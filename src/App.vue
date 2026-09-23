<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import StationMap from "./components/StationMap.vue";
import SitingPanel from "./components/SitingPanel.vue";
import {
  STATUS_CANDIDATE,
  STATUS_PENDING,
  cancelPendingSite,
  cycleLegacyStatus,
  isSitingRecord,
  markPending,
  openSite,
  sweepOverdue,
  type StationRecord
} from "./business/stationFlow";
import { precheckBatch, type SitingDraft } from "./business/siting";
import { loadFilter, loadStations, saveFilter, saveStations } from "./business/stationStore";

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
  "records": [
    {
      "station": "东区一站",
      "area": "东区",
      "stock": 36000,
      "manager": "刘站长",
      "status": "营业中",
      "notes": "库存正常"
    },
    {
      "station": "机场快线站",
      "area": "机场线",
      "stock": 9000,
      "manager": "王站长",
      "status": "库存紧张",
      "notes": "柴油待补"
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

// 持久化：从浏览器存储加载（含逾期迁移），刷新后保留候选/待建状态与占用名额
const records = ref<StationRecord[]>(
  loadStations(project.records as readonly StationRecord[])
);
const form = reactive<Record<string, string | number>>(createBlank());
const note = ref("");
const filter = ref(loadFilter(project.filters[0]));

watch(filter, (value) => saveFilter(value));

const filteredRecords = computed(() => {
  if (filter.value.startsWith("全部")) return records.value;
  return records.value.filter((record) => Object.values(record).includes(filter.value));
});

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
  saveStations(records.value);
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
  // 候选/待建走选址状态机，不参与老三态循环
  if (cycleLegacyStatus(record)) persist();
}

function remove(id: string) {
  records.value = records.value.filter((record) => record.id !== id);
  persist();
}

// ---- 新站选址：候选录入、整批预检、待建流转 ----

const lastResults = ref<{ accepted: Set<string>; reasons: Map<string, string> }>({
  accepted: new Set(),
  reasons: new Map()
});

function addDraft(draft: SitingDraft) {
  records.value = [
    {
      id: crypto.randomUUID(),
      status: STATUS_CANDIDATE,
      notes: "候选站址，待整批预检",
      createdAt: new Date().toISOString(),
      station: draft.station,
      area: draft.area,
      lat: draft.lat,
      lng: draft.lng,
      plannedDate: draft.plannedDate,
      rejectReason: ""
    },
    ...records.value
  ];
  persist();
}

function runSweep(): boolean {
  const changed = sweepOverdue(records.value);
  if (changed.length) persist();
  return changed.length > 0;
}

// 定时把逾期未开业的待建站转回候选，名额同步释放
const sweepTimer = window.setInterval(runSweep, 30_000);
onBeforeUnmount(() => window.clearInterval(sweepTimer));

function runPrecheck(ids: string[]) {
  runSweep();
  const targets = records.value.filter(
    (record) => ids.includes(record.id) && record.status === STATUS_CANDIDATE
  );
  const drafts: SitingDraft[] = targets.map((record) => ({
    id: record.id,
    station: String(record.station ?? ""),
    area: String(record.area ?? ""),
    lat: Number(record.lat),
    lng: Number(record.lng),
    plannedDate: String(record.plannedDate ?? "")
  }));

  const results = precheckBatch(drafts, records.value);
  const accepted = new Set<string>();
  const reasons = new Map<string, string>();
  for (const result of results) {
    const target = targets.find((record) => record.id === result.draft.id);
    if (!target) continue;
    if (result.verdict === "pending") {
      markPending(target); // 通过 → 待建并占用区域名额
      accepted.add(target.id);
    } else {
      target.rejectReason = result.reason || "预检未通过"; // 拒绝不占名额
      reasons.set(target.id, result.reason || "预检未通过");
    }
  }
  lastResults.value = { accepted, reasons };
  persist();
}

function cancelPending(id: string) {
  runSweep();
  const record = records.value.find((item) => item.id === id && item.status === STATUS_PENDING);
  if (record) {
    cancelPendingSite(record); // 取消 → 候选，名额立即释放
    persist();
  }
}

function confirmOpen(id: string) {
  runSweep();
  const record = records.value.find((item) => item.id === id && item.status === STATUS_PENDING);
  if (record) {
    openSite(record); // 确认开业 → 营业中
    persist();
  }
}

function removeCandidate(id: string) {
  records.value = records.value.filter(
    (record) => !(record.id === id && record.status === STATUS_CANDIDATE)
  );
  persist();
}
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
                <span class="status">{{ record.status }}</span>
              </div>
              <div class="details">
                <span v-for="field in fields" :key="field.key">{{ field.label }}: {{ record[field.key] }}</span>
              </div>
              <p class="note">{{ record.notes }}</p>
              <div class="actions">
                <button
                  type="button"
                  :disabled="isSitingRecord(record)"
                  :title="isSitingRecord(record) ? '候选/待建站请在选址面板流转' : ''"
                  @click="flow(record)"
                >
                  流转状态
                </button>
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

      <section class="geo">
        <section class="panel map-panel">
          <div class="toolbar">
            <h2>网点地图</h2>
            <small>标记随上方区域筛选联动</small>
          </div>
          <StationMap :stations="filteredRecords" />
        </section>

        <SitingPanel
          :stations="records"
          :last-results="lastResults"
          @add-draft="addDraft"
          @precheck="runPrecheck"
          @cancel-pending="cancelPending"
          @open="confirmOpen"
          @remove-candidate="removeCandidate"
        />
      </section>
    </div>
  </main>
</template>
