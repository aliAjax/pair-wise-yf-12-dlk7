// 业务文件：新站选址判定（整批预检）
// 拒绝条件（满足任一即拒绝，不占用名额）：
//   1. 同区域已有三座营业站；
//   2. 与任一营业站的球面距离不足五公里。

import {
  STATUS_PENDING,
  areaQuota,
  isOperatingStation,
  type StationRecord
} from "./stationFlow";

export const MIN_DISTANCE_KM = 5;

export interface SitingDraft {
  id?: string;
  station: string;
  area: string;
  lat: number;
  lng: number;
  plannedDate: string;
}

export type SitingVerdict = "pending" | "rejected";

export interface SitingResult {
  draft: SitingDraft;
  verdict: SitingVerdict;
  /** 拒绝原因，仅 rejected 有值 */
  reason?: string;
  /** 通过时占用名额的目标区域 */
  occupyArea?: string;
  distanceKm?: number;
}

const EARTH_RADIUS_KM = 6371;

const toRad = (degree: number) => (degree * Math.PI) / 180;

/** Haversine 球面距离（公里） */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function validCoordinates(lat: unknown, lng: unknown): boolean {
  const la = Number(lat);
  const ln = Number(lng);
  return (
    Number.isFinite(la) &&
    Number.isFinite(ln) &&
    la >= -90 && la <= 90 &&
    ln >= -180 && ln <= 180
  );
}

/** 表单单条预校验，返回错误信息数组（空数组表示通过） */
export function validateDraft(draft: SitingDraft): string[] {
  const errors: string[] = [];
  if (!draft.station.trim()) errors.push("请填写站点名称");
  if (!draft.area) errors.push("请选择区域");
  if (!validCoordinates(draft.lat, draft.lng)) {
    errors.push("经纬度无效（纬度 -90~90，经度 -180~180）");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.plannedDate || "")) {
    errors.push("请填写拟营业日期");
  } else if (new Date(`${draft.plannedDate}T23:59:59`).getTime() < Date.now()) {
    errors.push("拟营业日期不能早于今天");
  }
  return errors;
}

function nearestOperating(
  draft: SitingDraft,
  stations: readonly StationRecord[]
): { station: StationRecord; distance: number } | null {
  let nearest: { station: StationRecord; distance: number } | null = null;
  for (const record of stations) {
    if (!isOperatingStation(record)) continue;
    if (typeof record.lat !== "number" || typeof record.lng !== "number") continue;
    const distance = distanceKm(
      { lat: draft.lat, lng: draft.lng },
      { lat: record.lat, lng: record.lng }
    );
    if (!nearest || distance < nearest.distance) {
      nearest = { station: record, distance };
    }
  }
  return nearest;
}

/**
 * 整批预检：按提交顺序逐条判定；同一条被拒不再占用名额，
 * 本批先通过的待建站会计入后续条目的区域名额，保证整批结果确定。
 * 距离仅与现有营业站比较（暂停营业站不参与）。
 */
export function precheckBatch(
  drafts: readonly SitingDraft[],
  stations: readonly StationRecord[]
): SitingResult[] {
  // 以现有存量为基础模拟名额占用，不修改真实数据
  const simulated: StationRecord[] = stations.map((record) => ({ ...record }));
  const results: SitingResult[] = [];

  for (const draft of drafts) {
    const errors = validateDraft(draft);
    if (errors.length) {
      results.push({ draft, verdict: "rejected", reason: errors.join("；") });
      continue;
    }

    const quota = areaQuota(simulated, draft.area);
    if (quota.operating >= quota.capacity) {
      results.push({
        draft,
        verdict: "rejected",
        reason: `${draft.area}已有${quota.capacity}座营业站，名额已满`
      });
      continue;
    }
    if (quota.remaining <= 0) {
      results.push({
        draft,
        verdict: "rejected",
        reason: `${draft.area}营业站与待建站名额已满（营业${quota.operating}/待建${quota.pending}，上限${quota.capacity}）`
      });
      continue;
    }

    const nearest = nearestOperating(draft, simulated);
    if (nearest && nearest.distance < MIN_DISTANCE_KM) {
      results.push({
        draft,
        verdict: "rejected",
        reason: `与营业站「${nearest.station.station ?? nearest.station.id}」相距仅${nearest.distance.toFixed(2)}公里，不足${MIN_DISTANCE_KM}公里`,
        distanceKm: nearest.distance
      });
      continue;
    }

    // 通过：在模拟集中放入待建站，占用本批后续条目的区域名额
    simulated.push({
      id: draft.id || crypto.randomUUID(),
      station: draft.station.trim(),
      area: draft.area,
      lat: draft.lat,
      lng: draft.lng,
      plannedDate: draft.plannedDate,
      status: STATUS_PENDING,
      notes: "",
      rejectReason: "",
      createdAt: new Date().toISOString()
    });
    results.push({
      draft,
      verdict: "pending",
      occupyArea: draft.area,
      distanceKm: nearest?.distance
    });
  }

  return results;
}
