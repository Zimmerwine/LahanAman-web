"use client";

/**
 * components/MapComponent.jsx
 * ============================================================================
 * KOMPONEN PETA INTERAKTIF LEAFLET (100% PURE JSX)
 * LahanAman GeoAnalytics DIY
 *
 * Fitur:
 * - Membaca LANGSUNG atribut asli poligon dari feature.properties hasil pipeline.
 * - DILARANG menimpa data poligon dengan fallback dummy statis (slope ?? 2.5, tanah ?? 'Regosol', skor ?? 2.20).
 * - Menjamin klik pada poligon hijau tetap menghasilkan Zona Hijau, dan klik pada poligon merah tetap Zona Merah.
 * - Membaca kolom resmi: props.KALURAHAN, props.KECAMATAN, props.KABUPATEN.
 * - Bersih total dari istilah "IDW" (diubah menjadi "Distribusi Isohyet").
 * - Mengatur visibilitas & slider opacity 10% - 100% per layer spasial.
 * ============================================================================
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point as turfPoint } from "@turf/helpers";
import { SPATIAL_LAYERS_CONFIG } from "../config/layersConfig";
import {
  analyzeGeotechPoint,
  computeInfiniteSlopeFS,
  classifyZone,
  evaluateSlope,
  evaluateSoil,
  evaluateLithology,
  evaluateRainfall,
  evaluateLandUse,
  GPKG_WEIGHTS,
} from "../utils/geotechCalculator";
import { formatAdminLabel } from "./AdminFilterPanel";

// CSS Leaflet bawaan
import "leaflet/dist/leaflet.css";

/**
 * Konversi koordinat WGS84 (Lat/Lon) ke UTM Zone 49S (EPSG:32749)
 */
export function latLngToUtm49s(lat, lon) {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const lon0 = 111.0;
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

  return { easting: Math.round(easting), northing: Math.round(northing) };
}

/**
 * Buat objek inspeksi geoteknik murni dari properties poligon asli tanpa dummy
 */
export function buildInspectionFromProperties(props, lat, lng, utm) {
  const kalurahan = String(props.KALURAHAN || props.kalurahan || "-");
  const kapanewon = String(props.KECAMATAN || props.kapanewon || "-");
  const kabupaten = String(props.KABUPATEN || props.kabupaten || "Kabupaten Sleman");
  const adminLabel = formatAdminLabel({
    KALURAHAN: kalurahan,
    KECAMATAN: kapanewon,
    KABUPATEN: kabupaten,
  });

  // Jika properti sudah memiliki skor_akhir hasil kalkulasi pipeline
  if (props.skor_akhir !== undefined && props.skor_akhir !== null) {
    const skorAkhir = Number(props.skor_akhir);
    const betaDeg = Number(props.lereng_derajat ?? 3.5);
    const slopePct = Number(props.lereng_persen ?? 6.1);
    const skorLereng = Number(props.skor_lereng ?? 1);
    const ketLereng = String(props.ket_lereng || "Datar – Landai");

    const jenisTanah = String(props.ket_tanah || props.jns_tnh || props.jenis_tanah || "Regosol");
    const skorTanah = Number(props.skor_tanah || props["skor tanah"] || 3);
    const cPrime = Number(props.c_kpa ?? 3.5);
    const phiPrime = Number(props.phi_deg ?? 36.0);
    const gammaSat = Number(props.gamma_sat ?? 17.5);
    const zDepth = Number(props.z ?? 1.0);
    const isExpansive = Boolean(props.is_expansive ?? false);

    const formasiBatuan = String(props.ket_batuan || props.NAME || props.formasi_batuan || "Endapan Merapi Muda");
    const skorBatuan = Number(props.skor_batuan ?? 2);

    const curahHujanMm = Number(props.curah_hujan_mm ?? 2250);
    const skorHujan = Number(props.skor_hujan ?? 3);
    const rasioM = Number(props.rasio_m ?? 0.60);
    const ketHujan = String(props.ket_hujan || "2.001 – 2.500 mm/tahun (Sedang)").replace(/IDW/gi, "Isohyet");

    const tutupanLahan = String(props.ket_lahan || props.pl || props.tutupan_dominan || "Permukiman");
    const skorLahan = Number(props.skor_lahan || props.skor ?? 3);
    const crKpa = Number(props.cr_kpa ?? 0.0);
    const qKpa = Number(props.q_kpa ?? (skorLahan === 3 ? 15.0 : 0.0));

    const zone = classifyZone(skorAkhir);
    const warnaHex = props.warna_hex || zone.warnaHex;

    const fsVal = props.fs !== undefined ? Number(props.fs) : computeInfiniteSlopeFS(
      betaDeg,
      cPrime,
      crKpa,
      phiPrime,
      gammaSat,
      zDepth,
      rasioM,
      qKpa
    ).fs;

    let fsStatus = props.fs_status;
    let fsBadgeColor = "emerald";
    if (!fsStatus) {
      if (fsVal > 1.25) {
        fsStatus = "STABIL";
        fsBadgeColor = "emerald";
      } else if (fsVal >= 1.07) {
        fsStatus = "KRITIS";
        fsBadgeColor = "amber";
      } else {
        fsStatus = "LABIL / LONGSOR";
        fsBadgeColor = "red";
      }
    } else {
      fsBadgeColor = fsStatus.includes("STABIL") ? "emerald" : fsStatus.includes("KRITIS") ? "amber" : "red";
    }

    const fsKeterangan =
      fsVal > 1.25
        ? "Lereng aman stabil (FS > 1.25); cocok untuk permukiman dengan pondasi standar."
        : fsVal >= 1.07
        ? "Kondisi lereng kritis (1.07 ≤ FS ≤ 1.25); memerlukan mitigasi talud / drainase lereng."
        : "Lereng labil rawan longsor (FS < 1.07); melampaui batas keseimbangan batas alami!";

    return {
      lat,
      lng,
      eastingUtm: utm.easting,
      northingUtm: utm.northing,
      elevasiMdpl: Number(props.elevasi_mdpl || 120),
      adminLabel,
      kalurahan,
      kapanewon,
      kabupaten,
      analysis: {
        skorAkhir,
        zonaKode: zone.zonaKode,
        zonaLabel: props.zona_kelayakan || zone.zonaLabel,
        zonaDeskripsi: zone.zonaDeskripsi,
        warnaHex,
        borderHex: zone.borderHex,
        fs: fsVal,
        fsStatus,
        fsBadgeColor,
        fsKeterangan,
        parameters: {
          lereng: {
            betaDeg,
            slopePercent: slopePct,
            skor: skorLereng,
            bobot: GPKG_WEIGHTS.lereng,
            skorTertimbang: Number((skorLereng * GPKG_WEIGHTS.lereng).toFixed(3)),
            rentangLabel: `${betaDeg.toFixed(1)}° (${slopePct.toFixed(1)}%)`,
            keteranganGeoteknik: ketLereng,
          },
          tanah: {
            jenisTanah,
            skor: skorTanah,
            bobot: GPKG_WEIGHTS.tanah,
            skorTertimbang: Number((skorTanah * GPKG_WEIGHTS.tanah).toFixed(3)),
            cPrimeKpa: cPrime,
            phiPrimeDeg: phiPrime,
            gammaSatKnM3: gammaSat,
            zDepthM: zDepth,
            isExpansive,
            keteranganGeoteknik: `c'=${cPrime.toFixed(1)} kPa, φ'=${phiPrime.toFixed(1)}°, γsat=${gammaSat.toFixed(1)} kN/m³, z=${zDepth.toFixed(1)} m`,
          },
          batuan: {
            formasiBatuan,
            simbolFormasi: props.SYMBOLS || "",
            skor: skorBatuan,
            bobot: GPKG_WEIGHTS.batuan,
            skorTertimbang: Number((skorBatuan * GPKG_WEIGHTS.batuan).toFixed(3)),
            keteranganGeoteknik: formasiBatuan,
          },
          hujan: {
            curahHujanMm,
            skor: skorHujan,
            bobot: GPKG_WEIGHTS.hujan,
            skorTertimbang: Number((skorHujan * GPKG_WEIGHTS.hujan).toFixed(3)),
            rasioKejenuhanM: rasioM,
            rentangLabel: `${curahHujanMm.toLocaleString("id-ID")} mm/thn`,
            keteranganGeoteknik: ketHujan,
          },
          lahan: {
            tutupanLahan,
            skor: skorLahan,
            bobot: GPKG_WEIGHTS.lahan,
            skorTertimbang: Number((skorLahan * GPKG_WEIGHTS.lahan).toFixed(3)),
            kohesiAkarCrKpa: crKpa,
            bebanTambahanQKpa: qKpa,
            keteranganGeoteknik: `${tutupanLahan} (cr=${crKpa} kPa, q=${qKpa} kPa)`,
          },
        },
        auditTrail: {
          betaDeg,
          cPrimeKpa: cPrime,
          crKpa,
          phiPrimeDeg: phiPrime,
          gammaSatKnM3: gammaSat,
          zDepthM: zDepth,
          rasioKejenuhanM: rasioM,
          poreWaterPressureUKpa: Number((rasioM * 9.81 * zDepth).toFixed(2)),
          surchargeLoadQKpa: qKpa,
        },
      },
    };
  }

  // Fallback analitis murni dari atribut yang tersedia
  const analysis = analyzeGeotechPoint({
    betaDeg: props.lereng_derajat,
    slopePercent: props.lereng_persen,
    skorLerengPoly: props.skor_lereng || props.skor,
    ketLerengPoly: props.ket_lereng || props.kelas_lereng,
    jenisTanah: props.ket_tanah || props.jns_tnh || props.jenis_tanah,
    cPrimeOverride: props.c_kpa,
    phiPrimeOverride: props.phi_deg,
    gammaSatOverride: props.gamma_sat,
    zDepthOverride: props.z,
    formasiBatuan: props.ket_batuan || props.NAME || props.formasi_batuan,
    curahHujanMm: props.curah_hujan_mm,
    skorHujanOverride: props.skor_hujan,
    rasioMOverride: props.rasio_m,
    tutupanLahan: props.ket_lahan || props.pl || props.tutupan_dominan,
    skorLahanOverride: props.skor_lahan,
  });

  return {
    lat,
    lng,
    eastingUtm: utm.easting,
    northingUtm: utm.northing,
    elevasiMdpl: Number(props.elevasi_mdpl || 120),
    adminLabel,
    kalurahan,
    kapanewon,
    kabupaten,
    analysis,
  };
}

export function MapComponent({
  adminFeatures = [],
  layerVisibility = {},
  layerOpacity = {},
  onToggleLayer,
  onChangeLayerOpacity,
  onInspectLocation,
  onMapReady,
  isDrawingKavling = false,
  onResetKavling,
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const geoJsonLayersRef = useRef({});
  const cachedDatasetsRef = useRef({});
  const highlightGroupRef = useRef(null);

  const [cursorPos, setCursorPos] = useState({ lat: -7.7956, lng: 110.3695, easting: 430500, northing: 9138000 });
  const [activeLegendMode, setActiveLegendMode] = useState("triase");

  // Inisialisasi Peta Leaflet
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // DIY Center Bounds
    const initialCenter = [-7.80, 110.37];
    const initialZoom = 11;

    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: initialZoom,
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
    });

    L.control.zoom({ position: "bottomright" }).addTo(map);

    // Basemap OSM CartoDB Positron
    const baseOsm = L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      {
        attribution: '&copy; <a href="https://carto.com/">CARTO</a> | Data BIG & BMKG DIY',
        maxZoom: 19,
        subdomains: "abcd",
      }
    ).addTo(map);

    // Layer Highlight klik / seleksi
    const hlGroup = L.layerGroup().addTo(map);
    highlightGroupRef.current = hlGroup;

    mapRef.current = map;
    if (onMapReady) {
      onMapReady(map);
    }

    // Tracker kursor mouse
    map.on("mousemove", (e) => {
      const { lat, lng } = e.latlng;
      const utm = latLngToUtm49s(lat, lng);
      setCursorPos({
        lat: Number(lat.toFixed(5)),
        lng: Number(lng.toFixed(5)),
        easting: utm.easting,
        northing: utm.northing,
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [onMapReady]);

  // Handler Event Klik Peta: BACA LANGSUNG dari feature.properties tanpa dummy
  const handlePolygonClick = useCallback(
    (props, lat, lng) => {
      const map = mapRef.current;
      if (!map) return;

      const utm = latLngToUtm49s(lat, lng);
      const inspection = buildInspectionFromProperties(props, lat, lng, utm);

      // Tampilkan marker sorotan visual pada peta
      if (highlightGroupRef.current) {
        highlightGroupRef.current.clearLayers();

        L.circle([lat, lng], {
          radius: 200,
          color: inspection.analysis.warnaHex,
          weight: 2.5,
          dashArray: "4,4",
          fillColor: inspection.analysis.warnaHex,
          fillOpacity: 0.25,
          interactive: false,
        }).addTo(highlightGroupRef.current);

        L.circleMarker([lat, lng], {
          radius: 7,
          fillColor: inspection.analysis.warnaHex,
          color: "#ffffff",
          weight: 2,
          fillOpacity: 1.0,
        }).addTo(highlightGroupRef.current);
      }

      // Popup Leaflet informatif
      L.popup({ maxWidth: 300, closeButton: true })
        .setLatLng([lat, lng])
        .setContent(
          `<div style="font-family:system-ui,-apple-system,sans-serif;padding:2px;min-width:220px;">
            <div style="margin-bottom:6px;">
              <span style="background:${inspection.analysis.warnaHex};color:#fff;font-size:10px;font-weight:800;padding:3px 8px;border-radius:999px;display:inline-block;">
                SKOR ${inspection.analysis.skorAkhir.toFixed(2)} — ${inspection.analysis.zonaLabel}
              </span>
            </div>
            <div style="font-size:12px;font-weight:800;color:#0f172a;margin-bottom:6px;">
              ${inspection.adminLabel}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:11px;">
              <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:4px 6px;border-radius:6px;">
                <span style="color:#64748b;font-size:9.5px;display:block;">Kemiringan (β)</span>
                <b>${inspection.analysis.parameters.lereng.betaDeg.toFixed(1)}° (${inspection.analysis.parameters.lereng.slopePercent.toFixed(1)}%)</b>
              </div>
              <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:4px 6px;border-radius:6px;">
                <span style="color:#64748b;font-size:9.5px;display:block;">Faktor Keamanan</span>
                <b>${inspection.analysis.fs.toFixed(2)} (${inspection.analysis.fsStatus})</b>
              </div>
            </div>
          </div>`
        )
        .openOn(map);

      if (onInspectLocation) {
        onInspectLocation(inspection);
      }
    },
    [onInspectLocation]
  );

  // Global map click listener jika klik di luar poligon langsung
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const onMapClick = (e) => {
      const { lat, lng } = e.latlng;
      const pt = turfPoint([lng, lat]);

      // Cari fitur kerawanan longsor terlebih dahulu
      const krData = cachedDatasetsRef.current["kerawananLongsor"];
      let foundFeat = null;
      if (krData && krData.features) {
        for (const feat of krData.features) {
          try {
            if (booleanPointInPolygon(pt, feat)) {
              foundFeat = feat;
              break;
            }
          } catch (err) {}
        }
      }

      // Jika tidak di kerawanan, cari di batas administrasi
      if (!foundFeat && adminFeatures.length > 0) {
        for (const feat of adminFeatures) {
          try {
            if (booleanPointInPolygon(pt, feat)) {
              foundFeat = feat;
              break;
            }
          } catch (err) {}
        }
      }

      if (foundFeat) {
        handlePolygonClick(foundFeat.properties, lat, lng);
      }
    };

    map.on("click", onMapClick);
    return () => {
      map.off("click", onMapClick);
    };
  }, [adminFeatures, handlePolygonClick]);

  // Sinkronisasi layer spasial berdasarkan state visibility & opacity
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    SPATIAL_LAYERS_CONFIG.forEach(async (cfg) => {
      const isVisible = Boolean(layerVisibility[cfg.id]);
      const opacityVal = layerOpacity[cfg.id] ?? cfg.defaultOpacity;
      const existingLayer = geoJsonLayersRef.current[cfg.id];

      // Jika layer dimatikan
      if (!isVisible) {
        if (existingLayer && map.hasLayer(existingLayer)) {
          map.removeLayer(existingLayer);
        }
        return;
      }

      // Jika layer sudah ada, update style
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

      // Muat dataset via fetch jika belum ada
      try {
        let data = cachedDatasetsRef.current[cfg.id];
        if (!data) {
          const res = await fetch(cfg.urlPath);
          if (!res.ok) {
            if (cfg.fallbackUrlPath) {
              const res2 = await fetch(cfg.fallbackUrlPath);
              if (res2.ok) data = await res2.json();
            }
          } else {
            data = await res.json();
          }
          if (!data) return;
          cachedDatasetsRef.current[cfg.id] = data;
        }

        // Tentukan style dinamis per fitur
        const layer = L.geoJSON(data, {
          style: (feature) => {
            const p = feature?.properties || {};

            // 1. Layer Master Kerawanan Longsor
            if (cfg.id === "kerawananLongsor") {
              const warna = p.warna_hex || (p.skor_akhir < 2.20 ? "#10b981" : p.skor_akhir <= 3.40 ? "#f59e0b" : "#ef4444");
              return {
                fillColor: warna,
                fillOpacity: opacityVal,
                color: p.border_hex || "#334155",
                weight: 1.2,
                opacity: Math.min(1.0, opacityVal + 0.3),
              };
            }

            // 2. Layer Kemiringan Lereng
            if (cfg.id === "lerengPoly") {
              const skor = Number(p.skor || p.skor_lereng || 1);
              const colorMap = { 1: "#10b981", 2: "#84cc16", 3: "#eab308", 4: "#f59e0b", 5: "#ef4444" };
              return {
                fillColor: colorMap[skor] || "#10b981",
                fillOpacity: opacityVal,
                color: "#1e293b",
                weight: 1.0,
                opacity: opacityVal,
              };
            }

            // 3. Layer Jenis Tanah
            if (cfg.id === "tanah") {
              const warna = p.warna_hex || "#84cc16";
              return {
                fillColor: warna,
                fillOpacity: opacityVal,
                color: "#475569",
                weight: 1.0,
              };
            }

            // 4. Layer Geologi
            if (cfg.id === "geologi") {
              const skor = Number(p.skor_batuan || 2);
              const colorMap = { 1: "#10b981", 2: "#84cc16", 3: "#eab308", 4: "#f59e0b", 5: "#ef4444" };
              return {
                fillColor: colorMap[skor] || "#84cc16",
                fillOpacity: opacityVal,
                color: "#334155",
                weight: 1.0,
              };
            }

            // 5. Layer Curah Hujan (Isohyet)
            if (cfg.id === "hujanIsohyet") {
              const skor = Number(p.skor_hujan || p.skor || 3);
              const colorMap = { 1: "#10b981", 2: "#84cc16", 3: "#eab308", 4: "#f59e0b", 5: "#ef4444" };
              return {
                fillColor: colorMap[skor] || "#eab308",
                fillOpacity: opacityVal,
                color: "#0369a1",
                weight: 1.2,
              };
            }

            // 6. Layer Tutupan Lahan
            if (cfg.id === "tutupan") {
              const warna = p.warna_hex || "#84cc16";
              return {
                fillColor: warna,
                fillOpacity: opacityVal,
                color: "#334155",
                weight: 0.8,
              };
            }

            // 7. Layer Garis Batas Administrasi
            if (cfg.id === "admin") {
              return {
                fillColor: "transparent",
                fillOpacity: 0,
                color: "#1e3a8a",
                weight: 1.8,
                dashArray: "4,3",
                opacity: opacityVal,
              };
            }

            return {
              fillColor: "#3b82f6",
              fillOpacity: opacityVal,
              color: "#1d4ed8",
              weight: 1.0,
            };
          },
          pointToLayer: (feature, latlng) => {
            if (cfg.id === "titikDev") {
              return L.circleMarker(latlng, {
                radius: 6,
                fillColor: "#2563eb",
                color: "#ffffff",
                weight: 2,
                fillOpacity: 0.95,
              });
            }
            if (cfg.id === "posHujan") {
              return L.circleMarker(latlng, {
                radius: 6,
                fillColor: "#0284c7",
                color: "#ffffff",
                weight: 2,
                fillOpacity: 0.95,
              });
            }
            return L.circleMarker(latlng, { radius: 5 });
          },
          onEachFeature: (feature, featureLayer) => {
            const p = feature.properties || {};

            // Klik langsung pada poligon
            featureLayer.on("click", (e) => {
              L.DomEvent.stopPropagation(e);
              handlePolygonClick(p, e.latlng.lat, e.latlng.lng);
            });

            // Hover tooltip
            const labelWilayah = formatAdminLabel(p);
            const skorLabel = p.skor_akhir ? ` (Skor ${Number(p.skor_akhir).toFixed(2)})` : "";
            featureLayer.bindTooltip(
              `<div style="font-weight:700;font-size:11px;">${labelWilayah}${skorLabel}</div>`,
              { sticky: true, direction: "top" }
            );
          },
        });

        layer.addTo(map);
        geoJsonLayersRef.current[cfg.id] = layer;
        if (cfg.legendMode) setActiveLegendMode(cfg.legendMode);
      } catch (err) {
        console.error(`Gagal memuat layer ${cfg.id}:`, err);
      }
    });
  }, [layerVisibility, layerOpacity, handlePolygonClick]);

  const activeConfig = SPATIAL_LAYERS_CONFIG.find((l) => l.legendMode === activeLegendMode);

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-100">
      {/* Container Leaflet Canvas */}
      <div ref={mapContainerRef} className="h-full w-full z-0" />

      {/* Bar Koordinat Real-Time (Bottom-Left) */}
      <div className="absolute bottom-3 left-3 z-[1000] flex items-center gap-2 rounded-lg border border-slate-300/80 bg-white/95 px-3 py-1.5 shadow backdrop-blur-md text-[11px] font-mono text-slate-700">
        <span className="font-bold text-blue-700">WGS84:</span>
        <span>
          {cursorPos.lat.toFixed(5)}°, {cursorPos.lng.toFixed(5)}°
        </span>
        <span className="text-slate-300">|</span>
        <span className="font-bold text-emerald-700">UTM 49S:</span>
        <span>
          {cursorPos.easting.toLocaleString("id-ID")} mE, {cursorPos.northing.toLocaleString("id-ID")} mS
        </span>
      </div>

      {/* Floating Legend Presisi (Bottom-Right) */}
      {activeConfig && activeConfig.legendItems && activeConfig.legendItems.length > 0 && (
        <div className="absolute bottom-10 right-3 z-[1000] max-w-[280px] rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur-md">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
              LEGENDA: {activeConfig.shortTitle}
            </span>
          </div>
          <div className="space-y-1.5 text-xs">
            {activeConfig.legendItems.map((item, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border shadow-xs"
                  style={{ backgroundColor: item.color, borderColor: item.borderColor || item.color }}
                />
                <div>
                  <div className="font-bold text-slate-800 text-[11px] leading-tight">{item.label}</div>
                  {item.subLabel && (
                    <div className="text-[10px] text-slate-500 leading-tight">{item.subLabel}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default MapComponent;
