import { ref, watch, type Ref } from "vue";

/** 浏览器存储键，沿用原网点页，保证旧数据可继续读取 */
export const STORAGE_KEY = "hxwlfront-21-station-map";

export const STATUS_OPEN = "营业中";
export const STATUS_PAUSED = "暂停营业";
export const STATUS_LOW_STOCK = "库存紧张";
/** 选址流程扩展状态：候选（不占名额）、待建（占用区域名额） */
export const STATUS_PENDING = "待建";
export const STATUS_CANDIDATE = "候选";

export const AREAS = ["东区", "西区", "机场线"] as const;

export interface StationRecord {
  id: string;
  status: string;
  notes: string;
  createdAt: string;
  station: string;
  area: string;
  stock: number;
  manager: string;
  /** 选址录入：经度、纬度、拟营业日期、预检拒绝原因 */
  lng?: number;
  lat?: number;
  plannedOpenDate?: string;
  rejectReason?: string;
  [key: string]: string | number | undefined;
}

function createSeeds(): StationRecord[] {
  return [
    {
      id: "seed-1",
      station: "东区一站",
      area: "东区",
      stock: 36000,
      manager: "刘站长",
      status: STATUS_OPEN,
      notes: "库存正常",
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      lng: 116.405,
      lat: 39.915
    },
    {
      id: "seed-2",
      station: "机场快线站",
      area: "机场线",
      stock: 9000,
      manager: "王站长",
      status: STATUS_LOW_STOCK,
      notes: "柴油待补",
      createdAt: new Date().toISOString(),
      lng: 116.604,
      lat: 40.079
    }
  ];
}

export function saveRecords(records: StationRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // 隐私模式或配额超限时静默降级，内存数据仍可用
  }
}

/** 读取并迁移历史数据：老种子记录没有经纬度，按 id 补回默认坐标 */
function normalize(raw: unknown): StationRecord[] {
  if (!Array.isArray(raw)) return createSeeds();
  const seedCoords = new Map(createSeeds().map((seed) => [seed.id, { lng: seed.lng, lat: seed.lat }]));
  return (raw as unknown[])
    .filter((item): item is StationRecord => !!item && typeof (item as StationRecord).id === "string")
    .map((item) => {
      if ((item.lng == null || item.lat == null) && seedCoords.has(item.id)) {
        const coord = seedCoords.get(item.id)!;
        item.lng = coord.lng;
        item.lat = coord.lat;
      }
      return item;
    });
}

export function loadRecords(): StationRecord[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seeds = createSeeds();
    saveRecords(seeds);
    return seeds;
  }
  try {
    return normalize(JSON.parse(raw));
  } catch {
    return createSeeds();
  }
}

// 模块级单例：表单、列表、图表、地图和选址面板共享同一份数据
const recordsRef: Ref<StationRecord[]> = ref(loadRecords());

// 任意业务流转（预检、取消、开业、逾期、删除）都自动落盘，刷新后保留
watch(recordsRef, (value) => saveRecords(value), { deep: true });

export function useStationStore() {
  return {
    records: recordsRef,
    persist: () => saveRecords(recordsRef.value)
  };
}
