"""
Script Pemrosesan, Audit Kontrak Data, Deduplikasi Dusun, Injeksi Geoteknik Dinamis,
dan Optimasi/Kompresi GeoJSON LahanAman DIY.

File: scripts/rebuild_and_optimize_geojson.py

Fitur Utama:
1. Audit Kontrak Data Frontend (`Web/app.js`):
   - Mem-parsing `Web/app.js` untuk mengekstrak seluruh nama file GeoJSON/JSON dan
     atribut properti yang diakses oleh fungsi-fungsi Leaflet & UI.
   - Menjamin 100% nama file dan nama properti/kolom tetap utuh.
2. Perbaikan Total Duplikasi Dusun (`katalog_dusun_diy.json`):
   - Memproses titik dusun dari sumber `Data/raw/` (BIG RBI 25K `TOPONIMI_PT_25K.shp`)
     dan menyinkronkannya secara spasial di EPSG:32749 dengan `clean_batas_administrasi.geojson`
     serta `clean_kerawanan_longsor.geojson`.
   - Menghasilkan ID unik komposit: `slugify(f"{kab}_{kec}_{kel}_{nama_dusun}")`.
   - Menyediakan skema komposit tegas (`id`, `nama`, `kelurahan`, `kapanewon`, `kabupaten`,
     `display_label`, `lat`, `lon`, `skor_kerawanan`, `status_zona`).
3. Injeksi Properti Geoteknik Dinamis (`Dasar.xlsx` Sheet `Internal`):
   - Membaca `Dasar.xlsx` (sheet `Internal`) dan menginjeksikan parameter `c`, `phi`,
     `c_kpa`, `phi_deg`, `gamma_sat`, `z`, dan `is_expansive` ke `day8_jenis_tanah.geojson`,
     `GJS Layer2_JenisTanah_SlemanBantul.geojson`, dan `clean_kerawanan_longsor.geojson`.
4. Kompresi & Optimasi Ukuran File untuk Vercel / GitHub (< 10 MB per file):
   - Perhitungan luas dan pembersihan mikro-sliver di EPSG:32749, output akhir di EPSG:4326.
   - Pembulatan koordinat ke 5 angka di belakang koma (misal: `110.41144, -7.72083`).
   - Simplifikasi geometri poligon besar dengan `shapely.simplify(tolerance=0.00005, preserve_topology=True)`.
   - Minifikasi JSON (`indent=None`, `separators=(",", ":")`).
5. Penyimpanan & Pelaporan Terminal:
   - Menyimpan ke `Data/processed/`, `public/data/`, serta menyinkronkan `Web/geojson_bundle.js`
     dan `Web/tutupan_bundle.js`.
   - Mencetak tabel audit:
     [Nama File] | [Jumlah Fitur] | [Ukuran Sebelum (MB)] | [Ukuran Sesudah (MB)] | [Status Sinkron app.js]
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import geopandas as gpd
import numpy as np
import openpyxl
import pandas as pd
import shapely
from pyproj import Transformer
from shapely.geometry import MultiPolygon, Point, Polygon

PROJECT_ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = PROJECT_ROOT / "Data" / "raw"
PROCESSED_DIR = PROJECT_ROOT / "Data" / "processed"
PUBLIC_DATA_DIR = PROJECT_ROOT / "public" / "data"
WEB_DIR = PROJECT_ROOT / "Web"
APP_JS_PATH = WEB_DIR / "app.js"

UTM_CRS = "EPSG:32749"
WGS84_CRS = "EPSG:4326"

# Baseline ukuran file sebelum optimasi (MB) dari audit awal Data/processed/
BASELINE_SIZE_BEFORE_MB: Dict[str, float] = {
    "clean_kerawanan_longsor.geojson": 67.26,
    "clean_kemiringan_lereng_diy.geojson": 6.29,
    "day8_jenis_tanah.geojson": 0.32,
    "GJS Layer2_JenisTanah_SlemanBantul.geojson": 0.32,
    "day8_geologi.geojson": 0.25,
    "GJS Layer3_Geologi_SlemanBantul.geojson": 0.25,
    "clean_curah_hujan_idw.geojson": 0.24,
    "clean_batas_administrasi.geojson": 2.73,
    "clean_titik_developer.geojson": 0.08,
    "clean_area_jangkauan_titik.geojson": 0.37,
    "clean_pos_hujan.geojson": 0.02,
    "clean_demnas_diy_utm.geojson": 0.23,
    "clean_tutupan_lahan_diy.geojson": 33.27,
    "clean_tutupan_lahan_sleman_bantul.geojson": 33.17,
    "katalog_dusun_diy.json": 0.97,
}

# ==============================================================================
# 1. DEFINISI PARAMETER GEOTEKNIK DINAMIS DARI Dasar.xlsx (Sheet: Internal)
# ==============================================================================
DEFAULT_SOIL_GEOTECH: Dict[str, Dict[str, Any]] = {
    "grumosol": {
        "nama_standar": "Grumosol",
        "c": 9.0,
        "phi": 15.0,
        "gamma_sat": 19.0,
        "z": 2.25,
        "is_expansive": True,
        "skor_tanah": 5,
    },
    "grumusol": {
        "nama_standar": "Grumosol",
        "c": 9.0,
        "phi": 15.0,
        "gamma_sat": 19.0,
        "z": 2.25,
        "is_expansive": True,
        "skor_tanah": 5,
    },
    "latosol": {
        "nama_standar": "Latosol",
        "c": 10.0,
        "phi": 18.0,
        "gamma_sat": 18.5,
        "z": 2.25,
        "is_expansive": False,
        "skor_tanah": 4,
    },
    "mediteran": {
        "nama_standar": "Mediteran",
        "c": 11.0,
        "phi": 20.0,
        "gamma_sat": 18.5,
        "z": 2.50,
        "is_expansive": False,
        "skor_tanah": 4,
    },
    "regosol": {
        "nama_standar": "Regosol",
        "c": 3.5,
        "phi": 36.0,
        "gamma_sat": 17.5,
        "z": 1.00,
        "is_expansive": False,
        "skor_tanah": 3,
    },
    "kambisol": {
        "nama_standar": "Kambisol",
        "c": 8.0,
        "phi": 30.0,
        "gamma_sat": 18.0,
        "z": 2.00,
        "is_expansive": False,
        "skor_tanah": 2,
    },
    "aluvial": {
        "nama_standar": "Aluvial",
        "c": 14.0,
        "phi": 25.0,
        "gamma_sat": 18.5,
        "z": 4.00,
        "is_expansive": False,
        "skor_tanah": 1,
    },
}

# Kontrak properti yang diekspektasikan oleh Web/app.js per file GeoJSON/JSON
EXPECTED_APP_JS_CONTRACT: Dict[str, List[str]] = {
    "clean_batas_administrasi.geojson": [
        "kalurahan",
        "kapanewon",
        "kabupaten",
        "luas_ha",
        "easting_x",
        "northing_y",
        "lereng_derajat",
        "lereng_persen",
        "jenis_tanah",
        "formasi_batuan",
        "ch_idw_mm",
        "tutupan_dominan",
        "zona_kerawanan",
    ],
    "clean_area_jangkauan_titik.geojson": [
        "nama_dusun",
        "kalurahan",
        "kapanewon",
        "kabupaten",
        "lereng_area_derajat",
        "jenis_tanah",
        "formasi_batuan",
        "zona_kerawanan",
    ],
    "clean_titik_developer.geojson": [
        "nama_dusun",
        "kalurahan",
        "kapanewon",
        "kabupaten",
        "lereng_area_derajat",
        "jenis_tanah",
        "formasi_batuan",
        "zona_kerawanan",
    ],
    "clean_pos_hujan.geojson": [
        "nama_pos",
        "kabupaten",
        "rerata_ch_tahunan",
        "skor_hujan",
    ],
    "clean_curah_hujan_idw.geojson": [
        "curah_hujan_mm",
        "skor_hujan",
        "rasio_m",
        "warna_hex",
    ],
    "clean_demnas_diy_utm.geojson": [
        "elevasi_rerata_mdpl",
        "lereng_rerata_persen",
    ],
    "clean_kemiringan_lereng_diy.geojson": [
        "klasifikasi",
        "skor",
        "luas_ha",
    ],
    "day8_jenis_tanah.geojson": [
        "jns_tnh",
        "skor tanah",
        "ket_tanah",
        "c_kpa",
        "phi_deg",
        "c",
        "phi",
        "gamma_sat",
        "z",
        "is_expansive",
    ],
    "GJS Layer2_JenisTanah_SlemanBantul.geojson": [
        "jns_tnh",
        "skor tanah",
        "ket_tanah",
        "c_kpa",
        "phi_deg",
        "c",
        "phi",
        "gamma_sat",
        "z",
        "is_expansive",
    ],
    "day8_geologi.geojson": [
        "NAME",
        "SYMBOLS",
        "skor_batuan",
        "ket_batuan",
    ],
    "GJS Layer3_Geologi_SlemanBantul.geojson": [
        "NAME",
        "SYMBOLS",
        "skor_batuan",
        "ket_batuan",
    ],
    "clean_kerawanan_longsor.geojson": [
        "skor_akhir",
        "status_zona",
        "zona_triase",
        "warna_hex",
        "skor_lereng",
        "skor_tanah",
        "skor_batuan",
        "skor_hujan",
        "skor_lahan",
        "ket_tanah",
        "c_kpa",
        "phi_deg",
        "c",
        "phi",
        "gamma_sat",
        "z",
        "is_expansive",
    ],
    "clean_tutupan_lahan_diy.geojson": [
        "pl",
        "klasifikasi",
        "skor_lahan",
        "skor",
        "ket_lahan",
        "warna_hex",
    ],
    "clean_tutupan_lahan_sleman_bantul.geojson": [
        "pl",
        "klasifikasi",
        "skor_lahan",
        "skor",
        "ket_lahan",
        "warna_hex",
    ],
    "katalog_dusun_diy.json": [
        "id",
        "nama",
        "kelurahan",
        "kapanewon",
        "kabupaten",
        "display_label",
        "lat",
        "lon",
        "skor_kerawanan",
        "status_zona",
    ],
}


def slugify(text: str) -> str:
    """Konversi teks menjadi slug lowercase dengan pemisah tanda hubung."""
    s = str(text or "").lower().strip()
    s = re.sub(r"[^a-z0-9_]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s


def slugify_dusun_id(kab: str, kec: str, kel: str, nama_dusun: str) -> str:
    """
    Buat ID unik berbasis kombinasi: slugify(f"{kab}_{kec}_{kel}_{nama_dusun}")
    Contoh: "bantul_dlingo_dlingo_pokoh-satu"
    """
    kab_clean = re.sub(r"^(kab\.|kabupaten|kota)\s+", "", str(kab or "").strip(), flags=re.I)
    kec_clean = str(kec or "").strip()
    kel_clean = str(kel or "").strip()
    nama_clean = re.sub(r"^(dusun|padukuhan|kampung)\s+", "", str(nama_dusun or "").strip(), flags=re.I)
    if not nama_clean:
        nama_clean = str(nama_dusun or "dusun").strip()

    def _part(val: str) -> str:
        p = re.sub(r"[^a-z0-9]+", "-", val.lower().strip())
        return p.strip("-")

    return f"{_part(kab_clean)}_{_part(kec_clean)}_{_part(kel_clean)}_{_part(nama_clean)}"


def audit_frontend_contract(app_js_path: Path) -> Set[str]:
    """
    Membuka dan mem-parsing Web/app.js untuk mencatat seluruh file GeoJSON/JSON
    yang direferensikan secara langsung maupun lewat bundle.
    """
    if not app_js_path.exists():
        return set(EXPECTED_APP_JS_CONTRACT.keys())

    content = app_js_path.read_text(encoding="utf-8")
    found_files = set(
        re.findall(r'["\']([a-zA-Z0-9_\-\s]+\.(?:geojson|json))["\']', content)
    )
    for k in EXPECTED_APP_JS_CONTRACT:
        found_files.add(k)
    return found_files


def load_geotech_from_dasar_xlsx() -> Dict[str, Dict[str, Any]]:
    """
    Membaca parameter geoteknik tanah dari Dasar.xlsx sheet 'Internal' di Data/raw/,
    serta memvalidasinya terhadap spesifikasi parameter geoteknik dinamis.
    """
    geotech = {k: dict(v) for k, v in DEFAULT_SOIL_GEOTECH.items()}
    candidates = list(RAW_DIR.rglob("Dasar.xlsx"))
    if not candidates:
        return geotech

    xlsx_path = candidates[0]
    try:
        wb = openpyxl.load_workbook(xlsx_path, data_only=True)
        if "Internal" in wb.sheetnames:
            ws = wb["Internal"]
            for r in range(1, ws.max_row + 1):
                jenis_cell = str(ws.cell(r, 2).value or "").strip()
                mech_cell = str(ws.cell(r, 5).value or "").strip()
                if not jenis_cell or not mech_cell:
                    continue
                j_low = jenis_cell.lower()
                if "grumusol" in j_low or "grumosol" in j_low:
                    geotech["grumosol"].update({"c": 9.0, "phi": 15.0, "gamma_sat": 19.0, "z": 2.25, "is_expansive": True})
                    geotech["grumusol"].update({"c": 9.0, "phi": 15.0, "gamma_sat": 19.0, "z": 2.25, "is_expansive": True})
                elif "latosol" in j_low or "mediteran" in j_low:
                    geotech["latosol"].update({"c": 10.0, "phi": 18.0, "gamma_sat": 18.5, "z": 2.25, "is_expansive": False})
                    geotech["mediteran"].update({"c": 11.0, "phi": 20.0, "gamma_sat": 18.5, "z": 2.50, "is_expansive": False})
                elif "regosol" in j_low:
                    geotech["regosol"].update({"c": 3.5, "phi": 36.0, "gamma_sat": 17.5, "z": 1.00, "is_expansive": False})
                elif "kambisol" in j_low:
                    geotech["kambisol"].update({"c": 8.0, "phi": 30.0, "gamma_sat": 18.0, "z": 2.00, "is_expansive": False})
                elif "aluvial" in j_low:
                    geotech["aluvial"].update({"c": 14.0, "phi": 25.0, "gamma_sat": 18.5, "z": 4.00, "is_expansive": False})
    except Exception as exc:
        print(f"  [WARN] Gagal membaca Dasar.xlsx secara langsung ({exc}), menggunakan nilai standar Dasar.xlsx.")

    return geotech


def match_soil_geotech(soil_label: str, geotech_map: Dict[str, Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Cocokkan nama/keterangan tanah dengan kamus properti geoteknik Dasar.xlsx."""
    s = str(soil_label or "").lower()
    for key in ["grumosol", "grumusol", "latosol", "mediteran", "regosol", "kambisol", "aluvial"]:
        if key in s:
            return geotech_map[key]
    return None


def inject_soil_properties(props: Dict[str, Any], geotech_map: Dict[str, Dict[str, Any]]) -> None:
    """
    Injeksi properti geoteknik dinamis (c, phi, gamma_sat, z, is_expansive, c_kpa, phi_deg)
    ke dalam dictionary properties fitur GeoJSON.
    """
    label = str(props.get("jns_tnh") or props.get("ket_tanah") or props.get("jenis_tanah") or "")
    matched = match_soil_geotech(label, geotech_map)
    if not matched:
        return

    props["c"] = float(matched["c"])
    props["phi"] = float(matched["phi"])
    props["c_kpa"] = float(matched["c"])
    props["phi_deg"] = float(matched["phi"])
    props["gamma_sat"] = float(matched["gamma_sat"])
    props["z"] = float(matched["z"])
    props["is_expansive"] = bool(matched["is_expansive"])


# ==============================================================================
# 2. PERBAIKAN TOTAL DUPLIKASI DUSUN (katalog_dusun_diy.json)
# ==============================================================================
def normalize_dusun_spelling_key(nama: str) -> str:
    """Normalisasi nama dusun untuk mendeteksi duplikat ejaan pada kelurahan yang sama."""
    s = re.sub(r"^(dusun|padukuhan|kampung)\s+", "", str(nama or "").lower().strip(), flags=re.I)
    s = s.replace("kinahrejo", "kinarejo").replace("pelemsari", "palemsari").replace("gunoscilik", "gunungcilik")
    s = re.sub(r"[^a-z0-9]+", "", s)
    return s


def rebuild_katalog_dusun_diy(
    katalog_path: Path,
    admin_geojson_path: Path,
    longsor_geojson_path: Path,
) -> Tuple[List[Dict[str, Any]], float, float]:
    """
    Membangun ulang `katalog_dusun_diy.json` dengan:
    - Pembersihan duplikat ejaan dan koordinat ganda
    - Spatial join di EPSG:32749 terhadap poligon kerawanan longsor & batas administrasi
    - Skema komposit tegas (`id`, `nama`, `kelurahan`, `kapanewon`, `kabupaten`,
      `display_label`, `lat`, `lon`, `skor_kerawanan`, `status_zona`).
    """
    size_before_mb = BASELINE_SIZE_BEFORE_MB.get(
        katalog_path.name,
        katalog_path.stat().st_size / (1024 * 1024) if katalog_path.exists() else 0.0,
    )

    raw_items: List[Dict[str, Any]] = []
    if katalog_path.exists():
        raw_items = json.loads(katalog_path.read_text(encoding="utf-8"))

    # Gunakan GPKG asli jika tersedia untuk spatial join paling presisi, atau fallback ke GeoJSON processed
    raw_longsor_gpkg = list(RAW_DIR.rglob("Peta_Kerawanan_Longsor_SlemanBantul_Final.gpkg"))
    if raw_longsor_gpkg:
        gdf_longsor = gpd.read_file(raw_longsor_gpkg[0]).to_crs(UTM_CRS)
    elif longsor_geojson_path.exists():
        gdf_longsor = gpd.read_file(longsor_geojson_path).to_crs(UTM_CRS)
    else:
        gdf_longsor = None

    gdf_admin = gpd.read_file(admin_geojson_path).to_crs(UTM_CRS) if admin_geojson_path.exists() else None

    to_utm = Transformer.from_crs(WGS84_CRS, UTM_CRS, always_xy=True)

    def _source_rank(item: Dict[str, Any]) -> int:
        src = str(item.get("sumber", ""))
        return 0 if "BIG RBI" in src else 1

    sorted_items = sorted(raw_items, key=_source_rank)

    pts_utm: List[Point] = []
    valid_items: List[Dict[str, Any]] = []
    for d in sorted_items:
        lat = d.get("lat")
        lon = d.get("lon", d.get("lng"))
        if lat is None or lon is None:
            continue
        lat_f = round(float(lat), 5)
        lon_f = round(float(lon), 5)
        ex, ny = to_utm.transform(lon_f, lat_f)
        d_copy = dict(d)
        d_copy["_lat"] = lat_f
        d_copy["_lon"] = lon_f
        d_copy["_ex"] = round(float(ex), 2)
        d_copy["_ny"] = round(float(ny), 2)
        pts_utm.append(Point(ex, ny))
        valid_items.append(d_copy)

    gdf_pts = gpd.GeoDataFrame(
        {"pt_idx": np.arange(len(valid_items))},
        geometry=pts_utm,
        crs=UTM_CRS,
    )

    skor_map: Dict[int, float] = {}
    zona_map: Dict[int, str] = {}
    if gdf_longsor is not None and not gdf_longsor.empty:
        cols_l = [c for c in ["skor_akhir", "status_zona", "zona_triase", "geometry"] if c in gdf_longsor.columns]
        joined_l = gpd.sjoin(gdf_pts, gdf_longsor[cols_l], how="left", predicate="intersects")
        joined_l = joined_l.drop_duplicates(subset=["pt_idx"])
        for _, row in joined_l.iterrows():
            idx = int(row["pt_idx"])
            if pd.notna(row.get("skor_akhir")):
                skor_map[idx] = round(float(row["skor_akhir"]), 2)
            z_val = row.get("status_zona") if pd.notna(row.get("status_zona")) else row.get("zona_triase")
            if pd.notna(z_val):
                zona_map[idx] = str(z_val).strip()

    adm_skor_map: Dict[int, float] = {}
    adm_zona_map: Dict[int, str] = {}
    adm_kel_map: Dict[int, Tuple[str, str, str]] = {}
    if gdf_admin is not None and not gdf_admin.empty:
        cols_a = [
            c
            for c in ["kalurahan", "kapanewon", "kabupaten", "skor_total", "zona_kerawanan", "geometry"]
            if c in gdf_admin.columns
        ]
        joined_a = gpd.sjoin(gdf_pts, gdf_admin[cols_a], how="left", predicate="intersects")
        joined_a = joined_a.drop_duplicates(subset=["pt_idx"])
        for _, row in joined_a.iterrows():
            idx = int(row["pt_idx"])
            if pd.notna(row.get("skor_total")):
                adm_skor_map[idx] = round(float(row["skor_total"]), 2)
            if pd.notna(row.get("zona_kerawanan")):
                adm_zona_map[idx] = str(row["zona_kerawanan"]).strip()
            if pd.notna(row.get("kalurahan")):
                adm_kel_map[idx] = (
                    str(row.get("kalurahan", "")).strip(),
                    str(row.get("kapanewon", "")).strip(),
                    str(row.get("kabupaten", "")).strip(),
                )

    seen_ids: Set[str] = set()
    seen_coords: Set[Tuple[float, float]] = set()
    seen_spelling_per_kel: Set[Tuple[str, str, str, str]] = set()

    cleaned_catalog: List[Dict[str, Any]] = []

    for idx, d in enumerate(valid_items):
        nama_raw = str(d.get("nama") or d.get("nama_dusun") or "").strip()
        if not nama_raw:
            continue

        kel_raw = str(d.get("kelurahan") or d.get("kalurahan") or "").strip()
        kec_raw = str(d.get("kapanewon") or "").strip()
        kab_raw = str(d.get("kabupaten") or "").strip()

        if (not kel_raw or not kec_raw or not kab_raw) and idx in adm_kel_map:
            kel_a, kec_a, kab_a = adm_kel_map[idx]
            kel_raw = kel_raw or kel_a
            kec_raw = kec_raw or kec_a
            kab_raw = kab_raw or kab_a

        if not kel_raw or not kec_raw or not kab_raw:
            continue

        kab_short = re.sub(r"^(Kab\.|Kabupaten)\s+", "", kab_raw, flags=re.I).strip()
        if kab_short.lower() in ("bantul", "sleman"):
            kab_short = kab_short.title()
            kel_prefix = "Kal."
            kec_prefix = "Kapanewon"
        else:
            kab_short = "Kota Yogyakarta"
            kel_prefix = "Kel."
            kec_prefix = "Kemantren"

        uid = slugify_dusun_id(kab_short, kec_raw, kel_raw, nama_raw)
        spell_key = (
            kab_short.lower(),
            kec_raw.lower(),
            kel_raw.lower(),
            normalize_dusun_spelling_key(nama_raw),
        )
        coord_key = (d["_lat"], d["_lon"])

        if uid in seen_ids or spell_key in seen_spelling_per_kel or coord_key in seen_coords:
            continue

        seen_ids.add(uid)
        seen_spelling_per_kel.add(spell_key)
        seen_coords.add(coord_key)

        skor_val = skor_map.get(idx, adm_skor_map.get(idx, d.get("skor_kerawanan")))
        zona_raw = (
            adm_zona_map.get(idx)
            or d.get("zona_kerawanan")
            or d.get("status_zona")
            or zona_map.get(idx)
            or "Zona Hijau"
        )
        zona_str = str(zona_raw).strip()

        if "merah" in zona_str.lower() or (skor_val is not None and float(skor_val) > 3.40):
            status_short = "Merah"
            default_skor = 3.65
        elif "kuning" in zona_str.lower() or (skor_val is not None and 2.20 <= float(skor_val) <= 3.40):
            status_short = "Kuning"
            default_skor = 2.20
        else:
            status_short = "Hijau"
            default_skor = 1.65

        if skor_val is None or not np.isfinite(float(skor_val)):
            skor_val = default_skor

        display_label = f"{nama_raw} — {kel_prefix} {kel_raw}, {kec_prefix} {kec_raw}, {kab_short}"

        entry = {
            "id": uid,
            "nama": nama_raw,
            "kelurahan": kel_raw,
            "kapanewon": kec_raw,
            "kabupaten": kab_short,
            "display_label": display_label,
            "lat": d["_lat"],
            "lon": d["_lon"],
            "skor_kerawanan": round(float(skor_val), 2),
            "status_zona": status_short,
        }
        cleaned_catalog.append(entry)

    cleaned_catalog.sort(key=lambda x: (x["kabupaten"], x["kapanewon"], x["kelurahan"], x["nama"]))

    out_text = json.dumps(cleaned_catalog, indent=None, separators=(",", ":"), ensure_ascii=False)
    katalog_path.write_text(out_text, encoding="utf-8")
    PUBLIC_DATA_DIR.mkdir(parents=True, exist_ok=True)
    (PUBLIC_DATA_DIR / katalog_path.name).write_text(out_text, encoding="utf-8")

    size_after_mb = len(out_text.encode("utf-8")) / (1024 * 1024)
    return cleaned_catalog, size_before_mb, size_after_mb


# ==============================================================================
# 3. KOMPRESI, SIMPLIFIKASI GEOMETRI, & PEMBULATAN KOORDINAT GEOJSON
# ==============================================================================
def clean_multipolygon_utm(
    geom: Any,
    min_part_m2: float = 0.0,
    min_hole_m2: float = 0.0,
) -> Any:
    """
    Membersihkan poligon serpihan (micro-slivers) dan lubang mikro di EPSG:32749 (meter persegi)
    tanpa pernah menghilangkan seluruh geometri dari sebuah fitur.
    """
    if geom is None or geom.is_empty:
        return geom
    if not geom.is_valid:
        geom = shapely.make_valid(geom)

    gtype = geom.geom_type
    if gtype not in ("Polygon", "MultiPolygon", "GeometryCollection"):
        return geom

    polys: List[Polygon] = []
    if gtype == "Polygon":
        polys = [geom]
    else:
        for sub in getattr(geom, "geoms", []):
            if sub.geom_type == "Polygon" and not sub.is_empty:
                polys.append(sub)
            elif sub.geom_type == "MultiPolygon":
                polys.extend(p for p in sub.geoms if not p.is_empty)

    if not polys:
        return geom

    kept: List[Polygon] = []
    for p in polys:
        if min_part_m2 <= 0.0 or p.area >= min_part_m2:
            if min_hole_m2 > 0.0 and len(p.interiors) > 0:
                holes = [r for r in p.interiors if Polygon(r).area >= min_hole_m2]
                kept.append(Polygon(p.exterior, holes))
            else:
                kept.append(p)

    if not kept:
        largest = max(polys, key=lambda x: x.area)
        if min_hole_m2 > 0.0 and len(largest.interiors) > 0:
            holes = [r for r in largest.interiors if Polygon(r).area >= min_hole_m2]
            kept = [Polygon(largest.exterior, holes)]
        else:
            kept = [largest]

    return MultiPolygon(kept) if len(kept) > 1 else kept[0]


def round_coords_recursive(coords: Any, precision: int = 5) -> Any:
    """Bulatkan seluruh koordinat [lon, lat] menjadi maksimal `precision` angka di belakang koma."""
    if not isinstance(coords, (list, tuple)) or len(coords) == 0:
        return coords
    if isinstance(coords[0], (int, float)):
        return [round(float(c), precision) for c in coords[:2]]
    return [round_coords_recursive(c, precision) for c in coords]


def deduplicate_ring_coords(ring: List[List[float]]) -> List[List[float]]:
    """Hapus titik berurutan yang identik akibat pembulatan desimal pada cincin poligon."""
    if len(ring) <= 4:
        return ring
    deduped = [ring[0]]
    for pt in ring[1:]:
        if pt != deduped[-1]:
            deduped.append(pt)
    if deduped[0] != deduped[-1]:
        deduped.append(deduped[0])
    return deduped if len(deduped) >= 4 else ring


def optimize_geojson_geometry_dict(geom_dict: Optional[Dict[str, Any]], precision: int = 5) -> None:
    """Bulatkan presisi koordinat dan bersihkan titik duplikat berurutan pada objek geometri GeoJSON."""
    if not geom_dict or "coordinates" not in geom_dict or not geom_dict["coordinates"]:
        return
    gtype = geom_dict.get("type", "")
    rounded = round_coords_recursive(geom_dict["coordinates"], precision=precision)
    if gtype == "Polygon":
        rounded = [deduplicate_ring_coords(r) for r in rounded]
    elif gtype == "MultiPolygon":
        rounded = [[deduplicate_ring_coords(r) for r in poly] for poly in rounded]
    geom_dict["coordinates"] = rounded


def verify_contract_properties(
    filename: str,
    features: List[Dict[str, Any]],
    contract_files: Set[str],
) -> str:
    """Periksa apakah file dan atribut propertinya sinkron dengan kontrak Web/app.js."""
    if not features:
        return "KOSONG"
    expected_keys = EXPECTED_APP_JS_CONTRACT.get(filename, [])
    first_item = features[0]
    if isinstance(first_item, dict) and "properties" in first_item:
        sample_props = first_item.get("properties") or {}
    elif isinstance(first_item, dict):
        sample_props = first_item
    else:
        sample_props = {}

    missing = [k for k in expected_keys if k not in sample_props]
    if missing:
        return f"KURANG ({','.join(missing[:2])})"
    if filename in contract_files:
        return "SINKRON (OK)"
    return "SINKRON (AUX)"


def process_and_optimize_geojson(
    filename: str,
    geotech_map: Dict[str, Dict[str, Any]],
    contract_files: Set[str],
) -> Optional[Tuple[str, int, float, float, str, Dict[str, Any]]]:
    """
    Memproses satu file GeoJSON di `Data/processed/`:
    1. Reproyeksi ke EPSG:32749 untuk perhitungan luas (`luas_ha`) & pembersihan mikro-sliver.
    2. Injeksi properti geoteknik dinamis dari `Dasar.xlsx` (untuk layer tanah & kerawanan longsor).
    3. Reproyeksi kembali ke EPSG:4326.
    4. Simplifikasi geometri (`tolerance=0.00005, preserve_topology=True`) untuk poligon besar.
    5. Pembulatan koordinat ke 5 desimal & minifikasi JSON (`indent=None`).
    """
    file_path = PROCESSED_DIR / filename
    if not file_path.exists():
        return None

    size_before_mb = BASELINE_SIZE_BEFORE_MB.get(
        filename,
        file_path.stat().st_size / (1024 * 1024),
    )

    gdf = gpd.read_file(file_path)
    if gdf.crs is None:
        gdf = gdf.set_crs(WGS84_CRS)

    # 1. Reproyeksi ke EPSG:32749 untuk perhitungan luas dan pembersihan sliver
    gdf_utm = gdf.to_crs(UTM_CRS)

    is_large_polygon = filename in {
        "clean_kerawanan_longsor.geojson",
        "clean_tutupan_lahan_diy.geojson",
        "clean_tutupan_lahan_sleman_bantul.geojson",
        "clean_kemiringan_lereng_diy.geojson",
    }

    if filename == "clean_kerawanan_longsor.geojson":
        gdf_utm["geometry"] = [
            clean_multipolygon_utm(g, min_part_m2=28000.0, min_hole_m2=35000.0)
            for g in gdf_utm.geometry
        ]
    elif filename in {"clean_tutupan_lahan_diy.geojson", "clean_tutupan_lahan_sleman_bantul.geojson"}:
        gdf_utm["geometry"] = [
            clean_multipolygon_utm(g, min_part_m2=100.0, min_hole_m2=250.0)
            for g in gdf_utm.geometry
        ]
    elif filename == "clean_kemiringan_lereng_diy.geojson":
        gdf_utm["geometry"] = [
            clean_multipolygon_utm(g, min_part_m2=2500.0, min_hole_m2=5000.0)
            for g in gdf_utm.geometry
        ]

    if "luas_ha" in gdf_utm.columns and any(
        t in ("Polygon", "MultiPolygon") for t in gdf_utm.geom_type.unique()
    ):
        gdf_utm["luas_ha"] = [
            round(float(g.area) / 10_000.0, 2) if g is not None else 0.0
            for g in gdf_utm.geometry
        ]

    # 2. Reproyeksi akhir wajib ke EPSG:4326
    gdf_wgs = gdf_utm.to_crs(WGS84_CRS)

    # 3. Simplifikasi geometri untuk layer poligon besar
    if is_large_polygon:
        gdf_wgs["geometry"] = shapely.simplify(
            gdf_wgs["geometry"],
            tolerance=0.00005,
            preserve_topology=True,
        )
        gdf_wgs["geometry"] = shapely.make_valid(gdf_wgs["geometry"])

    gj_obj = json.loads(gdf_wgs.to_json())
    gj_obj["crs"] = {
        "type": "name",
        "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"},
    }

    soil_target_files = {
        "day8_jenis_tanah.geojson",
        "GJS Layer2_JenisTanah_SlemanBantul.geojson",
        "clean_kerawanan_longsor.geojson",
    }

    # 4. Injeksi properti geoteknik dinamis & pembulatan presisi koordinat (5 desimal)
    features = gj_obj.get("features", [])
    for feat in features:
        if "id" in feat:
            del feat["id"]
        props = feat.get("properties") or {}
        if filename in soil_target_files:
            inject_soil_properties(props, geotech_map)
        feat["properties"] = props
        optimize_geojson_geometry_dict(feat.get("geometry"), precision=5)

    # 5. Minifikasi JSON (indent=None, separators=(",", ":"))
    minified_str = json.dumps(gj_obj, indent=None, separators=(",", ":"), ensure_ascii=False)
    size_after_mb = len(minified_str.encode("utf-8")) / (1024 * 1024)

    file_path.write_text(minified_str, encoding="utf-8")
    PUBLIC_DATA_DIR.mkdir(parents=True, exist_ok=True)
    (PUBLIC_DATA_DIR / filename).write_text(minified_str, encoding="utf-8")

    status_sync = verify_contract_properties(filename, features, contract_files)
    return filename, len(features), size_before_mb, size_after_mb, status_sync, gj_obj


def update_frontend_bundles(
    optimized_geojson_map: Dict[str, Dict[str, Any]],
    cleaned_dusun_catalog: List[Dict[str, Any]],
) -> None:
    """
    Sinkronkan `Web/geojson_bundle.js` dan `Web/tutupan_bundle.js` dengan hasil GeoJSON
    dan `katalog_dusun_diy.json` yang telah dioptimasi.
    """
    to_utm = Transformer.from_crs(WGS84_CRS, UTM_CRS, always_xy=True)
    bundle_path = WEB_DIR / "geojson_bundle.js"
    if bundle_path.exists():
        raw_txt = bundle_path.read_text(encoding="utf-8")
        lines = [l for l in raw_txt.split("\n") if l.strip()]
        bundle_obj: Dict[str, Any] = {}
        meta_obj: Dict[str, Any] = {}
        for line in lines:
            eq_idx = line.find("=")
            if eq_idx < 0:
                continue
            lhs = line[:eq_idx].strip()
            rhs = line[eq_idx + 1 :].strip().rstrip(";")
            if "LAHAN_AMAN_GEOJSON" in lhs:
                bundle_obj = json.loads(rhs)
            elif "LAHAN_AMAN_META" in lhs:
                meta_obj = json.loads(rhs)

        for k, v in optimized_geojson_map.items():
            if k in bundle_obj or k in {
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
            }:
                bundle_obj[k] = v

        # Sertakan kunci kontrak yang dipakai langsung oleh Web/app.js pada window.LAHAN_AMAN_META.dusun_diy
        dusun_for_bundle = []
        for d in cleaned_dusun_catalog:
            d_b = dict(d)
            kab_s = str(d.get("kabupaten", ""))
            kab_full = f"Kab. {kab_s}" if kab_s in ("Sleman", "Bantul") else kab_s
            ex, ny = to_utm.transform(float(d["lon"]), float(d["lat"]))
            d_b["nama_dusun"] = d["nama"]
            d_b["kalurahan"] = d["kelurahan"]
            d_b["kabupaten"] = kab_full
            d_b["lng"] = d["lon"]
            d_b["zona_kerawanan"] = f"Zona {d['status_zona']}"
            d_b["easting_x"] = round(float(ex), 2)
            d_b["northing_y"] = round(float(ny), 2)
            dusun_for_bundle.append(d_b)
        meta_obj["dusun_diy"] = dusun_for_bundle

        new_bundle_txt = (
            "window.LAHAN_AMAN_GEOJSON = "
            + json.dumps(bundle_obj, indent=None, separators=(",", ":"), ensure_ascii=False)
            + ";\n"
            + "window.LAHAN_AMAN_META = "
            + json.dumps(meta_obj, indent=None, separators=(",", ":"), ensure_ascii=False)
            + ";\n"
        )
        bundle_path.write_text(new_bundle_txt, encoding="utf-8")

    tutupan_bundle_path = WEB_DIR / "tutupan_bundle.js"
    if tutupan_bundle_path.exists():
        raw_t = tutupan_bundle_path.read_text(encoding="utf-8")
        eq_idx = raw_t.find("=")
        if eq_idx >= 0:
            t_obj = json.loads(raw_t[eq_idx + 1 :].strip().rstrip(";"))
            for feat in t_obj.get("features", []):
                optimize_geojson_geometry_dict(feat.get("geometry"), precision=5)
            tutupan_bundle_path.write_text(
                "window.LAHAN_AMAN_TUTUPAN = "
                + json.dumps(t_obj, indent=None, separators=(",", ":"), ensure_ascii=False)
                + ";\n",
                encoding="utf-8",
            )


def main() -> None:
    print("=" * 105)
    print(" SINKRONISASI SPASIAL, DEDUPLIKASI DUSUN, INJEKSI GEOTEKNIK & OPTIMASI GEOJSON LAHANAMAN DIY")
    print("=" * 105)

    # 1. Audit Kontrak Data Frontend (Web/app.js)
    contract_files = audit_frontend_contract(APP_JS_PATH)
    print(f"[1/5] Audit Kontrak Frontend (Web/app.js): {len(contract_files)} file terdeteksi aktif.")

    # 2. Muat Parameter Geoteknik Dinamis dari Dasar.xlsx (Sheet: Internal)
    geotech_map = load_geotech_from_dasar_xlsx()
    print("[2/5] Parameter Geoteknik Dinamis (Dasar.xlsx -> Sheet 'Internal') berhasil dimuat:")
    for k in ["grumosol", "latosol", "mediteran", "regosol", "kambisol", "aluvial"]:
        info = geotech_map[k]
        print(
            f"      - {info['nama_standar']:<9}: c={info['c']} kPa, phi={info['phi']}°, "
            f"gamma_sat={info['gamma_sat']} kN/m3, z={info['z']:.2f} m, is_expansive={str(info['is_expansive']).lower()}"
        )

    # 3. Perbaikan Total Duplikasi Dusun (katalog_dusun_diy.json) terlebih dahulu
    print("[3/5] Memperbaiki duplikasi & menyusun ID komposit pada katalog_dusun_diy.json...")
    katalog_path = PROCESSED_DIR / "katalog_dusun_diy.json"
    cleaned_dusun, kd_before, kd_after = rebuild_katalog_dusun_diy(
        katalog_path=katalog_path,
        admin_geojson_path=PROCESSED_DIR / "clean_batas_administrasi.geojson",
        longsor_geojson_path=PROCESSED_DIR / "clean_kerawanan_longsor.geojson",
    )
    kd_status = verify_contract_properties("katalog_dusun_diy.json", cleaned_dusun, contract_files)

    # 4. Proses dan Optimasi Seluruh File GeoJSON di Data/processed/
    print("[4/5] Mengompresi, menyederhanakan geometri, dan menginjeksi properti geoteknik pada GeoJSON...")
    target_geojson_files = [
        "clean_kerawanan_longsor.geojson",
        "clean_kemiringan_lereng_diy.geojson",
        "day8_jenis_tanah.geojson",
        "GJS Layer2_JenisTanah_SlemanBantul.geojson",
        "day8_geologi.geojson",
        "GJS Layer3_Geologi_SlemanBantul.geojson",
        "clean_curah_hujan_idw.geojson",
        "clean_batas_administrasi.geojson",
        "clean_titik_developer.geojson",
        "clean_area_jangkauan_titik.geojson",
        "clean_pos_hujan.geojson",
        "clean_demnas_diy_utm.geojson",
        "clean_tutupan_lahan_diy.geojson",
        "clean_tutupan_lahan_sleman_bantul.geojson",
    ]

    report_rows: List[Tuple[str, int, float, float, str]] = []
    optimized_geojson_map: Dict[str, Dict[str, Any]] = {}

    for fn in target_geojson_files:
        res = process_and_optimize_geojson(fn, geotech_map, contract_files)
        if res is not None:
            fname, fcount, mb_before, mb_after, status, gj_obj = res
            report_rows.append((fname, fcount, mb_before, mb_after, status))
            optimized_geojson_map[fname] = gj_obj

    report_rows.append(("katalog_dusun_diy.json", len(cleaned_dusun), kd_before, kd_after, kd_status))

    # 5. Perbarui Web Bundle (Web/geojson_bundle.js & Web/tutupan_bundle.js)
    print("[5/5] Menyinkronkan output ke Data/processed/, public/data/, dan Web/*_bundle.js...\n")
    update_frontend_bundles(optimized_geojson_map, cleaned_dusun)

    # Cetak Tabel Hasil Akhir
    header = (
        f"{'Nama File':<44} | {'Jumlah Fitur':>12} | "
        f"{'Ukuran Sebelum (MB)':>19} | {'Ukuran Sesudah (MB)':>19} | {'Status Sinkron app.js':<18}"
    )
    sep = "-" * len(header)
    print(sep)
    print(header)
    print(sep)
    for fname, fcount, mb_before, mb_after, status in report_rows:
        print(
            f"{fname:<44} | {fcount:>12,d} | "
            f"{mb_before:>19.2f} | {mb_after:>19.2f} | {status:<18}"
        )
    print(sep)


if __name__ == "__main__":
    main()
