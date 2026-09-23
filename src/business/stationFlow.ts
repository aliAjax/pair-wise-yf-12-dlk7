// 业务文件：油站状态流转与区域名额占用
// 新站选址生命周期：候选 --预检通过--> 待建（占用名额） --确认开业--> 营业中
//                          ^---取消占用 / 逾期未开业----|

export const STATUS_OPERATING = "营业中";
export const STATUS_PAUSED = "暂停营业";
export const STATUS_LOW_STOCK = "库存紧张";
export const STATUS_PENDING = "待建";
export const STATUS_CANDIDATE = "候选";

/** 原有三座油站状态，列表上的「流转状态」按钮只在这三者之间循环 */
export const LEGACY_STATUSES = [STATUS_OPERATING, STATUS_PAUSED, STATUS_LOW_STOCK];

export const AREAS = ["东区", "西区", "机场线"] as const;

/** 同区域营业/占位名额上限：三座 */
export const AREA_CAPACITY = 3;

export interface StationRecord {
  id: string;
  status: string;
  notes: string;
  createdAt: string;
  station?: string;
  area?: string;
  stock?: number;
  manager?: string;
  lat?: number;
  lng?: number;
  /** 拟营业日期，YYYY-MM-DD */
  plannedDate?: string;
  /** 预检拒绝原因 / 逾期退回原因 */
  rejectReason?: string;
  [key: string]: unknown;
}

/**
 * 营业站口径：营业中、库存紧张都算营业站（库存紧张只是库存告警，站点仍在营业）；
 * 暂停营业不计入营业站数量与距离判定。
 */
export function isOperatingStation(record: StationRecord): boolean {
  return record.status === STATUS_OPERATING || record.status === STATUS_LOW_STOCK;
}

export function isPendingSite(record: StationRecord): boolean {
  return record.status === STATUS_PENDING;
}

export function isCandidateSite(record: StationRecord): boolean {
  return record.status === STATUS_CANDIDATE;
}

/** 选址流程产生的两种状态，不走老的三态循环 */
export function isSitingRecord(record: StationRecord): boolean {
  return isPendingSite(record) || isCandidateSite(record);
}

export function areaOperatingCount(stations: readonly StationRecord[], area: string): number {
  return stations.filter((item) => item.area === area && isOperatingStation(item)).length;
}

export function areaPendingCount(stations: readonly StationRecord[], area: string): number {
  return stations.filter((item) => item.area === area && isPendingSite(item)).length;
}

export interface AreaQuota {
  area: string;
  operating: number;
  pending: number;
  capacity: number;
  remaining: number;
}

/** 区域名额：营业站 + 待建站（已占用名额）合计不超过三座 */
export function areaQuota(stations: readonly StationRecord[], area: string): AreaQuota {
  const operating = areaOperatingCount(stations, area);
  const pending = areaPendingCount(stations, area);
  return {
    area,
    operating,
    pending,
    capacity: AREA_CAPACITY,
    remaining: Math.max(0, AREA_CAPACITY - operating - pending)
  };
}

/** 拟营业日期的截止时刻：当天 23:59:59，当天仍不算逾期 */
export function plannedDeadline(plannedDate?: string): number | null {
  if (!plannedDate || !/^\d{4}-\d{2}-\d{2}$/.test(plannedDate)) return null;
  const time = new Date(`${plannedDate}T23:59:59`).getTime();
  return Number.isNaN(time) ? null : time;
}

/** 候选 → 待建：预检通过，占用区域名额 */
export function markPending(record: StationRecord): void {
  record.status = STATUS_PENDING;
  record.rejectReason = "";
}

/** 待建 → 候选：取消占用，名额立即释放（名额由状态实时算出） */
export function cancelPendingSite(record: StationRecord): void {
  if (record.status !== STATUS_PENDING) return;
  record.status = STATUS_CANDIDATE;
  record.rejectReason = "已取消待建，名额已释放，可修改后重新预检";
}

/** 待建 → 营业中：确认开业，占位转为正式营业名额 */
export function openSite(record: StationRecord): void {
  if (record.status !== STATUS_PENDING) return;
  record.status = STATUS_OPERATING;
  record.rejectReason = "";
}

/** 待建 → 候选：逾期未开业，名额释放 */
export function revertToCandidate(record: StationRecord, reason: string): void {
  record.status = STATUS_CANDIDATE;
  record.rejectReason = reason;
}

/**
 * 扫描逾期未开业的待建站，退回候选并释放名额。返回被退回的记录 id。
 */
export function sweepOverdue(stations: readonly StationRecord[], now: number = Date.now()): string[] {
  const changed: string[] = [];
  for (const record of stations) {
    if (!isPendingSite(record)) continue;
    const deadline = plannedDeadline(record.plannedDate);
    if (deadline !== null && now > deadline) {
      revertToCandidate(record, "拟营业日期已过且未开业，自动转回候选，名额已释放");
      changed.push(record.id);
    }
  }
  return changed;
}

/** 老三态循环流转；候选/待建返回 false 不参与 */
export function cycleLegacyStatus(record: StationRecord): boolean {
  const index = LEGACY_STATUSES.indexOf(record.status);
  if (index < 0) return false;
  record.status = LEGACY_STATUSES[(index + 1) % LEGACY_STATUSES.length];
  return true;
}
