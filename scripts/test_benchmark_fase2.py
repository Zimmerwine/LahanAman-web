"""
test_benchmark_fase2.py
=======================
MILESTONE FASE 2: Skrip Benchmark & Uji Validasi Otomatis untuk `segment_analyzer.py`.

Menguji:
1. Pembacaan file sampel poligon kavling (`_Poligon_Kavling_Uji.gpkg`) dalam Dual-CRS (EPSG:4326 <-> EPSG:32749).
2. Akurasi luas metrik (`luas_m2`) pasca reproyeksi & intersection tanpa distorsi proyeksi (toleransi deviasi < 0.5%).
3. Pembacaan sudut kemiringan kontinu asli (`beta_mean` dalam derajat °) dari `Raster_Slope_Derajat_SlemanBantul.tif`
   (memastikan bukan nilai midpoint kaku dari skor kelas lereng).
4. Perhitungan beda tinggi elevasi (`tinggi_H = elev_max - elev_min` >= 0 m) dari `Raster_DEMNAS_Elevasi_SlemanBantul.tif`.
5. Kelengkapan struktur 12 atribut wajib GeoJSON keluaran `analyze_user_kavling`.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import geopandas as gpd
import pandas as pd
from shapely.geometry import Polygon, box

SCRIPTS_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPTS_DIR.parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from segment_analyzer import (
    METRIC_CRS,
    RASTER_DEMNAS_PATH,
    RASTER_SLOPE_PATH,
    VEKTOR_TRIASE_PATH,
    WGS84_CRS,
    analyze_user_kavling,
    muat_engine_fase2,
)

ATRIBUT_WAJIB = {
    "segmen_id",
    "zona_triase",
    "warna_hex",
    "luas_m2",
    "persen_luas",
    "beta_mean",
    "elev_min",
    "elev_max",
    "tinggi_H",
    "c_kpa",
    "phi_deg",
    "rasio_m",
}

# Nilai midpoint kaku kelas lereng (0-8° -> 4°, 8-15° -> 11.5°, 15-25° -> 20°, 25-35° -> 30°, >35° -> 40°)
MIDPOINT_KAKU = {4.0, 11.5, 20.0, 30.0, 40.0}


def siapkan_atau_baca_sampel_kavling() -> Path:
    """
    Cari file `_Poligon_Kavling_Uji.gpkg` di repositori.
    Bila belum ada, buat dataset benchmark standar `_Poligon_Kavling_Uji.gpkg` di `Data/processed/`
    yang mencakup 4 skenario kavling nyata di Kab. Sleman & Kab. Bantul (UTM 49S EPSG:32749).
    """
    kandidat = list(PROJECT_ROOT.rglob("*_Poligon_Kavling_Uji.gpkg"))
    if kandidat:
        return kandidat[0]

    out_dir = PROJECT_ROOT / "Data" / "processed"
    out_dir.mkdir(parents=True, exist_ok=True)
    sample_path = out_dir / "_Poligon_Kavling_Uji.gpkg"

    records = [
        {
            "kavling_kode": "KAV-UJI-01",
            "nama_kavling": "Kavling Perbukitan Imogiri-Dlingo (Lintas 3 Zona: Hijau, Kuning, Merah)",
            "kabupaten": "Kab. Bantul",
            "geometry": box(434000.0, 9124000.0, 434300.0, 9124300.0),  # 90.000 m²
        },
        {
            "kavling_kode": "KAV-UJI-02",
            "nama_kavling": "Kavling Dataran Wedomartani Ngemplak (Dominan Zona Hijau Landai)",
            "kabupaten": "Kab. Sleman",
            "geometry": box(435000.0, 9150000.0, 435250.0, 9150200.0),  # 50.000 m²
        },
        {
            "kavling_kode": "KAV-UJI-03",
            "nama_kavling": "Kavling Lereng Merapi Hargobinangun Pakem (Transisi Zona Hijau & Kuning)",
            "kabupaten": "Kab. Sleman",
            "geometry": box(436200.0, 9157500.0, 436550.0, 9157800.0),  # 105.000 m²
        },
        {
            "kavling_kode": "KAV-UJI-04",
            "nama_kavling": "Kavling Tebing Breksi Sambirejo Prambanan (Transisi Zona Kuning & Merah)",
            "kabupaten": "Kab. Sleman",
            "geometry": Polygon([
                (445200.0, 9139200.0),
                (445550.0, 9139200.0),
                (445600.0, 9139500.0),
                (445250.0, 9139550.0),
                (445200.0, 9139200.0),
            ]),
        },
    ]

    gdf_sample = gpd.GeoDataFrame(records, crs=METRIC_CRS)
    gdf_sample["luas_acuan_utm_m2"] = gdf_sample.geometry.area.round(1)
    gdf_sample.to_file(sample_path, driver="GPKG")
    return sample_path


def jalankan_benchmark_fase2() -> int:
    print("=" * 95)
    print("BENCHMARK & UJI VALIDASI OTOMATIS MILESTONE FASE 2 — LAHANAMAN GEOANALYTICS DIY")
    print("=" * 95)

    # 1. Validasi keterbacaan file Raster & Vektor Master
    print(f"[1/4] Mengecek keterbacaan Raster & Vektor Master...")
    cache = muat_engine_fase2()
    print(f"      ✔ Raster Slope  : {RASTER_SLOPE_PATH.name} | CRS={cache['slope_meta']['crs']} | Shape={cache['slope_meta']['shape']}")
    print(f"      ✔ Raster DEMNAS : {RASTER_DEMNAS_PATH.name} | CRS={cache['dem_meta']['crs']} | Shape={cache['dem_meta']['shape']}")
    print(f"      ✔ Vektor Triase : {VEKTOR_TRIASE_PATH.name} | Fitur={len(cache['triase_gdf'])} poligon (EPSG:32749)")

    # 2. Baca sampel poligon kavling
    sample_path = siapkan_atau_baca_sampel_kavling()
    gdf_uji_utm = gpd.read_file(sample_path).to_crs(METRIC_CRS)
    gdf_uji_wgs = gdf_uji_utm.to_crs(WGS84_CRS)
    print(f"\n[2/4] Membaca sampel poligon kavling: {sample_path.name} ({len(gdf_uji_utm)} poligon kavling)")

    semua_baris_tabel = []
    semua_lolos = True

    # 3. Eksekusi `analyze_user_kavling` untuk setiap poligon kavling
    print("\n[3/4] Menjalankan `analyze_user_kavling` (Input WGS84 EPSG:4326 -> Proses UTM 49S EPSG:32749)...")
    for idx in range(len(gdf_uji_utm)):
        row_utm = gdf_uji_utm.iloc[idx]
        row_wgs = gdf_uji_wgs.iloc[idx]

        kode_kav = str(row_utm.get("kavling_kode", f"KAV-{idx + 1:02d}"))
        nama_kav = str(row_utm.get("nama_kavling", f"Poligon Uji {idx + 1}"))
        luas_asli_utm = float(row_utm.geometry.area)

        # Simulasikan pengiriman GeoJSON Feature EPSG:4326 dari frontend Leaflet
        feat_wgs_dict = {
            "type": "Feature",
            "properties": {"kavling_kode": kode_kav, "nama_kavling": nama_kav},
            "geometry": json.loads(gpd.GeoSeries([row_wgs.geometry], crs=WGS84_CRS).to_json())["features"][0]["geometry"],
        }

        hasil_fc = analyze_user_kavling(feat_wgs_dict)
        segmen_features = hasil_fc.get("features", [])
        total_luas_segmen = sum(float(f["properties"]["luas_m2"]) for f in segmen_features)

        # Hitung deviasi luas proyeksi (%)
        deviasi_pct = abs(total_luas_segmen - luas_asli_utm) / luas_asli_utm * 100.0
        status_luas = deviasi_pct < 0.5

        print("-" * 95)
        print(f"► {kode_kav}: {nama_kav}")
        print(
            f"  Luas Acuan UTM (EPSG:32749) : {luas_asli_utm:,.1f} m² | "
            f"Total Luas Segmen : {total_luas_segmen:,.1f} m² | "
            f"Deviasi : {deviasi_pct:.4f}% [{'LOLOS < 0.5%' if status_luas else 'GAGAL'}]"
        )

        if not status_luas:
            semua_lolos = False

        for f in segmen_features:
            p = f["properties"]
            atribut_kurang = ATRIBUT_WAJIB - set(p.keys())
            if atribut_kurang:
                print(f"  [ERROR] Atribut wajib hilang pada {p.get('segmen_id')}: {atribut_kurang}")
                semua_lolos = False

            beta_val = float(p["beta_mean"])
            h_val = float(p["tinggi_H"])
            e_min = float(p["elev_min"])
            e_max = float(p["elev_max"])

            # Validasi tinggi_H >= 0 dan konsistensi elev_max - elev_min
            status_h = (h_val >= 0.0) and (abs(h_val - (e_max - e_min)) <= 0.05)
            # Validasi beta_mean kontinu dari raster
            status_beta = (0.0 <= beta_val <= 90.0)

            if not (status_h and status_beta):
                semua_lolos = False

            semua_baris_tabel.append({
                "Kavling": kode_kav,
                "Segmen": p["segmen_id"],
                "Zona Triase": p.get("zona_singkat", p["zona_triase"][:15]),
                "Warna": p["warna_hex"],
                "Luas (m²)": p["luas_m2"],
                "Porsi (%)": p["persen_luas"],
                "beta_mean (°)": p["beta_mean"],
                "Elev Min (m)": p["elev_min"],
                "Elev Max (m)": p["elev_max"],
                "Tinggi H (m)": p["tinggi_H"],
                "c' (kPa)": p["c_kpa"],
                "phi' (°)": p["phi_deg"],
                "m": p["rasio_m"],
            })

    # 4. Cetak Tabel Perbandingan Atribut Hasil Segmentasi
    df_hasil = pd.DataFrame(semua_baris_tabel)
    print("\n" + "=" * 95)
    print("[4/4] TABEL MATRIKS ATRIBUT HASIL SEGMENTASI KAVLING & ZONAL STATISTICS RASTER")
    print("=" * 95)
    print(df_hasil.to_string(index=False))
    print("=" * 95)

    # Cek apakah seluruh beta_mean bukan angka midpoint kaku
    semua_beta = set(df_hasil["beta_mean (°)"].tolist())
    bukan_midpoint_kaku = not semua_beta.issubset(MIDPOINT_KAKU)
    semua_h_positif = bool((df_hasil["Tinggi H (m)"] >= 0.0).all())

    print("\nRINGKASAN VERIFIKASI KRITERIA FASE 2:")
    print(f"  1. Konservasi Luas Proyeksi EPSG:32749 (Error < 0.5%) : {'✔ LOLOS' if semua_lolos else '✖ GAGAL'}")
    print(f"  2. Sudut Lereng Kontinu Nyata Raster (beta_mean °)    : {'✔ LOLOS' if bukan_midpoint_kaku else '✖ GAGAL'}")
    print(f"  3. Beda Tinggi Elevasi DEMNAS Positif (tinggi_H >= 0) : {'✔ LOLOS' if semua_h_positif else '✖ GAGAL'}")
    print("=" * 95)

    return 0 if (semua_lolos and bukan_midpoint_kaku and semua_h_positif) else 1


if __name__ == "__main__":
    sys.exit(jalankan_benchmark_fase2())
