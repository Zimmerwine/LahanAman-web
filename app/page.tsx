"use client";

/**
 * app/page.tsx
 * ============================================================================
 * MODUL 4 & 5: ENTERPRISE GEOSPATIAL DASHBOARD — LahanAman GeoAnalytics DIY
 *
 * Arsitektur Layout (Tailwind CSS):
 * - Header: Badge metrik ringkasan (Skor Hijau, Kuning, Merah), indikator EPSG
 *   (WGS84 & UTM 49S), tombol "Gambar Poligon Kavling", dan "Reset Kavling".
 * - Sidebar Kiri (Lebar 320px): Filter Administrasi Hierarkis (`AdminFilterPanel`)
 *   di bagian atas, diikuti Kontrol Layer Spasial di bawahnya.
 * - Area Peta Tengah: `MapComponent` + Floating Layer Controller (thin scrollbar & opacity 10%-100%).
 * - Sidebar Kanan (Lebar 380px): Detail Geoteknik & Audit Trail (Card FS & Zona GPKG,
 *   Panel Audit Trail β, c', φ', γsat, z, m, u, q, serta 5 Progress Bar Bobot GPKG).
 * ============================================================================
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { SPATIAL_LAYERS_CONFIG } from "../config/layersConfig";
import { analyzeGeotechPoint } from "../utils/geotechEngine";
import {
  AdminFilterPanel,
  AdminGeoJSONFeature,
  LeafletMapInstance,
  formatAdminLabel,
} from "../components/AdminFilterPanel";
import type { SelectedLocationInspection } from "../components/MapComponent";

const MapComponent = dynamic(() => import("../components/MapComponent"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-slate-200 text-xs font-semibold text-slate-600">
      ⏳ Memuat Peta Spasial LahanAman GeoAnalytics DIY...
    </div>
  ),
});

export default function LahanAmanDashboardPage() {
  const [adminFeatures, setAdminFeatures] = useState<AdminGeoJSONFeature[]>([]);
  const [mapInstance, setMapInstance] = useState<LeafletMapInstance | null>(null);
  const [selectedInspection, setSelectedInspection] =
    useState<SelectedLocationInspection | null>(null);
  const [isDrawingKavling, setIsDrawingKavling] = useState<boolean>(false);

  // State visibilitas & transparansi (10% - 100%) seluruh layer spasial
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const l of SPATIAL_LAYERS_CONFIG) init[l.id] = l.defaultVisible;
    return init;
  });

  const [layerOpacity, setLayerOpacity] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const l of SPATIAL_LAYERS_CONFIG) init[l.id] = l.defaultOpacity;
    return init;
  });

  // Muat clean_batas_administrasi.geojson saat inisialisasi
  useEffect(() => {
    let active = true;
    fetch("/data/clean_batas_administrasi.geojson")
      .then((res) => res.json())
      .then((fc) => {
        if (!active || !fc?.features) return;
        setAdminFeatures(fc.features as AdminGeoJSONFeature[]);
      })
      .catch((err) => console.error("Gagal memuat batas administrasi:", err));
    return () => {
      active = false;
    };
  }, []);

  // Hitung metrik ringkasan zona (Hijau, Kuning, Merah) murni data-driven
  const zoneStats = useMemo(() => {
    let hijau = 0;
    let kuning = 0;
    let merah = 0;

    for (const feat of adminFeatures) {
      const p = feat.properties;
      const res = analyzeGeotechPoint({
        betaDeg: p.lereng_derajat,
        slopePercent: p.lereng_persen,
        jenisTanah: p.jenis_tanah,
        formasiBatuan: p.formasi_batuan,
        curahHujanMm: (p.curah_hujan_mm ?? p.ch_idw_mm) as number | undefined,
        tutupanLahan: p.tutupan_dominan,
      });
      if (res.zonaKode === "HIJAU") hijau++;
      else if (res.zonaKode === "KUNING") kuning++;
      else merah++;
    }

    return { hijau, kuning, merah };
  }, [adminFeatures]);

  const handleToggleLayer = useCallback((layerId: string, visible: boolean) => {
    setLayerVisibility((prev) => ({ ...prev, [layerId]: visible }));
  }, []);

  const handleChangeLayerOpacity = useCallback((layerId: string, opacity: number) => {
    setLayerOpacity((prev) => ({ ...prev, [layerId]: opacity }));
  }, []);

  // Saat Kalurahan dipilih pada AdminFilterPanel
  const handleSelectKalurahan = useCallback(
    (
      feature: AdminGeoJSONFeature | null,
      boundsWgs84: [[number, number], [number, number]] | null
    ) => {
      if (!feature) return;
      const p = feature.properties;
      const analysis = analyzeGeotechPoint({
        betaDeg: p.lereng_derajat,
        slopePercent: p.lereng_persen,
        jenisTanah: p.jenis_tanah,
        formasiBatuan: p.formasi_batuan,
        curahHujanMm: (p.curah_hujan_mm ?? p.ch_idw_mm) as number | undefined,
        tutupanLahan: p.tutupan_dominan,
      });

      const centerLat = boundsWgs84
        ? (boundsWgs84[0][0] + boundsWgs84[1][0]) / 2
        : Number(p.lintang_wgs84 || -7.78);
      const centerLng = boundsWgs84
        ? (boundsWgs84[0][1] + boundsWgs84[1][1]) / 2
        : Number(p.bujur_wgs84 || 110.37);

      setSelectedInspection({
        lat: centerLat,
        lng: centerLng,
        eastingUtm: Number(p.easting_x || 435000),
        northingUtm: Number(p.northing_y || 9140000),
        elevasiMdpl: Number(p.elevasi_mdpl || 115),
        adminLabel: formatAdminLabel(p),
        kalurahan: p.kalurahan,
        kapanewon: p.kapanewon,
        kabupaten: p.kabupaten,
        analysis,
      });
    },
    []
  );

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-100 text-slate-900">
      {/* =====================================================================
          HEADER MODERN FLAT / GLASSMORPHISM
          ===================================================================== */}
      <header className="z-50 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 shadow-sm backdrop-blur-md">
        {/* Brand & Indikator EPSG */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-teal-600 text-sm font-extrabold text-white shadow">
            LA
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-extrabold tracking-tight text-slate-900">
                LahanAman GeoAnalytics DIY
              </h1>
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                UTM 49S: EPSG:32749
              </span>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                WGS84: EPSG:4326
              </span>
            </div>
            <p className="truncate text-[11px] text-slate-500">
              Sistem Analisis Kestabilan Lereng (Infinite Slope) &amp; Triase Kelayakan Lahan GPKG DIY
            </p>
          </div>
        </div>

        {/* Badge Metrik Ringkasan (Skor Hijau, Kuning, Merah) */}
        <div className="hidden xl:flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-900">
            <span className="h-2 w-2 rounded-full bg-emerald-600" />
            <span>
              Skor Hijau (&lt;2,20): <b className="font-extrabold">{zoneStats.hijau}</b>
            </span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span>
              Skor Kuning (2,20–3,40): <b className="font-extrabold">{zoneStats.kuning}</b>
            </span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-900">
            <span className="h-2 w-2 rounded-full bg-red-600" />
            <span>
              Skor Merah (&gt;3,40): <b className="font-extrabold">{zoneStats.merah}</b>
            </span>
          </div>
        </div>

        {/* Tombol Gambar Poligon Kavling & Reset Kavling */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setIsDrawingKavling((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:from-emerald-700 hover:to-teal-700 transition"
          >
            ✏️ {isDrawingKavling ? "Batal Gambar" : "Gambar Poligon Kavling"}
          </button>
          <button
            type="button"
            onClick={() => {
              setIsDrawingKavling(false);
              setSelectedInspection(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-red-400 hover:bg-red-50 hover:text-red-700 transition"
          >
            🗑️ Reset Kavling
          </button>
        </div>
      </header>

      {/* =====================================================================
          WORKSPACE UTAMA: SIDEBAR KIRI (320px) | PETA | SIDEBAR KANAN (380px)
          ===================================================================== */}
      <main className="flex flex-1 min-h-0 overflow-hidden">
        {/* SIDEBAR KIRI (Lebar 320px): Filter Administrasi Hierarkis + Kontrol Layer Spasial */}
        <aside className="w-[320px] shrink-0 border-r border-slate-200 bg-white/90 backdrop-blur-md flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-thin scrollbar-thumb-slate-300">
            {/* 1. Filter Wilayah Presisi (Hierarchical Admin Cascading Filter) */}
            <AdminFilterPanel
              adminFeatures={adminFeatures}
              mapInstance={mapInstance}
              onSelectKalurahan={handleSelectKalurahan}
            />

            {/* 2. Kontrol Layer Spasial & Slider Transparansi */}
            <div className="rounded-xl border border-slate-200 bg-white/95 p-3.5 shadow-sm">
              <div className="flex items-center justify-between mb-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-blue-700">
                  🗂️ Kontrol Layer Spasial
                </h3>
                <span className="text-[10px] font-semibold text-slate-500">Opacity 10–100%</span>
              </div>

              <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-300">
                {SPATIAL_LAYERS_CONFIG.map((cfg) => {
                  const isChecked = Boolean(layerVisibility[cfg.id]);
                  const opacityPct = Math.round(
                    (layerOpacity[cfg.id] ?? cfg.defaultOpacity) * 100
                  );

                  return (
                    <div
                      key={cfg.id}
                      className="rounded-lg border border-slate-200/90 bg-slate-50/80 p-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-800">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => handleToggleLayer(cfg.id, e.target.checked)}
                            className="h-3.5 w-3.5 rounded accent-blue-600"
                          />
                          <span>
                            {cfg.icon} {cfg.title}
                          </span>
                        </label>
                        {cfg.weightPercentage && (
                          <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-800">
                            {cfg.weightPercentage}%
                          </span>
                        )}
                      </div>

                      <div className="mt-1.5 flex items-center gap-2 pl-5">
                        <input
                          type="range"
                          min={10}
                          max={100}
                          step={5}
                          value={opacityPct}
                          onChange={(e) =>
                            handleChangeLayerOpacity(cfg.id, Number(e.target.value) / 100)
                          }
                          className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                        />
                        <span className="w-9 text-right font-mono text-[10px] font-bold text-slate-600">
                          {opacityPct}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </aside>

        {/* TENGAH: CANVAS PETA SPASIAL */}
        <section className="flex-1 min-w-0 h-full relative">
          <MapComponent
            adminFeatures={adminFeatures}
            layerVisibility={layerVisibility}
            layerOpacity={layerOpacity}
            onToggleLayer={handleToggleLayer}
            onChangeLayerOpacity={handleChangeLayerOpacity}
            onInspectLocation={setSelectedInspection}
            onMapReady={setMapInstance}
            isDrawingKavling={isDrawingKavling}
          />
        </section>

        {/* SIDEBAR KANAN (Lebar 380px): Detail Geoteknik & Audit Trail */}
        <aside className="w-[380px] shrink-0 border-l border-slate-200 bg-white/95 backdrop-blur-md flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5 scrollbar-thin scrollbar-thumb-slate-300">
            {!selectedInspection ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/80 p-6 text-center">
                <div className="mx-auto mb-2.5 flex h-11 w-11 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 text-xl">
                  🧭
                </div>
                <h2 className="text-sm font-extrabold text-slate-900">
                  Inspeksi Geoteknik &amp; Audit Trail
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                  Pilih <b>Kabupaten &rarr; Kapanewon &rarr; Kalurahan</b> pada panel kiri atau klik
                  titik pada peta untuk menampilkan kalkulasi <b>Faktor Keamanan (FS)</b>,{" "}
                  <b>Skor Akhir GPKG</b>, dan <b>Audit Trail Mekanika Tanah</b>.
                </p>
              </div>
            ) : (
              <>
                {/* 1. CARD UTAMA: SKOR AKHIR GPKG & NILAI FS DENGAN BADGE STATUS */}
                <div
                  className="rounded-xl border-2 p-3.5 shadow-sm"
                  style={{
                    borderColor: selectedInspection.analysis.warnaHex,
                    backgroundColor:
                      selectedInspection.analysis.zonaKode === "HIJAU"
                        ? "#ecfdf5"
                        : selectedInspection.analysis.zonaKode === "KUNING"
                        ? "#fffbeb"
                        : "#fef2f2",
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="rounded-full px-2.5 py-0.5 text-[11px] font-extrabold text-white shadow-sm"
                      style={{ backgroundColor: selectedInspection.analysis.warnaHex }}
                    >
                      SKOR GPKG: {selectedInspection.analysis.skorAkhir.toFixed(2)} / 5,00
                    </span>
                    <span className="font-mono text-[11px] font-bold text-slate-700">
                      ±{selectedInspection.elevasiMdpl.toFixed(1)} mdpl
                    </span>
                  </div>

                  <div className="mt-2 text-xs font-extrabold text-slate-900">
                    {selectedInspection.analysis.zonaLabel} —{" "}
                    {selectedInspection.analysis.zonaDeskripsi}
                  </div>

                  <div className="mt-1.5 text-sm font-extrabold text-slate-950">
                    {selectedInspection.adminLabel}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[10px] font-semibold text-slate-700">
                    <span className="rounded border border-slate-300/80 bg-white/80 px-2 py-0.5">
                      🌐 {selectedInspection.lat.toFixed(5)}°, {selectedInspection.lng.toFixed(5)}°
                    </span>
                    <span className="rounded border border-slate-300/80 bg-white/80 px-2 py-0.5">
                      📐 {Math.round(selectedInspection.eastingUtm).toLocaleString("id-ID")} mE,{" "}
                      {Math.round(selectedInspection.northingUtm).toLocaleString("id-ID")} mS
                    </span>
                  </div>
                </div>

                {/* CARD FAKTOR KEAMANAN LERENG (FS INFINITE SLOPE) */}
                <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Faktor Keamanan Lereng (Infinite Slope FS)
                      </span>
                      <span className="font-mono text-2xl font-extrabold text-slate-900">
                        {selectedInspection.analysis.fs.toFixed(2)}
                      </span>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-extrabold uppercase tracking-wide border ${
                        selectedInspection.analysis.fsBadgeColor === "emerald"
                          ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                          : selectedInspection.analysis.fsBadgeColor === "amber"
                          ? "bg-amber-100 text-amber-800 border-amber-300"
                          : "bg-red-100 text-red-800 border-red-300"
                      }`}
                    >
                      {selectedInspection.analysis.fsStatus}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
                    {selectedInspection.analysis.fsKeterangan}
                  </p>
                </div>

                {/* 2. PANEL AUDIT TRAIL PARAMETER INPUT AKTUAL LOKASI */}
                <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
                  <div className="flex items-center justify-between mb-2.5">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-blue-700">
                      🔬 Audit Trail Parameter Mekanika Tanah
                    </h3>
                    <span className="font-mono text-[10px] font-semibold text-slate-500">
                      Dasar.xlsx
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <span className="block text-[10px] text-slate-500">
                        Kemiringan Lereng (β)
                      </span>
                      <b className="font-mono text-slate-900">
                        {selectedInspection.analysis.auditTrail.betaDeg.toFixed(2)}° (
                        {selectedInspection.analysis.parameters.lereng.slopePercent.toFixed(1)}%)
                      </b>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <span className="block text-[10px] text-slate-500">
                        Kohesi Efektif (c&apos; + cr)
                      </span>
                      <b className="font-mono text-slate-900">
                        {selectedInspection.analysis.auditTrail.cPrimeKpa.toFixed(1)} +{" "}
                        {selectedInspection.analysis.auditTrail.crKpa.toFixed(1)} kPa
                      </b>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <span className="block text-[10px] text-slate-500">
                        Sudut Geser Dalam (φ&apos;)
                      </span>
                      <b className="font-mono text-slate-900">
                        {selectedInspection.analysis.auditTrail.phiPrimeDeg.toFixed(1)}°
                      </b>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <span className="block text-[10px] text-slate-500">
                        Berat Isi Jenuh (γsat)
                      </span>
                      <b className="font-mono text-slate-900">
                        {selectedInspection.analysis.auditTrail.gammaSatKnM3.toFixed(1)} kN/m³
                      </b>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <span className="block text-[10px] text-slate-500">
                        Kedalaman Bidang Gelincir (z)
                      </span>
                      <b className="font-mono text-slate-900">
                        {selectedInspection.analysis.auditTrail.zDepthM.toFixed(2)} m
                      </b>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <span className="block text-[10px] text-slate-500">
                        Rasio Kejenuhan Air (m)
                      </span>
                      <b className="font-mono text-slate-900">
                        {selectedInspection.analysis.auditTrail.rasioKejenuhanM.toFixed(2)}
                      </b>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <span className="block text-[10px] text-slate-500">
                        Tegangan Air Pori (u)
                      </span>
                      <b className="font-mono text-slate-900">
                        {selectedInspection.analysis.auditTrail.poreWaterPressureUKpa.toFixed(2)}{" "}
                        kPa
                      </b>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <span className="block text-[10px] text-slate-500">
                        Beban Tambahan (q)
                      </span>
                      <b className="font-mono text-slate-900">
                        {selectedInspection.analysis.auditTrail.surchargeLoadQKpa.toFixed(1)} kPa
                      </b>
                    </div>
                  </div>
                </div>

                {/* 3. BREAKDOWN SKOR: 5 PROGRESS BAR BOBOT TERPISAH */}
                <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
                  <div className="flex items-center justify-between mb-2.5">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-blue-700">
                      📊 Breakdown 5 Parameter GPKG
                    </h3>
                    <span className="text-[10px] font-bold text-slate-600">
                      Total: {selectedInspection.analysis.skorAkhir.toFixed(2)}
                    </span>
                  </div>

                  <div className="space-y-3">
                    {[
                      {
                        label: "Kemiringan Lereng (β)",
                        bobotPct: 30,
                        skor: selectedInspection.analysis.parameters.lereng.skor,
                        tertimbang: selectedInspection.analysis.parameters.lereng.skorTertimbang,
                        val: `${selectedInspection.analysis.parameters.lereng.betaDeg.toFixed(2)}° (${selectedInspection.analysis.parameters.lereng.rentangLabel})`,
                        desc: selectedInspection.analysis.parameters.lereng.keteranganGeoteknik,
                      },
                      {
                        label: "Karakteristik Tanah (Pedologi)",
                        bobotPct: 25,
                        skor: selectedInspection.analysis.parameters.tanah.skor,
                        tertimbang: selectedInspection.analysis.parameters.tanah.skorTertimbang,
                        val: selectedInspection.analysis.parameters.tanah.jenisTanah,
                        desc: selectedInspection.analysis.parameters.tanah.keteranganGeoteknik,
                      },
                      {
                        label: "Litologi & Formasi Geologi",
                        bobotPct: 20,
                        skor: selectedInspection.analysis.parameters.batuan.skor,
                        tertimbang: selectedInspection.analysis.parameters.batuan.skorTertimbang,
                        val: selectedInspection.analysis.parameters.batuan.formasiBatuan,
                        desc: selectedInspection.analysis.parameters.batuan.keteranganGeoteknik,
                      },
                      {
                        label: "Curah Hujan Tahunan (Isohyet)",
                        bobotPct: 15,
                        skor: selectedInspection.analysis.parameters.hujan.skor,
                        tertimbang: selectedInspection.analysis.parameters.hujan.skorTertimbang,
                        val: `${selectedInspection.analysis.parameters.hujan.curahHujanMm.toLocaleString("id-ID")} mm/thn`,
                        desc: selectedInspection.analysis.parameters.hujan.keteranganGeoteknik,
                      },
                      {
                        label: "Tutupan Lahan (RBI)",
                        bobotPct: 10,
                        skor: selectedInspection.analysis.parameters.lahan.skor,
                        tertimbang: selectedInspection.analysis.parameters.lahan.skorTertimbang,
                        val: selectedInspection.analysis.parameters.lahan.tutupanLahan,
                        desc: selectedInspection.analysis.parameters.lahan.keteranganGeoteknik,
                      },
                    ].map((item, idx) => {
                      const pctWidth = (item.skor / 5) * 100;
                      const barColor =
                        item.skor >= 5
                          ? "#D32F2F"
                          : item.skor === 4
                          ? "#FB8C00"
                          : item.skor === 3
                          ? "#FFB300"
                          : item.skor === 2
                          ? "#66BB6A"
                          : "#2E7D32";

                      return (
                        <div
                          key={idx}
                          className="rounded-lg border border-slate-200/90 bg-slate-50/70 p-2.5"
                        >
                          <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                            <span>
                              {item.label}{" "}
                              <span className="text-[10px] font-semibold text-blue-700">
                                ({item.bobotPct}%)
                              </span>
                            </span>
                            <span className="font-mono text-[11px]">
                              Skor {item.skor}/5 (+{item.tertimbang.toFixed(2)})
                            </span>
                          </div>
                          <div className="mt-1 text-[11px] font-semibold text-slate-900">
                            {item.val}
                          </div>
                          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{ width: `${pctWidth}%`, backgroundColor: barColor }}
                            />
                          </div>
                          <p className="mt-1 text-[10.5px] leading-snug text-slate-600">
                            {item.desc}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
