import React, { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { RouteSvg } from "./RouteSvg";
import { radius, sportColor } from "../theme";
import type { GeoPoint } from "../lib/geo";

const KEY = process.env.EXPO_PUBLIC_MAPTILER_KEY;

interface Props {
  points: GeoPoint[];
  sportId?: string;
  height?: number;
}

function lineData(points: GeoPoint[]) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates: points.map((p) => [p.lng, p.lat]) },
  };
}

function MapLibreRoute({ points, sportId, height = 200 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const stroke = sportColor(sportId);

  // Cria o mapa uma vez.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${KEY}`,
      center: [-43.18, -22.97],
      zoom: 12,
      attributionControl: false,
    });
    mapRef.current = map;
    map.on("load", () => {
      map.addSource("route", { type: "geojson", data: lineData([]) });
      map.addLayer({
        id: "route",
        type: "line",
        source: "route",
        paint: { "line-color": stroke, "line-width": 4 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Atualiza a rota conforme os pontos chegam.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || points.length === 0) return;
    const apply = () => {
      const src = map.getSource("route") as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      src.setData(lineData(points));
      const lngs = points.map((p) => p.lng);
      const lats = points.map((p) => p.lat);
      map.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 40, maxZoom: 16, duration: 400 }
      );
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [points]);

  return (
    <div style={{ height, width: "100%", borderRadius: radius.card, overflow: "hidden" }} ref={containerRef} />
  );
}

export function RouteMap(props: Props) {
  if (!KEY) return <RouteSvg {...props} />;
  return <MapLibreRoute {...props} />;
}
