// 业务文件：浏览器存储持久化
// 负责油站数据与区域筛选的加载、保存、刷新保留，以及加载时的逾期状态迁移。

import { sweepOverdue, type StationRecord } from "./stationFlow";

export const STORAGE_KEY = "hxwlfront-21-station-map";
const FILTER_KEY = "hxwlfront-21-area-filter";

/** 给首批内置油站补经纬度（表单、列表、图表不变，仅供地图与选址距离判定使用） */
export const SEED_COORDINATES: Record<string, { lat: number; lng: number }> = {
  "seed-1": { lat: 30.6586, lng: 104.0648 }, // 东区一站（成都东二环）
  "seed-2": { lat: 30.5742, lng: 103.9546 } // 机场快线站（双流机场方向）
};

function normalize(record: Partial<StationRecord>): StationRecord {
  return {
    ...record,
    station: String(record.station ?? ""),
    area: String(record.area ?? ""),
    status: String(record.status ?? ""),
    notes: String(record.notes ?? "暂无备注"),
    createdAt: String(record.createdAt ?? new Date().toISOString()),
    id: String(record.id ?? crypto.randomUUID()),
    lat: typeof record.lat === "number" ? record.lat : undefined,
    lng: typeof record.lng === "number" ? record.lng : undefined,
    plannedDate: typeof record.plannedDate === "string" ? record.plannedDate : undefined,
    rejectReason: typeof record.rejectReason === "string" ? record.rejectReason : ""
  };
}

/**
 * 加载油站：无存储时使用内置种子；加载后立即执行逾期迁移——
 * 待建站超过拟营业日期仍未开业的，转回候选且不占名额。
 */
export function loadStations(seed: readonly Partial<StationRecord>[]): StationRecord[] {
  let stations: StationRecord[] = [];
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    stations = seed.map((record, index) => {
      const id = record.id ?? `seed-${index + 1}`;
      return normalize({
        ...record,
        id,
        ...(SEED_COORDINATES[id] || {})
      });
    });
  } else {
    try {
      const parsed = JSON.parse(raw) as Partial<StationRecord>[];
      stations = Array.isArray(parsed) ? parsed.map(normalize) : [];
    } catch {
      stations = [];
    }
  }

  const reverted = sweepOverdue(stations);
  if (reverted.length) saveStations(stations);
  return stations;
}

export function saveStations(stations: readonly StationRecord[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stations));
}

export function loadFilter(fallback: string): string {
  return localStorage.getItem(FILTER_KEY) || fallback;
}

export function saveFilter(filter: string): void {
  localStorage.setItem(FILTER_KEY, filter);
}
