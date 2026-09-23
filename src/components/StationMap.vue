<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  STATUS_CANDIDATE,
  STATUS_PENDING,
  isOperatingStation,
  type StationRecord
} from "../business/stationFlow";

const props = defineProps<{
  stations: readonly StationRecord[];
}>();

const mapEl = ref<HTMLElement | null>(null);
let mapInstance: ReturnType<typeof L.map> | null = null;
let markers: ReturnType<typeof L.marker>[] = [];

const DEFAULT_CENTER: [number, number] = [30.61, 104.01];
const DEFAULT_ZOOM = 11;

function colorOf(record: StationRecord): string {
  if (isOperatingStation(record)) return "#14724f"; // 营业站：绿
  if (record.status === STATUS_PENDING) return "#c98a04"; // 待建占用：琥珀
  if (record.status === STATUS_CANDIDATE) return "#6b7280"; // 候选：灰
  return "#c84b31"; // 暂停营业：红
}

function popupHtml(record: StationRecord): string {
  const lines = [
    `<strong>${record.station ?? record.id}</strong>`,
    `状态：${record.status}`,
    record.area ? `区域：${record.area}` : "",
    typeof record.lat === "number" ? `经纬度：${record.lat.toFixed(4)}, ${record.lng?.toFixed(4)}` : "",
    record.plannedDate ? `拟营业日期：${record.plannedDate}` : "",
    record.rejectReason ? `<span style="color:#c84b31">${record.rejectReason}</span>` : ""
  ].filter(Boolean);
  return lines.join("<br/>");
}

function drawMarkers() {
  if (!mapInstance) return;
  markers.forEach((item) => item.remove());
  markers = [];

  const bounds = L.latLngBounds();
  let count = 0;
  let single: [number, number] | null = null;
  for (const record of props.stations) {
    if (typeof record.lat !== "number" || typeof record.lng !== "number") continue;
    const coords: [number, number] = [record.lat, record.lng];
    const color = colorOf(record);
    const icon = L.divIcon({
      className: "station-pin",
      html: `<span style="--pin:${color}"></span>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });
    const marker = L.marker(coords, { title: record.station ?? record.id, icon })
      .bindPopup(popupHtml(record))
      .addTo(mapInstance);
    markers.push(marker);
    bounds.extend(coords);
    single = coords;
    count += 1;
  }

  if (count === 1 && single) {
    mapInstance.setView(single, 12);
  } else if (count > 1) {
    mapInstance.fitBounds(bounds, { padding: [36, 36], maxZoom: 13 });
  }
}

onMounted(() => {
  if (!mapEl.value) return;
  mapInstance = L.map(mapEl.value).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap",
    maxZoom: 18
  }).addTo(mapInstance);
  drawMarkers();
  // 容器尺寸在 grid 布局确定后校正一次，避免瓦片错位
  setTimeout(() => mapInstance?.invalidateSize(), 60);
});

watch(
  () => props.stations,
  () => drawMarkers(),
  { deep: true }
);

onBeforeUnmount(() => {
  mapInstance?.remove();
  mapInstance = null;
});
</script>

<template>
  <div class="map-wrap">
    <div ref="mapEl" class="leaflet-map" />
    <div class="map-legend">
      <span><i style="--pin:#14724f"></i>营业站</span>
      <span><i style="--pin:#c98a04"></i>待建（占用名额）</span>
      <span><i style="--pin:#6b7280"></i>候选</span>
      <span><i style="--pin:#c84b31"></i>暂停营业</span>
    </div>
  </div>
</template>

<style>
.leaflet-map {
  height: 360px;
  border-radius: 8px;
  overflow: hidden;
}

.station-pin span {
  display: block;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--pin, #176b87);
  border: 3px solid #fff;
  box-shadow: 0 1px 6px rgba(23, 32, 51, 0.45);
}

.map-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 10px;
  color: #536078;
  font-size: 13px;
}

.map-legend i {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--pin, #176b87);
  margin-right: 5px;
}
</style>
