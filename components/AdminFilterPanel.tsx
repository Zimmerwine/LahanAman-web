"use client";

/**
 * components/AdminFilterPanel.tsx
 * ============================================================================
 * MODUL 3 & 4: FILTER WILAYAH PRESISI (HIERARCHICAL ADMIN CASCADING FILTER)
 * Pengganti Pencarian Dusun & Dependensi Toponimi Dusun
 *
 * Fitur Utama:
 * - Cascading Dropdown 3 Tingkat:
 *   1. Kabupaten / Kota
 *   2. Kapanewon / Kemantren (Kecamatan)
 *   3. Kalurahan / Kelurahan (Desa)
 * - Sumber data murni dari properti fitur `clean_batas_administrasi.geojson`.
 * - Saat Kalurahan dipilih, menghitung bounding box via `@turf/bbox` (`turf.bbox(feature)`)
 *   dan memanggil `map.fitBounds(...)` untuk zoom presisi ke batas desa/kalurahan.
 * - Menampilkan label wilayah standar: "Kal. [Nama], Kapanewon [Nama], [Kabupaten]".
 * ============================================================================
 */

import React, { useMemo, useState } from "react";
import bbox from "@turf/bbox";

export interface AdminFeatureProperties {
  kabupaten: string;
  kapanewon: string;
  kalurahan: string;
  luas_ha?: number;
  easting_x?: number;
  northing_y?: number;
  lereng_derajat?: number;
  lereng_persen?: number;
  jenis_tanah?: string;
  formasi_batuan?: string;
  ch_idw_mm?: number;
  curah_hujan_mm?: number;
  tutupan_dominan?: string;
  zona_kerawanan?: string;
  skor_total?: number;
  [key: string]: unknown;
}

export interface AdminGeoJSONFeature {
  type: "Feature";
  properties: AdminFeatureProperties;
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: unknown[];
  };
}

export interface LeafletMapInstance {
  fitBounds: (
    bounds: [[number, number], [number, number]],
    options?: { padding?: [number, number]; maxZoom?: number; animate?: boolean; duration?: number }
  ) => void;
}

export interface AdminFilterPanelProps {
  /** Daftar fitur dari clean_batas_administrasi.geojson */
  adminFeatures: AdminGeoJSONFeature[];
  /** Instance peta Leaflet / MapLibre yang mendukung fitBounds */
  mapInstance?: LeafletMapInstance | null;
  /** Callback saat Kalurahan dipilih atau di-reset */
  onSelectKalurahan?: (
    feature: AdminGeoJSONFeature | null,
    boundsWgs84: [[number, number], [number, number]] | null
  ) => void;
  /** Callback opsional saat filter Kabupaten atau Zona diubah */
  onFilterChange?: (filter: {
    kabupaten: string;
    kapanewon: string;
    kalurahan: string;
    zona: string;
  }) => void;
}

/**
 * Format label hierarki administrasi tanpa embel-embel dusun:
 * "Kal. [Nama], Kapanewon [Nama], Kab. [Nama]"
 */
export function formatAdminLabel(props?: Partial<AdminFeatureProperties> | null): string {
  if (!props) return "-";
  const kal = props.kalurahan || "-";
  const kec = props.kapanewon || "-";
  const kabRaw = props.kabupaten || "Kab. Sleman";
  const isKota = kabRaw.toLowerCase().includes("kota");
  const prefixDesa = isKota ? "Kel." : "Kal.";
  const prefixKec = isKota ? "Kemantren" : "Kapanewon";
  const kabLabel =
    kabRaw.startsWith("Kab.") || kabRaw.startsWith("Kota") ? kabRaw : `Kab. ${kabRaw}`;
  return `${prefixDesa} ${kal}, ${prefixKec} ${kec}, ${kabLabel}`;
}

export const AdminFilterPanel: React.FC<AdminFilterPanelProps> = ({
  adminFeatures,
  mapInstance,
  onSelectKalurahan,
  onFilterChange,
}) => {
  const [selectedKabupaten, setSelectedKabupaten] = useState<string>("");
  const [selectedKapanewon, setSelectedKapanewon] = useState<string>("");
  const [selectedKalurahan, setSelectedKalurahan] = useState<string>("");
  const [selectedZona, setSelectedZona] = useState<string>("ALL");

  // 1. Ekstrak daftar unik Kabupaten/Kota
  const kabupatenList = useMemo(() => {
    const setKab = new Set<string>();
    for (const f of adminFeatures) {
      const kab = f.properties?.kabupaten?.trim();
      if (kab) setKab.add(kab);
    }
    return Array.from(setKab).sort((a, b) => a.localeCompare(b, "id"));
  }, [adminFeatures]);

  // 2. Ekstrak daftar Kapanewon/Kecamatan berdasarkan Kabupaten terpilih
  const kapanewonList = useMemo(() => {
    if (!selectedKabupaten) return [];
    const setKec = new Set<string>();
    for (const f of adminFeatures) {
      if (f.properties?.kabupaten === selectedKabupaten && f.properties?.kapanewon) {
        setKec.add(f.properties.kapanewon.trim());
      }
    }
    return Array.from(setKec).sort((a, b) => a.localeCompare(b, "id"));
  }, [adminFeatures, selectedKabupaten]);

  // 3. Ekstrak daftar Kalurahan/Kelurahan berdasarkan Kabupaten + Kapanewon (+ filter Zona jika aktif)
  const kalurahanFeatures = useMemo(() => {
    if (!selectedKabupaten || !selectedKapanewon) return [];
    return adminFeatures
      .filter((f) => {
        const p = f.properties;
        if (!p) return false;
        if (p.kabupaten !== selectedKabupaten || p.kapanewon !== selectedKapanewon) {
          return false;
        }
        if (selectedZona !== "ALL" && p.zona_kerawanan && p.zona_kerawanan !== selectedZona) {
          return false;
        }
        return true;
      })
      .sort((a, b) =>
        (a.properties.kalurahan || "").localeCompare(b.properties.kalurahan || "", "id")
      );
  }, [adminFeatures, selectedKabupaten, selectedKapanewon, selectedZona]);

  // Fitur kalurahan yang sedang aktif terpilih
  const activeFeature = useMemo(() => {
    if (!selectedKabupaten || !selectedKapanewon || !selectedKalurahan) return null;
    return (
      adminFeatures.find(
        (f) =>
          f.properties?.kabupaten === selectedKabupaten &&
          f.properties?.kapanewon === selectedKapanewon &&
          f.properties?.kalurahan === selectedKalurahan
      ) || null
    );
  }, [adminFeatures, selectedKabupaten, selectedKapanewon, selectedKalurahan]);

  // Handler perubahan Kabupaten
  const handleKabupatenChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const kab = e.target.value;
    setSelectedKabupaten(kab);
    setSelectedKapanewon("");
    setSelectedKalurahan("");
    onFilterChange?.({
      kabupaten: kab || "ALL",
      kapanewon: "",
      kalurahan: "",
      zona: selectedZona,
    });
    onSelectKalurahan?.(null, null);
  };

  // Handler perubahan Kapanewon
  const handleKapanewonChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const kec = e.target.value;
    setSelectedKapanewon(kec);
    setSelectedKalurahan("");
    onFilterChange?.({
      kabupaten: selectedKabupaten || "ALL",
      kapanewon: kec,
      kalurahan: "",
      zona: selectedZona,
    });
    onSelectKalurahan?.(null, null);
  };

  // Handler perubahan Kalurahan -> hitung turf.bbox(feature) & jalankan map.fitBounds(...)
  const handleKalurahanChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const kal = e.target.value;
    setSelectedKalurahan(kal);

    onFilterChange?.({
      kabupaten: selectedKabupaten || "ALL",
      kapanewon: selectedKapanewon,
      kalurahan: kal,
      zona: selectedZona,
    });

    if (!kal) {
      onSelectKalurahan?.(null, null);
      return;
    }

    const targetFeature = adminFeatures.find(
      (f) =>
        f.properties?.kabupaten === selectedKabupaten &&
        f.properties?.kapanewon === selectedKapanewon &&
        f.properties?.kalurahan === kal
    );

    if (!targetFeature || !targetFeature.geometry) return;

    // Hitung bounding box [minX, minY, maxX, maxY] menggunakan @turf/bbox
    const [minX, minY, maxX, maxY] = bbox(targetFeature as Parameters<typeof bbox>[0]);
    const leafletBounds: [[number, number], [number, number]] = [
      [minY, minX], // South-West [lat, lng]
      [maxY, maxX], // North-East [lat, lng]
    ];

    if (mapInstance && typeof mapInstance.fitBounds === "function") {
      mapInstance.fitBounds(leafletBounds, {
        padding: [36, 36],
        maxZoom: 15,
        animate: true,
        duration: 0.75,
      });
    }

    onSelectKalurahan?.(targetFeature, leafletBounds);
  };

  // Handler perubahan Filter Kelas Zona GPKG
  const handleZonaChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const zona = e.target.value;
    setSelectedZona(zona);
    onFilterChange?.({
      kabupaten: selectedKabupaten || "ALL",
      kapanewon: selectedKapanewon,
      kalurahan: selectedKalurahan,
      zona,
    });
  };

  // Reset seluruh filter administrasi
  const handleResetFilter = () => {
    setSelectedKabupaten("");
    setSelectedKapanewon("");
    setSelectedKalurahan("");
    setSelectedZona("ALL");
    onFilterChange?.({
      kabupaten: "ALL",
      kapanewon: "",
      kalurahan: "",
      zona: "ALL",
    });
    onSelectKalurahan?.(null, null);
  };

  return (
    <div className="bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl p-3.5 shadow-sm">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-blue-700 text-sm">🧭</span>
          <h3 className="text-xs font-bold uppercase tracking-wider text-blue-700">
            Filter Wilayah Administrasi
          </h3>
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
          {adminFeatures.length} Kalurahan
        </span>
      </div>

      <div className="space-y-2.5">
        {/* TINGKAT 1: KABUPATEN / KOTA */}
        <div>
          <label
            htmlFor="admin-filter-kabupaten"
            className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1"
          >
            1. Kabupaten / Kota
          </label>
          <select
            id="admin-filter-kabupaten"
            value={selectedKabupaten}
            onChange={handleKabupatenChange}
            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="">— Pilih Kabupaten / Kota —</option>
            {kabupatenList.map((kab) => (
              <option key={kab} value={kab}>
                {kab}
              </option>
            ))}
          </select>
        </div>

        {/* TINGKAT 2: KAPANEWON / KECAMATAN */}
        <div>
          <label
            htmlFor="admin-filter-kapanewon"
            className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1"
          >
            2. Kapanewon / Kecamatan
          </label>
          <select
            id="admin-filter-kapanewon"
            value={selectedKapanewon}
            onChange={handleKapanewonChange}
            disabled={!selectedKabupaten}
            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 disabled:bg-slate-100 disabled:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="">
              {selectedKabupaten ? "— Pilih Kapanewon / Kecamatan —" : "Pilih Kabupaten terlebih dahulu"}
            </option>
            {kapanewonList.map((kec) => (
              <option key={kec} value={kec}>
                {kec}
              </option>
            ))}
          </select>
        </div>

        {/* TINGKAT 3: KALURAHAN / KELURAHAN */}
        <div>
          <label
            htmlFor="admin-filter-kalurahan"
            className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1"
          >
            3. Kalurahan / Kelurahan
          </label>
          <select
            id="admin-filter-kalurahan"
            value={selectedKalurahan}
            onChange={handleKalurahanChange}
            disabled={!selectedKapanewon}
            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 disabled:bg-slate-100 disabled:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="">
              {selectedKapanewon ? "— Pilih Kalurahan / Kelurahan —" : "Pilih Kapanewon terlebih dahulu"}
            </option>
            {kalurahanFeatures.map((f) => {
              const kalName = f.properties.kalurahan;
              return (
                <option key={`${selectedKapanewon}-${kalName}`} value={kalName}>
                  {kalName}
                </option>
              );
            })}
          </select>
        </div>

        {/* FILTER OPSIONAL KELAS SKORING ZONA GPKG */}
        <div>
          <label
            htmlFor="admin-filter-zona"
            className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1"
          >
            Filter Kelas Zona GPKG
          </label>
          <select
            id="admin-filter-zona"
            value={selectedZona}
            onChange={handleZonaChange}
            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="ALL">Semua Kelas Zona (Hijau / Kuning / Merah)</option>
            <option value="Zona Hijau">Zona Hijau (Skor &lt; 2,20 — Risiko Rendah)</option>
            <option value="Zona Kuning">Zona Kuning (Skor 2,20–3,40 — Risiko Sedang)</option>
            <option value="Zona Merah">Zona Merah (Skor &gt; 3,40 — Risiko Tinggi)</option>
          </select>
        </div>
      </div>

      {/* RINGKASAN KALURAHAN TERPILIH */}
      {activeFeature && (
        <div className="mt-3 rounded-lg bg-blue-50/90 border border-blue-200 p-2.5 text-xs text-slate-800">
          <div className="font-bold text-blue-950 leading-snug">
            {formatAdminLabel(activeFeature.properties)}
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-slate-600">
            <span>
              Luas:{" "}
              <b>
                {Number(activeFeature.properties.luas_ha || 0).toLocaleString("id-ID", {
                  maximumFractionDigits: 1,
                })}{" "}
                Ha
              </b>
            </span>
            <span>
              Lereng:{" "}
              <b>
                {Number(activeFeature.properties.lereng_derajat || 0).toLocaleString("id-ID", {
                  maximumFractionDigits: 1,
                })}
                °
              </b>
            </span>
          </div>
        </div>
      )}

      {(selectedKabupaten || selectedZona !== "ALL") && (
        <button
          type="button"
          onClick={handleResetFilter}
          className="mt-2.5 w-full rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 py-1.5 text-[11px] font-semibold text-slate-700 transition"
        >
          Reset Pilihan Wilayah
        </button>
      )}
    </div>
  );
};

export default AdminFilterPanel;
