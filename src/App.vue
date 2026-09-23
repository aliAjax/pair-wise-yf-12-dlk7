<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import StationMap from "./components/StationMap.vue";
import {
  AREAS,
  STATUS_CANDIDATE,
  STATUS_OPEN,
  STATUS_PENDING,
  saveRecords,
  useStationStore,
  type StationRecord
} from "./business/stationStore";
import { validateDraftInput } from "./business/sitingRules";
import {
  cancelPending,
  isOverdue,
  openStation,
  runBatchPrecheck,
  sitingRuleSummary,
  sweepOverdue,
  type BatchPrecheckSummary
} from "./business/sitingFlow";

type Field = {
  key: string;
  label: string;
  type?: "number" | "date" | "select";
  options?: readonly string[];
};

const project = {
  "number": 21,
  "folder": "hxwl/frontend/hxwlfront-21",
  "framework": "vue",
  "title": "油站网点地图管理",
  "subtitle": "维护油站位置、营业状态和库存摘要。",
  "industry": "石油",
  "stack": [
    "Vue3",
    "Vite",
    "TypeScript",
    "Element Plus",
    "Leaflet"
  ],
  "storageKey": "hxwlfront-21-station-map",
  "formTitle": "新增油站",
  "primaryAction": "保存油站",
  "entityLabel": "油站",
  "statuses": [
    "营业中",
    "暂停营业",
    "库存紧张"
  ],
  "filters": [
    "全部区域",
    "东区",
    "西区",
    "机场线"
  ],
  "fields": [
    {
      "key": "station",
      "label": "油站名称"
    },
    {
      "key": "area",
      "label": "区域",
      "type": "select",
      "options": [
        "东区",
        "西区",
        "机场线"
      ]
    },
    {
      "key": "stock",
      "label": "库存摘要L",
      "type": "number"
    },
    {
      "key": "manager",
      "label": "负责人"
    }
  ],
  "metricLabels": [
    "油站数",
    "营业中",
    "库存紧张"
  ]
} as const;

const fields = project.fields as readonly Field[];
const statuses = [...project.statuses];

function createBlank() {
  return Object.fromEntries(fields.map((field) => [field.key, field.type === "number" ? 0 : ""]));
}

// 数据来自持久化业务文件：localStorage 读取 + 深度 watch 落盘，刷新保留
const { records } = useStationStore();
const form = reactive<Record<string, string | number>>(createBlank());
const note = ref("");
const filter = ref(project.filters[0]);

function matchesFilter(record: StationRecord) {
  if (filter.value.startsWith("全部")) return true;
  return Object.values(record).includes(filter.value);
}

const filteredRecords = computed(() => records.value.filter(matchesFilter));

const metrics = computed(() => {
  const total = records.value.length;
  const second = records.value.filter((record) => record.status === statuses[1]).length;
  const third = records.value.filter((record) => record.status === statuses[2]).length;
  const numberValues = records.value.flatMap((record) =>
    fields.filter((field) => field.type === "number").map((field) => Number(record[field.key] || 0))
  );
  const sum = numberValues.reduce((acc, value) => acc + value, 0);
  return [total, second || sum, third || Math.round(sum / Math.max(total, 1))];
});

const chartRows = computed(() => statuses.map((status) => ({
  status,
  value: records.value.filter((record) => record.status === status).length
})));

const maxChart = computed(() => Math.max(1, ...chartRows.value.map((row) => row.value)));

function persist() {
  saveRecords(records.value);
}

function nextStatus(status: string) {
  const index = statuses.indexOf(status);
  return statuses[(index + 1) % statuses.length];
}

function primaryText(record: StationRecord) {
  const first = fields[0];
  const second = fields[1];
  return [record[first.key], record[second.key]].filter(Boolean).join(" / ") || project.entityLabel;
}

function submit() {
  records.value = [
    {
      ...form,
      id: crypto.randomUUID(),
      status: statuses[0],
      notes: note.value || "暂无备注",
      createdAt: new Date().toISOString()
    } as StationRecord,
    ...records.value
  ];
  Object.assign(form, createBlank());
  note.value = "";
  persist();
}

function flow(record: StationRecord) {
  // 候选/待建走选址专属流转，不能被网点页的循环流转按钮带偏
  if (record.status === STATUS_CANDIDATE || record.status === STATUS_PENDING) return;
  record.status = nextStatus(record.status);
  persist();
}

function remove(id: string) {
  records.value = records.value.filter((record) => record.id !== id);
  // 删除待建站同样释放名额（名额由状态派生）
  persist();
}

/* ---------------- 新站选址占用 ---------------- */

const sitingForm = reactive({
  station: "",
  area: AREAS[0],
  lng: NaN,
  lat: NaN,
  plannedOpenDate: ""
});
const formError = ref("");
const picking = ref(false);
const precheckSummary = ref<BatchPrecheckSummary | null>(null);
const todayValue = new Date().toISOString().slice(0, 10);

const candidates = computed(() =>
  records.value.filter((record) => record.status === STATUS_CANDIDATE && matchesFilter(record))
);
const pendingList = computed(() =>
  records.value.filter((record) => record.status === STATUS_PENDING && matchesFilter(record))
);

/** 区域名额：营业中 + 待建；候选不占名额 */
const quotaRows = computed(() =>
  AREAS.filter((area) => filter.value.startsWith("全部") || filter.value === area).map((area) => {
    const used = records.value.filter(
      (record) => record.area === area && (record.status === STATUS_OPEN || record.status === STATUS_PENDING)
    ).length;
    return { area, used, total: 3 };
  })
);

function resetSitingForm() {
  sitingForm.station = "";
  sitingForm.lng = NaN;
  sitingForm.lat = NaN;
  sitingForm.plannedOpenDate = "";
  formError.value = "";
}

/** 录入经纬度和拟营业日期后先建候选卡（不占名额），再整批预检 */
function addCandidate() {
  const issues = validateDraftInput(sitingForm);
  if (issues.length > 0) {
    formError.value = issues.map((issue) => issue.message).join("；");
    return;
  }
  formError.value = "";
  const record: StationRecord = {
    id: crypto.randomUUID(),
    station: sitingForm.station.trim(),
    area: sitingForm.area,
    stock: 0,
    manager: "",
    lng: Number(sitingForm.lng),
    lat: Number(sitingForm.lat),
    plannedOpenDate: sitingForm.plannedOpenDate,
    status: STATUS_CANDIDATE,
    notes: "选址候选，等待整批预检",
    createdAt: new Date().toISOString()
  };
  records.value = [...records.value, record];
  persist();
  resetSitingForm();
  precheckSummary.value = null;
}

function precheckAll() {
  precheckSummary.value = runBatchPrecheck(records.value);
  persist();
}

function onMapPick(payload: { lng: number; lat: number }) {
  sitingForm.lng = payload.lng;
  sitingForm.lat = payload.lat;
  formError.value = "";
}

function cancel(record: StationRecord) {
  cancelPending(record);
  persist();
}

function openForBusiness(record: StationRecord) {
  openStation(record);
  persist();
}

function overdue(record: StationRecord) {
  return isOverdue(record, todayValue);
}

let overdueTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  // 打开页面时先扫一次逾期，之后定时巡检（逾期未开业转回候选并释放名额）
  if (sweepOverdue(records.value) > 0) persist();
  overdueTimer = setInterval(() => {
    if (sweepOverdue(records.value) > 0) persist();
  }, 30000);
});

onBeforeUnmount(() => {
  if (overdueTimer) clearInterval(overdueTimer);
});
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">{{ project.industry }}行业前端最小闭环</p>
          <h1>{{ project.title }}</h1>
          <p class="subtitle">{{ project.subtitle }}</p>
        </div>
        <div class="stack">
          <span v-for="item in project.stack" :key="item" class="tag">{{ item }}</span>
        </div>
      </header>

      <section class="metrics">
        <article v-for="(label, index) in project.metricLabels" :key="label" class="metric">
          <span>{{ label }}</span>
          <strong>{{ metrics[index] }}</strong>
        </article>
      </section>

      <section class="workspace">
        <form class="panel" @submit.prevent="submit">
          <h2>{{ project.formTitle }}</h2>
          <div class="form-grid">
            <label v-for="field in fields" :key="field.key">
              {{ field.label }}
              <select v-if="field.type === 'select'" v-model="form[field.key]" required>
                <option value="">请选择</option>
                <option v-for="option in field.options" :key="option">{{ option }}</option>
              </select>
              <input v-else v-model="form[field.key]" :type="field.type || 'text'" required />
            </label>
            <label>
              备注
              <textarea v-model="note" placeholder="填写处理说明或现场备注" />
            </label>
            <button type="submit">{{ project.primaryAction }}</button>
          </div>
        </form>

        <section class="list-panel">
          <div class="toolbar">
            <h2>{{ project.entityLabel }}列表</h2>
            <select v-model="filter">
              <option v-for="item in project.filters" :key="item">{{ item }}</option>
            </select>
          </div>

          <div class="record-grid">
            <div v-if="filteredRecords.length === 0" class="empty">暂无匹配数据</div>
            <article v-for="record in filteredRecords" :key="record.id" class="record">
              <div class="record-head">
                <p class="record-title">{{ primaryText(record) }}</p>
                <span class="status" :class="{ 'status-pending': record.status === STATUS_PENDING, 'status-candidate': record.status === STATUS_CANDIDATE }">{{ record.status }}</span>
              </div>
              <div class="details">
                <span v-for="field in fields" :key="field.key">{{ field.label }}: {{ record[field.key] }}</span>
              </div>
              <p class="note">{{ record.notes }}</p>
              <div class="actions">
                <button type="button" :disabled="record.status === STATUS_CANDIDATE || record.status === STATUS_PENDING" @click="flow(record)">流转状态</button>
                <button class="secondary" type="button" @click="navigator.clipboard?.writeText(primaryText(record))">复制摘要</button>
                <button class="danger" type="button" @click="remove(record.id)">删除</button>
              </div>
            </article>
          </div>

          <div class="mini-chart">
            <div v-for="row in chartRows" :key="row.status" class="bar">
              <span>{{ row.status }}</span>
              <div class="bar-track"><div class="bar-fill" :style="{ width: `${(row.value / maxChart) * 100}%` }" /></div>
              <strong>{{ row.value }}</strong>
            </div>
          </div>
        </section>
      </section>

      <section class="siting">
        <div class="siting-head">
          <div>
            <h2>新站选址占用</h2>
            <p class="siting-rule">规则：{{ sitingRuleSummary() }}；通过后进入待建并占用区域名额，取消即释放；逾期未开业转回候选且不占名额。</p>
          </div>
          <div class="quota-chips">
            <span v-for="row in quotaRows" :key="row.area" class="quota-chip" :class="{ full: row.used >= row.total }">
              {{ row.area }}名额 {{ row.used }}/{{ row.total }}
            </span>
          </div>
        </div>

        <div class="siting-grid">
          <form class="panel" @submit.prevent="addCandidate">
            <h3>录入选址</h3>
            <div class="form-grid">
              <label>
                站点名称
                <input v-model="sitingForm.station" placeholder="如：东区三站" required />
              </label>
              <label>
                区域
                <select v-model="sitingForm.area">
                  <option v-for="area in AREAS" :key="area">{{ area }}</option>
                </select>
              </label>
              <label>
                经度
                <input v-model.number="sitingForm.lng" type="number" step="0.000001" min="-180" max="180" placeholder="116.40" required />
              </label>
              <label>
                纬度
                <input v-model.number="sitingForm.lat" type="number" step="0.000001" min="-90" max="90" placeholder="39.91" required />
              </label>
              <label>
                拟营业日期
                <input v-model="sitingForm.plannedOpenDate" type="date" :min="todayValue" required />
              </label>
              <button class="secondary" type="button" :class="{ active: picking }" @click="picking = !picking">
                {{ picking ? "正在地图取点（点击地图）" : "从地图取点" }}
              </button>
              <p v-if="Number.isFinite(sitingForm.lng) && Number.isFinite(sitingForm.lat)" class="coord-hint">
                已选坐标：{{ sitingForm.lng }}, {{ sitingForm.lat }}
              </p>
              <p v-if="formError" class="form-error">{{ formError }}</p>
              <button type="submit">加入候选（不占名额）</button>
            </div>
          </form>

          <div class="panel siting-col">
            <div class="siting-col-head">
              <h3>候选站点 · {{ candidates.length }}</h3>
              <button type="button" :disabled="candidates.length === 0" @click="precheckAll">整批预检</button>
            </div>
            <p v-if="precheckSummary" class="precheck-summary">{{ precheckSummary.message }}</p>
            <div v-if="candidates.length === 0" class="empty">暂无候选，录入经纬度和拟营业日期后加入</div>
            <article v-for="record in candidates" :key="record.id" class="siting-card">
              <div class="record-head">
                <p class="record-title">{{ record.station }}</p>
                <span class="status status-candidate">候选</span>
              </div>
              <div class="details">
                <span>区域: {{ record.area }}</span>
                <span>拟营业: {{ record.plannedOpenDate }}</span>
                <span>经纬度: {{ record.lng }}, {{ record.lat }}</span>
              </div>
              <p v-if="record.rejectReason" class="reject-reason">拒绝原因：{{ record.rejectReason }}</p>
              <div class="actions">
                <button class="danger" type="button" @click="remove(record.id)">移除候选</button>
              </div>
            </article>
          </div>

          <div class="panel siting-col">
            <div class="siting-col-head">
              <h3>待建站点（占名额）· {{ pendingList.length }}</h3>
            </div>
            <div v-if="pendingList.length === 0" class="empty">预检通过后进入待建</div>
            <article v-for="record in pendingList" :key="record.id" class="siting-card">
              <div class="record-head">
                <p class="record-title">{{ record.station }}</p>
                <span class="status" :class="overdue(record) ? 'status-overdue' : 'status-pending'">
                  {{ overdue(record) ? "逾期未开业" : "待建" }}
                </span>
              </div>
              <div class="details">
                <span>区域: {{ record.area }}</span>
                <span>拟营业: {{ record.plannedOpenDate }}</span>
                <span>经纬度: {{ record.lng }}, {{ record.lat }}</span>
              </div>
              <div class="actions">
                <button type="button" @click="openForBusiness(record)">确认开业</button>
                <button class="secondary" type="button" @click="cancel(record)">取消（释放名额）</button>
              </div>
            </article>
          </div>
        </div>

        <div class="map-panel">
          <div class="toolbar">
            <h3>网点地图</h3>
            <div class="legend">
              <span><i class="legend-dot" style="background:#14724f"></i>营业中</span>
              <span><i class="legend-dot" style="background:#69758c"></i>暂停营业</span>
              <span><i class="legend-dot" style="background:#d08a14"></i>库存紧张</span>
              <span><i class="legend-dot" style="background:#176b87"></i>待建</span>
              <span><i class="legend-dot legend-dot-ring" style="border-color:#e0a800"></i>候选</span>
            </div>
          </div>
          <StationMap :records="filteredRecords" :pickable="picking" @pick="onMapPick" />
        </div>
      </section>
    </div>
  </main>
</template>
