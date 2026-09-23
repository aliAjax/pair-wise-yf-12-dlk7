import {
  STATUS_OPEN,
  STATUS_PENDING,
  type StationRecord
} from "./stationStore";

/** 选址硬性规则：同区域最多三座营业站，且与任一营业站距离不得不足五公里 */
export const AREA_CAPACITY = 3;
export const MIN_DISTANCE_KM = 5;
/** 地球平均半径（公里），用于大圆距离计算 */
const EARTH_RADIUS_KM = 6371;

export interface LatLng {
  lng: number;
  lat: number;
}

/** 一次整批预检中的录入草稿：id 为空表示尚未建卡 */
export interface SitingDraft {
  id: string;
  station: string;
  area: string;
  plannedOpenDate: string;
  lng: number;
  lat: number;
}

export type RejectCode = "INVALID" | "AREA_FULL" | "TOO_CLOSE";

export interface PrecheckIssue {
  code: RejectCode;
  message: string;
}

export interface PrecheckResult {
  accepted: SitingDraft[];
  rejected: Array<{ draft: SitingDraft; issues: PrecheckIssue[] }>;
}

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Haversine 公式计算两个经纬度之间的地表距离（公里） */
export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidLngLat(lng: number, lat: number): boolean {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= -180 &&
    lng <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

export function validateDraftInput(input: {
  station: string;
  area: string;
  plannedOpenDate: string;
  lng: number;
  lat: number;
}): PrecheckIssue[] {
  const issues: PrecheckIssue[] = [];
  if (!input.station.trim()) {
    issues.push({ code: "INVALID", message: "请填写站点名称" });
  }
  if (!input.area) {
    issues.push({ code: "INVALID", message: "请选择所在区域" });
  }
  if (!input.plannedOpenDate) {
    issues.push({ code: "INVALID", message: "请填写拟营业日期" });
  }
  if (!isValidLngLat(input.lng, input.lat)) {
    issues.push({ code: "INVALID", message: "经纬度无效（经度 -180~180，纬度 -90~90）" });
  }
  return issues;
}

function isOperating(record: StationRecord): boolean {
  return record.status === STATUS_OPEN;
}

/** 占用区域名额的站点：营业中 + 已通过预检的待建 */
export function occupiesQuota(record: StationRecord): boolean {
  return record.status === STATUS_OPEN || record.status === STATUS_PENDING;
}

/**
 * 整批预检：按录入顺序逐张判定，已接受的同批草稿同样占用名额
 * （整批不得使任一区域超过三座名额）。距离仅与营业中站点比较。
 */
export function precheckDrafts(
  drafts: SitingDraft[],
  existing: StationRecord[]
): PrecheckResult {
  const accepted: SitingDraft[] = [];
  const rejected: PrecheckResult["rejected"] = [];
  const occupied = new Map<string, number>();

  for (const record of existing) {
    if (occupiesQuota(record)) {
      occupied.set(record.area, (occupied.get(record.area) ?? 0) + 1);
    }
  }
  const operating = existing.filter(isOperating);

  for (const draft of drafts) {
    const issues = validateDraftInput(draft);
    const used = occupied.get(draft.area) ?? 0;

    if (!issues.some((issue) => issue.code === "INVALID")) {
      if (used >= AREA_CAPACITY) {
        issues.push({
          code: "AREA_FULL",
          message: `${draft.area}已有三座营业站（含待建名额 ${used} 个），区域名额已满`
        });
      }

      const near = operating
        .map((station) => ({
          station,
          distance: distanceKm(draft, { lng: Number(station.lng), lat: Number(station.lat) })
        }))
        .filter((item) => Number.isFinite(item.distance) && item.distance < MIN_DISTANCE_KM)
        .sort((a, b) => a.distance - b.distance)[0];

      if (near) {
        issues.push({
          code: "TOO_CLOSE",
          message: `距营业站「${near.station.station}」仅 ${near.distance.toFixed(2)} 公里，不足五公里`
        });
      }
    }

    if (issues.length > 0) {
      rejected.push({ draft, issues });
    } else {
      accepted.push(draft);
      occupied.set(draft.area, used + 1);
    }
  }

  return { accepted, rejected };
}
