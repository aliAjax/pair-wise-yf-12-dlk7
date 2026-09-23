import assert from "node:assert";
import { precheckDrafts, distanceKm, type SitingDraft } from "../src/business/sitingRules";
import {
  STATUS_CANDIDATE,
  STATUS_OPEN,
  STATUS_PENDING,
  type StationRecord
} from "../src/business/stationStore";
import {
  cancelPending,
  openStation,
  runBatchPrecheck,
  sweepOverdue
} from "../src/business/sitingFlow";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("PASS:", name);
}

function station(partial: Partial<StationRecord>): StationRecord {
  return {
    id: Math.random().toString(36).slice(2),
    station: "站",
    area: "东区",
    stock: 0,
    manager: "",
    status: STATUS_OPEN,
    notes: "",
    createdAt: new Date().toISOString(),
    ...partial
  };
}

// 距离：沿纬线每经度约 85km（纬度 40），0.05 度 ≈ 4.27km < 5km；0.06 度 ≈ 5.12km > 5km
const base = { lng: 116.4, lat: 39.9 };
const nearKm = distanceKm(base, { lng: 116.45, lat: 39.9 });
const farKm = distanceKm(base, { lng: 116.46, lat: 39.9 });
ok("0.05度距离小于5km (" + nearKm.toFixed(2) + ")", nearKm < 5);
ok("0.06度距离大于5km (" + farKm.toFixed(2) + ")", farKm > 5);

// 场景1：同区域已有两座营业站，第三个名额可用
{
  const existing = [
    station({ area: "东区", lng: 116.0, lat: 39.9 }),
    station({ area: "东区", lng: 116.8, lat: 39.9 }),
    station({ area: "西区", lng: 115.0, lat: 39.9 })
  ];
  const drafts: SitingDraft[] = [
    { id: "d1", station: "东区三站", area: "东区", plannedOpenDate: "2026-12-01", lng: 116.4, lat: 39.9 }
  ];
  const result = precheckDrafts(drafts, existing);
  ok("名额未满且距离足够 -> 通过", result.accepted.length === 1 && result.rejected.length === 0);
}

// 场景2：同区域已有三座营业站 -> 拒绝（AREA_FULL）
{
  const existing = [
    station({ area: "东区", lng: 115.0, lat: 39.0 }),
    station({ area: "东区", lng: 115.4, lat: 39.0 }),
    station({ area: "东区", lng: 115.8, lat: 39.0 })
  ];
  const drafts: SitingDraft[] = [
    { id: "d1", station: "东区四站", area: "东区", plannedOpenDate: "2026-12-01", lng: 117.4, lat: 40.9 }
  ];
  const result = precheckDrafts(drafts, existing);
  ok("三座营业站 -> 拒绝", result.rejected.length === 1);
  ok("拒绝原因为区域名额", result.rejected[0].issues.some((i) => i.code === "AREA_FULL"));
}

// 场景3：距营业站不足5km -> 拒绝（TOO_CLOSE），不受其他区域影响
{
  const existing = [station({ area: "东区", lng: 116.4, lat: 39.9 })];
  const drafts: SitingDraft[] = [
    { id: "d1", station: "贴身站", area: "西区", plannedOpenDate: "2026-12-01", lng: 116.42, lat: 39.9 }
  ];
  const result = precheckDrafts(drafts, existing);
  ok("距离不足5km -> 拒绝", result.rejected.length === 1);
  ok("拒绝原因为距离", result.rejected[0].issues.some((i) => i.code === "TOO_CLOSE"));
}

// 场景4：库存紧张/暂停营业不算营业站，不参与名额与距离判定
{
  const existing = [
    station({ area: "东区", status: "库存紧张", lng: 116.4, lat: 39.9 }),
    station({ area: "东区", status: "暂停营业", lng: 116.41, lat: 39.9 })
  ];
  const drafts: SitingDraft[] = [
    { id: "d1", station: "新站", area: "东区", plannedOpenDate: "2026-12-01", lng: 116.42, lat: 39.9 }
  ];
  const result = precheckDrafts(drafts, existing);
  ok("非营业站不拦截 -> 通过", result.accepted.length === 1);
}

// 场景5：整批预检，同批先通过者占名额，第四个被拒绝
{
  const existing: StationRecord[] = [];
  const drafts: SitingDraft[] = [1, 2, 3, 4].map((n) => ({
    id: "d" + n,
    station: "东区批" + n,
    area: "东区",
    plannedOpenDate: "2026-12-01",
    lng: 110 + n, // 互相拉开超过5km
    lat: 36 + n
  }));
  const result = precheckDrafts(drafts, existing);
  ok("整批前三通过", result.accepted.length === 3);
  ok("整批第四个名额满拒绝", result.rejected.length === 1 && result.rejected[0].issues.some((i) => i.code === "AREA_FULL"));
}

// 场景6：待建站占用名额（营业2 + 待建1 = 3，新候选被拒）
{
  const existing = [
    station({ area: "东区", lng: 114.0, lat: 38.0 }),
    station({ area: "东区", lng: 114.8, lat: 38.0 }),
    station({ area: "东区", status: STATUS_PENDING, lng: 115.8, lat: 38.0 })
  ];
  const drafts: SitingDraft[] = [
    { id: "d1", station: "东区新", area: "东区", plannedOpenDate: "2026-12-01", lng: 117.0, lat: 39.5 }
  ];
  const result = precheckDrafts(drafts, existing);
  ok("待建占名额 -> 新候选被拒", result.rejected.length === 1);
}

// 场景7：完整流转 —— 候选→(预检)待建→取消→候选；名额释放后可再次通过
{
  const records: StationRecord[] = [
    station({ station: "东一", area: "东区", lng: 114.0, lat: 38.0 }),
    station({ station: "东二", area: "东区", lng: 114.8, lat: 38.0 }),
    station({ station: "候选站", area: "东区", status: STATUS_CANDIDATE, lng: 116.0, lat: 39.0, plannedOpenDate: "2026-12-01", notes: "" })
  ];
  const summary = runBatchPrecheck(records);
  const candidate = records.find((r) => r.station === "候选站")!;
  ok("预检后进入待建", candidate.status === STATUS_PENDING && summary.acceptedCount === 1);
  const quota = records.filter((r) => r.area === "东区" && (r.status === STATUS_OPEN || r.status === STATUS_PENDING)).length;
  ok("待建占用名额 = 3", quota === 3);

  cancelPending(candidate);
  ok("取消后回到候选", candidate.status === STATUS_CANDIDATE);
  const quotaAfter = records.filter((r) => r.area === "东区" && (r.status === STATUS_OPEN || r.status === STATUS_PENDING)).length;
  ok("取消释放名额 = 2", quotaAfter === 2);

  const summary2 = runBatchPrecheck(records);
  ok("名额释放后再次预检通过", summary2.acceptedCount === 1 && candidate.status === STATUS_PENDING);
}

// 场景8：逾期未开业转回候选，不占名额
{
  const records: StationRecord[] = [
    station({ station: "逾期站", area: "西区", status: STATUS_PENDING, plannedOpenDate: "2026-09-01", notes: "" }),
    station({ station: "未来站", area: "西区", status: STATUS_PENDING, plannedOpenDate: "2026-12-31", notes: "" })
  ];
  const swept = sweepOverdue(records, "2026-09-23");
  ok("逾期站转回候选数量=1", swept === 1);
  ok("逾期站为候选", records[0].status === STATUS_CANDIDATE);
  ok("未逾期保持待建", records[1].status === STATUS_PENDING);
  const used = records.filter((r) => r.area === "西区" && (r.status === STATUS_OPEN || r.status === STATUS_PENDING)).length;
  ok("逾期后名额只剩1", used === 1);
}

// 场景9：确认开业 -> 营业中
{
  const rec = station({ status: STATUS_PENDING });
  openStation(rec);
  ok("待建开业为营业中", rec.status === STATUS_OPEN);
}

// 场景10：无效经纬度/日期 -> INVALID
{
  const existing: StationRecord[] = [];
  const drafts: SitingDraft[] = [
    { id: "d1", station: "坏点", area: "东区", plannedOpenDate: "", lng: 999, lat: NaN }
  ];
  const result = precheckDrafts(drafts, existing);
  ok("无效录入被拒", result.rejected[0].issues.some((i) => i.code === "INVALID"));
}

console.log("\n全部 " + passed + " 项断言通过");
