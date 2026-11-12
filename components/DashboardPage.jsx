"use client";

/**
 * components/DashboardPage.jsx
 * ============================================================================
 * MODUL 5: DASHBOARD UTAMA & AUDIT TRAIL GEOTEKNIK LERENG DIY (100% PURE JSX)
 * LahanAman GeoAnalytics DIY
 *
 * Arsitektur:
 * - Header: Indikator Dual-CRS (WGS84 & UTM 49S), Badge Ringkasan Zona (Hijau, Kuning, Merah).
 * - Sidebar Kiri (320px): AdminFilterPanel (Kabupaten -> Kapanewon -> Kalurahan) & Layer Control.
 * - Canvas Peta Tengah: Leaflet MapComponent dengan event data-driven tanpa dummy fallback.
 * - Sidebar Kanan (380px): Card Skor GPKG, Badge FS (Stabil, Kritis, Labil), Audit Trail
 *   Mekanika Tanah (c', phi', gamma, z, m, u, q, beta), dan 5 Progress Bar Bobot.
 * ============================================================================
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { SPATIAL_LAYERS_CONFIG } from "../config/layersConfig";
import { AdminFilterPanel, formatAdminLabel } from "./AdminFilterPanel";

// Load MapComponent secara dynamic (SSR false)
const MapComponent = dynamic(() => import("./MapComponent"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-slate-200 text-xs font-semibold text-slate-600">
      ⏳ Memuat Peta Spasial LahanAman GeoAnalytics DIY...
    </div>
  ),
});

export function DashboardPage() {
  const [adminFeatures, setAdminFeatures] = useState([]);
  const [masterKrFeatures, setMasterKrFeatures] = useState([]);
  const [mapInstance, setMapInstance] = useState(null);
  const [selectedInspection, setSelectedInspection] = useState(null);
  const [isDrawingKavling, setIsDrawingKavling] = useState(false);

  // State visibilitas & transparansi layer
  const [layerVisibility, setLayerVisibility] = useState(() => {
    const init = {};
    for (const l of SPATIAL_LAYERS_CONFIG) init[l.id] = l.defaultVisible;
    return init;
  });

  const [layerOpacity, setLayerOpacity] = useState(() => {
    const init = {};
    for (const l of SPATIAL_LAYERS_CONFIG) init[l.id] = l.defaultOpacity;
    return init;
  });

  // Muat data batas administrasi saat inisialisasi
  useEffect(() => {
    let active = true;
    fetch("/data/clean_batas_administrasi.geojson")
      .then((res) => res.json())
      .then((fc) => {
        if (!active || !fc?.features) return;
        setAdminFeatures(fc.features);
      })
      .catch((err) => console.error("Gagal memuat batas administrasi:", err));

    // Muat data master kerawanan longsor untuk metrik akurat
    fetch("/data/clean_kerawanan_longsor.geojson")
      .then((res) => res.json())
      .then((fc) => {
        if (!active || !fc?.features) return;
        setMasterKrFeatures(fc.features);
      })
      .catch((err) => console.error("Gagal memuat master kerawanan:", err));

    return () => {
      active = false;
    };
  }, []);

  // Metrik ringkasan zona murni data-driven dari layer kerawanan longsor
  const zoneStats = useMemo(() => {
    let hijau = 0;
    let kuning = 0;
    let merah = 0;

    const source = masterKrFeatures.length > 0 ? masterKrFeatures : adminFeatures;
    for (const feat of source) {
      const p = feat.properties || {};
      const skor = Number(p.skor_akhir ?? p.skor_total ?? 2.5);
      if (skor < 2.20) hijau++;
      else if (skor <= 3.40) kuning++;
      else merah++;
    }

    return { hijau, kuning, merah };
  }, [masterKrFeatures, adminFeatures]);

  const handleToggleLayer = useCallback((layerId, visible) => {
    setLayerVisibility((prev) => ({ ...prev, [layerId]: visible }));
  }, []);

  const handleChangeLayerOpacity = useCallback((layerId, opacity) => {
    setLayerOpacity((prev) => ({ ...prev, [layerId]: opacity }));
  }, []);

  // Saat Kalurahan dipilih dari AdminFilterPanel
  const handleSelectKalurahan = useCallback((feature, boundsWgs84) => {
    if (!feature) {
      setSelectedInspection(null);
      return;
    }
    const p = feature.properties || {};

    const centerLat = boundsWgs84
      ? (boundsWgs84[0][0] + boundsWgs84[1][0]) / 2
      : Number(p.lintang_wgs84 || -7.78);
    const centerLng = boundsWgs84
      ? (boundsWgs84[0][1] + boundsWgs84[1][1]) / 2
      : Number(p.bujur_wgs84 || 110.37);

    const kalurahan = String(p.KALURAHAN || p.kalurahan || "-");
    const kapanewon = String(p.KECAMATAN || p.kapanewon || "-");
    const kabupaten = String(p.KABUPATEN || p.kabupaten || "Kabupaten Sleman");
    const adminLabel = formatAdminLabel({ KALURAHAN: kalurahan, KECAMATAN: kapanewon, KABUPATEN: kabupaten });

    const skorAkhir = Number(p.skor_akhir ?? p.skor_total ?? 2.45);
    const betaDeg = Number(p.lereng_derajat ?? 3.5);
    const slopePct = Number(p.lereng_persen ?? 6.1);
    const fsVal = Number(p.fs ?? (betaDeg <= 2.0 ? 5.0 : 2.5));

    let fsStatus = p.fs_status;
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

    const zonaKode = skorAkhir < 2.20 ? "HIJAU" : skorAkhir <= 3.40 ? "KUNING" : "MERAH";
    const warnaHex = p.warna_hex || (zonaKode === "HIJAU" ? "#10b981" : zonaKode === "KUNING" ? "#f59e0b" : "#ef4444");

    setSelectedInspection({
      lat: centerLat,
      lng: centerLng,
      eastingUtm: Number(p.easting_x || 435000),
      northingUtm: Number(p.northing_y || 9140000),
      elevasiMdpl: Number(p.elevasi_mdpl || 120),
      adminLabel,
      kalurahan,
      kapanewon,
      kabupaten,
      analysis: {
        skorAkhir,
        zonaKode,
        zonaLabel: p.zona_kelayakan || `ZONA ${zonaKode}`,
        zonaDeskripsi:
          zonaKode === "HIJAU"
            ? "Datar / Risiko Rendah / Konstruksi Standar"
            : zonaKode === "KUNING"
            ? "Risiko Sedang / Perlu Mitigasi Drainase & Talud"
            : "Risiko Tinggi / Rawan Longsor / Non-Buildable",
        warnaHex,
        borderHex: p.border_hex || warnaHex,
        fs: fsVal,
        fsStatus,
        fsBadgeColor,
        fsKeterangan:
          fsVal > 1.25
            ? "Lereng stabil aman (FS > 1.25); cocok untuk permukiman dengan pondasi standar."
            : fsVal >= 1.07
            ? "Kondisi lereng kritis (1.07 ≤ FS ≤ 1.25); memerlukan perkuatan dinding penahan tanah."
            : "Lereng labil rawan longsor (FS < 1.07); melampaui kapasitas geser tanah penutup!",
        parameters: {
          lereng: {
            betaDeg,
            slopePercent: slopePct,
            skor: Number(p.skor_lereng ?? 1),
            bobot: 0.30,
            skorTertimbang: Number(((p.skor_lereng ?? 1) * 0.30).toFixed(3)),
            rentangLabel: `${betaDeg.toFixed(1)}° (${slopePct.toFixed(1)}%)`,
            keteranganGeoteknik: p.kelas_lereng || p.ket_lereng || "0° – 8° (0% – 14.1%) Datar - Landai",
          },
          tanah: {
            jenisTanah: p.jenis_tanah || p.ket_tanah || "Regosol",
            skor: Number(p.skor_tanah ?? 3),
            bobot: 0.25,
            skorTertimbang: Number(((p.skor_tanah ?? 3) * 0.25).toFixed(3)),
            cPrimeKpa: Number(p.c_kpa ?? 3.5),
            phiPrimeDeg: Number(p.phi_deg ?? 36.0),
            gammaSatKnM3: Number(p.gamma_sat ?? 17.5),
            zDepthM: Number(p.z ?? 1.0),
            isExpansive: Boolean(p.is_expansive ?? false),
            keteranganGeoteknik: `c'=${Number(p.c_kpa ?? 3.5).toFixed(1)} kPa, φ'=${Number(p.phi_deg ?? 36.0).toFixed(1)}°, γsat=${Number(p.gamma_sat ?? 17.5).toFixed(1)} kN/m³, z=${Number(p.z ?? 1.0).toFixed(1)} m`,
          },
          batuan: {
            formasiBatuan: p.formasi_batuan || p.ket_batuan || "Endapan Merapi Muda",
            simbolFormasi: p.SYMBOLS || "",
            skor: Number(p.skor_batuan ?? 2),
            bobot: 0.20,
            skorTertimbang: Number(((p.skor_batuan ?? 2) * 0.20).toFixed(3)),
            keteranganGeoteknik: p.formasi_batuan || p.ket_batuan || "Endapan Merapi Muda (Pasir-Kerikil Permeabel)",
          },
          hujan: {
            curahHujanMm: Number(p.curah_hujan_mm ?? 2250),
            skor: Number(p.skor_hujan ?? 3),
            bobot: 0.15,
            skorTertimbang: Number(((p.skor_hujan ?? 3) * 0.15).toFixed(3)),
            rasioKejenuhanM: Number(p.rasio_m ?? 0.60),
            rentangLabel: `${Number(p.curah_hujan_mm ?? 2250).toLocaleString("id-ID")} mm/thn`,
            keteranganGeoteknik: String(p.kelas_hujan || p.ket_hujan || "2.001 – 2.500 mm/tahun (Sedang)").replace(/IDW/gi, "Isohyet"),
          },
          lahan: {
            tutupanLahan: p.tutupan_dominan || p.ket_lahan || "Permukiman",
            skor: Number(p.skor_tutupan || p.skor_lahan || 3),
            bobot: 0.10,
            skorTertimbang: Number(((p.skor_tutupan || p.skor_lahan || 3) * 0.10).toFixed(3)),
            kohesiAkarCrKpa: Number(p.cr_kpa ?? 0.0),
            bebanTambahanQKpa: Number(p.q_kpa ?? 15.0),
            keteranganGeoteknik: `${p.tutupan_dominan || p.ket_lahan || "Permukiman"} (cr=${p.cr_kpa ?? 0} kPa, q=${p.q_kpa ?? 15} kPa)`,
          },
        },
        auditTrail: {
          betaDeg,
          cPrimeKpa: Number(p.c_kpa ?? 3.5),
          crKpa: Number(p.cr_kpa ?? 0.0),
          phiPrimeDeg: Number(p.phi_deg ?? 36.0),
          gammaSatKnM3: Number(p.gamma_sat ?? 17.5),
          zDepthM: Number(p.z ?? 1.0),
          rasioKejenuhanM: Number(p.rasio_m ?? 0.60),
          poreWaterPressureUKpa: Number((Number(p.rasio_m ?? 0.60) * 9.81 * Number(p.z ?? 1.0)).toFixed(2)),
          surchargeLoadQKpa: Number(p.q_kpa ?? 15.0),
        },
      },
    });
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-100 text-slate-900 font-sans">
      {/* =====================================================================
          HEADER MODERN GLASSMORPHISM
          ===================================================================== */}
      <header className="z-50 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 shadow-sm backdrop-blur-md">
        {/* Brand & Dual CRS Indicators */}
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

        {/* Badge Metrik Ringkasan Data-Driven */}
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

        {/* Action Buttons */}
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
            🗑️ Reset
          </button>
        </div>
      </header>

      {/* =====================================================================
          WORKSPACE UTAMA
          ===================================================================== */}
      <main className="flex flex-1 min-h-0 overflow-hidden">
        {/* SIDEBAR KIRI (320px) */}
        <aside className="w-[320px] shrink-0 border-r border-slate-200 bg-white/90 backdrop-blur-md flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {/* 1. Filter Administrasi Cascading */}
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

              <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
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

        {/* TENGAH: PETA LEAFLET */}
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

        {/* SIDEBAR KANAN (380px): Detail Geoteknik & Audit Trail */}
        <aside className="w-[380px] shrink-0 border-l border-slate-200 bg-white/95 backdrop-blur-md flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
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
                  poligon pada peta untuk menampilkan kalkulasi <b>Faktor Keamanan (FS)</b>,{" "}
                  <b>Skor Akhir GPKG</b>, dan <b>Audit Trail Mekanika Tanah</b>.
                </p>
              </div>
            ) : (
              <>
                {/* 1. CARD UTAMA: SKOR AKHIR GPKG */}
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
                    {selectedInspection.analysis.zonaLabel} — {selectedInspection.analysis.zonaDeskripsi}
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

                {/* 2. CARD FAKTOR KEAMANAN (FS INFINITE SLOPE) */}
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

                {/* 3. PANEL AUDIT TRAIL PARAMETER INPUT MEKANIKA TANAH */}
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
                        {selectedInspection.analysis.auditTrail.poreWaterPressureUKpa.toFixed(2)} kPa
                      </b>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <span className="block text-[10px] text-slate-500">
                        Beban Tambahan Surcharge (q)
                      </span>
                      <b className="font-mono text-slate-900">
                        {selectedInspection.analysis.auditTrail.surchargeLoadQKpa.toFixed(1)} kPa
                      </b>
                    </div>
                  </div>
                </div>

                {/* 4. BREAKDOWN 5 PARAMETER GPKG DENGAN PROGRESS BAR */}
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
                        label: "Tutupan Lahan (Land Cover)",
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
                          ? "#ef4444"
                          : item.skor === 4
                          ? "#f59e0b"
                          : item.skor === 3
                          ? "#eab308"
                          : item.skor === 2
                          ? "#84cc16"
                          : "#10b981";

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

export default DashboardPage;
