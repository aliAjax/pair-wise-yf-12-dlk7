<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  STATUS_CANDIDATE,
  STATUS_LOW_STOCK,
  STATUS_OPEN,
  STATUS_PAUSED,
  STATUS_PENDING,
  type StationRecord
} from "../business/stationStore";

const props = defineProps<{
  records: StationRecord[];
  pickable?: boolean;
}>();

const emit = defineEmits<{
  (event: "pick", payload: { lng: number; lat: number }): void;
}>();

const mapEl = ref<HTMLElement | null>(null);
let map: L.Map | null = null;
let markerLayer: L.LayerGroup | null = null;
let clickHandler: ((event: L.LeafletMouseEvent) => void) | null = null;

const STATUS_COLOR: Record<string, string> = {
  [STATUS_OPEN]: "#14724f",
  [STATUS_PAUSED]: "#69758c",
  [STATUS_LOW_STOCK]: "#d08a14",
  [STATUS_PENDING]: "#176b87",
  [STATUS_CANDIDATE]: "#e0a800"
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function hasCoord(record: StationRecord): boolean {
  return (
    typeof record.lng === "number" &&
    typeof record.lat === "number" &&
    Number.isFinite(record.lng) &&
    Number.isFinite(record.lat)
  );
}

function renderMarkers() {
  if (!map || !markerLayer) return;
  markerLayer.clearLayers();

  const points: L.LatLngExpression[] = [];
  for (const record of props.records) {
    if (!hasCoord(record)) continue;
    const color = STATUS_COLOR[record.status] ?? "#69758c";
    const marker = L.marker([record.lat as number, record.lng as number], {
      icon: L.divIcon({
        className: "station-marker",
        html: `<span class="dot" style="background:${color};${record.status === STATUS_CANDIDATE ? "background:#fff;border:3px solid " + color + ";" : ""}"></span>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
        popupAnchor: [0, -10]
      }),
      title: record.station
    });

    marker.bindPopup(
      `<strong>${escapeHtml(record.station)}</strong><br/>` +
        `区域：${escapeHtml(record.area)}<br/>状态：${escapeHtml(record.status)}` +
        (record.plannedOpenDate ? `<br/>拟营业：${escapeHtml(record.plannedOpenDate)}` : "")
    );
    marker.addTo(markerLayer);
    points.push([record.lat as number, record.lng as number]);
  }

  if (points.length > 0) map.fitBounds(L.latLngBounds(points).pad(0.25), { maxZoom: 13 });
}

onMounted(() => {
  if (!mapEl.value) return;
  map = L.map(mapEl.value).setView([39.99, 116.5], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);

  clickHandler = (event: L.LeafletMouseEvent) => {
    if (props.pickable) {
      emit("pick", {
        lng: Number(event.latlng.lng.toFixed(6)),
        lat: Number(event.latlng.lat.toFixed(6))
      });
    }
  };
  map.on("click", clickHandler);

  // 容器从隐藏切到显示时需要重新计算尺寸
  setTimeout(() => map?.invalidateSize(), 0);
  renderMarkers();
});

watch(
  () => props.records,
  () => renderMarkers(),
  { deep: true }
);

watch(
  () => props.pickable,
  (pickable) => {
    if (mapEl.value) mapEl.value.style.cursor = pickable ? "crosshair" : "";
  }
);

onBeforeUnmount(() => {
  if (map && clickHandler) map.off("click", clickHandler);
  map?.remove();
  map = null;
});
</script>

<template>
  <div ref="mapEl" class="station-map" :class="{ picking: pickable }"></div>
</template>

<style>
.station-map {
  width: 100%;
  height: 420px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #dfe7f1;
}

.station-map.picking {
  cursor: crosshair;
  box-shadow: 0 0 0 3px rgba(23, 107, 135, 0.25);
}

.station-marker .dot {
  display: block;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid #fff;
  box-shadow: 0 1px 4px rgba(23, 32, 51, 0.45);
}
</style>
