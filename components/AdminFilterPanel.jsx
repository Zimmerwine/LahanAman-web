"use client";

/**
 * components/AdminFilterPanel.jsx
 * ============================================================================
 * FILTER WILAYAH PRESISI CASCADING HIERARKIS (100% PURE JSX)
 * LahanAman GeoAnalytics DIY
 *
 * Fitur:
 * - Dropdown 3 Tingkat: Kabupaten/Kota -> Kapanewon/Kecamatan -> Kalurahan/Kelurahan
 * - Membaca data unik murni dari clean_batas_administrasi.geojson
 * - Toponimi dusun & katalog_dusun_diy.json TELAH DIHAPUS TOTAL
 * - Saat Kalurahan dipilih, kamera Leaflet melakukan map.fitBounds(bbox) secara presisi
 * - Menampilkan format label baku: "Kal. [Nama], Kapanewon [Nama], [Kabupaten]"
 * ============================================================================
 */

import React, { useMemo, useState } from "react";
import bbox from "@turf/bbox";

/**
 * Format label administrasi:
 * "Kal. [Nama], Kapanewon [Nama], Kab. [Nama]"
 */
export function formatAdminLabel(props) {
  if (!props) return "-";
  const kal = props.KALURAHAN || props.kalurahan || "-";
  const kec = props.KECAMATAN || props.kapanewon || "-";
  const kabRaw = props.KABUPATEN || props.kabupaten || "Kabupaten Sleman";
  const isKota = kabRaw.toLowerCase().includes("kota");
  const prefixDesa = isKota ? "Kel." : "Kal.";
  const prefixKec = isKota ? "Kemantren" : "Kapanewon";
  const kabLabel =
    kabRaw.startsWith("Kab.") || kabRaw.startsWith("Kabupaten") || kabRaw.startsWith("Kota")
      ? kabRaw
      : `Kab. ${kabRaw}`;
  return `${prefixDesa} ${kal}, ${prefixKec} ${kec}, ${kabLabel}`;
}

/**
 * Hitung Leaflet bounds [[minLat, minLng], [maxLat, maxLng]] dari fitur GeoJSON
 */
export function computeLeafletBounds(feature) {
  if (!feature || !feature.geometry) return null;
  try {
    const b = bbox(feature); // [minX, minY, maxX, maxY]
    return [
      [b[1], b[0]],
      [b[3], b[2]],
    ];
  } catch (err) {
    let minLat = Infinity,
      maxLat = -Infinity,
      minLng = Infinity,
      maxLng = -Infinity;
    const scan = (coords) => {
      if (typeof coords[0] === "number") {
        const [lng, lat] = coords;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
      } else {
        coords.forEach(scan);
      }
    };
    scan(feature.geometry.coordinates);
    if (!Number.isFinite(minLat)) return null;
    return [
      [minLat, minLng],
      [maxLat, maxLng],
    ];
  }
}

export function AdminFilterPanel({
  adminFeatures = [],
  mapInstance = null,
  onSelectKalurahan,
  onFilterChange,
}) {
  const [selectedKabupaten, setSelectedKabupaten] = useState("");
  const [selectedKapanewon, setSelectedKapanewon] = useState("");
  const [selectedKalurahan, setSelectedKalurahan] = useState("");

  // 1. Ekstrak daftar Kabupaten/Kota unik
  const kabupatenList = useMemo(() => {
    const setKab = new Set();
    for (const feat of adminFeatures) {
      const p = feat.properties || {};
      const kab = p.KABUPATEN || p.kabupaten;
      if (kab) setKab.add(kab);
    }
    return Array.from(setKab).sort((a, b) => a.localeCompare("id"));
  }, [adminFeatures]);

  // 2. Ekstrak daftar Kapanewon unik berdasarkan Kabupaten terpilih
  const kapanewonList = useMemo(() => {
    const setKec = new Set();
    for (const feat of adminFeatures) {
      const p = feat.properties || {};
      const kab = p.KABUPATEN || p.kabupaten;
      const kec = p.KECAMATAN || p.kapanewon;
      if (!selectedKabupaten || kab === selectedKabupaten) {
        if (kec && kec !== "-") setKec.add(kec);
      }
    }
    return Array.from(setKec).sort((a, b) => a.localeCompare("id"));
  }, [adminFeatures, selectedKabupaten]);

  // 3. Ekstrak daftar Kalurahan unik berdasarkan Kapanewon & Kabupaten
  const kalurahanList = useMemo(() => {
    const setKal = new Set();
    for (const feat of adminFeatures) {
      const p = feat.properties || {};
      const kab = p.KABUPATEN || p.kabupaten;
      const kec = p.KECAMATAN || p.kapanewon;
      const kal = p.KALURAHAN || p.kalurahan;

      const matchKab = !selectedKabupaten || kab === selectedKabupaten;
      const matchKec = !selectedKapanewon || kec === selectedKapanewon;

      if (matchKab && matchKec && kal && kal !== "-") {
        setKal.add(kal);
      }
    }
    return Array.from(setKal).sort((a, b) => a.localeCompare("id"));
  }, [adminFeatures, selectedKabupaten, selectedKapanewon]);

  // Fitur terpilih saat ini
  const activeFeature = useMemo(() => {
    if (!selectedKalurahan) return null;
    return (
      adminFeatures.find((feat) => {
        const p = feat.properties || {};
        const kal = p.KALURAHAN || p.kalurahan;
        const kec = p.KECAMATAN || p.kapanewon;
        const kab = p.KABUPATEN || p.kabupaten;

        const matchKal = kal === selectedKalurahan;
        const matchKec = !selectedKapanewon || kec === selectedKapanewon;
        const matchKab = !selectedKabupaten || kab === selectedKabupaten;

        return matchKal && matchKec && matchKab;
      }) || null
    );
  }, [adminFeatures, selectedKabupaten, selectedKapanewon, selectedKalurahan]);

  // Handler saat Kabupaten diubah
  const handleKabupatenChange = (e) => {
    const kab = e.target.value;
    setSelectedKabupaten(kab);
    setSelectedKapanewon("");
    setSelectedKalurahan("");

    if (onFilterChange) {
      onFilterChange({ kabupaten: kab, kapanewon: "", kalurahan: "" });
    }
    if (onSelectKalurahan) {
      onSelectKalurahan(null, null);
    }
  };

  // Handler saat Kapanewon diubah
  const handleKapanewonChange = (e) => {
    const kec = e.target.value;
    setSelectedKapanewon(kec);
    setSelectedKalurahan("");

    if (onFilterChange) {
      onFilterChange({ kabupaten: selectedKabupaten, kapanewon: kec, kalurahan: "" });
    }
    if (onSelectKalurahan) {
      onSelectKalurahan(null, null);
    }
  };

  // Handler saat Kalurahan dipilih -> ZOOM PRESISI DENGAN fitBounds
  const handleKalurahanChange = (e) => {
    const kal = e.target.value;
    setSelectedKalurahan(kal);

    const feat =
      adminFeatures.find((f) => {
        const p = f.properties || {};
        const matchKal = (p.KALURAHAN || p.kalurahan) === kal;
        const matchKec = !selectedKapanewon || (p.KECAMATAN || p.kapanewon) === selectedKapanewon;
        const matchKab = !selectedKabupaten || (p.KABUPATEN || p.kabupaten) === selectedKabupaten;
        return matchKal && matchKec && matchKab;
      }) || null;

    if (!feat) {
      if (onSelectKalurahan) onSelectKalurahan(null, null);
      return;
    }

    const bounds = computeLeafletBounds(feat);

    // Zoom kamera Leaflet secara presisi
    if (mapInstance && bounds) {
      try {
        mapInstance.fitBounds(bounds, {
          padding: [30, 30],
          maxZoom: 15,
          animate: true,
          duration: 0.8,
        });
      } catch (err) {
        console.warn("Gagal melakukan map.fitBounds:", err);
      }
    }

    if (onSelectKalurahan) {
      onSelectKalurahan(feat, bounds);
    }

    if (onFilterChange) {
      onFilterChange({
        kabupaten: selectedKabupaten,
        kapanewon: selectedKapanewon,
        kalurahan: kal,
      });
    }
  };

  // Handler Reset Filter
  const handleResetFilter = () => {
    setSelectedKabupaten("");
    setSelectedKapanewon("");
    setSelectedKalurahan("");

    // Reset zoom ke wilayah DIY
    if (mapInstance) {
      try {
        mapInstance.fitBounds(
          [
            [-8.05, 110.15],
            [-7.55, 110.60],
          ],
          { padding: [20, 20], animate: true }
        );
      } catch (err) {
        console.warn("Gagal reset bounds:", err);
      }
    }

    if (onSelectKalurahan) onSelectKalurahan(null, null);
    if (onFilterChange) onFilterChange({ kabupaten: "", kapanewon: "", kalurahan: "" });
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white/95 p-3.5 shadow-sm">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">📍</span>
          <h3 className="text-xs font-bold uppercase tracking-wider text-blue-700">
            Filter Wilayah Administrasi
          </h3>
        </div>
        {(selectedKabupaten || selectedKapanewon || selectedKalurahan) && (
          <button
            type="button"
            onClick={handleResetFilter}
            className="text-[10px] font-bold text-red-600 hover:text-red-800 transition"
          >
            Reset
          </button>
        )}
      </div>

      <div className="space-y-2">
        {/* 1. Dropdown Kabupaten / Kota */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Kabupaten / Kota
          </label>
          <select
            value={selectedKabupaten}
            onChange={handleKabupatenChange}
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 transition"
          >
            <option value="">Semua Kabupaten / Kota</option>
            {kabupatenList.map((kab) => (
              <option key={kab} value={kab}>
                {kab}
              </option>
            ))}
          </select>
        </div>

        {/* 2. Dropdown Kapanewon / Kemantren (Kecamatan) */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Kapanewon / Kemantren
          </label>
          <select
            value={selectedKapanewon}
            onChange={handleKapanewonChange}
            disabled={kapanewonList.length === 0}
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="">
              {selectedKabupaten ? "Pilih Kapanewon / Kemantren" : "Semua Kapanewon"}
            </option>
            {kapanewonList.map((kec) => (
              <option key={kec} value={kec}>
                {kec}
              </option>
            ))}
          </select>
        </div>

        {/* 3. Dropdown Kalurahan / Kelurahan */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Kalurahan / Kelurahan (Desa)
          </label>
          <select
            value={selectedKalurahan}
            onChange={handleKalurahanChange}
            disabled={kalurahanList.length === 0}
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="">
              {selectedKapanewon ? "Pilih Kalurahan / Kelurahan" : "Semua Kalurahan"}
            </option>
            {kalurahanList.map((kal) => (
              <option key={kal} value={kal}>
                {kal}
              </option>
            ))}
          </select>
        </div>

        {/* Info Kalurahan Terpilih */}
        {activeFeature && (
          <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50/70 p-2 text-xs">
            <span className="block text-[10px] font-bold text-blue-700">Wilayah Terpilih:</span>
            <span className="font-extrabold text-slate-900">
              {formatAdminLabel(activeFeature.properties)}
            </span>
            {activeFeature.properties?.luas_ha && (
              <span className="block text-[10px] text-slate-600 mt-0.5">
                Luas Wilayah: {Number(activeFeature.properties.luas_ha).toFixed(1)} ha
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminFilterPanel;
