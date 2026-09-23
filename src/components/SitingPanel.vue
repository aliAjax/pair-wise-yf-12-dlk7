<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from "vue";
import {
  AREAS,
  STATUS_CANDIDATE,
  STATUS_PENDING,
  areaQuota,
  plannedDeadline,
  type StationRecord
} from "../business/stationFlow";
import { MIN_DISTANCE_KM, validateDraft, type SitingDraft } from "../business/siting";

const props = defineProps<{
  stations: readonly StationRecord[];
  /** 最近一次整批预检结果：id -> 是否通过/原因 */
  lastResults: { accepted: Set<string>; reasons: Map<string, string> };
}>();

const emit = defineEmits<{
  (e: "add-draft", draft: SitingDraft): void;
  (e: "precheck", ids: string[]): void;
  (e: "cancel-pending", id: string): void;
  (e: "open", id: string): void;
  (e: "remove-candidate", id: string): void;
}>();

const blank = (): SitingDraft => ({
  station: "",
  area: AREAS[0],
  lat: 30.65,
  lng: 104.05,
  plannedDate: ""
});

const form = reactive<SitingDraft>(blank());
const formError = ref("");
const selected = ref<Set<string>>(new Set());
const now = ref(Date.now());
const timer = window.setInterval(() => (now.value = Date.now()), 30_000);
onBeforeUnmount(() => window.clearInterval(timer));

const quotas = computed(() => AREAS.map((area) => areaQuota(props.stations, area)));
const candidates = computed(() => props.stations.filter((item) => item.status === STATUS_CANDIDATE));
const pending = computed(() => props.stations.filter((item) => item.status === STATUS_PENDING));

const allChecked = computed(
  () => candidates.value.length > 0 && candidates.value.every((item) => selected.value.has(item.id))
);

function toggleAll() {
  if (allChecked.value) {
    selected.value = new Set();
  } else {
    selected.value = new Set(candidates.value.map((item) => item.id));
  }
}

function toggleOne(id: string) {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

function addDraft() {
  const errors = validateDraft({ ...form });
  if (errors.length) {
    formError.value = errors.join("；");
    return;
  }
  formError.value = "";
  emit("add-draft", { ...form, station: form.station.trim() });
  Object.assign(form, blank());
}

function runPrecheck() {
  const ids = candidates.value.map((item) => item.id).filter((id) => selected.value.has(id));
  if (ids.length === 0) return;
  emit("precheck", ids);
}

function daysLeft(record: StationRecord): number | null {
  const deadline = plannedDeadline(record.plannedDate);
  if (deadline === null) return null;
  return Math.ceil((deadline - now.value) / 86_400_000);
}

function resultOf(id: string): "accepted" | "rejected" | "" {
  if (props.lastResults.accepted.has(id)) return "accepted";
  if (props.lastResults.reasons.has(id)) return "rejected";
  return "";
}
</script>

<template>
  <section class="panel siting-panel">
    <h2>新站选址占用</h2>
    <p class="siting-rule">
      录入经纬度与拟营业日期后整批预检：同区域已有三座营业站，或与任一营业站距离不足
      {{ MIN_DISTANCE_KM }} 公里即拒绝；通过后进入<strong>待建</strong>并占用区域名额，取消即释放；逾期未开业转回候选且不占名额。
    </p>

    <div class="quota-chips">
      <span
        v-for="quota in quotas"
        :key="quota.area"
        class="quota-chip"
        :class="{ full: quota.remaining === 0 }"
      >
        {{ quota.area }}：营业 {{ quota.operating }} / 待建 {{ quota.pending }} / 名额
        {{ quota.capacity }}（余 {{ quota.remaining }}）
      </span>
    </div>

    <div class="form-grid">
      <label>
        站点名称
        <input v-model="form.station" placeholder="如：南区三站" />
      </label>
      <label>
        区域
        <select v-model="form.area">
          <option v-for="area in AREAS" :key="area">{{ area }}</option>
        </select>
      </label>
      <div class="form-row">
        <label>
          纬度
          <input v-model.number="form.lat" type="number" step="0.000001" min="-90" max="90" />
        </label>
        <label>
          经度
          <input v-model.number="form.lng" type="number" step="0.000001" min="-180" max="180" />
        </label>
      </div>
      <label>
        拟营业日期
        <input v-model="form.plannedDate" type="date" :min="new Date().toISOString().slice(0, 10)" required />
      </label>
      <p v-if="formError" class="form-error">{{ formError }}</p>
      <button type="button" @click="addDraft">加入候选批量</button>
    </div>

    <div class="siting-block">
      <div class="siting-head">
        <h3>候选批量（{{ candidates.length }}）</h3>
        <button type="button" :disabled="selected.size === 0" @click="runPrecheck">
          整批预检{{ selected.size ? `（${selected.size}）` : "" }}
        </button>
      </div>
      <div v-if="candidates.length === 0" class="empty">暂无候选站点</div>
      <table v-else class="siting-table">
        <thead>
          <tr>
            <th class="col-check"><input type="checkbox" :checked="allChecked" @change="toggleAll" /></th>
            <th>站点 / 区域</th>
            <th>经纬度</th>
            <th>拟营业日期</th>
            <th>预检结果</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in candidates" :key="record.id">
            <td class="col-check">
              <input type="checkbox" :checked="selected.has(record.id)" @change="toggleOne(record.id)" />
            </td>
            <td>{{ record.station }}<br /><small>{{ record.area }}</small></td>
            <td><small>{{ record.lat?.toFixed(4) }}, {{ record.lng?.toFixed(4) }}</small></td>
            <td><small>{{ record.plannedDate }}</small></td>
            <td>
              <span v-if="resultOf(record.id) === 'accepted'" class="badge ok">已通过·占名额</span>
              <span v-else-if="resultOf(record.id) === 'rejected'" class="badge no">已拒绝</span>
              <span v-else-if="record.rejectReason" class="badge no">待复检</span>
              <span v-else class="badge">待预检</span>
              <small v-if="lastResults.reasons.get(record.id)" class="reject-reason">
                {{ lastResults.reasons.get(record.id) }}
              </small>
              <small v-else-if="record.rejectReason" class="reject-reason">{{ record.rejectReason }}</small>
            </td>
            <td>
              <button class="secondary mini" type="button" @click="emit('remove-candidate', record.id)">
                移除
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="siting-block">
      <h3>待建站（占用名额，{{ pending.length }}）</h3>
      <div v-if="pending.length === 0" class="empty">暂无待建站</div>
      <ul v-else class="pending-list">
        <li v-for="record in pending" :key="record.id">
          <div>
            <strong>{{ record.station }}</strong>
            <small>{{ record.area }} · 拟营业 {{ record.plannedDate }}</small>
            <small v-if="daysLeft(record) !== null" :class="{ overdue: daysLeft(record)! < 0 }">
              {{ daysLeft(record)! < 0
                ? `已逾期 ${Math.abs(daysLeft(record)!)} 天，待自动转回候选`
                : `剩余 ${daysLeft(record)} 天开业` }}
            </small>
          </div>
          <div class="actions">
            <button class="mini" type="button" @click="emit('open', record.id)">确认开业</button>
            <button class="secondary mini" type="button" @click="emit('cancel-pending', record.id)">
              取消（释放名额）
            </button>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>
