import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { radius, sportColor } from "../theme";
import type { GeoPoint } from "../lib/geo";

// Web: mapa raster escuro (CARTO dark, sem chave e sem web worker — empacota liso
// no Expo/Metro). No native, RouteMap.tsx usa o traçado SVG (mapa nativo é enhancement).
interface Props {
  points: GeoPoint[];
  sportId?: string;
  height?: number;
  interactive?: boolean;
}

export function RouteMap({ points, sportId, height = 200, interactive = true }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);
  const stroke = sportColor(sportId);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: interactive,
      attributionControl: true,
      dragging: interactive,
      touchZoom: interactive,
      scrollWheelZoom: interactive,
      doubleClickZoom: interactive,
      boxZoom: interactive,
      keyboard: interactive,
    }).setView([-22.97, -43.18], 13);
    // Esri "Dark Gray Canvas" — basemap escuro keyless (base + rótulos).
    const esri = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
    L.tileLayer(`${esri}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, {
      maxZoom: 16,
      attribution: "© Esri",
    }).addTo(map);
    L.tileLayer(`${esri}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 16 }).addTo(map);
    mapRef.current = map;
    // Garante o tamanho correto após o layout do react-native-web.
    setTimeout(() => map.invalidateSize(), 0);
    return () => {
      map.remove();
      mapRef.current = null;
      lineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || points.length === 0) return;
    const latlngs = points.map((p) => [p.lat, p.lng] as [number, number]);
    if (lineRef.current) lineRef.current.setLatLngs(latlngs);
    else lineRef.current = L.polyline(latlngs, { color: stroke, weight: 4 }).addTo(map);
    if (latlngs.length >= 2) map.fitBounds(latlngs, { padding: [30, 30], maxZoom: 16 });
    else map.setView(latlngs[0], 15);
  }, [points, stroke]);

  return (
    <div ref={containerRef} style={{ height, width: "100%", borderRadius: radius.card, overflow: "hidden" }} />
  );
}
