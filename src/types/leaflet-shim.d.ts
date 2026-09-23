declare module "leaflet" {
  export interface Map {
    setView: (...args: any[]) => any;
    fitBounds: (bounds: LatLngBounds, options?: unknown) => any;
    getBounds: () => LatLngBounds;
    remove: () => void;
    invalidateSize: () => Map;
    on: (event: string, handler: (...args: any[]) => void) => Map;
  }

  export interface LatLngBounds {
    extend: (latlng: LatLngExpression) => LatLngBounds;
  }

  export type LatLngExpression = [number, number] | { lat: number; lng: number };

  export interface MarkerOptions {
    title?: string;
    icon?: Icon;
    [key: string]: unknown;
  }

  export interface Marker {
    addTo: (map: Map) => Marker;
    bindPopup: (html: string) => Marker;
    on: (event: string, handler: (...args: any[]) => void) => Marker;
    remove: () => void;
  }

  export interface Icon {
    [key: string]: unknown;
  }

  export function map(id: string | HTMLElement): Map;
  export function tileLayer(urlTemplate: string, options?: Record<string, unknown>): {
    addTo: (map: Map) => unknown;
  };
  export function marker(latlng: LatLngExpression, options?: MarkerOptions): Marker;
  export function latLngBounds(): LatLngBounds;
  export function divIcon(options: {
    html?: string;
    className?: string;
    iconSize?: [number, number];
    iconAnchor?: [number, number];
  }): Icon;

  const leaflet: {
    map: typeof map;
    tileLayer: typeof tileLayer;
    marker: typeof marker;
    latLngBounds: typeof latLngBounds;
    divIcon: typeof divIcon;
  };
  export default leaflet;
}
