import {
  STATUS_CANDIDATE,
  STATUS_OPEN,
  STATUS_PENDING,
  type StationRecord
} from "./stationStore";
import {
  AREA_CAPACITY,
  MIN_DISTANCE_KM,
  precheckDrafts,
  type SitingDraft
} from "./sitingRules";

export interface BatchPrecheckSummary {
  acceptedCount: number;
  rejectedCount: number;
  message: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 预检通过：候选 → 待建，占用区域名额；未通过保留为候选并记录原因 */
export function runBatchPrecheck(records: StationRecord[]): BatchPrecheckSummary {
  sweepOverdue(records);

  const candidates = records.filter((record) => record.status === STATUS_CANDIDATE);
  if (candidates.length === 0) {
    return { acceptedCount: 0, rejectedCount: 0, message: "候选列表为空，请先录入选址" };
  }

  const drafts: SitingDraft[] = candidates.map((record) => ({
    id: record.id,
    station: record.station,
    area: record.area,
    plannedOpenDate: String(record.plannedOpenDate ?? ""),
    lng: Number(record.lng),
    lat: Number(record.lat)
  }));

  const { accepted, rejected } = precheckDrafts(drafts, records);
  const acceptedIds = new Set(accepted.map((draft) => draft.id));
  const reasonById = new Map(rejected.map((item) => [item.draft.id, item.issues.map((issue) => issue.message).join("；")]));

  for (const record of candidates) {
    if (acceptedIds.has(record.id)) {
      record.status = STATUS_PENDING;
      record.rejectReason = undefined;
      record.notes = `选址预检通过，待建名额已占用（拟营业 ${record.plannedOpenDate}）`;
    } else {
      record.status = STATUS_CANDIDATE;
      record.rejectReason = reasonById.get(record.id) ?? "预检未通过";
      record.notes = "选址预检拒绝：" + (record.rejectReason ?? "");
    }
  }

  return {
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    message:
      accepted.length > 0
        ? `预检完成：${accepted.length} 座通过进入待建，${rejected.length} 座被拒绝`
        : `预检完成：${rejected.length} 座候选全部被拒绝`
  };
}

/** 取消待建：待建 → 候选，立即释放区域名额 */
export function cancelPending(record: StationRecord): void {
  if (record.status !== STATUS_PENDING) return;
  record.status = STATUS_CANDIDATE;
  record.notes = `已取消待建，区域名额已释放（原拟营业 ${record.plannedOpenDate ?? "-"}）`;
}

/** 待建站点开业：待建 → 营业中，继续占用名额 */
export function openStation(record: StationRecord): void {
  if (record.status !== STATUS_PENDING) return;
  record.status = STATUS_OPEN;
  record.notes = `已开业（拟营业 ${record.plannedOpenDate ?? "-"}）`;
}

/**
 * 逾期未开业：拟营业日期已过仍处待建的站点转回候选，名额随之释放。
 * 返回被转回的站点数量。
 */
export function sweepOverdue(records: StationRecord[], now: string = today()): number {
  let swept = 0;
  for (const record of records) {
    if (
      record.status === STATUS_PENDING &&
      typeof record.plannedOpenDate === "string" &&
      record.plannedOpenDate < now
    ) {
      record.status = STATUS_CANDIDATE;
      record.notes = `拟营业日期 ${record.plannedOpenDate} 已过仍未开业，转回候选并释放名额`;
      swept += 1;
    }
  }
  return swept;
}

export function isOverdue(record: StationRecord, now: string = today()): boolean {
  return (
    record.status === STATUS_PENDING &&
    typeof record.plannedOpenDate === "string" &&
    record.plannedOpenDate < now
  );
}

export function sitingRuleSummary(): string {
  return `同区域限 ${AREA_CAPACITY} 座营业站，距任一营业站须 ≥ ${MIN_DISTANCE_KM} 公里`;
}
