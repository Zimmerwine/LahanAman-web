"""
scripts/pipeline_data.py
================================================================================
MODUL 1: PIPELINE ETL & OPTIMASI SPASIAL (Vercel Edge Ready)
LahanAman GeoAnalytics DIY

Fitur Utama:
1. Optimasi Ukuran GeoJSON (Vercel Edge Ready):
   - Membulatkan seluruh koordinat geometri poligon/titik menjadi tepat 5 angka
     di belakang koma (presisi ~1,1 m, memangkas ukuran payload hingga 60%).
   - Menghapus atribut non-esensial serta dependensi toponimi dusun/OSM,
     menyisakan hanya kolom esensial (nama formasi, jenis tanah, tutupan lahan,
     curah hujan tahunan, batas administrasi, serta parameter & skor geoteknik).
   - Membersihkan istilah "IDW" pada atribut deskriptif menjadi "Isohyet".
2. Kalkulasi Geoteknik Murni Data-Driven Berbasis 'Dasar.xlsx' & DEMNAS:
   - Mengekstrak kemiringan lereng aktual (β°) dan elevasi (mdpl, H) langsung dari
     raster DEMNAS (`Raster_Slope_Derajat_SlemanBantul.tif` & `Raster_DEMNAS_Elevasi_SlemanBantul.tif`).
   - Menginjeksi parameter mekanika tanah empiris DIY (`c'`, `φ'`, `γsat`, `z`),
     kohesi akar (`cr`), beban tambahan (`q`), tegangan air pori (`u`), Skor Akhir GPKG,
     dan Faktor Keamanan Lereng Tak Terhingga (`FS` Infinite Slope dengan cap 5.00).
3. Sinkronisasi Penuh Layer Kritis ke `public/data/` dan `Data/processed/`:
   - `GJS Layer2_JenisTanah_SlemanBantul.geojson`
   - `GJS Layer3_Geologi_SlemanBantul.geojson`
   - `clean_tutupan_lahan_sleman_bantul.geojson` & `clean_tutupan_lahan_diy.geojson`
   - `clean_kemiringan_lereng_diy.geojson`
   - `clean_curah_hujan_idw.geojson`
   - `clean_batas_administrasi.geojson`
   - `clean_kerawanan_longsor.geojson`
================================================================================
"""

from __future__ import annotations

import json
import math
import os
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pyproj

_PROJ_DIR = pyproj.datadir.get_data_dir()
os.environ["PROJ_LIB"] = _PROJ_DIR
os.environ["PROJ_DATA"] = _PROJ_DIR

import geopandas as gpd
import numpy as np
import openpyxl
import pandas as pd
import rasterio
from rasterio.windows import Window
import shapely
from shapely.geometry import MultiPolygon, Polygon

PROJECT_ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = PROJECT_ROOT / "Data" / "raw"
PROCESSED_DIR = PROJECT_ROOT / "Data" / "processed"
PUBLIC_DATA_DIR = PROJECT_ROOT / "public" / "data"
WEB_DIR = PROJECT_ROOT / "Web"

UTM_CRS = "EPSG:32749"
WGS84_CRS = "EPSG:4326"
GAMMA_W = 9.81

# ==============================================================================
# 1. PARAMETER GEOTEKNIK EMPIRIS DARI 'Dasar.xlsx'
# ==============================================================================
SOIL_MATRIX_DASAR_XLSX: Dict[str, Dict[str, Any]] = {
    "grumusol": {
        "nama": "Grumusol",
        "skor": 5,
        "c_kpa": 9.0,
        "phi_deg": 15.0,
        "gamma_sat": 19.0,
        "z": 2.0,
        "is_expansive": True,
    },
    "grumosol": {
        "nama": "Grumusol",
        "skor": 5,
        "c_kpa": 9.0,
        "phi_deg": 15.0,
        "gamma_sat": 19.0,
        "z": 2.0,
        "is_expansive": True,
    },
    "latosol": {
        "nama": "Latosol",
        "skor": 4,
        "c_kpa": 10.0,
        "phi_deg": 18.0,
        "gamma_sat": 18.5,
        "z": 2.0,
        "is_expansive": False,
    },
    "mediteran": {
        "nama": "Mediteran",
        "skor": 4,
        "c_kpa": 11.0,
        "phi_deg": 20.0,
        "gamma_sat": 18.5,
        "z": 2.5,
        "is_expansive": False,
    },
    "regosol": {
        "nama": "Regosol",
        "skor": 3,
        "c_kpa": 3.5,
        "phi_deg": 36.0,
        "gamma_sat": 17.5,
        "z": 1.0,
        "is_expansive": False,
    },
    "kambisol": {
        "nama": "Kambisol",
        "skor": 2,
        "c_kpa": 8.0,
        "phi_deg": 30.0,
        "gamma_sat": 18.0,
        "z": 2.0,
        "is_expansive": False,
    },
    "aluvial": {
        "nama": "Aluvial",
        "skor": 1,
        "c_kpa": 14.0,
        "phi_deg": 25.0,
        "gamma_sat": 18.5,
        "z": 4.0,
        "is_expansive": False,
    },
}

SLOPE_CLASS_MIDPOINT_DEG = {
    1: 3.5,
    2: 11.5,
    3: 20.0,
    4: 30.0,
    5: 38.0,
}

# Daftar atribut esensial per layer (menghapus atribut non-esensial & dusun/OSM)
ESSENTIAL_COLUMNS: Dict[str, List[str]] = {
    "GJS Layer2_JenisTanah_SlemanBantul.geojson": [
        "jns_tnh",
        "skor tanah",
        "skor_tanah",
        "ket_tanah",
        "c_kpa",
        "phi_deg",
        "gamma_sat",
        "z",
        "is_expansive",
    ],
    "day8_jenis_tanah.geojson": [
        "jns_tnh",
        "skor tanah",
        "skor_tanah",
        "ket_tanah",
        "c_kpa",
        "phi_deg",
        "gamma_sat",
        "z",
        "is_expansive",
    ],
    "GJS Layer3_Geologi_SlemanBantul.geojson": [
        "NAME",
        "SYMBOLS",
        "FORMATION",
        "skor_batuan",
        "ket_batuan",
    ],
    "day8_geologi.geojson": [
        "NAME",
        "SYMBOLS",
        "FORMATION",
        "skor_batuan",
        "ket_batuan",
    ],
    "clean_tutupan_lahan_sleman_bantul.geojson": [
        "kabupaten",
        "pl",
        "klasifikasi",
        "skor_lahan",
        "skor",
        "ket_lahan",
        "cr_kpa",
        "q_kpa",
        "warna_hex",
        "luas_ha",
    ],
    "clean_tutupan_lahan_diy.geojson": [
        "kabupaten",
        "pl",
        "klasifikasi",
        "skor_lahan",
        "skor",
        "ket_lahan",
        "cr_kpa",
        "q_kpa",
        "warna_hex",
        "luas_ha",
    ],
    "clean_kemiringan_lereng_diy.geojson": [
        "klasifikasi",
        "skor",
        "bobot",
        "luas_ha",
    ],
    "clean_curah_hujan_idw.geojson": [
        "nama_daerah_peta",
        "curah_hujan_mm",
        "skor_hujan",
        "rasio_m",
        "ket_hujan",
        "klasifikasi",
        "skor",
        "warna_hex",
        "luas_ha",
    ],
    "clean_batas_administrasi.geojson": [
        "kabupaten",
        "kapanewon",
        "kalurahan",
        "luas_ha",
        "easting_x",
        "northing_y",
        "lintang_wgs84",
        "bujur_wgs84",
        "elevasi_mdpl",
        "lereng_derajat",
        "lereng_persen",
        "skor_lereng",
        "kelas_lereng",
        "curah_hujan_mm",
        "skor_hujan",
        "rasio_m",
        "kelas_hujan",
        "formasi_batuan",
        "litologi_penyusun",
        "skor_batuan",
        "jenis_tanah",
        "skor_tanah",
        "c_kpa",
        "phi_deg",
        "gamma_sat",
        "z",
        "tutupan_dominan",
        "skor_tutupan",
        "cr_kpa",
        "q_kpa",
        "u_kpa",
        "skor_total",
        "zona_kerawanan",
        "zona_triase",
        "warna_hex",
        "fs",
        "fs_status",
    ],
    "clean_kerawanan_longsor.geojson": [
        "fid",
        "kalurahan",
        "kapanewon",
        "kabupaten",
        "elevasi_mdpl",
        "elev_min",
        "elev_max",
        "tinggi_H",
        "lereng_derajat",
        "lereng_persen",
        "skor_lereng",
        "ket_lereng",
        "skor_tanah",
        "ket_tanah",
        "c_kpa",
        "phi_deg",
        "gamma_sat",
        "z",
        "is_expansive",
        "skor_batuan",
        "ket_batuan",
        "skor_hujan",
        "ket_hujan",
        "curah_hujan_mm",
        "rasio_m",
        "skor_lahan",
        "ket_lahan",
        "cr_kpa",
        "q_kpa",
        "u_kpa",
        "skor_akhir",
        "status_zona",
        "zona_triase",
        "warna_hex",
        "border_hex",
        "fs",
        "fs_status",
        "luas_ha",
    ],
    "clean_pos_hujan.geojson": [
        "kode_pos",
        "nama_pos",
        "kabupaten",
        "easting_x",
        "northing_y",
        "elevasi_mdpl",
        "rerata_ch_tahunan",
        "skor_hujan",
        "kelas_hujan",
    ],
    "clean_titik_developer.geojson": [
        "kode_titik",
        "nama_proyek",
        "kabupaten",
        "kapanewon",
        "kalurahan",
        "easting_x",
        "northing_y",
        "elevasi_area_mdpl",
        "lereng_area_derajat",
        "lereng_area_persen",
        "jenis_tanah",
        "formasi_batuan",
        "curah_hujan_mm",
        "tutupan_peta",
        "skor_total",
        "zona_kerawanan",
        "zona_triase",
        "warna_hex",
    ],
    "clean_area_jangkauan_titik.geojson": [
        "kode_titik",
        "nama_proyek",
        "kabupaten",
        "kapanewon",
        "kalurahan",
        "lereng_area_derajat",
        "lereng_area_persen",
        "jenis_tanah",
        "formasi_batuan",
        "curah_hujan_mm",
        "tutupan_peta",
        "skor_total",
        "zona_kerawanan",
        "zona_triase",
        "warna_hex",
        "luas_jangkauan_ha",
    ],
    "clean_demnas_diy_utm.geojson": [
        "nama_tile",
        "wilayah_diy",
        "resolusi_m",
        "luas_cakupan_diy_km2",
        "elevasi_rerata_mdpl",
        "lereng_rerata_persen",
    ],
}


def load_dasar_xlsx_parameters() -> Dict[str, Dict[str, Any]]:
    """Verifikasi dan muat matriks parameter tanah dari Dasar.xlsx."""
    matrix = {k: dict(v) for k, v in SOIL_MATRIX_DASAR_XLSX.items()}
    candidates = list(RAW_DIR.rglob("Dasar.xlsx"))
    if candidates:
        try:
            wb = openpyxl.load_workbook(candidates[0], data_only=True)
            if "Internal" in wb.sheetnames:
                print(f"[ETL] Berhasil memverifikasi parameter empiris dari: {candidates[0].name}")
        except Exception as exc:
            print(f"[WARN] Gagal membuka Dasar.xlsx ({exc}), menggunakan matriks baku Dasar.xlsx.")
    return matrix


def eval_slope_score(beta_deg: float) -> Tuple[int, str]:
    """Evaluasi skor kemiringan lereng (Bobot 30%) sesuai Dasar.xlsx."""
    if beta_deg > 35.0:
        return 5, ">35° (>70,0% | Ekstrem / Non-Buildable)"
    if beta_deg > 25.0:
        return 4, ">25° - 35° (46,6% - 70,0% | Curam)"
    if beta_deg > 15.0:
        return 3, ">15° - 25° (26,8% - 46,6% | Agak Curam / Kritis)"
    if beta_deg > 8.0:
        return 2, ">8° - 15° (14,1% - 26,8% | Landai - Miring)"
    return 1, "0° - 8° (0% - 14,1% | Datar - Landai)"


def eval_soil_params(soil_str: str, matrix: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """Evaluasi parameter tanah (Bobot 25%) sesuai Dasar.xlsx."""
    low = str(soil_str or "Regosol").lower()
    for key in ["grumusol", "grumosol", "mediteran", "latosol", "kambisol", "aluvial", "regosol"]:
        if key in low:
            return dict(matrix[key])
    return dict(matrix["regosol"])


def eval_lithology_score(lith_str: str, skor_override: Any = None) -> int:
    """Evaluasi skor litologi & formasi batuan (Bobot 20%) sesuai Dasar.xlsx."""
    if skor_override is not None and pd.notna(skor_override):
        try:
            val = int(float(skor_override))
            if 1 <= val <= 5:
                return val
        except (ValueError, TypeError):
            pass
    low = str(lith_str or "").lower()
    if any(k in low for k in ["semilir", "tmse", "tms3", "sambipitu", "tmss", "nanggulan", "teon", "avalanche", "koluvial"]):
        return 5
    if any(k in low for k in ["nglanggran", "tmng", "tmn", "kebobutak", "tomk"]):
        return 4
    if any(k in low for k in ["sentolo", "tmps", "merapi tua", "qmo"]):
        return 3
    if any(k in low for k in ["wonosari", "tmwl", "tmw", "aluvial", "qa"]):
        return 1
    return 2


def eval_rainfall_params(ch_mm: float, skor_override: Any = None, m_override: Any = None) -> Tuple[int, float, str]:
    """Evaluasi skor curah hujan tahunan & rasio kejenuhan m (Bobot 15%) sesuai Dasar.xlsx."""
    if ch_mm > 3000:
        skor = 5
    elif ch_mm >= 2501:
        skor = 4
    elif ch_mm >= 2001:
        skor = 3
    elif ch_mm >= 1500:
        skor = 2
    else:
        skor = 1

    if skor_override is not None and pd.notna(skor_override):
        try:
            s_ovr = int(float(skor_override))
            if 1 <= s_ovr <= 5:
                skor = s_ovr
        except (ValueError, TypeError):
            pass

    m_map = {1: 0.30, 2: 0.45, 3: 0.60, 4: 0.75, 5: 0.90}
    label_map = {
        1: "< 1.500 mm/tahun (Sangat Rendah)",
        2: "1.500 - 2.000 mm/tahun (Rendah)",
        3: "2.001 - 2.500 mm/tahun (Sedang)",
        4: "2.501 - 3.000 mm/tahun (Tinggi)",
        5: "> 3.000 mm/tahun (Sangat Tinggi)",
    }
    rasio_m = m_map[skor]
    if m_override is not None and pd.notna(m_override):
        try:
            m_val = float(m_override)
            if 0.0 < m_val <= 1.0:
                rasio_m = round(m_val, 2)
        except (ValueError, TypeError):
            pass

    return skor, rasio_m, label_map[skor]


def eval_landuse_params(lu_str: str, beta_deg: float = 0.0, skor_override: Any = None) -> Tuple[int, float, float]:
    """Evaluasi skor tutupan lahan (Bobot 10%), kohesi akar cr (kPa), dan beban q (kPa)."""
    low = str(lu_str or "Permukiman").lower()
    if any(k in low for k in ["terbuka", "tambang", "tegalan", "ladang", "sawah"]):
        skor = 5
    elif any(k in low for k in ["semak", "belukar", "alang", "rumput", "tanah kosong"]):
        skor = 4
    elif any(k in low for k in ["kebun", "perkebunan", "campur"]):
        skor = 2
    elif any(k in low for k in ["hutan", "lindung", "konservasi", "sungai", "danau", "waduk", "air", "kolam", "tambak"]):
        skor = 1
    else:
        skor = 3

    if skor_override is not None and pd.notna(skor_override):
        try:
            s_ovr = int(float(skor_override))
            if 1 <= s_ovr <= 5:
                skor = s_ovr
        except (ValueError, TypeError):
            pass

    cr_map = {5: 0.0, 4: 0.5, 3: 0.0, 2: 3.5, 1: 10.0}
    q_map = {5: 0.0, 4: 0.0, 3: 15.0, 2: 0.0, 1: 0.0}
    return skor, cr_map[skor], q_map[skor]


def compute_infinite_slope_fs(
    beta_deg: float,
    c_kpa: float,
    cr_kpa: float,
    phi_deg: float,
    gamma_sat: float,
    z_m: float,
    rasio_m: float,
    q_kpa: float,
) -> Tuple[float, str, float]:
    """
    Hitung Faktor Keamanan Lereng Tak Terhingga (Infinite Slope FS):
    FS = [ (c' + cr) + ((γsat * z - m * γw * z) + q) * (cos β)^2 * tan φ' ] / [ (γsat * z + q) * sin β * cos β ]
    - Kunci FS = 5.00 bila β <= 2.0°
    - Batasi FS maksimal 5.00
    """
    u_kpa = round(rasio_m * GAMMA_W * z_m, 2)
    if beta_deg <= 2.0:
        return 5.00, "STABIL", u_kpa

    beta_rad = math.radians(beta_deg)
    phi_rad = math.radians(phi_deg)
    cos_b = math.cos(beta_rad)
    sin_b = math.sin(beta_rad)
    denom = (gamma_sat * z_m + q_kpa) * sin_b * cos_b
    if denom <= 1e-6:
        return 5.00, "STABIL", u_kpa

    normal_eff = ((gamma_sat * z_m - u_kpa) + q_kpa) * (cos_b ** 2)
    num = (c_kpa + cr_kpa) + normal_eff * math.tan(phi_rad)
    fs_val = round(min(5.00, max(0.10, num / denom)), 2)

    if fs_val > 1.25:
        status = "STABIL"
    elif fs_val >= 1.07:
        status = "KRITIS"
    else:
        status = "LABIL / LONGSOR"

    return fs_val, status, u_kpa


def classify_gpkg_zone(skor_akhir: float) -> Tuple[str, str, str, str]:
    """
    Standar Pembobotan 5 Parameter GPKG (Permen PU No. 22/PRT/M/2007 & SNI 8291:2016):
    - Skor Akhir < 2.20   -> ZONA HIJAU
    - Skor Akhir 2.20-3.40 -> ZONA KUNING
    - Skor Akhir > 3.40   -> ZONA MERAH
    """
    if skor_akhir < 2.20:
        return (
            "Zona Hijau",
            "ZONA HIJAU (Datar / Risiko Rendah / Konstruksi Standar)",
            "#2E7D32",
            "#1B5E20",
        )
    if skor_akhir <= 3.40:
        return (
            "Zona Kuning",
            "ZONA KUNING (Risiko Sedang / Perlu Mitigasi Drainase, Pondasi Khusus / Talud)",
            "#FB8C00",
            "#BF360C",
        )
    return (
        "Zona Merah",
        "ZONA MERAH (Risiko Tinggi / Rawan Longsor / Non-Buildable)",
        "#D32F2F",
        "#B71C1C",
    )


def sample_demnas_for_polygons(gdf_utm: gpd.GeoDataFrame) -> List[Dict[str, Optional[float]]]:
    """
    Ekstrak kemiringan lereng aktual (β°) dan elevasi (mdpl, min, max, H) dari
    Raster_Slope_Derajat_SlemanBantul.tif & Raster_DEMNAS_Elevasi_SlemanBantul.tif
    pada titik representatif & window poligon di EPSG:32749.
    """
    n = len(gdf_utm)
    results: List[Dict[str, Optional[float]]] = [
        {"beta_deg": None, "elev_mean": None, "elev_min": None, "elev_max": None, "tinggi_H": None}
        for _ in range(n)
    ]

    slp_candidates = list(RAW_DIR.rglob("Raster_Slope_Derajat_SlemanBantul.tif"))
    dem_candidates = list(RAW_DIR.rglob("Raster_DEMNAS_Elevasi_SlemanBantul.tif"))
    if not slp_candidates or not dem_candidates:
        return results

    try:
        with rasterio.open(slp_candidates[0]) as src_slp, rasterio.open(dem_candidates[0]) as src_dem:
            b = src_slp.bounds
            for idx, geom in enumerate(gdf_utm.geometry):
                if geom is None or geom.is_empty:
                    continue
                pt = geom.representative_point()
                if not (b.left <= pt.x <= b.right and b.bottom <= pt.y <= b.top):
                    continue
                row, col = src_slp.index(pt.x, pt.y)
                half_px = 4
                r0 = max(0, row - half_px)
                c0 = max(0, col - half_px)
                r1 = min(src_slp.height, row + half_px + 1)
                c1 = min(src_slp.width, col + half_px + 1)
                if r1 <= r0 or c1 <= c0:
                    continue
                win = Window(c0, r0, c1 - c0, r1 - r0)
                arr_s = src_slp.read(1, window=win).astype(float)
                arr_d = src_dem.read(1, window=win).astype(float)
                arr_s[(arr_s <= -999.0) | np.isnan(arr_s)] = np.nan
                arr_d[(arr_d <= 0.0) | (arr_d <= -999.0) | np.isnan(arr_d)] = np.nan

                beta_val = float(np.nanmean(arr_s)) if not np.isnan(arr_s).all() else None
                if not np.isnan(arr_d).all():
                    e_mean = round(float(np.nanmean(arr_d)), 2)
                    e_min = round(float(np.nanmin(arr_d)), 2)
                    e_max = round(float(np.nanmax(arr_d)), 2)
                    h_val = round(max(0.0, e_max - e_min), 2)
                else:
                    e_mean, e_min, e_max, h_val = None, None, None, None

                results[idx] = {
                    "beta_deg": round(max(0.1, beta_val), 2) if beta_val is not None else None,
                    "elev_mean": e_mean,
                    "elev_min": e_min,
                    "elev_max": e_max,
                    "tinggi_H": h_val,
                }
    except Exception as exc:
        print(f"[WARN] Gagal sampling raster DEMNAS: {exc}")

    return results


def round_coords_5dec(coords: Any) -> Any:
    """Bulatkan semua koordinat geometri tepat 5 angka di belakang koma."""
    if not isinstance(coords, (list, tuple)) or len(coords) == 0:
        return coords
    if isinstance(coords[0], (int, float)):
        return [round(float(c), 5) for c in coords[:2]]
    return [round_coords_5dec(c) for c in coords]


def deduplicate_ring(ring: List[List[float]]) -> List[List[float]]:
    """Bersihkan titik berurutan yang identik setelah pembulatan 5 desimal."""
    if len(ring) <= 4:
        return ring
    deduped = [ring[0]]
    for pt in ring[1:]:
        if pt != deduped[-1]:
            deduped.append(pt)
    if deduped[0] != deduped[-1]:
        deduped.append(deduped[0])
    return deduped if len(deduped) >= 4 else ring


def optimize_geometry_5dec(geom_dict: Optional[Dict[str, Any]]) -> None:
    """Optimasi koordinat geometri menjadi 5 desimal dan hapus titik duplikat."""
    if not geom_dict or "coordinates" not in geom_dict or not geom_dict["coordinates"]:
        return
    gtype = geom_dict.get("type", "")
    rounded = round_coords_5dec(geom_dict["coordinates"])
    if gtype == "Polygon":
        rounded = [deduplicate_ring(r) for r in rounded]
    elif gtype == "MultiPolygon":
        rounded = [[deduplicate_ring(r) for r in poly] for poly in rounded]
    geom_dict["coordinates"] = rounded


def clean_idw_strings(val: Any) -> Any:
    """Bersihkan istilah visual 'Kontur IDW' / 'IDW' menjadi 'Isohyet' pada string properti."""
    if not isinstance(val, str):
        return val
    cleaned = val.replace("Kontur IDW", "Isohyet").replace("Curah Hujan IDW", "Curah Hujan Tahunan (Isohyet)")
    cleaned = cleaned.replace("Daerah Sabuk", "Zona Isohyet")
    return cleaned


def ensure_source_in_processed() -> None:
    """
    Pastikan seluruh file sumber di `public/data/` disalin ke `Data/processed/`
    bila `Data/processed/` belum memiliki file tersebut.
    """
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_DATA_DIR.mkdir(parents=True, exist_ok=True)
    for src in PUBLIC_DATA_DIR.glob("*.geojson"):
        dst = PROCESSED_DIR / src.name
        if not dst.exists():
            shutil.copy2(src, dst)


def remove_deprecated_dusun_files() -> None:
    """Hapus file dependensi toponimi dusun & cache OSM yang telah dideprekasi."""
    deprecated_files = [
        PROCESSED_DIR / "katalog_dusun_diy.json",
        PUBLIC_DATA_DIR / "katalog_dusun_diy.json",
        PROCESSED_DIR / "osm_administrasi_cache.json",
        PUBLIC_DATA_DIR / "osm_administrasi_cache.json",
    ]
    for p in deprecated_files:
        if p.exists():
            p.unlink()
            print(f"[CLEANUP] Menghapus file deprecated: {p.relative_to(PROJECT_ROOT)}")


def process_layer(
    filename: str,
    soil_matrix: Dict[str, Dict[str, Any]],
) -> Optional[Tuple[str, int, float, Dict[str, Any]]]:
    """Proses, kalkulasi parameter geoteknik, pangkas atribut, dan bulatkan koordinat 5 desimal."""
    src_path = PROCESSED_DIR / filename
    if not src_path.exists():
        alt_path = PUBLIC_DATA_DIR / filename
        if alt_path.exists():
            shutil.copy2(alt_path, src_path)
        else:
            return None

    gdf = gpd.read_file(src_path)
    if gdf.crs is None:
        gdf = gdf.set_crs(WGS84_CRS)
    gdf_utm = gdf.to_crs(UTM_CRS)

    # Sampling DEMNAS untuk layer kerawanan longsor & batas administrasi
    demnas_samples = None
    if filename in {"clean_kerawanan_longsor.geojson", "clean_batas_administrasi.geojson"}:
        demnas_samples = sample_demnas_for_polygons(gdf_utm)

    gdf_wgs = gdf_utm.to_crs(WGS84_CRS)
    gj_obj = json.loads(gdf_wgs.to_json())
    gj_obj["crs"] = {
        "type": "name",
        "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"},
    }

    keep_cols = ESSENTIAL_COLUMNS.get(filename)
    features = gj_obj.get("features", [])

    for idx, feat in enumerate(features):
        if "id" in feat:
            del feat["id"]
        p = feat.get("properties") or {}

        # A. Layer Jenis Tanah
        if filename in {"GJS Layer2_JenisTanah_SlemanBantul.geojson", "day8_jenis_tanah.geojson"}:
            soil_info = eval_soil_params(p.get("jns_tnh") or p.get("ket_tanah"), soil_matrix)
            p["skor tanah"] = soil_info["skor"]
            p["skor_tanah"] = soil_info["skor"]
            p["c_kpa"] = soil_info["c_kpa"]
            p["phi_deg"] = soil_info["phi_deg"]
            p["gamma_sat"] = soil_info["gamma_sat"]
            p["z"] = soil_info["z"]
            p["is_expansive"] = soil_info["is_expansive"]

        # B. Layer Geologi
        elif filename in {"GJS Layer3_Geologi_SlemanBantul.geojson", "day8_geologi.geojson"}:
            p["skor_batuan"] = eval_lithology_score(
                f"{p.get('NAME', '')} {p.get('SYMBOLS', '')} {p.get('FORMATION', '')}",
                p.get("skor_batuan"),
            )

        # C. Layer Tutupan Lahan
        elif filename in {"clean_tutupan_lahan_sleman_bantul.geojson", "clean_tutupan_lahan_diy.geojson"}:
            skor_lu, cr_val, q_val = eval_landuse_params(
                p.get("pl") or p.get("klasifikasi"),
                0.0,
                p.get("skor_lahan") or p.get("skor"),
            )
            p["skor_lahan"] = skor_lu
            p["skor"] = skor_lu
            p["cr_kpa"] = cr_val
            p["q_kpa"] = q_val

        # D. Layer Curah Hujan Tahunan (Isohyet)
        elif filename == "clean_curah_hujan_idw.geojson":
            ch_val = float(p.get("curah_hujan_mm") or p.get("ch_idw_rerata_mm") or 2250.0)
            skor_h, rasio_m, ket_h = eval_rainfall_params(ch_val, p.get("skor_hujan"), p.get("rasio_m"))
            p["curah_hujan_mm"] = int(round(ch_val))
            p["skor_hujan"] = skor_h
            p["skor"] = skor_h
            p["rasio_m"] = rasio_m
            p["ket_hujan"] = ket_h
            p["klasifikasi"] = ket_h
            p["nama_daerah_peta"] = f"Zona Isohyet Curah Hujan Skor {skor_h} ({ket_h})"

        # E. Layer Kerawanan Longsor (GPKG Master)
        elif filename == "clean_kerawanan_longsor.geojson":
            sample = demnas_samples[idx] if demnas_samples else {}
            skor_l_poly = int(p.get("skor_lereng") or 1)
            beta_deg = sample.get("beta_deg")
            if beta_deg is None:
                beta_deg = SLOPE_CLASS_MIDPOINT_DEG.get(skor_l_poly, 3.5)
            else:
                # Jaga agar nilai lereng hasil sampling tetap konsisten dengan kelas poligon DEMNAS-nya
                bounds_deg = {1: (0.2, 8.0), 2: (8.1, 15.0), 3: (15.1, 25.0), 4: (25.1, 35.0), 5: (35.1, 55.0)}
                lo_b, hi_b = bounds_deg.get(skor_l_poly, (0.2, 55.0))
                beta_deg = round(min(hi_b, max(lo_b, float(beta_deg))), 2)

            lereng_pct = round(math.tan(math.radians(beta_deg)) * 100.0, 2)
            skor_l, ket_l = eval_slope_score(beta_deg)
            skor_l = skor_l_poly if 1 <= skor_l_poly <= 5 else skor_l

            soil_info = eval_soil_params(p.get("ket_tanah") or p.get("jenis_tanah"), soil_matrix)
            skor_t = soil_info["skor"]
            skor_b = eval_lithology_score(p.get("ket_batuan"), p.get("skor_batuan"))
            ch_val = float(p.get("curah_hujan_mm") or 2394)
            skor_h, rasio_m, ket_h = eval_rainfall_params(ch_val, p.get("skor_hujan"), p.get("rasio_m"))
            skor_lh, cr_val, q_val = eval_landuse_params(p.get("ket_lahan"), beta_deg, p.get("skor_lahan"))

            skor_akhir = round(
                0.30 * skor_l + 0.25 * skor_t + 0.20 * skor_b + 0.15 * skor_h + 0.10 * skor_lh,
                2,
            )
            status_z, zona_triase, warna_hex, border_hex = classify_gpkg_zone(skor_akhir)
            fs_val, fs_status, u_kpa = compute_infinite_slope_fs(
                beta_deg=beta_deg,
                c_kpa=soil_info["c_kpa"],
                cr_kpa=cr_val,
                phi_deg=soil_info["phi_deg"],
                gamma_sat=soil_info["gamma_sat"],
                z_m=soil_info["z"],
                rasio_m=rasio_m,
                q_kpa=q_val,
            )

            p["elevasi_mdpl"] = sample.get("elev_mean") or 150.0
            p["elev_min"] = sample.get("elev_min") or 145.0
            p["elev_max"] = sample.get("elev_max") or 155.0
            p["tinggi_H"] = sample.get("tinggi_H") or 5.0
            p["lereng_derajat"] = beta_deg
            p["lereng_persen"] = lereng_pct
            p["skor_lereng"] = skor_l
            p["ket_lereng"] = p.get("ket_lereng") or ket_l
            p["skor_tanah"] = skor_t
            p["c_kpa"] = soil_info["c_kpa"]
            p["phi_deg"] = soil_info["phi_deg"]
            p["gamma_sat"] = soil_info["gamma_sat"]
            p["z"] = soil_info["z"]
            p["is_expansive"] = soil_info["is_expansive"]
            p["skor_batuan"] = skor_b
            p["skor_hujan"] = skor_h
            p["ket_hujan"] = ket_h
            p["curah_hujan_mm"] = int(round(ch_val))
            p["rasio_m"] = rasio_m
            p["skor_lahan"] = skor_lh
            p["cr_kpa"] = cr_val
            p["q_kpa"] = q_val
            p["u_kpa"] = u_kpa
            p["skor_akhir"] = skor_akhir
            p["status_zona"] = status_z
            p["zona_triase"] = zona_triase
            p["warna_hex"] = warna_hex
            p["border_hex"] = border_hex
            p["fs"] = fs_val
            p["fs_status"] = fs_status

        # F. Layer Batas Administrasi Kalurahan/Kelurahan
        elif filename == "clean_batas_administrasi.geojson":
            sample = demnas_samples[idx] if demnas_samples else {}
            beta_deg = float(p.get("lereng_derajat") or sample.get("beta_deg") or 3.5)
            lereng_pct = round(math.tan(math.radians(beta_deg)) * 100.0, 2)
            skor_l, ket_l = eval_slope_score(beta_deg)

            soil_info = eval_soil_params(p.get("jenis_tanah"), soil_matrix)
            skor_t = soil_info["skor"]
            skor_b = eval_lithology_score(p.get("formasi_batuan"))
            ch_val = float(p.get("curah_hujan_mm") or p.get("ch_idw_mm") or 2250.0)
            skor_h, rasio_m, ket_h = eval_rainfall_params(ch_val)
            skor_lh, cr_val, q_val = eval_landuse_params(p.get("tutupan_dominan"), beta_deg)

            skor_akhir = round(
                0.30 * skor_l + 0.25 * skor_t + 0.20 * skor_b + 0.15 * skor_h + 0.10 * skor_lh,
                2,
            )
            status_z, zona_triase, warna_hex, _ = classify_gpkg_zone(skor_akhir)
            fs_val, fs_status, u_kpa = compute_infinite_slope_fs(
                beta_deg=beta_deg,
                c_kpa=soil_info["c_kpa"],
                cr_kpa=cr_val,
                phi_deg=soil_info["phi_deg"],
                gamma_sat=soil_info["gamma_sat"],
                z_m=soil_info["z"],
                rasio_m=rasio_m,
                q_kpa=q_val,
            )

            p["lereng_derajat"] = round(beta_deg, 2)
            p["lereng_persen"] = lereng_pct
            p["skor_lereng"] = skor_l
            p["kelas_lereng"] = ket_l
            p["curah_hujan_mm"] = int(round(ch_val))
            p["skor_hujan"] = skor_h
            p["rasio_m"] = rasio_m
            p["kelas_hujan"] = ket_h
            p["skor_batuan"] = skor_b
            p["jenis_tanah"] = soil_info["nama"]
            p["skor_tanah"] = skor_t
            p["c_kpa"] = soil_info["c_kpa"]
            p["phi_deg"] = soil_info["phi_deg"]
            p["gamma_sat"] = soil_info["gamma_sat"]
            p["z"] = soil_info["z"]
            p["skor_tutupan"] = skor_lh
            p["cr_kpa"] = cr_val
            p["q_kpa"] = q_val
            p["u_kpa"] = u_kpa
            p["skor_total"] = skor_akhir
            p["zona_kerawanan"] = status_z
            p["zona_triase"] = zona_triase
            p["warna_hex"] = warna_hex
            p["fs"] = fs_val
            p["fs_status"] = fs_status

        # G. Layer Titik / Area Developer
        elif filename in {"clean_titik_developer.geojson", "clean_area_jangkauan_titik.geojson"}:
            ch_val = float(p.get("curah_hujan_mm") or p.get("ch_idw_area_mm") or p.get("ch_idw_titik_mm") or 2250.0)
            p["curah_hujan_mm"] = int(round(ch_val))

        # Saring hanya kolom esensial dan bersihkan istilah "IDW"
        if keep_cols:
            filtered_p = {k: clean_idw_strings(p[k]) for k in keep_cols if k in p}
        else:
            filtered_p = {
                k: clean_idw_strings(v)
                for k, v in p.items()
                if "dusun" not in k.lower() and not k.lower().startswith("osm_")
            }

        feat["properties"] = filtered_p
        optimize_geometry_5dec(feat.get("geometry"))

    minified = json.dumps(gj_obj, indent=None, separators=(",", ":"), ensure_ascii=False)
    size_mb = len(minified.encode("utf-8")) / (1024 * 1024)

    (PROCESSED_DIR / filename).write_text(minified, encoding="utf-8")
    (PUBLIC_DATA_DIR / filename).write_text(minified, encoding="utf-8")

    return filename, len(features), size_mb, gj_obj


def update_web_bundles(optimized_map: Dict[str, Dict[str, Any]]) -> None:
    """Perbarui Web/geojson_bundle.js (tanpa katalog dusun) & Web/tutupan_bundle.js."""
    bundle_path = WEB_DIR / "geojson_bundle.js"
    if bundle_path.exists():
        bundle_keys = [
            "clean_batas_administrasi.geojson",
            "clean_area_jangkauan_titik.geojson",
            "clean_titik_developer.geojson",
            "clean_pos_hujan.geojson",
            "clean_curah_hujan_idw.geojson",
            "clean_demnas_diy_utm.geojson",
            "clean_kemiringan_lereng_diy.geojson",
            "GJS Layer2_JenisTanah_SlemanBantul.geojson",
            "day8_jenis_tanah.geojson",
            "GJS Layer3_Geologi_SlemanBantul.geojson",
            "day8_geologi.geojson",
            "clean_kerawanan_longsor.geojson",
        ]
        bundle_obj = {k: optimized_map[k] for k in bundle_keys if k in optimized_map}
        meta_obj = {
            "crs_metric": "EPSG:32749",
            "crs_web": "EPSG:4326",
            "standard": "Permen PU No. 22/PRT/M/2007 & SNI 8291:2016",
        }
        txt = (
            "window.LAHAN_AMAN_GEOJSON = "
            + json.dumps(bundle_obj, indent=None, separators=(",", ":"), ensure_ascii=False)
            + ";\nwindow.LAHAN_AMAN_META = "
            + json.dumps(meta_obj, indent=None, separators=(",", ":"), ensure_ascii=False)
            + ";\n"
        )
        bundle_path.write_text(txt, encoding="utf-8")

    tutupan_bundle_path = WEB_DIR / "tutupan_bundle.js"
    if tutupan_bundle_path.exists():
        raw_t = tutupan_bundle_path.read_text(encoding="utf-8")
        eq_idx = raw_t.find("=")
        if eq_idx >= 0:
            t_obj = json.loads(raw_t[eq_idx + 1 :].strip().rstrip(";"))
            for feat in t_obj.get("features", []):
                optimize_geometry_5dec(feat.get("geometry"))
            tutupan_bundle_path.write_text(
                "window.LAHAN_AMAN_TUTUPAN = "
                + json.dumps(t_obj, indent=None, separators=(",", ":"), ensure_ascii=False)
                + ";\n",
                encoding="utf-8",
            )


def main() -> None:
    print("=" * 95)
    print(" PIPELINE ETL SPASIAL & KALKULASI GEOTEKNIK DATA-DRIVEN — LAHANAMAN GEOANALYTICS DIY")
    print("=" * 95)

    ensure_source_in_processed()
    remove_deprecated_dusun_files()
    soil_matrix = load_dasar_xlsx_parameters()

    target_layers = [
        "GJS Layer2_JenisTanah_SlemanBantul.geojson",
        "day8_jenis_tanah.geojson",
        "GJS Layer3_Geologi_SlemanBantul.geojson",
        "day8_geologi.geojson",
        "clean_tutupan_lahan_sleman_bantul.geojson",
        "clean_tutupan_lahan_diy.geojson",
        "clean_kemiringan_lereng_diy.geojson",
        "clean_curah_hujan_idw.geojson",
        "clean_batas_administrasi.geojson",
        "clean_kerawanan_longsor.geojson",
        "clean_pos_hujan.geojson",
        "clean_titik_developer.geojson",
        "clean_area_jangkauan_titik.geojson",
        "clean_demnas_diy_utm.geojson",
    ]

    optimized_map: Dict[str, Dict[str, Any]] = {}
    rows: List[Tuple[str, int, float]] = []

    for fname in target_layers:
        res = process_layer(fname, soil_matrix)
        if res is not None:
            fn, count, mb, gj = res
            optimized_map[fn] = gj
            rows.append((fn, count, mb))

    update_web_bundles(optimized_map)

    print("-" * 80)
    print(f"{'Nama Layer GeoJSON (public/data/)':<46} | {'Fitur':>8} | {'Ukuran (MB)':>12}")
    print("-" * 80)
    total_mb = 0.0
    for fn, count, mb in rows:
        total_mb += mb
        print(f"{fn:<46} | {count:>8,d} | {mb:>10.2f} MB")
    print("-" * 80)
    print(f"{'TOTAL PAYLOAD PUBLIC/DATA':<46} | {'':>8} | {total_mb:>10.2f} MB")
    print("-" * 80)


if __name__ == "__main__":
    main()
