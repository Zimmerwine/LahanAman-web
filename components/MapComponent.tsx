"use client";

/**
 * components/MapComponent.tsx
 * ============================================================================
 * MODUL 4 & 5: KOMPONEN PETA INTERAKTIF & FLOATING LAYER CONTROLLER
 * LahanAman GeoAnalytics DIY
 *
 * Fitur:
 * - Mendukung Dual-CRS: Visualisasi WebGIS EPSG:4326 (WGS84) & Kalkulasi Metrik EPSG:32749 (UTM 49S)
 * - Floating Layer Controller dengan custom thin scrollbar, checkbox toggle aktif/nonaktif,
 *   dan slider opacity individual (10% - 100%) untuk setiap layer tematik.
 * - Integrasi penuh dengan `AdminFilterPanel` (`map.fitBounds(turf.bbox(feature))`)
 * - Point-in-Polygon real-time menggunakan `@turf/boolean-point-in-polygon` dan kalkulasi
 *   murni data-driven melalui `analyzeGeotechPoint` (`utils/geotechEngine.ts`).
 * - Seluruh istilah "IDW" telah dibersihkan dari visual UI, tooltip, dan legenda.
 * ============================================================================
 */

import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point as turfPoint } from "@turf/helpers";
import {
  SPATIAL_LAYERS_CONFIG,
  SpatialLayerConfig,
  LegendModeKey,
} from "../config/layersConfig";
import {
  analyzeGeotechPoint,
  GeotechAnalysisResult,
} from "../utils/geotechEngine";
import {
  AdminGeoJSONFeature,
  LeafletMapInstance,
  formatAdminLabel,
} from "./AdminFilterPanel";

export interface SelectedLocationInspection {
  lat: number;
  lng: number;
  eastingUtm: number;
  northingUtm: number;
  elevasiMdpl: number;
  adminLabel: string;
  kalurahan: string;
  kapanewon: string;
  kabupaten: string;
  analysis: GeotechAnalysisResult;
}

export interface MapComponentProps {
  adminFeatures: AdminGeoJSONFeature[];
  layerVisibility: Record<string, boolean>;
  layerOpacity: Record<string, number>;
  onToggleLayer: (layerId: string, visible: boolean) => void;
  onChangeLayerOpacity: (layerId: string, opacity: number) => void;
  onInspectLocation: (inspection: SelectedLocationInspection) => void;
  onMapReady?: (map: LeafletMapInstance) => void;
  isDrawingKavling?: boolean;
  onResetKavling?: () => void;
}

/**
 * Konversi cepat WGS84 (Lat/Lng) ke UTM Zone 49S (EPSG:32749) untuk bar koordinat
 */
export function latLngToUtm49s(lat: number, lon: number): { easting: number; northing: number } {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const lon0 = 111.0; // Central meridian Zone 49
  const e2 = 2 * f - f * f;
  const ep2 = e2 / (1 - e2);

  const phi = (lat * Math.PI) / 180.0;
  const lam = (lon * Math.PI) / 180.0;
  const lam0 = (lon0 * Math.PI) / 180.0;

  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) * Math.sin(phi));
  const T = Math.tan(phi) * Math.tan(phi);
  const C = ep2 * Math.cos(phi) * Math.cos(phi);
  const A = Math.cos(phi) * (lam - lam0);

  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 * e2 * e2) / 1024) * Math.sin(2 * phi) +
      ((15 * e2 * e2) / 256 + (45 * e2 * e2 * e2) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 * e2 * e2) / 3072) * Math.sin(6 * phi));

  const easting =
    500000.0 +
    k0 *
      N *
      (A +
        ((1 - T + C) * Math.pow(A, 3)) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * Math.pow(A, 5)) / 120);

  const northing =
    10000000.0 +
    k0 *
      (M +
        N *
          Math.tan(phi) *
          ((A * A) / 2 +
            ((5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4)) / 24 +
            ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * Math.pow(A, 6)) / 720));

  return { easting, northing };
}

export const MapComponent: React.FC<MapComponentProps> = ({
  adminFeatures,
  layerVisibility,
  layerOpacity,
  onToggleLayer,
  onChangeLayerOpacity,
  onInspectLocation,
  onMapReady,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const geoJsonLayersRef = useRef<Record<string, L.GeoJSON>>({});
  const cachedDatasetsRef = useRef<Record<string, GeoJSON.FeatureCollection>>({});
  const highlightGroupRef = useRef<L.LayerGroup | null>(null);

  const [cursorCoords, setCursorCoords] = useState({
    lat: -7.765,
    lng: 110.378,
    easting: 431420.0,
    northing: 9141550.0,
  });
  const [isFloatingPanelOpen, setIsFloatingPanelOpen] = useState(true);
  const [activeLegendMode, setActiveLegendMode] = useState<LegendModeKey>("triase");

  // Inisialisasi Peta Leaflet
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [-7.765, 110.378],
      zoom: 11.25,
      preferCanvas: true,
      zoomControl: false,
    });

    L.tileLayer("https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", {
      maxZoom: 20,
      attribution: "&copy; Google Maps Hybrid | LahanAman DIY EPSG:32749",
    }).addTo(map);

    L.control.zoom({ position: "topleft" }).addTo(map);
    L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);

    const highlightGroup = L.layerGroup().addTo(map);
    highlightGroupRef.current = highlightGroup;
    mapRef.current = map;

    if (onMapReady) {
      onMapReady({
        fitBounds: (bounds, options) => {
          map.fitBounds(bounds, options);
        },
      });
    }

    map.on("mousemove", (e: L.LeafletMouseEvent) => {
      const utm = latLngToUtm49s(e.latlng.lat, e.latlng.lng);
      setCursorCoords({
        lat: e.latlng.lat,
        lng: e.latlng.lng,
        easting: utm.easting,
        northing: utm.northing,
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [onMapReady]);

  // Fungsi pencarian fitur poligon yang melingkupi titik klik (Point-in-Polygon)
  const findFeatureAtPoint = (
    lng: number,
    lat: number,
    features?: GeoJSON.Feature[]
  ): GeoJSON.Feature | null => {
    if (!features || !features.length) return null;
    const pt = turfPoint([lng, lat]);
    for (const feat of features) {
      if (
        feat.geometry &&
        (feat.geometry.type === "Polygon" || feat.geometry.type === "MultiPolygon")
      ) {
        if (booleanPointInPolygon(pt, feat as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>)) {
          return feat;
        }
      }
    }
    return null;
  };

  // Handler klik peta untuk analisis geoteknik murni data-driven
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleMapClick = async (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      const utm = latLngToUtm49s(lat, lng);

      // Pastikan dataset utama tersedia untuk query spasial
      const ensureLoaded = async (cfg: SpatialLayerConfig) => {
        if (cachedDatasetsRef.current[cfg.id]) return cachedDatasetsRef.current[cfg.id];
        try {
          const res = await fetch(cfg.urlPath);
          if (res.ok) {
            const json = (await res.json()) as GeoJSON.FeatureCollection;
            cachedDatasetsRef.current[cfg.id] = json;
            return json;
          }
        } catch {
          // fallback
        }
        return null;
      };

      const [krFc, slpFc, soilFc, geoFc, rainFc, luFc] = await Promise.all(
        ["kerawananLongsor", "lerengPoly", "tanah", "geologi", "hujanIsohyet", "tutupan"].map(
          (id) => {
            const cfg = SPATIAL_LAYERS_CONFIG.find((c) => c.id === id);
            return cfg ? ensureLoaded(cfg) : Promise.resolve(null);
          }
        )
      );

      const admFeat = findFeatureAtPoint(
        lng,
        lat,
        adminFeatures as unknown as GeoJSON.Feature[]
      );
      const krFeat = findFeatureAtPoint(lng, lat, krFc?.features);
      const slpFeat = findFeatureAtPoint(lng, lat, slpFc?.features);
      const soilFeat = findFeatureAtPoint(lng, lat, soilFc?.features);
      const geoFeat = findFeatureAtPoint(lng, lat, geoFc?.features);
      const rainFeat = findFeatureAtPoint(lng, lat, rainFc?.features);
      const luFeat = findFeatureAtPoint(lng, lat, luFc?.features);

      const admP = (admFeat?.properties || {}) as Record<string, unknown>;
      const krP = (krFeat?.properties || {}) as Record<string, unknown>;
      const slpP = (slpFeat?.properties || {}) as Record<string, unknown>;
      const soilP = (soilFeat?.properties || {}) as Record<string, unknown>;
      const geoP = (geoFeat?.properties || {}) as Record<string, unknown>;
      const rainP = (rainFeat?.properties || {}) as Record<string, unknown>;
      const luP = (luFeat?.properties || {}) as Record<string, unknown>;

      // Kalkulasi Geoteknik Murni Data-Driven (Tanpa placeholder beta = 4.5°)
      const analysis = analyzeGeotechPoint({
        betaDeg: (krP.lereng_derajat ?? admP.lereng_derajat ?? null) as number | null,
        slopePercent: (krP.lereng_persen ?? admP.lereng_persen ?? null) as number | null,
        skorLerengPoly: (slpP.skor ?? krP.skor_lereng ?? admP.skor_lereng ?? null) as number | null,
        ketLerengPoly: (slpP.klasifikasi ?? krP.ket_lereng ?? admP.kelas_lereng ?? null) as
          | string
          | null,
        jenisTanah: (soilP.jns_tnh ?? krP.ket_tanah ?? admP.jenis_tanah ?? "Regosol") as string,
        cPrimeOverride: (soilP.c_kpa ?? krP.c_kpa ?? null) as number | null,
        phiPrimeOverride: (soilP.phi_deg ?? krP.phi_deg ?? null) as number | null,
        gammaSatOverride: (soilP.gamma_sat ?? krP.gamma_sat ?? null) as number | null,
        zDepthOverride: (soilP.z ?? krP.z ?? null) as number | null,
        formasiBatuan: (geoP.NAME ?? krP.ket_batuan ?? admP.formasi_batuan ?? null) as
          | string
          | null,
        simbolFormasi: (geoP.SYMBOLS ?? null) as string | null,
        skorBatuanOverride: (geoP.skor_batuan ?? krP.skor_batuan ?? null) as number | null,
        curahHujanMm: (rainP.curah_hujan_mm ?? krP.curah_hujan_mm ?? admP.ch_idw_mm ?? null) as
          | number
          | null,
        skorHujanOverride: (rainP.skor_hujan ?? krP.skor_hujan ?? null) as number | null,
        rasioMOverride: (rainP.rasio_m ?? krP.rasio_m ?? null) as number | null,
        tutupanLahan: (luP.pl ?? luP.klasifikasi ?? krP.ket_lahan ?? admP.tutupan_dominan ?? null) as
          | string
          | null,
        skorLahanOverride: (luP.skor_lahan ?? krP.skor_lahan ?? null) as number | null,
      });

      const kalurahan = String(admP.kalurahan || krP.kalurahan || "-");
      const kapanewon = String(admP.kapanewon || krP.kapanewon || "-");
      const kabupaten = String(admP.kabupaten || krP.kabupaten || "Kab. Sleman");
      const adminLabel = formatAdminLabel({ kalurahan, kapanewon, kabupaten });

      // Tampilkan sorotan titik pada peta
      if (highlightGroupRef.current) {
        highlightGroupRef.current.clearLayers();
        L.circle([lat, lng], {
          radius: 240,
          color: analysis.warnaHex,
          weight: 2.2,
          dashArray: "5,4",
          fillColor: analysis.warnaHex,
          fillOpacity: 0.25,
          interactive: false,
        }).addTo(highlightGroupRef.current);

        L.circleMarker([lat, lng], {
          radius: 8,
          fillColor: analysis.warnaHex,
          color: "#ffffff",
          weight: 2.5,
          fillOpacity: 1.0,
        }).addTo(highlightGroupRef.current);
      }

      // Popup ringkas dengan format "Kal. [Nama], Kapanewon [Nama], Kab. [Nama]" (tanpa Dusun)
      L.popup({ maxWidth: 300 })
        .setLatLng([lat, lng])
        .setContent(
          `<div style="font-family:'Inter',sans-serif;min-width:230px;">
            <div style="margin-bottom:4px;">
              <span style="background:${analysis.warnaHex};color:#fff;font-size:10px;font-weight:800;padding:2px 8px;border-radius:999px;">
                SKOR ${analysis.skorAkhir.toFixed(2)} — ${analysis.zonaLabel}
              </span>
            </div>
            <div style="font-size:13px;font-weight:800;color:#0f172a;margin-bottom:6px;">
              ${adminLabel}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;font-size:11px;">
              <div style="background:#f1f5f9;padding:5px 7px;border-radius:6px;">
                <span style="color:#64748b;font-size:10px;display:block;">Kemiringan (β)</span>
                <b>${analysis.parameters.lereng.betaDeg.toFixed(2)}° (${analysis.parameters.lereng.slopePercent.toFixed(1)}%)</b>
              </div>
              <div style="background:#f1f5f9;padding:5px 7px;border-radius:6px;">
                <span style="color:#64748b;font-size:10px;display:block;">Faktor Keamanan (FS)</span>
                <b>${analysis.fs.toFixed(2)} (${analysis.fsStatus})</b>
              </div>
            </div>
          </div>`
        )
        .openOn(map);

      onInspectLocation({
        lat,
        lng,
        eastingUtm: utm.easting,
        northingUtm: utm.northing,
        elevasiMdpl: Number(admP.elevasi_mdpl || 115),
        adminLabel,
        kalurahan,
        kapanewon,
        kabupaten,
        analysis,
      });
    };

    map.on("click", handleMapClick);
    return () => {
      map.off("click", handleMapClick);
    };
  }, [adminFeatures, onInspectLocation]);

  // Sinkronisasi visibilitas & opacity tiap layer tematik
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    SPATIAL_LAYERS_CONFIG.forEach(async (cfg) => {
      const isVisible = Boolean(layerVisibility[cfg.id]);
      const opacityVal = layerOpacity[cfg.id] ?? cfg.defaultOpacity;
      const existingLayer = geoJsonLayersRef.current[cfg.id];

      if (!isVisible) {
        if (existingLayer && map.hasLayer(existingLayer)) {
          map.removeLayer(existingLayer);
        }
        return;
      }

      if (existingLayer) {
        existingLayer.setStyle({
          fillOpacity: cfg.id === "admin" ? 0 : opacityVal,
          opacity: Math.min(1.0, opacityVal + 0.25),
        });
        if (!map.hasLayer(existingLayer)) {
          existingLayer.addTo(map);
        }
        if (cfg.legendMode) setActiveLegendMode(cfg.legendMode);
        return;
      }

      try {
        let data = cachedDatasetsRef.current[cfg.id];
        if (!data) {
          const res = await fetch(cfg.urlPath);
          if (!res.ok) return;
          data = (await res.json()) as GeoJSON.FeatureCollection;
          cachedDatasetsRef.current[cfg.id] = data;
        }

        const layer = L.geoJSON(data, {
          style: (feature) => {
            const fp = (feature?.properties || {}) as Record<string, unknown>;
            const colorHex = String(fp.warna_hex || "#2563eb");
            return {
              color: cfg.id === "admin" ? "#cbd5e1" : "#1e293b",
              weight: cfg.id === "admin" ? 1.2 : 1.0,
              fillColor: colorHex,
              fillOpacity: cfg.id === "admin" ? 0 : opacityVal,
              opacity: Math.min(1.0, opacityVal + 0.25),
            };
          },
        }).addTo(map);

        geoJsonLayersRef.current[cfg.id] = layer;
        if (cfg.legendMode) setActiveLegendMode(cfg.legendMode);
      } catch (err) {
        console.error(`Gagal memuat layer ${cfg.title}:`, err);
      }
    });
  }, [layerVisibility, layerOpacity]);

  const activeLegendConfig =
    SPATIAL_LAYERS_CONFIG.find((c) => c.legendMode === activeLegendMode) ||
    SPATIAL_LAYERS_CONFIG[0];

  return (
    <div className="relative w-full h-full bg-slate-300 overflow-hidden">
      {/* CONTAINER PETA LEAFLET */}
      <div ref={mapContainerRef} className="w-full h-full cursor-crosshair" />

      {/* BAR KOORDINAT LIVE (WGS84 & UTM 49S) */}
      <div className="pointer-events-none absolute top-3 left-14 z-[800] flex flex-wrap items-center gap-2 rounded-lg border border-slate-300 bg-white/95 px-3 py-1.5 font-mono text-[11px] text-slate-800 shadow-md backdrop-blur-md">
        <span>
          🌐 <b>WGS84 (EPSG:4326)</b>: {cursorCoords.lat.toFixed(5)}°, {cursorCoords.lng.toFixed(5)}°
        </span>
        <span className="text-slate-400">|</span>
        <span>
          📐 <b>UTM 49S (EPSG:32749)</b>: X:{" "}
          {cursorCoords.easting.toLocaleString("id-ID", { maximumFractionDigits: 1 })} mE, Y:{" "}
          {cursorCoords.northing.toLocaleString("id-ID", { maximumFractionDigits: 1 })} mS
        </span>
      </div>

      {/* FLOATING LAYER CONTROLLER DENGAN CUSTOM THIN SCROLLBAR & OPACITY SLIDER (10% - 100%) */}
      <div className="absolute top-3 right-3 z-[850] w-72 rounded-xl border border-slate-300/95 bg-white/95 shadow-xl backdrop-blur-md overflow-hidden">
        <button
          type="button"
          onClick={() => setIsFloatingPanelOpen((prev) => !prev)}
          className="flex w-full items-center justify-between px-3.5 py-2.5 text-xs font-bold text-slate-900 hover:bg-slate-100/80 transition"
        >
          <span>🗂️ Layer Spasial &amp; Transparansi</span>
          <span>{isFloatingPanelOpen ? "▾" : "▸"}</span>
        </button>

        {isFloatingPanelOpen && (
          <div className="max-h-[340px] overflow-y-auto border-t border-slate-200 px-3 py-2.5 space-y-2 scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-slate-100">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Layer Tematik GPKG &amp; Referensi
            </div>

            {SPATIAL_LAYERS_CONFIG.map((layerCfg) => {
              const checked = Boolean(layerVisibility[layerCfg.id]);
              const currentOpacityPct = Math.round(
                (layerOpacity[layerCfg.id] ?? layerCfg.defaultOpacity) * 100
              );

              return (
                <div
                  key={layerCfg.id}
                  className="rounded-lg border border-slate-200/80 bg-slate-50/70 p-2 transition hover:border-blue-200"
                >
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-800">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => onToggleLayer(layerCfg.id, e.target.checked)}
                      className="h-3.5 w-3.5 rounded accent-blue-600 cursor-pointer"
                    />
                    <span className="truncate">
                      {layerCfg.icon} {layerCfg.title}
                    </span>
                  </label>

                  {/* Slider Opacity 10% - 100% */}
                  {checked && (
                    <div className="mt-1.5 pl-5 pr-1">
                      <div className="flex items-center justify-between text-[10px] text-slate-500 mb-0.5">
                        <span>Transparansi Layer</span>
                        <span className="font-mono font-bold text-blue-700">
                          {currentOpacityPct}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={10}
                        max={100}
                        step={5}
                        value={currentOpacityPct}
                        onChange={(e) =>
                          onChangeLayerOpacity(layerCfg.id, Number(e.target.value) / 100)
                        }
                        className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* LEGENDA DINAMIS BEBAS LABEL IDW */}
      <div className="absolute bottom-6 right-3 z-[800] max-w-[275px] rounded-xl border border-slate-300 bg-white/95 p-3 text-[11px] text-slate-800 shadow-lg backdrop-blur-md">
        <div className="font-bold uppercase tracking-wider text-blue-700 mb-1.5">
          {activeLegendConfig.icon} {activeLegendConfig.title}
        </div>
        <div className="space-y-1">
          {activeLegendConfig.legendItems.map((item, idx) => (
            <div key={idx} className="flex items-start gap-2">
              <span
                className="mt-0.5 h-3.5 w-3.5 rounded shrink-0 border"
                style={{
                  backgroundColor: item.color,
                  borderColor: item.borderColor || "rgba(0,0,0,0.18)",
                }}
              />
              <div className="leading-tight">
                <div className="font-semibold text-slate-800">{item.label}</div>
                {item.subLabel && <div className="text-[10px] text-slate-500">{item.subLabel}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default MapComponent;
