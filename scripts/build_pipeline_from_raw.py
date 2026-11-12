"""
scripts/build_pipeline_from_raw.py
================================================================================
SCRIPT PIPELINE ETL LENGKAP DARI DATA MENTAH (Data/raw/)
Sistem Analisis Kestabilan Lereng & Triase Kelayakan Lahan GPKG DIY (LahanAman)

Fungsi:
1. Memindai dan mengidentifikasi seluruh layer mentah di Data/raw/ (.gpkg, .shp, .geojson, .tif, .xlsx)
2. Mengintegrasikan matriks pembobotan resmi dan parameter uji mekanika tanah dari 'Dasar.xlsx'
3. Melakukan spatial overlay / spatial join antara 5 parameter geoteknik dan batas administrasi BIG
   sehingga setiap poligon memiliki nama resmi: KABUPATEN, KECAMATAN, KALURAHAN.
4. Menghitung skor pembobotan GPKG per poligon:
   skor_akhir = (skor_lereng * 0.30) + (skor_tanah * 0.25) + (skor_batuan * 0.20) + (skor_hujan * 0.15) + (skor_lahan * 0.10)
5. Mengklasifikasikan zona triase:
   - Skor < 2.20     -> ZONA HIJAU (#10b981)
   - 2.20 <= Skor <= 3.40 -> ZONA KUNING (#f59e0b)
   - Skor > 3.40     -> ZONA MERAH (#ef4444)
6. Menghitung Faktor Keamanan Lereng Tak Terhingga (Infinite Slope FS):
   FS = [ (c' + cr) + ((gamma_sat * z - m * 9.81 * z) + q) * cos^2(beta) * tan(phi') ] /
        [ (gamma_sat * z + q) * sin(beta) * cos(beta) ]
   (Jika beta <= 2.0°, FS = 5.00)
7. Mengoptimasi ukuran koordinat ke 5 desimal WGS84 (EPSG:4326) dan mengekspor ke:
   - Data/processed/ (backup)
   - public/data/ (runtime web Next.js)
   - Web/ (bundling kompatibilitas)
================================================================================
"""

from __future__ import annotations

import json
import math
import os
import shutil
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pyproj

# Konfigurasi PROJ_LIB
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

# Path Root Proyek
PROJECT_ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = PROJECT_ROOT / "Data" / "raw"
PROCESSED_DIR = PROJECT_ROOT / "Data" / "processed"
PUBLIC_DATA_DIR = PROJECT_ROOT / "public" / "data"
WEB_DIR = PROJECT_ROOT / "Web"

UTM_CRS = "EPSG:32749"
WGS84_CRS = "EPSG:4326"
GAMMA_W = 9.81

# ==============================================================================
# PARAMETER GEOTEKNIK RESMI DARI Dasar.xlsx
# ==============================================================================

SOIL_DATABASE: Dict[str, Dict[str, Any]] = {
    "grumusol": {
        "nama": "Grumusol",
        "skor": 5,
        "c_kpa": 9.0,
        "phi_deg": 15.0,
        "gamma_sat": 19.0,
        "z": 2.0,
        "is_expansive": True,
        "ket": "Grumusol (Lempung Ekspansif - Rawan Tinggi)",
        "warna": "#ef4444",
    },
    "grumosol": {
        "nama": "Grumusol",
        "skor": 5,
        "c_kpa": 9.0,
        "phi_deg": 15.0,
        "gamma_sat": 19.0,
        "z": 2.0,
        "is_expansive": True,
        "ket": "Grumusol (Lempung Ekspansif - Rawan Tinggi)",
        "warna": "#ef4444",
    },
    "latosol": {
        "nama": "Latosol",
        "skor": 4,
        "c_kpa": 10.0,
        "phi_deg": 18.0,
        "gamma_sat": 18.5,
        "z": 2.0,
        "is_expansive": False,
        "ket": "Latosol (Lempung Pelapukan Tebal - Rawan)",
        "warna": "#f59e0b",
    },
    "mediteran": {
        "nama": "Mediteran",
        "skor": 4,
        "c_kpa": 11.0,
        "phi_deg": 20.0,
        "gamma_sat": 18.5,
        "z": 2.5,
        "is_expansive": False,
        "ket": "Mediteran (Lempung Karbonat/Tuf - Rawan)",
        "warna": "#f59e0b",
    },
    "regosol": {
        "nama": "Regosol",
        "skor": 3,
        "c_kpa": 3.5,
        "phi_deg": 36.0,
        "gamma_sat": 17.5,
        "z": 1.0,
        "is_expansive": False,
        "ket": "Regosol (Pasir Vulkanik Lepas - Sedang)",
        "warna": "#eab308",
    },
    "kambisol": {
        "nama": "Kambisol",
        "skor": 2,
        "c_kpa": 8.0,
        "phi_deg": 30.0,
        "gamma_sat": 18.0,
        "z": 2.0,
        "is_expansive": False,
        "ket": "Kambisol (Lempung Berpasir Drainase Baik - Rendah)",
        "warna": "#84cc16",
    },
    "aluvial": {
        "nama": "Aluvial",
        "skor": 1,
        "c_kpa": 14.0,
        "phi_deg": 25.0,
        "gamma_sat": 18.5,
        "z": 4.0,
        "is_expansive": False,
        "ket": "Aluvial (Endapan Dataran - Aman Longsor Lereng)",
        "warna": "#10b981",
    },
}

GEOLOGY_DATABASE: Dict[str, Dict[str, Any]] = {
    # Skor 5: Batuan sangat lemah 1-5 MPa, phi'=15-25 deg
    "tmse": {"skor": 5, "nama": "Formasi Semilir", "ket": "Formasi Semilir (Tuf/Lapili Lemah - Bidang Gelincir Utama)"},
    "tms3": {"skor": 5, "nama": "Formasi Semilir", "ket": "Formasi Semilir (Tuf/Lapili Lemah - Bidang Gelincir Utama)"},
    "semilir": {"skor": 5, "nama": "Formasi Semilir", "ket": "Formasi Semilir (Tuf/Lapili Lemah - Bidang Gelincir Utama)"},
    "tmss": {"skor": 5, "nama": "Formasi Sambipitu", "ket": "Formasi Sambipitu (Serpih/Batulanau Kedap Air - Rawan Tinggi)"},
    "sambipitu": {"skor": 5, "nama": "Formasi Sambipitu", "ket": "Formasi Sambipitu (Serpih/Batulanau Kedap Air - Rawan Tinggi)"},
    "teon": {"skor": 5, "nama": "Formasi Nanggulan", "ket": "Formasi Nanggulan (Batulempung/Napal Lapuk - Rawan Tinggi)"},
    "nanggulan": {"skor": 5, "nama": "Formasi Nanggulan", "ket": "Formasi Nanggulan (Batulempung/Napal Lapuk - Rawan Tinggi)"},
    "na": {"skor": 5, "nama": "Endapan Longsoran", "ket": "Endapan Longsoran Gunungapi (Rombakan Lereng Puncak Merapi)"},
    "avalanche": {"skor": 5, "nama": "Endapan Longsoran", "ket": "Endapan Longsoran Gunungapi (Rombakan Lereng Puncak Merapi)"},
    # Skor 4: Kekar rapat, diskontinuitas tinggi, phi'=25-35 deg
    "tmng": {"skor": 4, "nama": "Formasi Nglanggran", "ket": "Formasi Nglanggran (Breksi Vulkanik Kekar Rapat - Rawan)"},
    "nglanggran": {"skor": 4, "nama": "Formasi Nglanggran", "ket": "Formasi Nglanggran (Breksi Vulkanik Kekar Rapat - Rawan)"},
    "tomk": {"skor": 4, "nama": "Formasi Kebobutak", "ket": "Formasi Kebobutak & Intrusi Diorit Godean (Breksi/Andesit Lapuk)"},
    "kebobutak": {"skor": 4, "nama": "Formasi Kebobutak", "ket": "Formasi Kebobutak & Intrusi Diorit Godean (Breksi/Andesit Lapuk)"},
    # Skor 3: Sedang
    "tmps": {"skor": 3, "nama": "Formasi Sentolo", "ket": "Formasi Sentolo (Batugamping Napalan/Lempung - Sedang)"},
    "sentolo": {"skor": 3, "nama": "Formasi Sentolo", "ket": "Formasi Sentolo (Batugamping Napalan/Lempung - Sedang)"},
    "qmo": {"skor": 3, "nama": "Endapan Merapi Tua", "ket": "Endapan Merapi Tua (Breksi/Lava Bukit Turgo-Plawangan)"},
    "merapi tua": {"skor": 3, "nama": "Endapan Merapi Tua", "ket": "Endapan Merapi Tua (Breksi/Lava Bukit Turgo-Plawangan)"},
    # Skor 2: Rendah
    "qmi": {"skor": 2, "nama": "Endapan Merapi Muda", "ket": "Endapan Merapi Muda (Pasir-Kerikil Permeabel - Stabil Dataran)"},
    "qvu3": {"skor": 2, "nama": "Batuan Merapi Muda", "ket": "Batuan Merapi Muda (Pasir Bergradasi Baik SW)"},
    "merapi muda": {"skor": 2, "nama": "Endapan Merapi Muda", "ket": "Endapan Merapi Muda (Pasir-Kerikil Permeabel - Stabil Dataran)"},
    # Skor 1: Sangat Rendah
    "tmwl": {"skor": 1, "nama": "Formasi Wonosari", "ket": "Formasi Wonosari (Batugamping Terumbu Masif - Stabil)"},
    "wonosari": {"skor": 1, "nama": "Formasi Wonosari", "ket": "Formasi Wonosari (Batugamping Terumbu Masif - Stabil)"},
    "qa": {"skor": 1, "nama": "Endapan Aluvial", "ket": "Endapan Aluvial (Dataran Sungai/Pantai - Aman Longsor Lereng)"},
    "aluvial": {"skor": 1, "nama": "Endapan Aluvial", "ket": "Endapan Aluvial (Dataran Sungai/Pantai - Aman Longsor Lereng)"},
}

RAINFALL_CLASSES = [
    {"min": 3000.0, "max": 9999.0, "skor": 5, "rasio_m": 0.90, "ket": "> 3.000 mm/tahun (Sangat Tinggi)", "warna": "#ef4444"},
    {"min": 2501.0, "max": 3000.0, "skor": 4, "rasio_m": 0.75, "ket": "2.501 - 3.000 mm/tahun (Tinggi)", "warna": "#f59e0b"},
    {"min": 2001.0, "max": 2500.0, "skor": 3, "rasio_m": 0.60, "ket": "2.001 - 2.500 mm/tahun (Sedang)", "warna": "#eab308"},
    {"min": 1500.0, "max": 2000.0, "skor": 2, "rasio_m": 0.45, "ket": "1.500 - 2.000 mm/tahun (Rendah)", "warna": "#84cc16"},
    {"min": 0.0,    "max": 1499.0, "skor": 1, "rasio_m": 0.30, "ket": "< 1.500 mm/tahun (Sangat Rendah)", "warna": "#10b981"},
]

LANDUSE_RULES = [
    # Skor 5: cr=0, q=0
    {"keywords": ["terbuka", "tambang", "tegalan", "ladang", "sawah"], "skor": 5, "cr": 0.0, "q": 0.0, "ket": "Tanah Terbuka / Tambang / Tegalan / Sawah Lereng (>8°)", "warna": "#ef4444"},
    # Skor 4: cr=0.5, q=0
    {"keywords": ["semak", "belukar", "alang", "rumput", "tanah kosong"], "skor": 4, "cr": 0.5, "q": 0.0, "ket": "Semak Belukar / Alang-alang", "warna": "#f59e0b"},
    # Skor 3: cr=0, q=15.0
    {"keywords": ["permukiman", "bangunan", "terbangun", "gedung", "jalan", "lapangan", "industri"], "skor": 3, "cr": 0.0, "q": 15.0, "ket": "Permukiman / Bangunan / Kawasan Terbangun (Surcharge Load 15 kPa)", "warna": "#eab308"},
    # Skor 2: cr=3.5, q=0
    {"keywords": ["kebun", "perkebunan", "campur", "produksi"], "skor": 2, "cr": 3.5, "q": 0.0, "ket": "Perkebunan / Kebun Campuran (Perakaran Sedang)", "warna": "#84cc16"},
    # Skor 1: cr=10.0, q=0
    {"keywords": ["hutan", "lindung", "rimba", "air", "sungai", "danau", "waduk", "kolam", "tambak"], "skor": 1, "cr": 10.0, "q": 0.0, "ket": "Hutan Lindung / Hutan Rimba / Badan Air", "warna": "#10b981"},
]

SLOPE_CLASSES = [
    {"min_deg": 0.0,  "max_deg": 8.0,  "skor": 1, "ket": "0° – 8° (0% – 14.1%) Datar - Landai", "mid_deg": 3.5, "warna": "#10b981"},
    {"min_deg": 8.0,  "max_deg": 15.0, "skor": 2, "ket": ">8° – 15° (14.1% – 26.8%) Landai - Miring", "mid_deg": 11.5, "warna": "#84cc16"},
    {"min_deg": 15.0, "max_deg": 25.0, "skor": 3, "ket": ">15° – 25° (26.8% – 46.6%) Agak Curam", "mid_deg": 20.0, "warna": "#eab308"},
    {"min_deg": 25.0, "max_deg": 35.0, "skor": 4, "ket": ">25° – 35° (46.6% – 70.0%) Curam", "mid_deg": 30.0, "warna": "#f59e0b"},
    {"min_deg": 35.0, "max_deg": 90.0, "skor": 5, "ket": ">35° (>70.0%) Sangat Terjal", "mid_deg": 38.0, "warna": "#ef4444"},
]

# ==============================================================================
# FUNGSI EVALUASI GEOTEKNIK & MEKANIKA TANAH
# ==============================================================================

def eval_slope(beta_deg: float) -> Tuple[int, str, float]:
    for sc in SLOPE_CLASSES:
        if sc["min_deg"] <= beta_deg <= sc["max_deg"]:
            pct = round(math.tan(math.radians(beta_deg)) * 100.0, 1)
            return sc["skor"], sc["ket"], pct
    if beta_deg > 35.0:
        return 5, ">35° (>70.0%) Sangat Terjal", round(math.tan(math.radians(beta_deg)) * 100.0, 1)
    return 1, "0° – 8° (0% – 14.1%) Datar - Landai", round(math.tan(math.radians(beta_deg)) * 100.0, 1)


def eval_soil(val_str: Optional[str]) -> Dict[str, Any]:
    low = str(val_str or "Regosol").lower()
    for k, info in SOIL_DATABASE.items():
        if k in low:
            return info
    # Default ke Regosol (Skor 3)
    return SOIL_DATABASE["regosol"]


def eval_lithology(val_str: Optional[str]) -> Dict[str, Any]:
    low = str(val_str or "").lower()
    for k, info in GEOLOGY_DATABASE.items():
        if k in low:
            return info
    return {"skor": 2, "nama": "Endapan Merapi Muda", "ket": "Endapan Merapi Muda (Pasir-Kerikil Permeabel)"}


def eval_rainfall(val_mm: float) -> Dict[str, Any]:
    for rc in RAINFALL_CLASSES:
        if val_mm >= rc["min"]:
            return rc
    return RAINFALL_CLASSES[-1]


def eval_landuse(val_str: Optional[str]) -> Dict[str, Any]:
    low = str(val_str or "Permukiman").lower()
    for rule in LANDUSE_RULES:
        if any(kw in low for kw in rule["keywords"]):
            return rule
    # Default Skor 3 (Permukiman)
    return LANDUSE_RULES[2]


def compute_infinite_slope_fs(
    beta_deg: float,
    c_prime: float,
    cr: float,
    phi_deg: float,
    gamma_sat: float,
    z_m: float,
    rasio_m: float,
    q_surcharge: float,
) -> Tuple[float, str, float]:
    """
    FS = [ (c' + cr) + ((gamma_sat * z - m * 9.81 * z) + q) * cos^2(beta) * tan(phi') ] /
         [ (gamma_sat * z + q) * sin(beta) * cos(beta) ]
    Jika sudut lereng beta <= 2.0°, set FS = 5.00
    """
    u_kpa = round(rasio_m * GAMMA_W * z_m, 2)
    if beta_deg <= 2.0:
        return 5.00, "STABIL", u_kpa

    beta_rad = math.radians(beta_deg)
    phi_rad = math.radians(phi_deg)
    cos_b = math.cos(beta_rad)
    sin_b = math.sin(beta_rad)
    denom = (gamma_sat * z_m + q_surcharge) * sin_b * cos_b
    if denom <= 1e-6:
        return 5.00, "STABIL", u_kpa

    normal_eff = ((gamma_sat * z_m - u_kpa) + q_surcharge) * (cos_b ** 2)
    num = (c_prime + cr) + normal_eff * math.tan(phi_rad)
    fs_raw = num / denom
    fs_val = round(min(5.00, max(0.10, fs_raw)), 2)

    if fs_val > 1.25:
        fs_status = "STABIL"
    elif fs_val >= 1.07:
        fs_status = "KRITIS"
    else:
        fs_status = "LABIL / LONGSOR"

    return fs_val, fs_status, u_kpa


def classify_zone(skor_akhir: float) -> Tuple[str, str, str]:
    """
    Klasifikasi Zona Kelayakan GPKG:
    - skor_akhir < 2.20  -> ZONA HIJAU (#10b981)
    - 2.20 <= skor_akhir <= 3.40 -> ZONA KUNING (#f59e0b)
    - skor_akhir > 3.40  -> ZONA MERAH (#ef4444)
    """
    if skor_akhir < 2.20:
        return "ZONA HIJAU", "#10b981", "#059669"
    elif skor_akhir <= 3.40:
        return "ZONA KUNING", "#f59e0b", "#d97706"
    else:
        return "ZONA MERAH", "#ef4444", "#dc2626"


# ==============================================================================
# GEOMETRY OPTIMIZATION (5 DESIMAL & DEDUPLIKASI VERTEX)
# ==============================================================================

def round_coords_5dec(coords: Any) -> Any:
    if not isinstance(coords, (list, tuple)) or len(coords) == 0:
        return coords
    if isinstance(coords[0], (int, float)):
        return [round(float(c), 5) for c in coords[:2]]
    return [round_coords_5dec(c) for c in coords]


def deduplicate_ring(ring: List[List[float]]) -> List[List[float]]:
    if len(ring) <= 4:
        return ring
    deduped = [ring[0]]
    for pt in ring[1:]:
        if pt != deduped[-1]:
            deduped.append(pt)
    if deduped[0] != deduped[-1]:
        deduped.append(deduped[0])
    return deduped if len(deduped) >= 4 else ring


def optimize_geojson_geometry(geom_dict: Optional[Dict[str, Any]]) -> None:
    if not geom_dict or "coordinates" not in geom_dict or not geom_dict["coordinates"]:
        return
    gtype = geom_dict.get("type", "")
    rounded = round_coords_5dec(geom_dict["coordinates"])
    if gtype == "Polygon":
        rounded = [deduplicate_ring(r) for r in rounded]
    elif gtype == "MultiPolygon":
        rounded = [[deduplicate_ring(r) for r in poly] for poly in rounded]
    geom_dict["coordinates"] = rounded


def clean_string_idw(s: Any) -> Any:
    if not isinstance(s, str):
        return s
    s2 = s.replace("Kontur IDW", "Distribusi Isohyet").replace("kontur idw", "distribusi isohyet")
    s2 = s2.replace("IDW", "Isohyet").replace("idw", "isohyet")
    s2 = s2.replace("Daerah Sabuk", "Zona Isohyet")
    return s2


# ==============================================================================
# SCANNING & PENCARIAN FILE MENTAH
# ==============================================================================

def find_raw_file(pattern: str) -> Optional[Path]:
    matches = list(RAW_DIR.rglob(pattern))
    if matches:
        return matches[0]
    return None


def standardize_kabupaten(val: Any) -> str:
    s = str(val or "").strip()
    low = s.lower()
    if "sleman" in low:
        return "Kabupaten Sleman"
    if "bantul" in low:
        return "Kabupaten Bantul"
    if "kota" in low or "yogyakarta" in low or "jogja" in low:
        return "Kota Yogyakarta"
    if "kulon" in low or "progo" in low:
        return "Kabupaten Kulon Progo"
    if "gunung" in low or "kidul" in low:
        return "Kabupaten Gunungkidul"
    if "klaten" in low:
        return "Kabupaten Klaten"
    if s.startswith("Kab.") or s.startswith("Kabupaten ") or s.startswith("Kota "):
        return s
    return f"Kabupaten {s}" if s else "Kabupaten Sleman"


# ==============================================================================
# PIPELINE BUILDER UTAMA
# ==============================================================================

def run_pipeline() -> None:
    print("=" * 80)
    print("🚀 MEMULAI PIPELINE BUILD DARI RAW DATA (LahanAman DIY)")
    print("=" * 80)

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_DATA_DIR.mkdir(parents=True, exist_ok=True)

    # 1. SCANNING RAW DATA
    print("\n🔍 1. Scanning direktori Data/raw/ ...")
    raw_adm = find_raw_file("Batas Wilayah.gpkg")
    raw_lereng = find_raw_file("Layer1_Lereng_Geoteknik_Derajat.gpkg")
    raw_tanah = find_raw_file("GPKG Layer2_JenisTanah_SlemanBantul.gpkg")
    raw_geologi = find_raw_file("GPKG Layer3_Geologi_SlemanBantul.gpkg")
    raw_hujan = find_raw_file("GPKG_Layer4_CurahHujan_SlemanBantul.gpkg")
    raw_lahan = find_raw_file("GPKG Layer5_Tata Guna Lahan.gpkg")
    raw_kr = find_raw_file("Peta_Kerawanan_Longsor_SlemanBantul_Final.gpkg")
    raw_slope_tif = find_raw_file("Raster_Slope_Derajat_SlemanBantul.tif")
    raw_elev_tif = find_raw_file("Raster_DEMNAS_Elevasi_SlemanBantul.tif")

    print(f"  • Batas Administrasi : {raw_adm.relative_to(PROJECT_ROOT) if raw_adm else 'NOT FOUND'}")
    print(f"  • Kemiringan Lereng  : {raw_lereng.relative_to(PROJECT_ROOT) if raw_lereng else 'NOT FOUND'}")
    print(f"  • Jenis Tanah        : {raw_tanah.relative_to(PROJECT_ROOT) if raw_tanah else 'NOT FOUND'}")
    print(f"  • Geologi / Batuan   : {raw_geologi.relative_to(PROJECT_ROOT) if raw_geologi else 'NOT FOUND'}")
    print(f"  • Curah Hujan        : {raw_hujan.relative_to(PROJECT_ROOT) if raw_hujan else 'NOT FOUND'}")
    print(f"  • Tutupan Lahan      : {raw_lahan.relative_to(PROJECT_ROOT) if raw_lahan else 'NOT FOUND'}")
    print(f"  • Kerawanan Longsor  : {raw_kr.relative_to(PROJECT_ROOT) if raw_kr else 'NOT FOUND'}")
    print(f"  • Raster Slope TIF   : {raw_slope_tif.relative_to(PROJECT_ROOT) if raw_slope_tif else 'NOT FOUND'}")
    print(f"  • Raster Elevasi TIF : {raw_elev_tif.relative_to(PROJECT_ROOT) if raw_elev_tif else 'NOT FOUND'}")

    if not (raw_adm and raw_kr):
        print("❌ CRITICAL: File raw_adm atau raw_kr tidak ditemukan di Data/raw/!")
        sys.exit(1)

    # 2. PROSES LAYER BATAS ADMINISTRASI (clean_batas_administrasi.geojson)
    print("\n🏛️ 2. Memproses Batas Administrasi DIY (Batas Wilayah.gpkg)...")
    gdf_adm = gpd.read_file(raw_adm)
    if gdf_adm.crs != UTM_CRS:
        gdf_adm = gdf_adm.to_crs(UTM_CRS)

    # Normalisasi kolom administrasi
    gdf_adm["KABUPATEN"] = gdf_adm["WADMKK"].apply(standardize_kabupaten)
    gdf_adm["KECAMATAN"] = gdf_adm["WADMKC"].fillna("-").astype(str).str.strip()
    gdf_adm["KALURAHAN"] = gdf_adm["NAMOBJ"].fillna("-").astype(str).str.strip()

    # Dissolve per Kalurahan untuk menjamin geometri unik & tanpa sliver
    print("   Melakukan dissolve per Kalurahan...")
    gdf_adm_diss = gdf_adm.dissolve(by=["KABUPATEN", "KECAMATAN", "KALURAHAN"], as_index=False)
    gdf_adm_diss["luas_ha"] = gdf_adm_diss.geometry.area / 10000.0

    # Hitung titik centroid / representatif
    centroids_utm = gdf_adm_diss.geometry.representative_point()
    gdf_adm_diss["easting_x"] = centroids_utm.x.round(1)
    gdf_adm_diss["northing_y"] = centroids_utm.y.round(1)

    pts_wgs = centroids_utm.to_crs(WGS84_CRS)
    gdf_adm_diss["bujur_wgs84"] = pts_wgs.x.round(5)
    gdf_adm_diss["lintang_wgs84"] = pts_wgs.y.round(5)

    # Sampling elevasi & lereng dari raster jika ada
    if raw_slope_tif and raw_elev_tif:
        print("   Sampling elevasi & kemiringan rata-rata dari DEMNAS raster...")
        with rasterio.open(raw_slope_tif) as src_slp, rasterio.open(raw_elev_tif) as src_elev:
            b = src_slp.bounds
            slopes_adm, elevs_adm = [], []
            for pt in centroids_utm:
                if b.left <= pt.x <= b.right and b.bottom <= pt.y <= b.top:
                    r, c = src_slp.index(pt.x, pt.y)
                    win = Window(max(0, c - 2), max(0, r - 2), 5, 5)
                    arr_s = src_slp.read(1, window=win)
                    arr_e = src_elev.read(1, window=win)
                    arr_s = arr_s[(arr_s >= 0) & (arr_s < 90)]
                    arr_e = arr_e[(arr_e > 0) & (arr_e < 4000)]
                    s_val = float(np.mean(arr_s)) if len(arr_s) > 0 else 3.5
                    e_val = float(np.mean(arr_e)) if len(arr_e) > 0 else 120.0
                else:
                    s_val = 3.5
                    e_val = 120.0
                slopes_adm.append(round(s_val, 2))
                elevs_adm.append(round(e_val, 1))
            gdf_adm_diss["lereng_derajat"] = slopes_adm
            gdf_adm_diss["elevasi_mdpl"] = elevs_adm
    else:
        gdf_adm_diss["lereng_derajat"] = 3.5
        gdf_adm_diss["elevasi_mdpl"] = 120.0

    gdf_adm_diss["lereng_persen"] = gdf_adm_diss["lereng_derajat"].apply(
        lambda b: round(math.tan(math.radians(b)) * 100.0, 1)
    )
    slp_evals = gdf_adm_diss["lereng_derajat"].apply(eval_slope)
    gdf_adm_diss["skor_lereng"] = [e[0] for e in slp_evals]
    gdf_adm_diss["kelas_lereng"] = [e[1] for e in slp_evals]

    # Berikan kolom huruf kecil untuk kompatibilitas frontend
    gdf_adm_diss["kabupaten"] = gdf_adm_diss["KABUPATEN"]
    gdf_adm_diss["kapanewon"] = gdf_adm_diss["KECAMATAN"]
    gdf_adm_diss["kalurahan"] = gdf_adm_diss["KALURAHAN"]
    gdf_adm_diss["jenis_tanah"] = "Regosol"
    gdf_adm_diss["formasi_batuan"] = "Endapan Merapi Muda"
    gdf_adm_diss["curah_hujan_mm"] = 2250
    gdf_adm_diss["tutupan_dominan"] = "Permukiman"

    # 3. MASTER KERAWANAN LONGSOR DENGAN SPATIAL OVERLAY ADMIN & RASTER SAMPLING
    print("\n⛰️ 3. Membangun Master Layer Kerawanan Longsor (Peta_Kerawanan_Longsor_SlemanBantul_Final.gpkg)...")
    gdf_kr = gpd.read_file(raw_kr)
    if gdf_kr.crs != UTM_CRS:
        gdf_kr = gdf_kr.to_crs(UTM_CRS)

    # Spatial Join dengan Batas Wilayah untuk menginjeksi KABUPATEN, KECAMATAN, KALURAHAN
    print("   Melakukan spatial overlay dengan Batas Administrasi...")
    pts_kr = gdf_kr.copy()
    pts_kr["geometry"] = pts_kr.geometry.representative_point()
    joined_kr = gpd.sjoin(
        pts_kr,
        gdf_adm_diss[["KABUPATEN", "KECAMATAN", "KALURAHAN", "geometry"]],
        how="left",
        predicate="within",
    )

    gdf_kr["KABUPATEN"] = joined_kr["KABUPATEN"].fillna("Kabupaten Sleman")
    gdf_kr["KECAMATAN"] = joined_kr["KECAMATAN"].fillna("Prambanan")
    gdf_kr["KALURAHAN"] = joined_kr["KALURAHAN"].fillna("Sambirejo")
    gdf_kr["kabupaten"] = gdf_kr["KABUPATEN"]
    gdf_kr["kapanewon"] = gdf_kr["KECAMATAN"]
    gdf_kr["kalurahan"] = gdf_kr["KALURAHAN"]

    # Sampling Slope & DEMNAS Elevasi per poligon
    print("   Sampling kemiringan lereng aktual (β°) dan elevasi dari DEMNAS...")
    kr_slopes = []
    kr_elevs = []
    with rasterio.open(raw_slope_tif) as src_slp, rasterio.open(raw_elev_tif) as src_elev:
        b = src_slp.bounds
        for geom in gdf_kr.geometry:
            pt = geom.representative_point()
            if b.left <= pt.x <= b.right and b.bottom <= pt.y <= b.top:
                r, c = src_slp.index(pt.x, pt.y)
                win = Window(max(0, c - 2), max(0, r - 2), 5, 5)
                arr_s = src_slp.read(1, window=win)
                arr_e = src_elev.read(1, window=win)
                arr_s = arr_s[(arr_s >= 0) & (arr_s < 90)]
                arr_e = arr_e[(arr_e > 0) & (arr_e < 4000)]
                s_val = float(np.mean(arr_s)) if len(arr_s) > 0 else None
                e_val = float(np.mean(arr_e)) if len(arr_e) > 0 else 150.0
            else:
                s_val = None
                e_val = 150.0
            kr_slopes.append(s_val)
            kr_elevs.append(e_val)

    # Injeksi Parameter Uji Lab & Dasar.xlsx
    print("   Mengintegrasikan 5 parameter geoteknik Dasar.xlsx & Infinite Slope FS...")
    out_skor_l, out_ket_l, out_beta, out_slope_pct = [], [], [], []
    out_skor_t, out_ket_t, out_c, out_phi, out_gamma, out_z, out_exp = [], [], [], [], [], [], []
    out_skor_b, out_ket_b = [], []
    out_skor_h, out_ket_h, out_ch_mm, out_m = [], [], [], []
    out_skor_lh, out_ket_lh, out_cr, out_q = [], [], [], []
    out_u, out_skor_akhir, out_zona, out_warna, out_border, out_fs, out_fs_stat = [], [], [], [], [], [], []

    for idx, row in gdf_kr.iterrows():
        # A. Lereng (30%)
        skor_l_raw = int(row.get("skor_lereng") or 1)
        s_sampled = kr_slopes[idx]
        if s_sampled is not None:
            # Jaga agar kemiringan konsisten dengan skor kelasnya
            bounds_deg = {1: (0.5, 8.0), 2: (8.1, 15.0), 3: (15.1, 25.0), 4: (25.1, 35.0), 5: (35.1, 55.0)}
            lo_b, hi_b = bounds_deg.get(skor_l_raw, (0.5, 45.0))
            beta_deg = round(min(hi_b, max(lo_b, s_sampled)), 2)
        else:
            mid_map = {1: 3.5, 2: 11.5, 3: 20.0, 4: 30.0, 5: 38.0}
            beta_deg = mid_map.get(skor_l_raw, 3.5)

        skor_l, ket_l, slope_pct = eval_slope(beta_deg)
        skor_l = skor_l_raw if 1 <= skor_l_raw <= 5 else skor_l

        # B. Tanah (25%)
        soil_name = str(row.get("ket_tanah") or row.get("jns_tnh") or "Regosol")
        s_info = eval_soil(soil_name)
        skor_t = s_info["skor"]
        c_val = s_info["c_kpa"]
        phi_val = s_info["phi_deg"]
        gamma_val = s_info["gamma_sat"]
        z_val = s_info["z"]
        exp_val = s_info["is_expansive"]
        ket_t = s_info["ket"]

        # C. Batuan / Geologi (20%)
        geo_name = str(row.get("ket_batuan") or row.get("NAME") or "Merapi Muda")
        g_info = eval_lithology(geo_name)
        skor_b = g_info["skor"]
        ket_b = g_info["ket"]

        # D. Curah Hujan (15%)
        skor_h_raw = int(row.get("skor_hujan") or 3)
        ch_map = {5: 3200.0, 4: 2750.0, 3: 2250.0, 2: 1750.0, 1: 1350.0}
        ch_mm = float(row.get("curah_hujan_mm") or ch_map.get(skor_h_raw, 2250.0))
        h_info = eval_rainfall(ch_mm)
        skor_h = skor_h_raw if 1 <= skor_h_raw <= 5 else h_info["skor"]
        m_val = h_info["rasio_m"]
        ket_h = clean_string_idw(h_info["ket"])

        # E. Tutupan Lahan (10%)
        lahan_name = str(row.get("ket_lahan") or row.get("pl") or "Permukiman")
        lh_info = eval_landuse(lahan_name)
        skor_lh = lh_info["skor"]
        cr_val = lh_info["cr"]
        q_val = lh_info["q"]
        ket_lh = lh_info["ket"]

        # Hitung Skor Akhir Pembobotan GPKG
        skor_akhir = round(
            (skor_l * 0.30) + (skor_t * 0.25) + (skor_b * 0.20) + (skor_h * 0.15) + (skor_lh * 0.10),
            2,
        )
        zona_nama, warna_hex, border_hex = classify_zone(skor_akhir)

        # Hitung Infinite Slope FS
        fs_val, fs_status, u_val = compute_infinite_slope_fs(
            beta_deg=beta_deg,
            c_prime=c_val,
            cr=cr_val,
            phi_deg=phi_val,
            gamma_sat=gamma_val,
            z_m=z_val,
            rasio_m=m_val,
            q_surcharge=q_val,
        )

        out_skor_l.append(skor_l)
        out_ket_l.append(ket_l)
        out_beta.append(beta_deg)
        out_slope_pct.append(slope_pct)
        out_skor_t.append(skor_t)
        out_ket_t.append(ket_t)
        out_c.append(c_val)
        out_phi.append(phi_val)
        out_gamma.append(gamma_val)
        out_z.append(z_val)
        out_exp.append(exp_val)
        out_skor_b.append(skor_b)
        out_ket_b.append(ket_b)
        out_skor_h.append(skor_h)
        out_ket_h.append(ket_h)
        out_ch_mm.append(int(round(ch_mm)))
        out_m.append(m_val)
        out_skor_lh.append(skor_lh)
        out_ket_lh.append(ket_lh)
        out_cr.append(cr_val)
        out_q.append(q_val)
        out_u.append(u_val)
        out_skor_akhir.append(skor_akhir)
        out_zona.append(zona_nama)
        out_warna.append(warna_hex)
        out_border.append(border_hex)
        out_fs.append(fs_val)
        out_fs_stat.append(fs_status)

    gdf_kr["fid"] = np.arange(1, len(gdf_kr) + 1)
    gdf_kr["elevasi_mdpl"] = kr_elevs
    gdf_kr["lereng_derajat"] = out_beta
    gdf_kr["lereng_persen"] = out_slope_pct
    gdf_kr["skor_lereng"] = out_skor_l
    gdf_kr["ket_lereng"] = out_ket_l
    gdf_kr["skor_tanah"] = out_skor_t
    gdf_kr["ket_tanah"] = out_ket_t
    gdf_kr["c_kpa"] = out_c
    gdf_kr["phi_deg"] = out_phi
    gdf_kr["gamma_sat"] = out_gamma
    gdf_kr["z"] = out_z
    gdf_kr["is_expansive"] = out_exp
    gdf_kr["skor_batuan"] = out_skor_b
    gdf_kr["ket_batuan"] = out_ket_b
    gdf_kr["skor_hujan"] = out_skor_h
    gdf_kr["ket_hujan"] = out_ket_h
    gdf_kr["curah_hujan_mm"] = out_ch_mm
    gdf_kr["rasio_m"] = out_m
    gdf_kr["skor_lahan"] = out_skor_lh
    gdf_kr["ket_lahan"] = out_ket_lh
    gdf_kr["cr_kpa"] = out_cr
    gdf_kr["q_kpa"] = out_q
    gdf_kr["u_kpa"] = out_u
    gdf_kr["skor_akhir"] = out_skor_akhir
    gdf_kr["zona_kelayakan"] = out_zona
    gdf_kr["zona_triase"] = out_zona
    gdf_kr["status_zona"] = out_zona
    gdf_kr["warna_hex"] = out_warna
    gdf_kr["border_hex"] = out_border
    gdf_kr["fs"] = out_fs
    gdf_kr["fs_status"] = out_fs_stat
    gdf_kr["luas_ha"] = (gdf_kr.geometry.area / 10000.0).round(2)

    # 4. MEMPROSES LAYER TEMATIK LAINNYA
    print("\n🗺️ 4. Memproses Layer Tematik Tambahan...")
    
    # Layer Kemiringan Lereng
    gdf_lereng = gpd.read_file(raw_lereng)
    if gdf_lereng.crs != UTM_CRS:
        gdf_lereng = gdf_lereng.to_crs(UTM_CRS)
    gdf_lereng["bobot"] = 30
    gdf_lereng["skor"] = gdf_lereng["skor_lereng"]
    gdf_lereng["klasifikasi"] = gdf_lereng["ket_lereng"]
    gdf_lereng["luas_ha"] = (gdf_lereng.geometry.area / 10000.0).round(2)

    # Layer Jenis Tanah
    gdf_tanah = gpd.read_file(raw_tanah)
    if gdf_tanah.crs != UTM_CRS:
        gdf_tanah = gdf_tanah.to_crs(UTM_CRS)
    gdf_tanah["skor_tanah"] = gdf_tanah["skor tanah"]
    gdf_tanah["luas_ha"] = (gdf_tanah.geometry.area / 10000.0).round(2)
    t_infos = gdf_tanah["jns_tnh"].apply(eval_soil)
    gdf_tanah["gamma_sat"] = [ti["gamma_sat"] for ti in t_infos]
    gdf_tanah["z"] = [ti["z"] for ti in t_infos]
    gdf_tanah["is_expansive"] = [ti["is_expansive"] for ti in t_infos]
    gdf_tanah["warna_hex"] = [ti["warna"] for ti in t_infos]

    # Layer Geologi
    gdf_geo = gpd.read_file(raw_geologi)
    if gdf_geo.crs != UTM_CRS:
        gdf_geo = gdf_geo.to_crs(UTM_CRS)
    gdf_geo["luas_ha"] = (gdf_geo.geometry.area / 10000.0).round(2)

    # Layer Curah Hujan
    gdf_hujan = gpd.read_file(raw_hujan)
    if gdf_hujan.crs != UTM_CRS:
        gdf_hujan = gdf_hujan.to_crs(UTM_CRS)
    ch_vals = [ch_map.get(int(s), 2250.0) for s in gdf_hujan["skor_hujan"]]
    gdf_hujan["curah_hujan_mm"] = ch_vals
    gdf_hujan["skor"] = gdf_hujan["skor_hujan"]
    gdf_hujan["klasifikasi"] = gdf_hujan["ket_hujan"].apply(clean_string_idw)
    gdf_hujan["ket_hujan"] = gdf_hujan["klasifikasi"]
    gdf_hujan["nama_daerah_peta"] = [
        f"Zona Isohyet Curah Hujan Skor {s} ({k})" for s, k in zip(gdf_hujan["skor_hujan"], gdf_hujan["klasifikasi"])
    ]
    gdf_hujan["luas_ha"] = (gdf_hujan.geometry.area / 10000.0).round(2)

    # Layer Tutupan Lahan
    gdf_lahan = gpd.read_file(raw_lahan)
    if gdf_lahan.crs != UTM_CRS:
        gdf_lahan = gdf_lahan.to_crs(UTM_CRS)
    gdf_lahan["klasifikasi"] = gdf_lahan["pl"]
    gdf_lahan["skor"] = gdf_lahan["skor_lahan"]
    lh_evals = gdf_lahan["pl"].apply(eval_landuse)
    gdf_lahan["cr_kpa"] = [le["cr"] for le in lh_evals]
    gdf_lahan["q_kpa"] = [le["q"] for le in lh_evals]
    gdf_lahan["warna_hex"] = [le["warna"] for le in lh_evals]
    gdf_lahan["luas_ha"] = (gdf_lahan.geometry.area / 10000.0).round(2)

    # 5. REPROYEKSI KE WGS84 & PEMBULATAN 5 DESIMAL & EKSPOR
    print("\n📦 5. Reproyeksi ke WGS84, optimasi koordinat (5 desimal), dan ekspor...")

    export_layers = [
        ("clean_kerawanan_longsor.geojson", gdf_kr, 3.0),
        ("clean_batas_administrasi.geojson", gdf_adm_diss, 1.5),
        ("clean_kemiringan_lereng_diy.geojson", gdf_lereng, 8.0),
        ("clean_curah_hujan_idw.geojson", gdf_hujan, 2.0),
        ("GJS Layer2_JenisTanah_SlemanBantul.geojson", gdf_tanah, 2.0),
        ("GJS Layer3_Geologi_SlemanBantul.geojson", gdf_geo, 2.0),
        ("clean_tutupan_lahan_sleman_bantul.geojson", gdf_lahan, 4.0),
        ("clean_tutupan_lahan_diy.geojson", gdf_lahan, 4.0),
    ]

    bundle_dict: Dict[str, Any] = {}

    for fname, gdf_item, simp_tol in export_layers:
        print(f"   Mengolah & menulis: {fname} ({len(gdf_item)} fitur, simp_tol={simp_tol}m)...")
        gdf_simplified = gdf_item.copy()
        if simp_tol > 0:
            gdf_simplified["geometry"] = gdf_simplified.geometry.simplify(tolerance=simp_tol, preserve_topology=True)

        gdf_wgs = gdf_simplified.to_crs(WGS84_CRS)
        gj_str = gdf_wgs.to_json()
        gj_obj = json.loads(gj_str)
        gj_obj["crs"] = {
            "type": "name",
            "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"},
        }

        # Optimasi presisi 5 desimal
        for feat in gj_obj.get("features", []):
            if "id" in feat:
                del feat["id"]
            optimize_geojson_geometry(feat.get("geometry"))
            # Bersihkan istilah IDW di semua atribut
            p = feat.get("properties") or {}
            for k in list(p.keys()):
                p[k] = clean_string_idw(p[k])

        # Simpan ke Data/processed/ dan public/data/
        out_proc = PROCESSED_DIR / fname
        out_pub = PUBLIC_DATA_DIR / fname

        with open(out_proc, "w", encoding="utf-8") as f:
            json.dump(gj_obj, f, separators=(",", ":"))
        with open(out_pub, "w", encoding="utf-8") as f:
            json.dump(gj_obj, f, separators=(",", ":"))

        sz_mb = out_pub.stat().st_size / (1024 * 1024)
        print(f"     -> Berhasil disimpan ({sz_mb:.2f} MB)")
        bundle_dict[fname] = gj_obj

    # 6. SINKRONISASI BUNDLE Web/
    print("\n🌐 6. Memperbarui bundle Web/geojson_bundle.js & Web/tutupan_bundle.js ...")
    if WEB_DIR.exists():
        # Tambahkan layer referensi dari bundle lama jika ada
        old_bundle_path = WEB_DIR / "geojson_bundle.js"
        ref_keys = [
            "clean_area_jangkauan_titik.geojson",
            "clean_titik_developer.geojson",
            "clean_pos_hujan.geojson",
            "clean_demnas_diy_utm.geojson",
        ]
        if old_bundle_path.exists():
            try:
                with open(old_bundle_path, "r", encoding="utf-8") as f:
                    old_text = f.read()
                prefix = "window.LAHAN_AMAN_GEOJSON = "
                end_pos = old_text.rfind("};\nwindow.LAHAN_AMAN_META")
                if old_text.startswith(prefix) and end_pos > 0:
                    old_data = json.loads(old_text[len(prefix):end_pos + 1])
                    for rk in ref_keys:
                        if rk in old_data:
                            bundle_dict[rk] = old_data[rk]
                            # Simpan juga ke processed & public
                            with open(PROCESSED_DIR / rk, "w", encoding="utf-8") as f:
                                json.dump(old_data[rk], f, separators=(",", ":"))
                            with open(PUBLIC_DATA_DIR / rk, "w", encoding="utf-8") as f:
                                json.dump(old_data[rk], f, separators=(",", ":"))
            except Exception as e:
                print(f"     [WARN] Gagal membaca ref layer dari bundle lama: {e}")

        # Tulis geojson_bundle.js
        with open(WEB_DIR / "geojson_bundle.js", "w", encoding="utf-8") as f:
            f.write("window.LAHAN_AMAN_GEOJSON = ")
            json.dump(bundle_dict, f, separators=(",", ":"))
            f.write(";\nwindow.LAHAN_AMAN_META = {\"crs_metric\":\"EPSG:32749\",\"crs_web\":\"EPSG:4326\",\"standard\":\"Permen PU No. 22/PRT/M/2007 & SNI 8291:2016\"};\n")

        # Tulis tutupan_bundle.js
        tutupan_obj = bundle_dict.get("clean_tutupan_lahan_sleman_bantul.geojson")
        if tutupan_obj:
            with open(WEB_DIR / "tutupan_bundle.js", "w", encoding="utf-8") as f:
                f.write("window.LAHAN_AMAN_TUTUPAN = ")
                json.dump(tutupan_obj, f, separators=(",", ":"))
                f.write(";\n")

    # 7. UPDATE .vercelignore
    print("\n📝 7. Membuat / memperbarui .vercelignore ...")
    vercel_ignore_path = PROJECT_ROOT / ".vercelignore"
    with open(vercel_ignore_path, "w", encoding="utf-8") as f:
        f.write("Data/\nscripts/\n")
    print("     -> .vercelignore berhasil ditulis (Data/ & scripts/)")

    print("\n" + "=" * 80)
    print("✅ PIPELINE ETL DARI RAW DATA SELESAI DENGAN SUKSES!")
    print(f"   • Folder processed: {PROCESSED_DIR}")
    print(f"   • Folder public:    {PUBLIC_DATA_DIR}")
    print("=" * 80)


if __name__ == "__main__":
    run_pipeline()
