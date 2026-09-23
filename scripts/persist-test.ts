// 持久化往返测试：候选/待建状态、坐标与日期写入 localStorage 后可还原
import { STORAGE_KEY, loadRecords, saveRecords, STATUS_PENDING } from "../src/business/stationStore";

const data = [
  {
    id: "p1",
    station: "持久站",
    area: "西区",
    stock: 0,
    manager: "",
    status: STATUS_PENDING,
    notes: "待建占用",
    createdAt: "2026-09-23T00:00:00.000Z",
    lng: 116.3,
    lat: 39.8,
    plannedOpenDate: "2026-12-01"
  }
];

saveRecords(data);
const raw = localStorage.getItem(STORAGE_KEY);
if (!raw) throw new Error("未写入 localStorage");
const parsed = JSON.parse(raw);
if (parsed[0].status !== STATUS_PENDING || parsed[0].lng !== 116.3 || parsed[0].plannedOpenDate !== "2026-12-01") {
  throw new Error("写入数据不符");
}

const loaded = loadRecords();
const found = loaded.find((r) => r.id === "p1");
if (!found || found.status !== STATUS_PENDING || found.lat !== 39.8) {
  throw new Error("读取还原失败");
}

// 老版本数据（无经纬度的种子 id）应被迁移补坐标
localStorage.setItem(
  STORAGE_KEY,
  JSON.stringify([{ id: "seed-1", station: "东区一站", area: "东区", stock: 36000, manager: "刘站长", status: "营业中", notes: "", createdAt: "" }])
);
const migrated = loadRecords();
if (typeof migrated[0].lng !== "number" || typeof migrated[0].lat !== "number") {
  throw new Error("旧种子坐标迁移失败");
}
console.log("PASS: 持久化往返 + 旧数据迁移正常（seed-1 ->", migrated[0].lng, migrated[0].lat + ")");
