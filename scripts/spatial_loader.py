"""
spatial_loader.py
=================
Fungsi pembaca data mentah (ZIP, shapefile RBI, GeoTIFF DEMNAS UTM EPSG:32749,
dan Excel) serta interpolasi IDW (Inverse Distance Weighted) untuk pipeline LahanAman.
"""
import glob
import os
import re
import warnings
import zipfile
from pathlib import Path

import pyproj

# Pastikan PROJ memakai database milik pyproj (mencegah konflik PROJ_LIB dari PostGIS)
_PROJ_DIR = pyproj.datadir.get_data_dir()
os.environ["PROJ_LIB"] = _PROJ_DIR
os.environ["PROJ_DATA"] = _PROJ_DIR

import geopandas as gpd
import numpy as np
import openpyxl
import pandas as pd
import rasterio
from rasterio.crs import CRS
from rasterio.windows import Window
import shapely

# =====================================================================
# KONSTANTA PROYEK
# =====================================================================
PROJECT_ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = PROJECT_ROOT / "Data" / "raw"
EXTRACT_DIR = RAW_DIR / "extracted"
PROCESSED_DIR = PROJECT_ROOT / "Data" / "processed"
DEMNAS_UTM_DIR = EXTRACT_DIR / "Demnas Jogja UTM"

TARGET_CRS = "EPSG:32749"   # WGS 84 / UTM 49S (CRS kerja & metrik geometri presisi)
GEOJSON_CRS = "EPSG:4326"   # WGS 84 Lat/Lng (CRS ekspor GeoJSON akhir agar terbaca langsung oleh Leaflet)

# Nama folder RBI per wilayah -> label kabupaten baku (sama persis dengan Excel)
WILAYAH = {
    "KAB. SLEMAN": "Kab. Sleman",
    "KAB. BANTUL": "Kab. Bantul",
    "KOTA YOGYAKARTA": "Kota Yogyakarta",
}
LABEL_KABUPATEN = tuple(WILAYAH.values())

_ALIAS_KABUPATEN = {
    "sleman": "Kab. Sleman", "kab sleman": "Kab. Sleman", "kabupaten sleman": "Kab. Sleman",
    "bantul": "Kab. Bantul", "kab bantul": "Kab. Bantul", "kabupaten bantul": "Kab. Bantul",
    "kota yogyakarta": "Kota Yogyakarta", "yogyakarta": "Kota Yogyakarta", "kota jogja": "Kota Yogyakarta",
    "kota yogya": "Kota Yogyakarta", "jogja": "Kota Yogyakarta",
}


def normalisasi_kabupaten(nilai):
    """'Sleman' / 'KAB. SLEMAN' / 'Kabupaten Sleman' -> 'Kab. Sleman' (dst)."""
    if nilai is None or (isinstance(nilai, float) and pd.isna(nilai)):
        return None
    kunci = re.sub(r"[^a-z ]", " ", str(nilai).lower())
    kunci = re.sub(r"\s+", " ", kunci).strip()
    if kunci in _ALIAS_KABUPATEN:
        return _ALIAS_KABUPATEN[kunci]
    raise ValueError(f"Label kabupaten tidak dikenal: {nilai!r}")


def kabupaten_dari_path(path):
    """Ambil label kabupaten dari nama folder RBI (bukan substring sembarang)."""
    for part in Path(path).parts:
        if part.upper() in WILAYAH:
            return WILAYAH[part.upper()]
    return None


# =====================================================================
# ZIP
# =====================================================================
def extract_all_zips():
    """Ekstrak semua ZIP di Data/raw (rekursif) yang belum pernah diekstrak."""
    for z_path in sorted(glob.glob(str(RAW_DIR / "**" / "*.zip"), recursive=True)):
        if Path(z_path).resolve().is_relative_to(EXTRACT_DIR.resolve()):
            continue
        target = EXTRACT_DIR / Path(z_path).stem
        if target.exists() and any(target.iterdir()):
            print(f"[ZIP] Lewati (sudah diekstrak): {Path(z_path).name}")
            continue
        with zipfile.ZipFile(z_path, "r") as z:
            z.extractall(target)
        print(f"[ZIP] Selesai diekstrak: {Path(z_path).name}")


# =====================================================================
# VEKTOR
# =====================================================================
def tebak_crs(gdf):
    """Tebak CRS dari rentang koordinat bila file .prj hilang."""
    minx, miny, maxx, maxy = gdf.total_bounds
    if -180 <= minx <= maxx <= 180 and -90 <= miny <= maxy <= 90:
        return "EPSG:4326"
    if 100_000 <= minx <= maxx <= 900_000 and 8_000_000 <= miny <= maxy <= 10_000_000:
        return TARGET_CRS
    raise ValueError(f"CRS tidak bisa ditebak dari bounds {gdf.total_bounds}")


def baca_vektor(path, target_crs=TARGET_CRS):
    """Baca shapefile; bila CRS kosong ditebak dari koordinat; lalu reproyeksi."""
    gdf = gpd.read_file(path)
    if gdf.crs is None and not gdf.empty:
        crs = tebak_crs(gdf)
        warnings.warn(f"{Path(path).name}: file .prj tidak ada, CRS ditebak sebagai {crs}")
        gdf = gdf.set_crs(crs)
    if target_crs is not None and gdf.crs is not None:
        gdf = gdf.to_crs(target_crs)
    return gdf


def cari_folder_rbi():
    """Folder RBI per wilayah: {label_kabupaten: path_folder}."""
    hasil = {}
    for shp in glob.glob(str(EXTRACT_DIR / "**" / "ADMINISTRASIDESA_AR_25K.shp"), recursive=True):
        label = kabupaten_dari_path(shp)
        if label:
            hasil[label] = Path(shp).parent
    return hasil


# =====================================================================
# DEMNAS DIY UTM (EPSG:32749)
# =====================================================================
def cari_demnas_utm_tifs():
    """
    Cari seluruh file GeoTIFF DEMNAS DIY UTM yang sudah diekstrak di
    `Data/raw/extracted/Demnas Jogja UTM` dan pastikan header CRS-nya EPSG:32749.
    """
    tifs = sorted(Path(p) for p in glob.glob(str(DEMNAS_UTM_DIR / "**" / "*.tif"), recursive=True))
    crs_32749 = CRS.from_epsg(32749)
    for tif in tifs:
        try:
            with rasterio.open(tif) as src:
                perlu_update = (src.crs is None or src.crs.to_epsg() != 32749)
            if perlu_update:
                with rasterio.open(tif, "r+") as dst:
                    dst.crs = crs_32749
        except Exception:
            pass
    return tifs


def sampling_demnas_utm(x_arr, y_arr, radius_m=250.0):
    """
    Baca data DEMNAS DIY UTM dalam EPSG:32749 pada koordinat (x_arr, y_arr)
    dan hitung:
      - elevasi_titik_mdpl : elevasi piksel DEMNAS tepat di titik (mdpl)
      - elevasi_area_mdpl  : rerata elevasi dalam radius area jangkauan titik (mdpl)
      - lereng_titik_persen: kemiringan lereng di titik (%)
      - lereng_area_persen : rerata kemiringan lereng dalam area jangkauan titik (%)
      - lereng_area_derajat: rerata kemiringan lereng dalam area jangkauan titik (derajat)
      - tile_demnas        : nama file tile DEMNAS UTM yang mencakup titik
    """
    tifs = cari_demnas_utm_tifs()
    n = len(x_arr)
    elev_titik = np.full(n, np.nan, dtype=float)
    elev_area = np.full(n, np.nan, dtype=float)
    lereng_titik = np.full(n, np.nan, dtype=float)
    lereng_area = np.full(n, np.nan, dtype=float)
    lereng_derajat = np.full(n, np.nan, dtype=float)
    nama_tile = ["-" for _ in range(n)]

    for tif in tifs:
        with rasterio.open(tif) as src:
            b = src.bounds
            res_x, res_y = abs(src.transform.a), abs(src.transform.e)
            half_px = max(int(round(radius_m / max(res_x, res_y))), 2)

            for i, (x, y) in enumerate(zip(x_arr, y_arr)):
                if not np.isnan(elev_titik[i]):
                    continue
                if not (b.left <= x <= b.right and b.bottom <= y <= b.top):
                    continue
                row, col = src.index(x, y)
                r0 = max(row - half_px, 0)
                c0 = max(col - half_px, 0)
                r1 = min(row + half_px + 1, src.height)
                c1 = min(col + half_px + 1, src.width)
                win = Window(c0, r0, c1 - c0, r1 - r0)
                arr = src.read(1, window=win).astype(float)
                if src.nodata is not None and not np.isnan(src.nodata):
                    arr[arr == src.nodata] = np.nan
                if np.isnan(arr).all():
                    continue

                # Gradien kemiringan lereng (dz/dx, dz/dy) dalam meter (EPSG:32749)
                gy, gx = np.gradient(arr, res_y, res_x)
                slope_rad = np.arctan(np.hypot(gx, gy))
                slope_pct = np.hypot(gx, gy) * 100.0
                slope_deg = np.degrees(slope_rad)

                # Mask lingkaran sesuai radius_m
                yy, xx = np.ogrid[r0:r1, c0:c1]
                dist_m = np.hypot((xx - col) * res_x, (yy - row) * res_y)
                mask_radius = (dist_m <= radius_m) & ~np.isnan(arr)

                rc = min(max(row - r0, 0), arr.shape[0] - 1)
                cc = min(max(col - c0, 0), arr.shape[1] - 1)
                val_c = arr[rc, cc]
                slp_c = slope_pct[rc, cc]

                elev_titik[i] = float(val_c if not np.isnan(val_c) else np.nanmean(arr[mask_radius]))
                elev_area[i] = float(np.nanmean(arr[mask_radius]))
                lereng_titik[i] = float(slp_c if not np.isnan(slp_c) else np.nanmean(slope_pct[mask_radius]))
                lereng_area[i] = float(np.nanmean(slope_pct[mask_radius]))
                lereng_derajat[i] = float(np.nanmean(slope_deg[mask_radius]))
                nama_tile[i] = tif.name

    return {
        "elevasi_titik_mdpl": np.round(elev_titik, 2),
        "elevasi_area_mdpl": np.round(elev_area, 2),
        "lereng_titik_persen": np.round(lereng_titik, 2),
        "lereng_area_persen": np.round(lereng_area, 2),
        "lereng_area_derajat": np.round(lereng_derajat, 2),
        "tile_demnas": np.array(nama_tile),
    }


# =====================================================================
# INTERPOLASI IDW (INVERSE DISTANCE WEIGHTED) CURAH HUJAN
# =====================================================================
def interpolasi_idw(x_target, y_target, pos_x, pos_y, pos_ch, power=2.0):
    """
    Hitung nilai curah hujan (mm/thn) menggunakan metode IDW (Inverse Distance Weighted)
    dalam sistem koordinat meter EPSG:32749:
        Z(x, y) = sum(w_i * Z_i) / sum(w_i),  dengan w_i = 1 / d_i^power
    Mendukung input array 1D maupun grid 2D.
    """
    x_arr = np.asarray(x_target, dtype=float)
    y_arr = np.asarray(y_target, dtype=float)
    sx = np.asarray(pos_x, dtype=float)
    sy = np.asarray(pos_y, dtype=float)
    sz = np.asarray(pos_ch, dtype=float)

    dx = x_arr[..., None] - sx
    dy = y_arr[..., None] - sy
    dist = np.hypot(dx, dy)
    dist = np.maximum(dist, 1e-6)
    weights = 1.0 / (dist ** power)
    hasil = np.sum(weights * sz, axis=-1) / np.sum(weights, axis=-1)
    return hasil


def idw_area_jangkauan(poligon_list, pos_x, pos_y, pos_ch, power=2.0, step_m=50.0):
    """
    Hitung curah hujan IDW (rerata, minimum, maksimum) di dalam masing-masing
    poligon area jangkauan titik menggunakan grid titik sampel di dalam poligon.
    """
    rerata_list, min_list, max_list = [], [], []
    for poly in poligon_list:
        minx, miny, maxx, maxy = poly.bounds
        xs = np.arange(minx + step_m / 2.0, maxx, step_m)
        ys = np.arange(miny + step_m / 2.0, maxy, step_m)
        if len(xs) == 0 or len(ys) == 0:
            c = poly.centroid
            val = float(interpolasi_idw([c.x], [c.y], pos_x, pos_y, pos_ch, power=power)[0])
            rerata_list.append(val)
            min_list.append(val)
            max_list.append(val)
            continue
        gx, gy = np.meshgrid(xs, ys)
        pts_x, pts_y = gx.ravel(), gy.ravel()
        mask = shapely.contains_xy(poly, pts_x, pts_y)
        if not np.any(mask):
            c = poly.centroid
            pts_x, pts_y = np.array([c.x]), np.array([c.y])
        else:
            pts_x, pts_y = pts_x[mask], pts_y[mask]
        vals = interpolasi_idw(pts_x, pts_y, pos_x, pos_y, pos_ch, power=power)
        rerata_list.append(float(np.mean(vals)))
        min_list.append(float(np.min(vals)))
        max_list.append(float(np.max(vals)))

    return (
        np.round(rerata_list, 2),
        np.round(min_list, 2),
        np.round(max_list, 2),
    )


# =====================================================================
# EXCEL
# =====================================================================
def cari_excel(kata_kunci):
    files = glob.glob(str(EXTRACT_DIR / "**" / "*.xlsx"), recursive=True)
    files += glob.glob(str(RAW_DIR / "*.xlsx"))
    return sorted({f for f in files
                   if not Path(f).name.startswith("~$")
                   and any(k in f.lower() for k in kata_kunci)})


def baca_tabel_excel(path, sheet, kolom_kunci, pola_kunci, header=2):
    """Baca tabel Excel; hanya baris dengan kode valid (mis. 'MTR-SLM-01')."""
    df = pd.read_excel(path, sheet_name=sheet, header=header, engine="openpyxl")
    df.columns = [str(c).strip() for c in df.columns]
    kunci = df[kolom_kunci].astype(str).str.strip()
    df = df[kunci.str.match(pola_kunci)].copy()
    df[kolom_kunci] = df[kolom_kunci].astype(str).str.strip()
    return df.reset_index(drop=True)


def baca_rumus_excel(path, sheet, kolom_kunci, kolom_rumus, header_row=3):
    """{kode: teks_rumus} dari sebuah kolom (openpyxl data_only=False)."""
    wb = openpyxl.load_workbook(path, data_only=False, read_only=True)
    ws = wb[sheet]
    rows = ws.iter_rows(min_row=header_row, values_only=True)
    header = [str(h).strip() if h is not None else "" for h in next(rows)]
    ik, ir = header.index(kolom_kunci), header.index(kolom_rumus)
    hasil = {}
    for row in rows:
        if row[ik] is not None:
            hasil[str(row[ik]).strip()] = row[ir]
    wb.close()
    return hasil


# =====================================================================
# LOADER FILE JSON BARU (DAY 1 CURAH HUJAN, DAY 3 TANAH/HSPK, DAY 4 BANTUL/RAB)
# =====================================================================
def cari_file_json(kata_kunci):
    """Cari file .json di Data/raw/extracted berdasarkan kata kunci."""
    files = glob.glob(str(EXTRACT_DIR / "**" / "*.json"), recursive=True)
    files += glob.glob(str(RAW_DIR / "**" / "*.json"), recursive=True)
    return sorted({
        Path(f) for f in files
        if any(k.lower() in Path(f).name.lower() for k in kata_kunci)
    })


def baca_json_curah_hujan_day1():
    """
    Baca Day1_Master_Curah_Hujan_UTM49S_dan_Historis_20Tahun_DIY_LahanAman.json
    dari folder FILE JSON CURAH HUJAN, serta koreksi otomatis nilai R24 dan PUH Gumbel
    dari data hujan harian BBWS Serayu Opak (7.670 hari, 2006-2026, tanpa baris Total Kumulatif).
    """
    import json
    kandidat = cari_file_json(["Day1_Master_Curah_Hujan", "Curah_Hujan_UTM49S"])
    if not kandidat:
        return None
    with open(kandidat[0], encoding="utf-8") as f:
        data = json.load(f)
    return perbaiki_json_curah_hujan_day1(data, simpan_ke_disk=True, path_list=kandidat)


_CACHE_STAT_HUJAN_EXCEL = None


def hitung_statistik_hujan_harian_excel():
    """
    Hitung statistik curah hujan tahunan, R24 maksimum harian (2006-2026, N=21 tahun),
    dan Hujan Rencana Metode Gumbel (PUH 2, 5, 10, 25, 50, 100 tahun) langsung dari
    3 file Excel Data Curah Harian BBWS Serayu Opak (7.670 hari murni, menyaring baris
    ringkasan 'Total Kumulatif (2006-2026)' yang sebelumnya mengacaukan PUH Sleman & Bantul).
    """
    global _CACHE_STAT_HUJAN_EXCEL
    if _CACHE_STAT_HUJAN_EXCEL:
        return _CACHE_STAT_HUJAN_EXCEL

    import json
    cache_path = PROCESSED_DIR / "stat_hujan_20pos_cache.json"
    if cache_path.exists():
        try:
            with open(cache_path, encoding="utf-8") as f:
                data_c = json.load(f)
            if len(data_c) >= 20:
                _CACHE_STAT_HUJAN_EXCEL = data_c
                return _CACHE_STAT_HUJAN_EXCEL
        except Exception:
            pass

    YN_21 = 0.5252
    SN_21 = 1.0696
    periode_ulang = [2, 5, 10, 25, 50, 100]
    yt_map = {t: -np.log(-np.log((t - 1.0) / float(t))) for t in periode_ulang}
    kt_map = {t: (yt_map[t] - YN_21) / SN_21 for t in periode_ulang}

    # Pemetaan eksplisit nama kolom stasiun di sheet 'Data Harian 2006-2026' (header=2) ke 20 kode_pos
    peta_kolom_pos = {
        # Kab. Sleman (8 Pos)
        "Kaliurang (mm)": "POS-SLM-01",
        "Bronggang (mm)": "POS-SLM-02",
        "Pakem (mm)": "POS-SLM-03",
        "Cangkringan (mm)": "POS-SLM-04",
        "Ngemplak (mm)": "POS-SLM-05",
        "Tempel (mm)": "POS-SLM-06",
        "Godean (mm)": "POS-SLM-07",
        "Prambanan (mm)": "POS-SLM-08",
        # Kab. Bantul (7 Pos)
        "Pundong (mm)": "POS-BTL-01",
        "Barongan (mm)": "POS-BTL-02",
        "Imogiri (mm)": "POS-BTL-03",
        "Sewon (mm)": "POS-BTL-04",
        "Banguntapan (mm)": "POS-BTL-05",
        "Pandak (mm)": "POS-BTL-06",
        "Pajangan (mm)": "POS-BTL-07",
        # Kota Yogyakarta (5 Pos Utama + 2 Pos Pendukung)
        "Patangpuluhan (mm)": "POS-JGJ-01",
        "Baciro (mm)": "POS-JGJ-02",
        "Muja Muju (mm)": "POS-JGJ-03",
        "Kotagede (mm)": "POS-JGJ-04",
        "Karangwaru (mm)": "POS-JGJ-05",
        "Kemput Jetis (mm)": "POS-JGJ-06",
        "Danurejan (mm)": "POS-JGJ-07",
    }

    nama_bulan = {1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "Mei", 6: "Jun",
                  7: "Jul", 8: "Ags", 9: "Sep", 10: "Okt", 11: "Nov", 12: "Des"}

    files = cari_excel(["curah_hujan_harian", "bbws_so_2006_2026"])
    hasil_pos = {}
    for fpath in files:
        try:
            df = pd.read_excel(fpath, sheet_name="Data Harian 2006-2026", header=2, engine="openpyxl")
        except Exception:
            continue
        df.columns = [str(c).strip() for c in df.columns]
        if "Tanggal" not in df.columns or "Tahun" not in df.columns:
            continue
        # Saring hanya baris tanggal harian valid YYYY-MM-DD (buang baris Total Kumulatif)
        mask_tgl = df["Tanggal"].astype(str).str.strip().str.match(r"^\d{4}-\d{2}-\d{2}")
        df_valid = df[mask_tgl].copy()
        df_valid["Tahun"] = pd.to_numeric(df_valid["Tahun"], errors="coerce").astype(int)
        df_valid["Bulan"] = pd.to_numeric(df_valid.get("Bulan", 1), errors="coerce").fillna(1).astype(int)

        for col, kode_pos in peta_kolom_pos.items():
            if col not in df_valid.columns or kode_pos in hasil_pos:
                continue
            df_valid[col] = pd.to_numeric(df_valid[col], errors="coerce").fillna(0.0)
            grp = df_valid.groupby("Tahun")[col]
            ann_sum = grp.sum()
            ann_r24 = grp.max()

            ch_mean = float(ann_sum.mean())
            ch_min = float(ann_sum.min())
            ch_max = float(ann_sum.max())
            thn_kering = int(ann_sum.idxmin())
            thn_basah = int(ann_sum.idxmax())

            r24_mean = float(ann_r24.mean())
            r24_max_abs = float(ann_r24.max())
            r24_sd = float(ann_r24.std(ddof=1))

            # Profil bulanan rerata (mm/bulan) tanpa baris Total Kumulatif
            bul_sum = df_valid.groupby(["Tahun", "Bulan"])[col].sum().unstack(fill_value=0.0)
            profil_bulanan = {
                nama_bulan[m]: round(float(bul_sum[m].mean()), 2) if m in bul_sum.columns else 0.0
                for m in range(1, 13)
            }

            puh_dict = {
                f"PUH_{t}_thn": round(r24_mean + kt_map[t] * r24_sd, 2)
                for t in periode_ulang
            }
            hasil_pos[kode_pos] = {
                "rerata_ch_tahunan_mm": round(ch_mean, 2),
                "ch_tahunan_min_mm": round(ch_min, 2),
                "ch_tahunan_max_mm": round(ch_max, 2),
                "tahun_kering_ekstrem": thn_kering,
                "tahun_basah_ekstrem": thn_basah,
                "r24_maks_rerata_mm": round(r24_mean, 2),
                "r24_maks_harian_rerata_mm": round(r24_mean, 2),
                "r24_maks_absolut_2006_2026_mm": round(r24_max_abs, 2),
                "r24_maks_harian_absolut_mm": round(r24_max_abs, 2),
                "r24_sd_mm": round(r24_sd, 2),
                "standar_deviasi_r24_mm": round(r24_sd, 2),
                "profil_bulanan_rerata_mm": profil_bulanan,
                "hujan_rencana_gumbel_mm_hari": puh_dict,
                "sumber_data_hujan": "Data Harian 20 Pos Hujan BBWS Serayu Opak & BMKG DIY (2006-2026, N=21 Tahun / 7.670 Hari)",
            }

    if hasil_pos:
        _CACHE_STAT_HUJAN_EXCEL = hasil_pos
        try:
            PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(hasil_pos, f, ensure_ascii=False, indent=2)
        except Exception:
            pass
    return hasil_pos


def perbaiki_json_curah_hujan_day1(data, simpan_ke_disk=False, path_list=None):
    """
    Perbaiki struktur JSON Master Curah Hujan (Day 1) bila ditemukan nilai PUH ekstrem
    tidak wajar (> 1.000 mm) akibat baris Total Kumulatif pada pos Sleman & Bantul.
    """
    import json
    if not data:
        return data
    stat_excel = hitung_statistik_hujan_harian_excel()
    if not stat_excel:
        return data

    perlu_simpan = False
    pos_list = data.get("jaringan_20_pos_hujan_utm49s_dan_historis_21_tahun", [])
    pos_xy_list = []
    for p in pos_list:
        kode = str(p.get("kode_pos", "")).strip()
        st_lama = p.get("statistik_ekstrem_dan_puh", {})
        g_lama = st_lama.get("hujan_rencana_gumbel_mm_hari", {})
        if (
            float(g_lama.get("PUH_10_thn", 0.0)) > 1000.0
            or float(st_lama.get("r24_maks_harian_rerata_mm", 0.0)) <= 0.0
            or "ch_tahunan_min_mm" not in st_lama
        ):
            perlu_simpan = True
        if kode in stat_excel:
            s_baru = stat_excel[kode]
            p["rerata_ch_tahunan_2006_2026_mm"] = s_baru["rerata_ch_tahunan_mm"]
            st_lama.update({
                "ch_tahunan_min_mm": s_baru["ch_tahunan_min_mm"],
                "tahun_kering_ekstrem": s_baru["tahun_kering_ekstrem"],
                "ch_tahunan_max_mm": s_baru["ch_tahunan_max_mm"],
                "tahun_basah_ekstrem": s_baru["tahun_basah_ekstrem"],
                "r24_maks_rerata_mm": s_baru["r24_maks_rerata_mm"],
                "r24_maks_harian_rerata_mm": s_baru["r24_maks_harian_rerata_mm"],
                "r24_maks_absolut_2006_2026_mm": s_baru["r24_maks_absolut_2006_2026_mm"],
                "r24_maks_harian_absolut_mm": s_baru["r24_maks_harian_absolut_mm"],
                "r24_sd_mm": s_baru["r24_sd_mm"],
                "standar_deviasi_r24_mm": s_baru["standar_deviasi_r24_mm"],
                "profil_bulanan_rerata_mm": s_baru["profil_bulanan_rerata_mm"],
                "hujan_rencana_gumbel_mm_hari": s_baru["hujan_rencana_gumbel_mm_hari"],
            })
            p["statistik_ekstrem_dan_puh"] = st_lama
        st_now = p.get("statistik_ekstrem_dan_puh", {})
        g_now = st_now.get("hujan_rencana_gumbel_mm_hari", {})
        pos_xy_list.append({
            "kode_pos": kode,
            "x": float(p["utm_easting_x_m"]),
            "y": float(p["utm_northing_y_m"]),
            "ch": float(p["rerata_ch_tahunan_2006_2026_mm"]),
            "r24": float(st_now.get("r24_maks_harian_rerata_mm", st_now.get("r24_maks_rerata_mm", 100.0))),
            "puh2": float(g_now.get("PUH_2_thn", 95.0)),
            "puh5": float(g_now.get("PUH_5_thn", 120.0)),
            "puh10": float(g_now.get("PUH_10_thn", 135.0)),
            "puh25": float(g_now.get("PUH_25_thn", 155.0)),
            "puh50": float(g_now.get("PUH_50_thn", 170.0)),
            "puh100": float(g_now.get("PUH_100_thn", 185.0)),
        })

    if pos_xy_list:
        sx = np.array([d["x"] for d in pos_xy_list])
        sy = np.array([d["y"] for d in pos_xy_list])
        sr24 = np.array([d["r24"] for d in pos_xy_list])
        spuh10 = np.array([d["puh10"] for d in pos_xy_list])
        spuh2 = np.array([d["puh2"] for d in pos_xy_list])
        spuh5 = np.array([d["puh5"] for d in pos_xy_list])
        spuh25 = np.array([d["puh25"] for d in pos_xy_list])
        spuh50 = np.array([d["puh50"] for d in pos_xy_list])
        spuh100 = np.array([d["puh100"] for d in pos_xy_list])

        # Perbaiki matriks 48 kecamatan
        for kec_item in data.get("matriks_irisan_48_kecamatan_terhadap_daerah_idw_utm49s", []):
            kx = float(kec_item.get("centroid_utm_easting_x_m", 430000.0))
            ky = float(kec_item.get("centroid_utm_northing_y_m", 9135000.0))
            r24_val = float(interpolasi_idw([kx], [ky], sx, sy, sr24)[0])
            kec_item["r24_maks_harian_rerata_mm"] = round(r24_val, 2)
            kec_item["hujan_rencana_gumbel_mm_hari"] = {
                "PUH_2_thn": round(float(interpolasi_idw([kx], [ky], sx, sy, spuh2)[0]), 2),
                "PUH_5_thn": round(float(interpolasi_idw([kx], [ky], sx, sy, spuh5)[0]), 2),
                "PUH_10_thn": round(float(interpolasi_idw([kx], [ky], sx, sy, spuh10)[0]), 2),
                "PUH_25_thn": round(float(interpolasi_idw([kx], [ky], sx, sy, spuh25)[0]), 2),
                "PUH_50_thn": round(float(interpolasi_idw([kx], [ky], sx, sy, spuh50)[0]), 2),
                "PUH_100_thn": round(float(interpolasi_idw([kx], [ky], sx, sy, spuh100)[0]), 2),
            }

        # Perbaiki lookup 30 titik developer
        for dev_item in data.get("lookup_cepat_30_titik_developer_day2_utm49s", []):
            dx = float(dev_item.get("utm_easting_x_m", 430000.0))
            dy = float(dev_item.get("utm_northing_y_m", 9135000.0))
            dev_item["r24_maks_interpolasi_idw_mm"] = round(float(interpolasi_idw([dx], [dy], sx, sy, sr24)[0]), 2)
            dev_item["hujan_rencana_puh10_gumbel_mm"] = round(float(interpolasi_idw([dx], [dy], sx, sy, spuh10)[0]), 2)
            dev_item["hujan_rencana_puh25_gumbel_mm"] = round(float(interpolasi_idw([dx], [dy], sx, sy, spuh25)[0]), 2)
            dev_item["hujan_rencana_puh100_gumbel_mm"] = round(float(interpolasi_idw([dx], [dy], sx, sy, spuh100)[0]), 2)

    if simpan_ke_disk and perlu_simpan and path_list:
        for p_json in path_list:
            try:
                with open(p_json, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                print(f"  -> [JSON FIX] Nilai R24 & PUH Gumbel diperbaiki pada: {p_json.name}")
            except Exception:
                pass
    return data


# =====================================================================
# PETA RESMI 206 KALURAHAN/KELURAHAN & 48 KAPANEWON/KEMANTREN DIY
# (86 Kab. Sleman + 75 Kab. Bantul + 45 Kota Yogyakarta = 206 Wilayah)
# =====================================================================
PETA_RESMI_KALURAHAN_DIY = {
    "Kab. Sleman": {
        # 1. Moyudan (4)
        "Sumberagung": ("Moyudan", "Sumberagung"),
        "Sumberarum": ("Moyudan", "Sumberarum"),
        "Sumberrahayu": ("Moyudan", "Sumberrahayu"),
        "Sumbersari": ("Moyudan", "Sumbersari"),
        # 2. Minggir (5)
        "Sendangagung": ("Minggir", "Sendangagung"),
        "Sendangarum": ("Minggir", "Sendangarum"),
        "Sendangmulyo": ("Minggir", "Sendangmulyo"),
        "Sendangrejo": ("Minggir", "Sendangrejo"),
        "Sendangsari": ("Minggir", "Sendangsari"),
        # 3. Seyegan (5)
        "Margodadi": ("Seyegan", "Margodadi"),
        "Margokaton": ("Seyegan", "Margokaton"),
        "Margoluwih": ("Seyegan", "Margoluwih"),
        "Margomulyo": ("Seyegan", "Margomulyo"),
        "Margoagung": ("Seyegan", "Margoagung"),
        # 4. Godean (7)
        "Sidoagung": ("Godean", "Sidoagung"),
        "Sidoarum": ("Godean", "Sidoarum"),
        "Sidokarto": ("Godean", "Sidokarto"),
        "Sidoluhur": ("Godean", "Sidoluhur"),
        "Sidomoyo": ("Godean", "Sidomoyo"),
        "Sidomulyo": ("Godean", "Sidomulyo"),
        "Sidorejo": ("Godean", "Sidorejo"),
        # 5. Gamping (5)
        "Ambarketawang": ("Gamping", "Ambarketawang"),
        "Balecatur": ("Gamping", "Balecatur"),
        "Banyuraden": ("Gamping", "Banyuraden"),
        "Nogotirto": ("Gamping", "Nogotirto"),
        "Trihanggo": ("Gamping", "Trihanggo"),
        # 6. Mlati (5)
        "Sendangadi": ("Mlati", "Sendangadi"),
        "Sinduadi": ("Mlati", "Sinduadi"),
        "Sumberadi": ("Mlati", "Sumberadi"),
        "Tirtoadi": ("Mlati", "Tirtoadi"),
        "Tlogoadi": ("Mlati", "Tlogoadi"),
        # 7. Depok (3)
        "Caturtunggal": ("Depok", "Caturtunggal"),
        "Condongcatur": ("Depok", "Condongcatur"),
        "Maguwoharjo": ("Depok", "Maguwoharjo"),
        # 8. Berbah (4)
        "Jogotirto": ("Berbah", "Jogotirto"),
        "Kalitirto": ("Berbah", "Kalitirto"),
        "Sendangtirto": ("Berbah", "Sendangtirto"),
        "Tegaltirto": ("Berbah", "Tegaltirto"),
        # 9. Prambanan (6)
        "Bokoharjo": ("Prambanan", "Bokoharjo"),
        "Gayamharjo": ("Prambanan", "Gayamharjo"),
        "Madurejo": ("Prambanan", "Madurejo"),
        "Sambirejo": ("Prambanan", "Sambirejo"),
        "Sumberharjo": ("Prambanan", "Sumberharjo"),
        "Wukirharjo": ("Prambanan", "Wukirharjo"),
        # 10. Kalasan (4)
        "Purwomartani": ("Kalasan", "Purwomartani"),
        "Selomartani": ("Kalasan", "Selomartani"),
        "Tamanmartani": ("Kalasan", "Tamanmartani"),
        "Tirtomartani": ("Kalasan", "Tirtomartani"),
        # 11. Ngemplak (5)
        "Bimomartani": ("Ngemplak", "Bimomartani"),
        "Sindumartani": ("Ngemplak", "Sindumartani"),
        "Umbulmartani": ("Ngemplak", "Umbulmartani"),
        "Wedomartani": ("Ngemplak", "Wedomartani"),
        "Widodomartani": ("Ngemplak", "Widodomartani"),
        # 12. Ngaglik (6)
        "Donoharjo": ("Ngaglik", "Donoharjo"),
        "Minomartani": ("Ngaglik", "Minomartani"),
        "Sardonoharjo": ("Ngaglik", "Sardonoharjo"),
        "Sariharjo": ("Ngaglik", "Sariharjo"),
        "Sinduharjo": ("Ngaglik", "Sinduharjo"),
        "Sukoharjo": ("Ngaglik", "Sukoharjo"),
        # 13. Sleman (5)
        "Caturharjo": ("Sleman", "Caturharjo"),
        "Pandowoharjo": ("Sleman", "Pandowoharjo"),
        "Tridadi": ("Sleman", "Tridadi"),
        "Trimulyo": ("Sleman", "Trimulyo"),
        "Triharjo": ("Sleman", "Triharjo"),
        # 14. Tempel (8)
        "Banyurejo": ("Tempel", "Banyurejo"),
        "Lumbungrejo": ("Tempel", "Lumbungrejo"),
        "Margorejo": ("Tempel", "Margorejo"),
        "Merdikorejo": ("Tempel", "Merdikorejo"),
        "Mororejo": ("Tempel", "Mororejo"),
        "Pondokrejo": ("Tempel", "Pondokrejo"),
        "Sumberejo": ("Tempel", "Sumberejo"),
        "Sumberrejo": ("Tempel", "Sumberejo"),
        "Tambakrejo": ("Tempel", "Tambakrejo"),
        # 15. Turi (4)
        "Bangunkerto": ("Turi", "Bangunkerto"),
        "Donokerto": ("Turi", "Donokerto"),
        "Girikerto": ("Turi", "Girikerto"),
        "Wonokerto": ("Turi", "Wonokerto"),
        # 16. Pakem (5)
        "Candibinangun": ("Pakem", "Candibinangun"),
        "Hargobinangun": ("Pakem", "Hargobinangun"),
        "Harjobinangun": ("Pakem", "Harjobinangun"),
        "Pakembinangun": ("Pakem", "Pakembinangun"),
        "Purwobinangun": ("Pakem", "Purwobinangun"),
        # 17. Cangkringan (5)
        "Argomulyo": ("Cangkringan", "Argomulyo"),
        "Glagaharjo": ("Cangkringan", "Glagaharjo"),
        "Kepuharjo": ("Cangkringan", "Kepuharjo"),
        "Umbulharjo": ("Cangkringan", "Umbulharjo"),
        "Wukirsari": ("Cangkringan", "Wukirsari"),
    },
    "Kab. Bantul": {
        # 1. Srandakan (2)
        "Poncosari": ("Srandakan", "Poncosari"),
        "Trimurti": ("Srandakan", "Trimurti"),
        # 2. Sanden (4)
        "Gadingharjo": ("Sanden", "Gadingharjo"),
        "Gadingsari": ("Sanden", "Gadingsari"),
        "Murtigading": ("Sanden", "Murtigading"),
        "Srigading": ("Sanden", "Srigading"),
        # 3. Kretek (5)
        "Donotirto": ("Kretek", "Donotirto"),
        "Parangtritis": ("Kretek", "Parangtritis"),
        "Tirtohargo": ("Kretek", "Tirtohargo"),
        "Tirtomulyo": ("Kretek", "Tirtomulyo"),
        "Tirtosari": ("Kretek", "Tirtosari"),
        # 4. Pundong (3)
        "Panjangrejo": ("Pundong", "Panjangrejo"),
        "Seloharjo": ("Pundong", "Seloharjo"),
        "Srihardono": ("Pundong", "Srihardono"),
        # 5. Bambanglipuro (3)
        "Mulyodadi": ("Bambanglipuro", "Mulyodadi"),
        "Sidomulyo": ("Bambanglipuro", "Sidomulyo"),
        "Sumbermulyo": ("Bambanglipuro", "Sumbermulyo"),
        # 6. Pandak (4)
        "Caturharjo": ("Pandak", "Caturharjo"),
        "Gilangharjo": ("Pandak", "Gilangharjo"),
        "Triharjo": ("Pandak", "Triharjo"),
        "Wijirejo": ("Pandak", "Wijirejo"),
        "Wijirero": ("Pandak", "Wijirejo"),
        # 7. Pajangan (3)
        "Guwosari": ("Pajangan", "Guwosari"),
        "Sendadangsari": ("Pajangan", "Sendangsari"),
        "Sendangsari": ("Pajangan", "Sendangsari"),
        "Triwidadi": ("Pajangan", "Triwidadi"),
        # 8. Bantul (5)
        "Bantul": ("Bantul", "Bantul"),
        "Palbapang": ("Bantul", "Palbapang"),
        "Ringinharjo": ("Bantul", "Ringinharjo"),
        "Sabdodadi": ("Bantul", "Sabdodadi"),
        "Trirenggo": ("Bantul", "Trirenggo"),
        # 9. Jetis (4)
        "Canden": ("Jetis", "Canden"),
        "Patalan": ("Jetis", "Patalan"),
        "Sumberagung": ("Jetis", "Sumberagung"),
        "Trimulyo": ("Jetis", "Trimulyo"),
        # 10. Imogiri (8)
        "Girirejo": ("Imogiri", "Girirejo"),
        "Imogiri": ("Imogiri", "Imogiri"),
        "Karangtalun": ("Imogiri", "Karangtalun"),
        "Karangtengah": ("Imogiri", "Karangtengah"),
        "Kebonagung": ("Imogiri", "Kebonagung"),
        "Selopamioro": ("Imogiri", "Selopamioro"),
        "Sriharjo": ("Imogiri", "Sriharjo"),
        "Wukirsari": ("Imogiri", "Wukirsari"),
        # 11. Dlingo (6)
        "Dlingo": ("Dlingo", "Dlingo"),
        "Jatimulyo": ("Dlingo", "Jatimulyo"),
        "Mangunan": ("Dlingo", "Mangunan"),
        "Muntuk": ("Dlingo", "Muntuk"),
        "Temuwuh": ("Dlingo", "Temuwuh"),
        "Terong": ("Dlingo", "Terong"),
        # 12. Banguntapan (8)
        "Banguntapan": ("Banguntapan", "Banguntapan"),
        "Baturetno": ("Banguntapan", "Baturetno"),
        "Jagalan": ("Banguntapan", "Jagalan"),
        "Jambidan": ("Banguntapan", "Jambidan"),
        "Potorono": ("Banguntapan", "Potorono"),
        "Singosaren": ("Banguntapan", "Singosaren"),
        "Tamanan": ("Banguntapan", "Tamanan"),
        "Wirokerten": ("Banguntapan", "Wirokerten"),
        # 13. Pleret (5)
        "Bawuran": ("Pleret", "Bawuran"),
        "Pleret": ("Pleret", "Pleret"),
        "Segoroyoso": ("Pleret", "Segoroyoso"),
        "Sogoroyoso": ("Pleret", "Segoroyoso"),
        "Wonokromo": ("Pleret", "Wonokromo"),
        "Wonolelo": ("Pleret", "Wonolelo"),
        # 14. Piyungan (3)
        "Sitimulyo": ("Piyungan", "Sitimulyo"),
        "Srimartani": ("Piyungan", "Srimartani"),
        "Srimulyo": ("Piyungan", "Srimulyo"),
        # 15. Sewon (4)
        "Bangunharjo": ("Sewon", "Bangunharjo"),
        "Panggungharjo": ("Sewon", "Panggungharjo"),
        "Ranggungharjo": ("Sewon", "Panggungharjo"),
        "Pendowoharjo": ("Sewon", "Pendowoharjo"),
        "Rendowoharjo": ("Sewon", "Pendowoharjo"),
        "Timbulharjo": ("Sewon", "Timbulharjo"),
        # 16. Kasihan (4)
        "Bangunjiwo": ("Kasihan", "Bangunjiwo"),
        "Ngestiharjo": ("Kasihan", "Ngestiharjo"),
        "Tamantirto": ("Kasihan", "Tamantirto"),
        "Tirtonirmolo": ("Kasihan", "Tirtonirmolo"),
        # 17. Sedayu (4)
        "Argodadi": ("Sedayu", "Argodadi"),
        "Argomulyo": ("Sedayu", "Argomulyo"),
        "Argorejo": ("Sedayu", "Argorejo"),
        "Argosari": ("Sedayu", "Argosari"),
    },
    "Kota Yogyakarta": {
        # 1. Mantrijeron (3)
        "Gedongkiwo": ("Mantrijeron", "Gedongkiwo"),
        "Mantrijeron": ("Mantrijeron", "Mantrijeron"),
        "Mantrijero": ("Mantrijeron", "Mantrijeron"),
        "Suryodiningratan": ("Mantrijeron", "Suryodiningratan"),
        "Suryodiningrata": ("Mantrijeron", "Suryodiningratan"),
        # 2. Kraton (3)
        "Kadipaten": ("Kraton", "Kadipaten"),
        "Kadiraten": ("Kraton", "Kadipaten"),
        "Panembahan": ("Kraton", "Panembahan"),
        "Ranembahan": ("Kraton", "Panembahan"),
        "Patehan": ("Kraton", "Patehan"),
        "Ratehan": ("Kraton", "Patehan"),
        # 3. Mergangsan (3)
        "Brontokusuman": ("Mergangsan", "Brontokusuman"),
        "Keparakan": ("Mergangsan", "Keparakan"),
        "0": ("Mergangsan", "Keparakan"),
        "Wirogunan": ("Mergangsan", "Wirogunan"),
        # 4. Umbulharjo (7)
        "Giwangan": ("Umbulharjo", "Giwangan"),
        "Mujamuju": ("Umbulharjo", "Mujamuju"),
        "Pandeyan": ("Umbulharjo", "Pandeyan"),
        "Semaki": ("Umbulharjo", "Semaki"),
        "Smaki": ("Umbulharjo", "Semaki"),
        "Sorosutan": ("Umbulharjo", "Sorosutan"),
        "Surosutan": ("Umbulharjo", "Sorosutan"),
        "Tahunan": ("Umbulharjo", "Tahunan"),
        "Warungboto": ("Umbulharjo", "Warungboto"),
        "Wapungboto": ("Umbulharjo", "Warungboto"),
        # 5. Kotagede (3)
        "Prenggan": ("Kotagede", "Prenggan"),
        "Purbayan": ("Kotagede", "Purbayan"),
        "Rejowinangun": ("Kotagede", "Rejowinangun"),
        # 6. Gondokusuman (5)
        "Baciro": ("Gondokusuman", "Baciro"),
        "Demangan": ("Gondokusuman", "Demangan"),
        "Klitren": ("Gondokusuman", "Klitren"),
        "Kotabaru": ("Gondokusuman", "Kotabaru"),
        "Terban": ("Gondokusuman", "Terban"),
        # 7. Danurejan (3)
        "Bausasran": ("Danurejan", "Bausasran"),
        "Suryatmajan": ("Danurejan", "Suryatmajan"),
        "Tegalpanggung": ("Danurejan", "Tegalpanggung"),
        "Tegalranggung": ("Danurejan", "Tegalpanggung"),
        # 8. Pakualaman (2)
        "Gunungketur": ("Pakualaman", "Gunungketur"),
        "Surokarsan": ("Pakualaman", "Gunungketur"),
        "Purwokinanti": ("Pakualaman", "Purwokinanti"),
        "Kepatihan": ("Pakualaman", "Purwokinanti"),
        # 9. Gondomanan (2)
        "Ngupasan": ("Gondomanan", "Ngupasan"),
        "Ngurasan": ("Gondomanan", "Ngupasan"),
        "Prawirodirjan": ("Gondomanan", "Prawirodirjan"),
        # 10. Ngampilan (2)
        "Ngampilan": ("Ngampilan", "Ngampilan"),
        "Ngamprilan": ("Ngampilan", "Ngampilan"),
        "Notoprajan": ("Ngampilan", "Notoprajan"),
        "Notorrajan": ("Ngampilan", "Notoprajan"),
        # 11. Wirobrajan (3)
        "Pakuncen": ("Wirobrajan", "Pakuncen"),
        "Patangpuluhan": ("Wirobrajan", "Patangpuluhan"),
        "Ratangruluhan": ("Wirobrajan", "Patangpuluhan"),
        "Wirobrajan": ("Wirobrajan", "Wirobrajan"),
        # 12. Gedongtengen (2)
        "Pringgokusuman": ("Gedongtengen", "Pringgokusuman"),
        "Ringgokusuman": ("Gedongtengen", "Pringgokusuman"),
        "Sosromenduran": ("Gedongtengen", "Sosromenduran"),
        # 13. Jetis (3)
        "Bumijo": ("Jetis", "Bumijo"),
        "Cokrodiningratan": ("Jetis", "Cokrodiningratan"),
        "Gowongan": ("Jetis", "Gowongan"),
        # 14. Tegalrejo (4)
        "Bener": ("Tegalrejo", "Bener"),
        "Karangwaru": ("Tegalrejo", "Karangwaru"),
        "Kricak": ("Tegalrejo", "Kricak"),
        "Tegalrejo": ("Tegalrejo", "Tegalrejo"),
    },
}


def baca_json_tanah_hspk_day3():
    """Baca Katalog_82_HSPK_dan_Matriks_Poligon_Tanah_DIY_LahanAman.json (Day 3)."""
    import json
    kandidat = cari_file_json(["Katalog_82_HSPK", "Matriks_Poligon_Tanah"])
    if not kandidat:
        return None
    with open(kandidat[0], encoding="utf-8") as f:
        return json.load(f)


def baca_json_geologi_rab_day4():
    """Baca Paket_Data_Hari_4_Unit_Ekonomi_dan_Geologi_Bantul_LahanAman.json (Day 4)."""
    import json
    kandidat = cari_file_json(["Paket_Data_Hari_4", "Geologi_Bantul"])
    if not kandidat:
        return None
    with open(kandidat[0], encoding="utf-8") as f:
        return json.load(f)


def baca_json_drainase_day5():
    """Baca Paket_Data_Hari_5_Standar_Biaya_Drainase_Sumur_Resapan_dan_Skoring_Lereng_Hujan_LahanAman.json (Day 5)."""
    import json
    kandidat = cari_file_json(["Paket_Data_Hari_5", "Standar_Biaya_Drainase"])
    if not kandidat:
        return None
    with open(kandidat[0], encoding="utf-8") as f:
        return json.load(f)


def baca_json_pondasi_day7():
    """Baca Paket_Data_Hari_7_Matriks_Korelasi_Pondasi_Mitigasi_dan_Audit_Overlay_Sleman_LahanAman.json (Day 7)."""
    import json
    kandidat = cari_file_json(["Paket_Data_Hari_7", "Matriks_Korelasi_Pondasi"])
    if not kandidat:
        return None
    with open(kandidat[0], encoding="utf-8") as f:
        return json.load(f)


def cari_gpkg_lereng():
    """
    Cari file GeoPackage kemiringan lereng terbaru.
    Prioritas:
      1. Layer1_Lereng_Geoteknik_Derajat.gpkg (Slope Derajat terbaru di Layer ZIP)
      2. Dissolved_Layer1_Lereng_SlemanBantul.gpkg (Layer ZIP atau Peta)
      3. File GPKG lereng lainnya.
    """
    # 1. Cek layer lereng geoteknik derajat terbaru di folder Slope Derajat / Layer ZIP
    kandidat_derajat = glob.glob(str(EXTRACT_DIR / "**" / "*Lereng_Geoteknik_Derajat*.gpkg"), recursive=True)
    if kandidat_derajat:
        return Path(kandidat_derajat[0])

    # 2. Cek dissolved GPKG lereng
    kandidat_dissolved = glob.glob(str(EXTRACT_DIR / "**" / "Dissolved_Layer1_Lereng_SlemanBantul.gpkg"), recursive=True)
    if kandidat_dissolved:
        return Path(kandidat_dissolved[0])

    # 3. Cek di folder Peta/ jika ada
    peta_dir = PROJECT_ROOT / "Peta"
    if peta_dir.exists():
        utama = peta_dir / "Dissolved_Layer1_Lereng_SlemanBantul.gpkg"
        if utama.exists():
            return utama
        for p in sorted(peta_dir.glob("*.gpkg")):
            if "lereng" in p.name.lower():
                return p

    # 4. Fallback: cari GPKG lereng mana saja di EXTRACT_DIR
    semua_gpkg = glob.glob(str(EXTRACT_DIR / "**" / "*.gpkg"), recursive=True)
    for g in semua_gpkg:
        if "lereng" in Path(g).name.lower():
            return Path(g)
    return None


# =====================================================================
# INTEGRASI OPENSTREETMAP API (OVERPASS & NOMINATIM) UNTUK VALIDASI
# BATAS ADMINISTRASI (KALURAHAN / KAPANEWON / KABUPATEN) REAL-LIFE
# =====================================================================
def ambil_data_osm_diy(timeout_s=12):
    """
    Ambil daftar batas administrasi desa/kalurahan (admin_level=7/8) dan
    kapanewon/kemantren (admin_level=6) di Daerah Istimewa Yogyakarta
    dari OpenStreetMap Overpass API dalam satu request cepat, lalu simpan
    ke cache lokal `Data/processed/osm_administrasi_cache.json`.
    """
    import json
    import urllib.parse
    import urllib.request

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = PROCESSED_DIR / "osm_administrasi_cache.json"
    if cache_path.exists():
        try:
            with open(cache_path, encoding="utf-8") as f:
                cached = json.load(f)
            if cached and isinstance(cached, dict) and "elements" in cached:
                return cached
        except Exception:
            pass

    # Query Overpass API untuk seluruh relation/node admin & place=village/suburb di DIY
    overpass_query = (
        '[out:json][timeout:6];'
        'area["ISO3166-2"="ID-YO"]->.diy;'
        '('
        'relation["boundary"="administrative"]["admin_level"~"^(6|7|8)$"](area.diy);'
        'node["place"~"^(village|suburb|town|municipality)$"](area.diy);'
        ');'
        'out tags center;'
    )
    endpoints = [
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass-api.de/api/interpreter",
    ]
    for url in endpoints:
        try:
            data_bytes = urllib.parse.urlencode({"data": overpass_query}).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=data_bytes,
                headers={"User-Agent": "LahanAman-GeoSpatial-Audit-DIY/2.0 (EPSG:32749)"},
            )
            with urllib.request.urlopen(req, timeout=6) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            if payload and "elements" in payload:
                with open(cache_path, "w", encoding="utf-8") as f:
                    json.dump(payload, f, ensure_ascii=False, indent=2)
                print(f"  -> [OSM API] Berhasil mengambil {len(payload['elements'])} elemen administrasi DIY dari OpenStreetMap Overpass API.")
                return payload
        except Exception:
            continue

    fallback_payload = {"elements": [], "status": "nominatim_ready"}
    try:
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(fallback_payload, f, ensure_ascii=False, indent=2)
    except Exception:
        pass
    print("  -> [OSM API] Menggunakan kamus resmi BPS/Kemendagri + endpoint Nominatim OpenStreetMap.")
    return fallback_payload


def perkaya_atribut_osm(kabupaten_list, kapanewon_list, kalurahan_list, easting_arr, northing_arr):
    """
    Konversi koordinat EPSG:32749 (UTM 49S) ke WGS84 (lat, lon) dan hubungkan setiap
    wilayah ke OpenStreetMap (OSM Relation/Node ID dari Overpass API + URL Nominatim Reverse API).
    """
    transformer = pyproj.Transformer.from_crs(TARGET_CRS, "EPSG:4326", always_xy=True)
    lons, lats = transformer.transform(np.asarray(easting_arr, dtype=float), np.asarray(northing_arr, dtype=float))

    osm_data = ambil_data_osm_diy()
    osm_index = {}
    for el in osm_data.get("elements", []):
        tags = el.get("tags", {})
        nama = str(tags.get("name", "")).strip()
        if not nama:
            continue
        nama_clean = re.sub(r"^(kalurahan|kelurahan|desa|kecamatan|kapanewon|kemantren)\s+", "", nama, flags=re.I).strip().lower()
        osm_type = el.get("type", "relation")
        osm_id = el.get("id")
        if nama_clean and osm_id:
            # Utamakan relation dibanding node
            if nama_clean not in osm_index or osm_type == "relation":
                osm_index[nama_clean] = f"{osm_type}/{osm_id}"

    osm_ids, osm_hierarchies, osm_api_urls, osm_map_urls = [], [], [], []
    for kab, kec, kal, lat, lon in zip(kabupaten_list, kapanewon_list, kalurahan_list, lats, lons):
        kal_key = str(kal).strip().lower()
        kec_key = str(kec).strip().lower()
        osm_ref = osm_index.get(kal_key, osm_index.get(kec_key, f"nominatim/{kal_key.replace(' ', '_')}"))
        prefix_desa = "Kelurahan" if str(kab) == "Kota Yogyakarta" else "Kalurahan"
        prefix_kec = "Kemantren" if str(kab) == "Kota Yogyakarta" else "Kapanewon"
        hier = f"{prefix_desa} {kal}, {prefix_kec} {kec}, {kab}, Daerah Istimewa Yogyakarta"
        api_url = f"https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat={lat:.6f}&lon={lon:.6f}&zoom=15&addressdetails=1"
        if "/" in osm_ref and not osm_ref.startswith("nominatim/"):
            map_url = f"https://www.openstreetmap.org/{osm_ref}"
        else:
            map_url = f"https://www.openstreetmap.org/?mlat={lat:.6f}&mlon={lon:.6f}#map=15/{lat:.6f}/{lon:.6f}"
        osm_ids.append(osm_ref)
        osm_hierarchies.append(hier)
        osm_api_urls.append(api_url)
        osm_map_urls.append(map_url)

    return {
        "lintang_wgs84": np.round(lats, 6),
        "bujur_wgs84": np.round(lons, 6),
        "osm_id": np.array(osm_ids),
        "osm_hierarki_resmi": np.array(osm_hierarchies),
        "osm_nominatim_api": np.array(osm_api_urls),
        "osm_url": np.array(osm_map_urls),
    }


# =====================================================================
# INTEGRASI LAYER ACUAN DAY 8 & KATALOG DUSUN/PADUKUHAN RESMI DIY (RBI 25K)
# =====================================================================
_ROMAN_NUMS = {"I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"}


def format_nama_dusun_asli(raw_name, kabupaten="Kab. Sleman"):
    """
    Format nama dusun/padukuhan/kampung dari TOPONIMI_PT_25K.shp (REMARK='Permukiman Lainnya')
    menjadi nama Dusun yang presisi, asli, dan mudah dibaca (bukan inisial atau placeholder).
    Contoh: 'CEPER' -> 'Dusun Ceper', 'POGUNG DALANGAN' -> 'Dusun Pogung Dalangan'.
    """
    if not raw_name:
        return ""
    s = re.sub(r"\s+", " ", str(raw_name).strip())
    if not s or s.upper().startswith("MTR-"):
        return ""
    # Bersihkan prefix berulang bila sudah ada
    s_clean = re.sub(r"^(dusun|padukuhan|dukuh|kampung|kp\.?)\s+", "", s, flags=re.I).strip()
    words = []
    for w in s_clean.split(" "):
        w_up = w.upper()
        if w_up in _ROMAN_NUMS:
            words.append(w_up)
        else:
            words.append(w.capitalize())
    titled = " ".join(words)
    if str(kabupaten) == "Kota Yogyakarta":
        if s.lower().startswith("kampung"):
            return f"Kampung {titled}"
        return f"Kampung {titled}"
    return f"Dusun {titled}"


# Daftar Dusun ikonik tambahan (Lereng Merapi, Perbukitan, dan Perkotaan) untuk melengkapi TOPONIMI_PT_25K
_DUSUN_TAMBAHAN_IKONIK = [
    ("Dusun Kinahrejo", "Umbulharjo", "Cangkringan", "Kab. Sleman", -7.5945, 110.4412),
    ("Dusun Pelemsari", "Umbulharjo", "Cangkringan", "Kab. Sleman", -7.5985, 110.4402),
    ("Dusun Kaliadem", "Kepuharjo", "Cangkringan", "Kab. Sleman", -7.5880, 110.4535),
    ("Dusun Petung", "Kepuharjo", "Cangkringan", "Kab. Sleman", -7.5990, 110.4510),
    ("Dusun Jambu", "Kepuharjo", "Cangkringan", "Kab. Sleman", -7.6065, 110.4495),
    ("Dusun Kopeng", "Kepuharjo", "Cangkringan", "Kab. Sleman", -7.6130, 110.4480),
    ("Dusun Kalitengah Lor", "Glagaharjo", "Cangkringan", "Kab. Sleman", -7.5835, 110.4675),
    ("Dusun Kalitengah Kidul", "Glagaharjo", "Cangkringan", "Kab. Sleman", -7.5920, 110.4665),
    ("Dusun Srunen", "Glagaharjo", "Cangkringan", "Kab. Sleman", -7.6040, 110.4640),
    ("Dusun Turgo", "Purwobinangun", "Pakem", "Kab. Sleman", -7.5910, 110.4240),
    ("Dusun Kaliurang Timur", "Hargobinangun", "Pakem", "Kab. Sleman", -7.5970, 110.4310),
    ("Dusun Kaliurang Barat", "Hargobinangun", "Pakem", "Kab. Sleman", -7.5975, 110.4235),
    ("Dusun Boyong", "Hargobinangun", "Pakem", "Kab. Sleman", -7.6210, 110.4210),
    ("Dusun Tunggularum", "Wonokerto", "Turi", "Kab. Sleman", -7.6080, 110.3910),
    ("Dusun Ngandong", "Girikerto", "Turi", "Kab. Sleman", -7.6020, 110.4050),
    ("Dusun Kemirikebo", "Girikerto", "Turi", "Kab. Sleman", -7.5980, 110.4110),
    ("Dusun Ceper", "Wedomartani", "Ngemplak", "Kab. Sleman", -7.7287, 110.4186),
    ("Dusun Krapyak", "Wedomartani", "Ngemplak", "Kab. Sleman", -7.7279, 110.4153),
    ("Dusun Karangmojo", "Wedomartani", "Ngemplak", "Kab. Sleman", -7.7294, 110.4219),
    ("Dusun Tajem", "Wedomartani", "Ngemplak", "Kab. Sleman", -7.7520, 110.4320),
    ("Dusun Kregan", "Wedomartani", "Ngemplak", "Kab. Sleman", -7.7340, 110.4210),
    ("Dusun Malangrejo", "Wedomartani", "Ngemplak", "Kab. Sleman", -7.7410, 110.4280),
    ("Dusun Kenayan", "Wedomartani", "Ngemplak", "Kab. Sleman", -7.7375, 110.4135),
    ("Dusun Pokoh", "Wedomartani", "Ngemplak", "Kab. Sleman", -7.7315, 110.4275),
    ("Dusun Gondanglegi", "Wedomartani", "Ngemplak", "Kab. Sleman", -7.7225, 110.4170),
    ("Dusun Pogung Dalangan", "Sinduadi", "Mlati", "Kab. Sleman", -7.7610, 110.3735),
    ("Dusun Pogung Baru", "Sinduadi", "Mlati", "Kab. Sleman", -7.7585, 110.3715),
    ("Dusun Karangjati", "Sinduadi", "Mlati", "Kab. Sleman", -7.7680, 110.3690),
    ("Dusun Babarsari", "Caturtunggal", "Depok", "Kab. Sleman", -7.7810, 110.4140),
    ("Dusun Seturan", "Caturtunggal", "Depok", "Kab. Sleman", -7.7715, 110.4095),
    ("Dusun Karanggayam", "Caturtunggal", "Depok", "Kab. Sleman", -7.7640, 110.3860),
    ("Dusun Mrican", "Caturtunggal", "Depok", "Kab. Sleman", -7.7770, 110.3910),
    ("Dusun Gejayan", "Condongcatur", "Depok", "Kab. Sleman", -7.7670, 110.3955),
    ("Dusun Kentungan", "Condongcatur", "Depok", "Kab. Sleman", -7.7540, 110.3945),
    ("Dusun Kayen", "Condongcatur", "Depok", "Kab. Sleman", -7.7440, 110.3940),
    ("Dusun Kledokan", "Caturtunggal", "Depok", "Kab. Sleman", -7.7760, 110.4105),
    ("Dusun Breksi", "Sambirejo", "Prambanan", "Kab. Sleman", -7.7815, 110.5045),
    ("Dusun Gunungsari", "Sambirejo", "Prambanan", "Kab. Sleman", -7.7765, 110.5080),
    ("Dusun Nglengkong", "Sambirejo", "Prambanan", "Kab. Sleman", -7.7860, 110.5020),
    ("Dusun Dawangsari", "Sambirejo", "Prambanan", "Kab. Sleman", -7.7690, 110.5095),
    ("Dusun Mangunan", "Mangunan", "Dlingo", "Kab. Bantul", -7.9320, 110.4240),
    ("Dusun Sukorame", "Mangunan", "Dlingo", "Kab. Bantul", -7.9390, 110.4310),
    ("Dusun Kedungmiri", "Sriharjo", "Imogiri", "Kab. Bantul", -7.9490, 110.4020),
    ("Dusun Sompok", "Sriharjo", "Imogiri", "Kab. Bantul", -7.9450, 110.4080),
    ("Dusun Becici", "Muntuk", "Dlingo", "Kab. Bantul", -7.8820, 110.4430),
    ("Dusun Gunoscilik", "Muntuk", "Dlingo", "Kab. Bantul", -7.8890, 110.4380),
    ("Dusun Kasongan", "Bangunjiwo", "Kasihan", "Kab. Bantul", -7.8450, 110.3380),
    ("Dusun Kalipucang", "Bangunjiwo", "Kasihan", "Kab. Bantul", -7.8540, 110.3260),
    ("Dusun Bibis", "Bangunjiwo", "Kasihan", "Kab. Bantul", -7.8390, 110.3150),
    ("Dusun Grogol", "Parangtritis", "Kretek", "Kab. Bantul", -8.0150, 110.3260),
    ("Dusun Mancingan", "Parangtritis", "Kretek", "Kab. Bantul", -8.0230, 110.3320),
]


def baca_layer_day8():
    """
    Muat seluruh layer vektor geoteknik resmi dari folder DAY 8 dalam proyeksi EPSG:32749 (UTM 49S):
      - lereng: GJS Layer1_Lereng_Geoteknik_Derajat.geojson
      - tanah: GJS Layer2_JenisTanah_SlemanBantul.geojson
      - geologi: GJS Layer3_Geologi_SlemanBantul.geojson
      - hujan: GJS_Layer4_CurahHujan_SlemanBantul.geojson
      - lahan: GJS Layer5_Tata Guna Lahan.geojson
      - kerawanan_final: GJS Peta_Kerawanan_Longsor_SlemanBantul_Final.geojson
    """
    day8_layers = {}
    pola_layer = {
        "lereng": "*Layer1_Lereng_Geoteknik_Derajat*.geojson",
        "tanah": "*Layer2_JenisTanah_SlemanBantul*.geojson",
        "geologi": "*Layer3_Geologi_SlemanBantul*.geojson",
        "hujan": "*Layer4_CurahHujan_SlemanBantul*.geojson",
        "lahan": "*Layer5_Tata Guna Lahan*.geojson",
        "kerawanan_final": "*Peta_Kerawanan_Longsor_SlemanBantul_Final*.geojson",
    }
    for key, pattern in pola_layer.items():
        matches = glob.glob(str(EXTRACT_DIR / "**" / pattern), recursive=True)
        if matches:
            try:
                gdf = gpd.read_file(matches[0])
                if gdf.crs is None:
                    gdf = gdf.set_crs(TARGET_CRS)
                elif str(gdf.crs).upper() != TARGET_CRS:
                    gdf = gdf.to_crs(TARGET_CRS)
                day8_layers[key] = gdf
            except Exception as e:
                print(f"  [!] Gagal membaca layer DAY 8 {key}: {e}")
    return day8_layers


def muat_katalog_dusun_diy(gdf_admin_utm=None, force_rebuild=False):
    """
    Bangun dan muat katalog ~3.600 titik Dusun / Padukuhan / Kampung asli di DIY
    dari shapefile resmi BIG RBI 25K (`TOPONIMI_PT_25K.shp`, REMARK='Permukiman Lainnya')
    yang di-join secara spasial dengan 206 Kalurahan/Kelurahan resmi DIY (EPSG:32749).
    """
    import json
    from shapely.geometry import Point

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = PROCESSED_DIR / "katalog_dusun_diy.json"
    if cache_path.exists() and not force_rebuild:
        try:
            with open(cache_path, encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list) and len(data) >= 1000:
                return data
        except Exception:
            pass

    transformer_to_wgs = pyproj.Transformer.from_crs(TARGET_CRS, "EPSG:4326", always_xy=True)
    transformer_to_utm = pyproj.Transformer.from_crs("EPSG:4326", TARGET_CRS, always_xy=True)

    # Siapkan gdf_admin_utm bila belum diberikan
    if gdf_admin_utm is None:
        p_adm = PROCESSED_DIR / "clean_batas_administrasi.geojson"
        if p_adm.exists():
            gdf_admin_utm = gpd.read_file(p_adm).to_crs(TARGET_CRS)
        else:
            bundle_p = PROJECT_ROOT / "Web" / "geojson_bundle.js"
            if bundle_p.exists():
                raw = bundle_p.read_text(encoding="utf-8")
                idx = raw.find("{")
                obj, _ = json.JSONDecoder().raw_decode(raw[idx:])
                fc = obj.get("clean_batas_administrasi.geojson")
                if fc:
                    gdf_tmp = gpd.GeoDataFrame.from_features(fc["features"])
                    minx, miny, maxx, maxy = gdf_tmp.total_bounds
                    crs_in = "EPSG:4326" if (-180 <= minx <= maxx <= 180) else TARGET_CRS
                    gdf_admin_utm = gdf_tmp.set_crs(crs_in).to_crs(TARGET_CRS)

    records = []
    seen_keys = set()

    # 1. Masukkan Dusun ikonik terkurasi terlebih dahulu agar koordinat terkenalnya presisi
    for nama_d, kal, kec, kab, lat, lng in _DUSUN_TAMBAHAN_IKONIK:
        x_u, y_u = transformer_to_utm.transform(float(lng), float(lat))
        k_uniq = f"{nama_d.lower()}|{kal.lower()}|{kec.lower()}"
        seen_keys.add(k_uniq)
        records.append({
            "nama_dusun": nama_d,
            "kalurahan": kal,
            "kapanewon": kec,
            "kabupaten": kab,
            "lat": round(float(lat), 6),
            "lng": round(float(lng), 6),
            "easting_x": round(float(x_u), 2),
            "northing_y": round(float(y_u), 2),
            "sumber": "Toponimi Padukuhan DIY",
        })

    # 2. Baca seluruh TOPONIMI_PT_25K.shp di KAB. SLEMAN, KAB. BANTUL, KOTA YOGYAKARTA
    shps = sorted(glob.glob(str(EXTRACT_DIR / "**" / "TOPONIMI_PT_25K.shp"), recursive=True))
    pts_list = []
    for shp in shps:
        kab_folder = kabupaten_dari_path(shp)
        try:
            gdf_t = baca_vektor(shp, target_crs=TARGET_CRS)
            if "REMARK" in gdf_t.columns:
                gdf_t = gdf_t[gdf_t["REMARK"].astype(str).isin(["Permukiman Lainnya", "Ibukota Desa"])].copy()
            gdf_t["kab_folder"] = kab_folder or "Kab. Sleman"
            pts_list.append(gdf_t[["NAMOBJ", "REMARK", "kab_folder", "geometry"]])
        except Exception:
            continue

    if pts_list:
        all_pts = gpd.GeoDataFrame(pd.concat(pts_list, ignore_index=True), geometry="geometry", crs=TARGET_CRS)
        all_pts = all_pts[all_pts.geometry.notnull() & ~all_pts.geometry.is_empty].copy()
        # Ambil centroid bila ada MultiPoint/PointZ
        xs = np.array([g.centroid.x for g in all_pts.geometry], dtype=float)
        ys = np.array([g.centroid.y for g in all_pts.geometry], dtype=float)
        all_pts["geometry"] = [Point(x, y) for x, y in zip(xs, ys)]
        lons, lats = transformer_to_wgs.transform(xs, ys)
        all_pts["lat"] = np.round(lats, 6)
        all_pts["lng"] = np.round(lons, 6)
        all_pts["easting_x"] = np.round(xs, 2)
        all_pts["northing_y"] = np.round(ys, 2)

        if gdf_admin_utm is not None and not gdf_admin_utm.empty:
            adm_cols = ["kabupaten", "kapanewon", "kalurahan", "geometry"]
            for extra_c in ["zona_kerawanan", "skor_total", "lereng_derajat", "jenis_tanah", "formasi_batuan"]:
                if extra_c in gdf_admin_utm.columns:
                    adm_cols.append(extra_c)
            joined = gpd.sjoin(all_pts, gdf_admin_utm[adm_cols], how="inner", predicate="within")
            for _, r in joined.iterrows():
                raw_nm = str(r["NAMOBJ"]).strip()
                kab_r = str(r["kabupaten"])
                kec_r = str(r["kapanewon"])
                kal_r = str(r["kalurahan"])
                nama_fmt = format_nama_dusun_asli(raw_nm, kab_r)
                if not nama_fmt:
                    continue
                k_uniq = f"{nama_fmt.lower()}|{kal_r.lower()}|{kec_r.lower()}"
                if k_uniq in seen_keys:
                    continue
                seen_keys.add(k_uniq)
                rec = {
                    "nama_dusun": nama_fmt,
                    "kalurahan": kal_r,
                    "kapanewon": kec_r,
                    "kabupaten": kab_r,
                    "lat": float(r["lat"]),
                    "lng": float(r["lng"]),
                    "easting_x": float(r["easting_x"]),
                    "northing_y": float(r["northing_y"]),
                    "sumber": "BIG RBI 25K (Toponimi Padukuhan)",
                }
                if "zona_kerawanan" in r and pd.notna(r["zona_kerawanan"]):
                    rec["zona_kerawanan"] = str(r["zona_kerawanan"])
                records.append(rec)

    try:
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(records, f, ensure_ascii=False)
        print(f"  -> [TOPONIMI DUSUN] Katalog {len(records)} Dusun/Padukuhan resmi DIY tersimpan: {cache_path}")
    except Exception:
        pass
    return records


# =====================================================================
# ENGINE PENILAIAN GEOTEKNIK & TRIASE BACKEND (ACUAN DAY 8)
# =====================================================================
def evaluasi_geoteknik_day8_backend(
    lereng_deg=None,
    lereng_pct=None,
    jenis_tanah_str="",
    formasi_batuan_str="",
    ch_mm=2200.0,
    tutupan_str="",
    skor_lereng_override=None,
    skor_tanah_override=None,
    skor_batuan_override=None,
    skor_hujan_override=None,
    skor_tutupan_override=None,
    c_kpa_override=None,
    phi_deg_override=None,
    rasio_m_override=None,
):
    """
    Proses kalkulasi penilaian geoteknik & triase murni di sisi backend (silent calculation)
    berdasarkan dokumen acuan Folder DAY 8 ('Dasar Penentuan Kelas Kemiringan Lereng.pdf' & 'Dasar.xlsx'):
      1. Kemiringan Lereng (Bobot 30%):
         - Skor 1: 0°–8° (0%–14.1%)
         - Skor 2: >8°–15° (14.1%–26.8%)
         - Skor 3: >15°–25° (26.8%–46.6%)
         - Skor 4: >25°–35° (46.6%–70.0%)
         - Skor 5: >35° (>70.0%)
      2. Karakteristik Tanah Penutup / Pedologi (Bobot 15%):
         - Skor 5: Grumosol (c'=9.0 kPa, phi'=15°, ekspansif tinggi)
         - Skor 4: Latosol & Mediteran (c'=10.5 kPa, phi'=19°, solum tebal >2m)
         - Skor 3: Regosol (c'=3.5 kPa, phi'=36°, pasir lepas/sarang)
         - Skor 2: Kambisol (c'=8.0 kPa, phi'=30°)
         - Skor 1: Aluvial (c'=14.0 kPa, phi'=25°, dataran datar)
      3. Litologi / Formasi Batuan (Bobot 20%):
         - Skor 5: Formasi Semilir (Tmse, Tms3), Sambipitu (Tmss), Nanggulan (Teon), Koluvial/Avalanche (na)
         - Skor 4: Formasi Nglanggran (Tmng), Kebobutak (Tomk)
         - Skor 3: Formasi Sentolo (Tmps), Merapi Tua (Qmo)
         - Skor 2: Endapan Merapi Muda (Qmi, Qvu3)
         - Skor 1: Formasi Wonosari (Tmwl), Aluvial (Qa)
      4. Curah Hujan IDW (Bobot 20%):
         - Skor 5: >3.000 mm/thn (m = 0.90)
         - Skor 4: 2.501–3.000 mm/thn (m = 0.75)
         - Skor 3: 2.001–2.500 mm/thn (m = 0.60)
         - Skor 2: 1.500–2.000 mm/thn (m = 0.45)
         - Skor 1: <1.500 mm/thn (m = 0.30)
      5. Tutupan Lahan (Bobot 15%):
         - Skor 5: Lahan terbuka, tegalan, sawah lereng miring
         - Skor 4: Semak belukar, rumput
         - Skor 3: Permukiman, jaringan jalan
         - Skor 2: Perkebunan, kebun campuran
         - Skor 1: Hutan lindung, tubuh air
    """
    import math

    # 1. Kemiringan Lereng (30%)
    if lereng_deg is None and lereng_pct is not None:
        lereng_deg = math.degrees(math.atan(float(lereng_pct) / 100.0))
    elif lereng_deg is None:
        lereng_deg = 4.0
    lereng_deg = max(0.2, float(lereng_deg))
    if lereng_pct is None:
        lereng_pct = math.tan(math.radians(lereng_deg)) * 100.0
    lereng_pct = max(0.35, float(lereng_pct))

    if skor_lereng_override is not None and 1 <= int(skor_lereng_override) <= 5:
        skor_lereng = int(skor_lereng_override)
    else:
        if lereng_deg <= 8.0:
            skor_lereng = 1
        elif lereng_deg <= 15.0:
            skor_lereng = 2
        elif lereng_deg <= 25.0:
            skor_lereng = 3
        elif lereng_deg <= 35.0:
            skor_lereng = 4
        else:
            skor_lereng = 5

    label_lereng_map = {
        1: "Datar – Landai (0°–8° / 0%–14,1%)",
        2: "Landai – Agak Miring (>8°–15° / 14,1%–26,8%)",
        3: "Miring – Agak Curam (>15°–25° / 26,8%–46,6%)",
        4: "Curam (>25°–35° / 46,6%–70,0%)",
        5: "Sangat Terjal / Kritis (>35° / >70,0%)",
    }
    kelas_lereng = label_lereng_map.get(skor_lereng, label_lereng_map[1])

    # 2. Karakteristik Tanah Penutup / Pedologi (15%)
    t_low = str(jenis_tanah_str or "").lower()
    is_expansive = False
    if "grumosol" in t_low or "grumusol" in t_low or "ekspansif" in t_low or "vertisol" in t_low or "montmorillonit" in t_low or "montmorilonit" in t_low or "smektit" in t_low:
        skor_tanah = 5
        nama_tanah = "Grumosol (Lempung Hitam Ekspansif)"
        ket_tanah = "Tanah lempung hitam berplastisitas tinggi (smektit/montmorilonit); kembang-kerut ekstrem (retak saat kering, mengembang saat basah), rentan rayapan lereng dan risiko retak pondasi."
        c_kpa, phi_deg = 9.0, 15.0
        is_expansive = True
    elif "latosol" in t_low or "mediteran" in t_low or "andosol" in t_low or "litosol" in t_low:
        skor_tanah = 4
        nama_tanah = "Latosol & Mediteran" if ("latosol" in t_low or "mediteran" in t_low) else str(jenis_tanah_str)
        ket_tanah = "Tanah pelapukan lanjut solum tebal (>2 m), jenuh air saat hujan lebat"
        c_kpa, phi_deg = 10.0, 18.0
    elif "kambisol" in t_low or "inceptisol" in t_low:
        skor_tanah = 2
        nama_tanah = "Kambisol"
        ket_tanah = "Tanah perkembangan muda-sedang dengan struktur agregat cukup stabil"
        c_kpa, phi_deg = 8.0, 30.0
    elif "aluvial" in t_low or "entisol" in t_low or "planosol" in t_low:
        skor_tanah = 1
        nama_tanah = "Aluvial (Endapan Dataran)"
        ket_tanah = "Tanah endapan dataran rendah/lembah sungai dengan kohesi cukup baik"
        c_kpa, phi_deg = 14.0, 25.0
    else:
        skor_tanah = 3
        nama_tanah = "Regosol (Pasir Vulkanik)" if "regosol" in t_low or not jenis_tanah_str else str(jenis_tanah_str)
        ket_tanah = "Pasir vulkanik lepas/sarang (kohesi rendah), permeabilitas tinggi namun peka gerusan air"
        c_kpa, phi_deg = 3.5, 36.0

    if skor_tanah_override is not None and 1 <= int(skor_tanah_override) <= 5:
        skor_tanah = int(skor_tanah_override)
        if skor_tanah == 5:
            is_expansive = True
    if c_kpa_override is not None and float(c_kpa_override) > 0:
        c_kpa = float(c_kpa_override)
    if phi_deg_override is not None and float(phi_deg_override) > 0:
        phi_deg = float(phi_deg_override)

    # 3. Litologi / Formasi Batuan (20%) — Murni Formasi Geologi & Litologi Batuan
    g_low = str(formasi_batuan_str or "").lower()
    if any(k in g_low for k in ["semilir", "tmse", "tms3"]):
        skor_batuan = 5
        nama_batuan = "Formasi Semilir (Tmse / Tms3)"
        ket_batuan = "Litologi Batuan: Tuf, breksi batuapung (pumice), batupasir tufan & serpih (bidang gelincir aktif)"
    elif any(k in g_low for k in ["sambipitu", "tmss"]):
        skor_batuan = 5
        nama_batuan = "Formasi Sambipitu (Tmss)"
        ket_batuan = "Litologi Batuan: Perselingan batupasir tufan, serpih & batulanau kedap air"
    elif any(k in g_low for k in ["nanggulan", "teon"]):
        skor_batuan = 5
        nama_batuan = "Formasi Nanggulan (Teon)"
        ket_batuan = "Litologi Batuan: Batulempung, napal, batupasir kuarsa & sisipan lignit"
    elif any(k in g_low for k in ["koluvial", "avalanche", "ladu", "(na)"]):
        skor_batuan = 5
        nama_batuan = "Satuan Breksi Piroklastik / Guguran Lava Merapi (na)"
        ket_batuan = "Litologi Batuan: Breksi piroklastik awan panas (ladu) & bongkah lava andesit belum terkonsolidasi"
    elif any(k in g_low for k in ["nglanggran", "tmng"]):
        skor_batuan = 4
        nama_batuan = "Formasi Nglanggran (Tmng)"
        ket_batuan = "Litologi Batuan: Breksi gunungapi purba, aglomerat & lava andesit-basal berkekar rapat"
    elif any(k in g_low for k in ["kebobutak", "tomk", "diorit"]):
        skor_batuan = 4
        nama_batuan = "Formasi Kebobutak & Intrusi Diorit (Tomk)"
        ket_batuan = "Litologi Batuan: Breksi andesit, tuf lapili, aglomerat & intrusi batuan beku diorit"
    elif any(k in g_low for k in ["sentolo", "tmps"]):
        skor_batuan = 3
        nama_batuan = "Formasi Sentolo (Tmps)"
        ket_batuan = "Litologi Batuan: Batugamping berlapis, napal tufan & batupasir gampingan"
    elif any(k in g_low for k in ["merapi tua", "qmo"]):
        skor_batuan = 3
        nama_batuan = "Formasi Gunungapi Merapi Tua (Qmo)"
        ket_batuan = "Litologi Batuan: Breksi gunungapi tua terkersikkan & aliran lava andesit olivin"
    elif any(k in g_low for k in ["wonosari", "tmwl"]):
        skor_batuan = 1
        nama_batuan = "Formasi Wonosari (Tmwl)"
        ket_batuan = "Litologi Batuan: Batugamping terumbu masif (reef limestone), kalkarenit & batugamping klastik"
    elif any(k in g_low for k in ["aluvial", "qa", "gumuk"]):
        skor_batuan = 1
        nama_batuan = "Satuan Batuan Klastik Fluvial Kuarter (Qa)"
        ket_batuan = "Litologi Batuan: Konglomerat, kerakal, batupasir klastik kuarter & endapan batuan sedimen dataran"
    else:
        skor_batuan = 2
        nama_batuan = "Formasi Gunungapi Merapi Muda (Qmi)"
        ket_batuan = "Litologi Batuan: Breksi laharik, tuf piroklastik, aglomerat & batuan beku lava andesit Merapi Muda"

    if skor_batuan_override is not None and 1 <= int(skor_batuan_override) <= 5:
        skor_batuan = int(skor_batuan_override)

    # 4. Curah Hujan IDW (20%)
    ch_val = float(ch_mm if ch_mm is not None else 2200.0)
    if ch_val > 3000.0:
        skor_hujan, rasio_m, kelas_hujan = 5, 0.90, "> 3.000 mm/thn (Sangat Tinggi)"
    elif ch_val >= 2501.0:
        skor_hujan, rasio_m, kelas_hujan = 4, 0.75, "2.501 – 3.000 mm/thn (Tinggi)"
    elif ch_val >= 2001.0:
        skor_hujan, rasio_m, kelas_hujan = 3, 0.60, "2.001 – 2.500 mm/thn (Sedang)"
    elif ch_val >= 1500.0:
        skor_hujan, rasio_m, kelas_hujan = 2, 0.45, "1.500 – 2.000 mm/thn (Rendah)"
    else:
        skor_hujan, rasio_m, kelas_hujan = 1, 0.30, "< 1.500 mm/thn (Sangat Rendah)"

    if skor_hujan_override is not None and 1 <= int(skor_hujan_override) <= 5:
        skor_hujan = int(skor_hujan_override)
        m_map = {1: 0.30, 2: 0.45, 3: 0.60, 4: 0.75, 5: 0.90}
        rasio_m = m_map.get(skor_hujan, rasio_m)
    if rasio_m_override is not None and 0.0 < float(rasio_m_override) <= 1.0:
        rasio_m = float(rasio_m_override)

    # 5. Tutupan Lahan (15%)
    l_low = str(tutupan_str or "").lower()
    if any(k in l_low for k in ["terbuka", "tegalan", "ladang", "pasir"]):
        skor_tutupan = 5
        nama_tutupan = str(tutupan_str) if tutupan_str else "Tegalan / Lahan Terbuka"
        ket_tutupan = "Minim kanopi pelindung; infiltrasi & limpasan permukaan langsung menggerus tanah"
    elif "sawah" in l_low:
        if lereng_deg > 8.0:
            skor_tutupan = 5
            nama_tutupan = "Sawah Lereng Miring"
            ket_tutupan = "Persawahan pada lereng miring meningkatkan penjenuhan air pori secara menerus"
        else:
            skor_tutupan = 3
            nama_tutupan = "Sawah Dataran"
            ket_tutupan = "Persawahan dataran terkelola dengan genangan air musiman"
    elif any(k in l_low for k in ["semak", "belukar", "rumput", "alang"]):
        skor_tutupan = 4
        nama_tutupan = str(tutupan_str) if tutupan_str else "Semak Belukar / Padang Rumput"
        ket_tutupan = "Perakaran dangkal; penahan erosi permukaan sedang"
    elif any(k in l_low for k in ["kebun", "perkebunan", "campur", "vegetasi"]):
        skor_tutupan = 2
        nama_tutupan = str(tutupan_str) if tutupan_str else "Perkebunan / Kebun Campuran"
        ket_tutupan = "Tajuk rapat dan perakaran pohon membantu menjaga stabilitas tanah dangkal"
    elif any(k in l_low for k in ["hutan", "air", "sungai", "danau", "waduk"]):
        skor_tutupan = 1
        nama_tutupan = str(tutupan_str) if tutupan_str else "Hutan Lindung / Tubuh Air"
        ket_tutupan = "Zona konservasi vegetasi rapat / badan air alami"
    else:
        skor_tutupan = 3
        nama_tutupan = str(tutupan_str) if tutupan_str else "Permukiman dan Tempat Kegiatan"
        ket_tutupan = "Kawasan terbangun & jaringan jalan dengan beban konstruksi di permukaan"

    if skor_tutupan_override is not None and 1 <= int(skor_tutupan_override) <= 5:
        skor_tutupan = int(skor_tutupan_override)

    # Akumulasi Skor Akhir (Silent di Backend)
    skor_akhir = round(
        0.30 * skor_lereng
        + 0.15 * skor_tanah
        + 0.20 * skor_batuan
        + 0.20 * skor_hujan
        + 0.15 * skor_tutupan,
        2,
    )

    # Estimasi Faktor Keamanan Murni (Factor of Safety / FS Terzaghi Tanpa Manipulasi):
    # FS = [c' + (gamma_sat * z - m * gamma_w * z) * cos^2(beta) * tan(phi')] / [gamma_sat * z * sin(beta) * cos(beta)]
    gamma_sat = 18.0
    gamma_w = 9.81
    z_depth = 2.0
    beta_calc = max(float(lereng_deg), 1.0)  # proteksi beta_min = 1.0 derajat agar tidak pembagian nol pada tanah datar
    beta_rad = math.radians(beta_calc)
    phi_rad = math.radians(phi_deg)
    cos_b = math.cos(beta_rad)
    sin_b = math.sin(beta_rad)
    normal_eff = (gamma_sat * z_depth - rasio_m * gamma_w * z_depth) * (cos_b ** 2)
    shear_res = c_kpa + normal_eff * math.tan(phi_rad)
    driving = gamma_sat * z_depth * sin_b * cos_b
    fs_val = round(shear_res / driving, 2)

    # Klasifikasi Status Triase & Warna sesuai spesifikasi DAY 8 (5 Parameter Berbobot):
    # - Zona Merah (#EF4444): Skor Akhir > 3.40
    # - Zona Hijau (#10B981): Skor Akhir < 2.20 atau lereng datar (0°–8°) tanpa lempung ekspansif
    # - Zona Kuning (#F59E0B): Skor Akhir 2.20 – 3.40
    if skor_akhir > 3.40:
        zona = "Zona Merah"
        badge = "ZONA MERAH (BAHAYA KRITIS)"
        warna_hex = "#EF4444"
    elif skor_akhir < 2.20 or (lereng_deg <= 8.0 and not is_expansive):
        zona = "Zona Hijau"
        badge = "ZONA HIJAU (AMAN)"
        warna_hex = "#10B981"
    else:
        zona = "Zona Kuning"
        badge = "ZONA KUNING (PERLU MITIGASI)"
        warna_hex = "#F59E0B"

    # Evaluasi Indikator Kestabilan Lereng (FS) secara independen & jujur terhadap kondisi fisik
    if fs_val >= 1.50:
        fs_label = "STABIL"
        if zona == "Zona Merah":
            if lereng_deg <= 8.0:
                fs_desc = "Kerawanan makro tinggi akibat faktor geologi/hujan, namun kestabilan lereng lokal stabil mutlak karena topografi datar."
            else:
                fs_desc = "Kestabilan geser lereng lokal terhitung stabil (FS ≥ 1.50), namun tetap berada pada zona waspada/kritis makro akibat faktor formasi geologi/litologi atau tutupan lahan."
        elif zona == "Zona Kuning":
            if lereng_deg <= 8.0:
                fs_desc = "Kerawanan makro sedang akibat faktor tanah/geologi, namun kestabilan lereng lokal stabil mutlak karena topografi datar."
            else:
                fs_desc = "Kestabilan geser lereng lokal terhitung stabil (FS ≥ 1.50), namun tetap berada pada zona waspada/kritis makro akibat faktor formasi geologi/litologi atau tutupan lahan."
        else:
            fs_desc = "Gaya penahan geser tanah melampaui gaya penggerak gravitasi lereng secara aman."
    elif fs_val >= 1.15:
        fs_label = "RAWAN RAYAPAN"
        fs_desc = "Kestabilan lereng marjinal saat tanah jenuh air hujan; rentan rayapan tanah (soil creep) tanpa perkuatan."
    else:
        fs_label = "LABIL"
        fs_desc = "Gaya penggerak lereng mendekati/melampaui batas kuat geser tanah; bahaya longsor tinggi saat hujan ekstrem."

    fs_pct = int(min(max(round((fs_val / 3.5) * 100.0), 15), 100))

    # Rekomendasi Ahli Berbasis AI (AI Geotechnical Advisor Card)
    if zona == "Zona Merah":
        if lereng_deg <= 8.0 and fs_val >= 1.50:
            diagnosa = (
                f"Kerawanan makro tinggi dipicu oleh faktor geologi ({nama_batuan}), tanah ({nama_tanah}), dan curah hujan "
                f"{ch_val:.0f} mm/thn, namun kestabilan lereng lokal stabil mutlak (FS {fs_val:.2f}) karena topografi datar ({lereng_deg:.1f}° / {lereng_pct:.1f}%)."
            )
        elif lereng_deg > 8.0 and fs_val >= 1.50:
            diagnosa = (
                f"Kestabilan geser lereng lokal terhitung stabil (FS ≥ 1.50; FS = {fs_val:.2f}) pada kemiringan {lereng_deg:.1f}° ({lereng_pct:.1f}%), "
                f"namun tetap berada pada zona waspada/kritis makro akibat faktor formasi geologi/litologi ({nama_batuan}), tanah ({nama_tanah}), atau tutupan lahan."
            )
        else:
            diagnosa = (
                f"Kondisi lereng ({lereng_deg:.1f}° / {lereng_pct:.1f}%) di atas {nama_batuan} dengan tanah {nama_tanah} "
                f"dan curah hujan {ch_val:.0f} mm/thn memicu tekanan air pori tinggi serta potensi bidang gelincir aktif (FS {fs_val:.2f})."
            )
        pondasi = (
            "Zona ini tidak direkomendasikan untuk bangunan hunian standar tanpa rekayasa geoteknik. Wajib menggunakan "
            "pondasi dalam (Bore Pile / Strauss Pile) yang ditanam menembus lapisan batuan dasar keras di bawah bidang gelincir."
        )
        mitigasi = (
            "Wajib mempertahankan vegetasi berakar dalam, dilarang keras melakukan pemotongan tebing tegak (cut slope), "
            "serta bangun dinding penahan tanah beton bertulang (Cantilever Retaining Wall), bronjong berjenjang, dan saluran pengelak air hujan."
        )
        if skor_lereng >= 5 or lereng_deg > 35.0:
            kpr_status = "Zona Sangat Terjal / Non-Buildable"
        else:
            kpr_status = "Zona Kerawanan Geologi Tinggi — Perlu Penyelidikan Geoteknik Rinci (Sondir/Bor) & Perkuatan Lereng."
        kpr_kode = "merah"
    elif zona == "Zona Kuning":
        if is_expansive:
            diagnosa = (
                f"Tanah {nama_tanah} pada kemiringan {lereng_deg:.1f}° memiliki sifat kembang-susut (swelling-shrinkage) tinggi "
                f"dan rentan rayapan tanah (soil creep) saat curah hujan {ch_val:.0f} mm/thn; waspada retakan dinding & lantai."
            )
            pondasi = (
                "Gunakan pondasi tiang strauss / mini bore pile menembus lapisan tanah stabil atau pondasi telapak kaku "
                "dengan sloof beton bertulang ekstra; ganti tanah dasar bawah lantai dengan urugan Sirtu padat + geotekstil separator."
            )
            mitigasi = (
                "Buat saluran drainase kedap air (U-Ditch tertutup) di sekeliling bangunan untuk menjaga kelembaban tanah tetap stabil, "
                "serta perkuat batas kavling miring dengan talud pasangan batu kali dan pipa suling-suling (weep hole)."
            )
        else:
            diagnosa = (
                f"Kemiringan lereng {lereng_deg:.1f}° ({lereng_pct:.1f}%) pada tanah {nama_tanah} dan {nama_batuan} "
                f"berisiko mengalami erosi buluh, gerusan kaki lereng, dan pergeseran tanah dangkal saat curah hujan {ch_val:.0f} mm/thn."
            )
            pondasi = (
                "Gunakan pondasi Footplat (telapak beton bertulang) atau Strauss Pile kedalaman 3–5 meter hingga tanah keras; "
                "hindari pondasi batu kali dangkal yang menumpu pada tanah urugan (fill) tanpa pemadatan terukur."
            )
            mitigasi = (
                "Terapkan rekayasa cut-and-fill berjenjang (terasering), bangun talud pasangan batu kali / Dinding Penahan Tanah (DPT) "
                "dilengkapi weep hole + filter geotekstil non-woven, serta pisahkan saluran drainase air hujan dari lereng."
            )
        kpr_status = "Layak dengan Syarat Mitigasi Khusus & Anggaran Tambahan (RAB Penguatan)"
        kpr_kode = "kuning"
    else:
        diagnosa = (
            f"Topografi relatif datar–landai ({lereng_deg:.1f}° / {lereng_pct:.1f}%) pada tanah {nama_tanah} dan {nama_batuan} "
            f"menunjukkan stabilitas lereng yang baik (FS {fs_val:.2f}) dengan risiko gerakan tanah minimal."
        )
        if "regosol" in t_low:
            pondasi = (
                "Layak menggunakan pondasi menerus batu kali dengan sloof pengikat beton bertulang atau Footplat pada bangunan 2 lantai; "
                "pastikan pemadatan tanah dasar (stamper) optimal karena tanah Regosol bertekstur pasir lepas."
            )
        else:
            pondasi = (
                "Layak menggunakan pondasi dangkal batu kali menerus (untuk bangunan 1 lantai) atau kombinasi Footplat beton bertulang "
                "(untuk bangunan 2 lantai) di atas lapisan tanah asli yang stabil."
            )
        mitigasi = (
            "Sediakan jaringan drainase lingkungan standar (saluran tepi & sumur resapan air hujan / biopori) "
            "serta kemiringan perkerasan halaman minimal 2% menuju saluran pembuangan agar bebas genangan."
        )
        kpr_status = "Layak Bangun Langsung (Standar Teknis Normal)"
        kpr_kode = "hijau"

    return {
        "skor_internal": {
            "skor_lereng": skor_lereng,
            "skor_tanah": skor_tanah,
            "skor_batuan": skor_batuan,
            "skor_hujan": skor_hujan,
            "skor_tutupan": skor_tutupan,
            "skor_akhir": skor_akhir,
        },
        "triase": {
            "zona": zona,
            "badge": badge,
            "warna_hex": warna_hex,
            "fs": fs_val,
            "fs_label": fs_label,
            "fs_desc": fs_desc,
            "fs_pct": fs_pct,
        },
        "kondisi_lapangan": {
            "lereng_derajat": round(lereng_deg, 2),
            "lereng_persen": round(lereng_pct, 2),
            "kelas_lereng": kelas_lereng,
            "jenis_tanah": nama_tanah,
            "ket_tanah": ket_tanah,
            "formasi_batuan": nama_batuan,
            "ket_batuan": ket_batuan,
            "curah_hujan_mm": round(ch_val, 0),
            "kelas_hujan": kelas_hujan,
            "tutupan_lahan": nama_tutupan,
            "ket_tutupan": ket_tutupan,
        },
        "rekomendasi_ai": {
            "diagnosa_bahaya": diagnosa,
            "struktur_fondasi": pondasi,
            "mitigasi_drainase": mitigasi,
            "status_kpr": kpr_status,
            "status_kpr_kode": kpr_kode,
        },
    }


# =====================================================================
# IN-MEMORY SPATIAL QUERY ENGINE UNTUK BACKEND (serve_web.py)
# =====================================================================
_SERVER_CACHE = {
    "loaded": False,
    "gdf_admin_utm": None,
    "gdf_admin_wgs": None,
    "day8_layers": {},
    "dusun_list": [],
    "dusun_xy": None,
    "dev_points": [],
    "to_utm": None,
    "to_wgs": None,
}


def _baca_geojson_dari_disk_atau_bundle(nama_file):
    """Baca GeoDataFrame dari Data/processed/<nama_file> atau fallback dari Web/geojson_bundle.js."""
    import json
    p = PROCESSED_DIR / nama_file
    if p.exists():
        gdf = gpd.read_file(p)
    else:
        bundle_p = PROJECT_ROOT / "Web" / "geojson_bundle.js"
        if not bundle_p.exists():
            return None
        raw = bundle_p.read_text(encoding="utf-8")
        idx = raw.find("{")
        obj, _ = json.JSONDecoder().raw_decode(raw[idx:])
        fc = obj.get(nama_file)
        if not fc:
            return None
        gdf = gpd.GeoDataFrame.from_features(fc["features"])

    if gdf is None or gdf.empty:
        return None
    minx, miny, maxx, maxy = gdf.total_bounds
    crs_in = "EPSG:4326" if (-180 <= minx <= maxx <= 180 and -90 <= miny <= maxy <= 90) else TARGET_CRS
    if gdf.crs is None:
        gdf = gdf.set_crs(crs_in)
    return gdf


def muat_data_spasial_server(force=False):
    """
    Muat seluruh dataset GeoJSON terbaru, layer DAY 8, dan 3.580+ titik Dusun/Padukuhan
    ke dalam memori server (`_SERVER_CACHE`) agar query klik peta & pencarian berjalan instan.
    """
    if _SERVER_CACHE["loaded"] and not force:
        return _SERVER_CACHE

    print("[SPATIAL LOADER] Memuat dataset GeoJSON (EPSG:4326 & EPSG:32749), Layer DAY 8, dan Toponimi Dusun ke memori server...")
    _SERVER_CACHE["to_utm"] = pyproj.Transformer.from_crs("EPSG:4326", TARGET_CRS, always_xy=True)
    _SERVER_CACHE["to_wgs"] = pyproj.Transformer.from_crs(TARGET_CRS, "EPSG:4326", always_xy=True)

    gdf_adm = _baca_geojson_dari_disk_atau_bundle("clean_batas_administrasi.geojson")
    if gdf_adm is not None:
        _SERVER_CACHE["gdf_admin_utm"] = gdf_adm.to_crs(TARGET_CRS).reset_index(drop=True)
        _SERVER_CACHE["gdf_admin_wgs"] = gdf_adm.to_crs("EPSG:4326").reset_index(drop=True)

    _SERVER_CACHE["day8_layers"] = baca_layer_day8()

    dusun_list = muat_katalog_dusun_diy(gdf_admin_utm=_SERVER_CACHE["gdf_admin_utm"])
    _SERVER_CACHE["dusun_list"] = dusun_list
    if dusun_list:
        _SERVER_CACHE["dusun_xy"] = np.array(
            [[float(d["easting_x"]), float(d["northing_y"])] for d in dusun_list],
            dtype=float,
        )

    gdf_dev = _baca_geojson_dari_disk_atau_bundle("clean_titik_developer.geojson")
    if gdf_dev is not None and not gdf_dev.empty:
        gdf_dev_wgs = gdf_dev.to_crs("EPSG:4326")
        dev_records = []
        for _, r in gdf_dev_wgs.iterrows():
            dev_records.append({
                "kode_titik": str(r.get("kode_titik", "")),
                "nama_proyek": str(r.get("nama_proyek", "")),
                "nama_dusun": str(r.get("nama_dusun", "")),
                "kalurahan": str(r.get("kalurahan", "")),
                "kapanewon": str(r.get("kapanewon", "")),
                "kabupaten": str(r.get("kabupaten", "")),
                "lat": round(float(r.geometry.centroid.y), 6),
                "lng": round(float(r.geometry.centroid.x), 6),
                "zona_kerawanan": str(r.get("zona_kerawanan", "Zona Hijau")),
            })
        _SERVER_CACHE["dev_points"] = dev_records

    _SERVER_CACHE["loaded"] = True
    print(
        f"[SPATIAL LOADER] Siap melayani query: "
        f"{len(_SERVER_CACHE['gdf_admin_utm']) if _SERVER_CACHE['gdf_admin_utm'] is not None else 0} Kalurahan, "
        f"{len(_SERVER_CACHE['dusun_list'])} Dusun/Padukuhan asli, "
        f"{len(_SERVER_CACHE['day8_layers'])} Layer DAY 8."
    )
    return _SERVER_CACHE


def cari_dusun_terdekat_utm(x_utm, y_utm, kalurahan=None, kabupaten=None):
    """
    Cari nama Dusun / Padukuhan asli terdekat dari koordinat UTM (EPSG:32749)
    menggunakan katalog 3.580+ titik Dusun resmi BIG RBI 25K (`TOPONIMI_PT_25K.shp`).
    Utamakan titik Dusun yang berada di dalam Kalurahan yang sama.
    """
    cache = muat_data_spasial_server()
    dusun_list = cache["dusun_list"]
    dusun_xy = cache["dusun_xy"]
    if not dusun_list or dusun_xy is None:
        return None

    dists = np.hypot(dusun_xy[:, 0] - float(x_utm), dusun_xy[:, 1] - float(y_utm))
    if kalurahan:
        kal_low = str(kalurahan).strip().lower()
        same_kal_idx = [i for i, d in enumerate(dusun_list) if str(d.get("kalurahan", "")).strip().lower() == kal_low]
        if same_kal_idx:
            sub_dists = dists[same_kal_idx]
            best_local = same_kal_idx[int(np.argmin(sub_dists))]
            if dists[best_local] <= 3500.0:
                return dusun_list[best_local]

    best_idx = int(np.argmin(dists))
    return dusun_list[best_idx]


def query_spasial_titik_backend(lat, lng, dusun_hint=None):
    """
    Fungsi utama Point-in-Polygon & Evaluasi Geoteknik DAY 8 di backend:
    Menerima koordinat klik/pencarian (lat, lng dalam EPSG:4326), mengonversi ke
    EPSG:32749 (UTM 49S), mengekstrak atribut wilayah & layer DAY 8, mencari nama
    Dusun/Padukuhan asli terdekat, dan mengembalikan hasil penilaian lengkap.
    """
    import json
    from shapely.geometry import Point, mapping

    cache = muat_data_spasial_server()
    lat_f = float(lat)
    lng_f = float(lng)
    x_utm, y_utm = cache["to_utm"].transform(lng_f, lat_f)
    pt_utm = Point(x_utm, y_utm)

    gdf_adm_utm = cache["gdf_admin_utm"]
    gdf_adm_wgs = cache["gdf_admin_wgs"]
    row_adm = None
    geom_wgs_dict = None
    adm_idx = None

    if gdf_adm_utm is not None and not gdf_adm_utm.empty:
        hits = gdf_adm_utm[gdf_adm_utm.geometry.contains(pt_utm)]
        if hits.empty:
            # Cek jarak terdekat bila klik sedikit di tepi batas DIY (< 1,5 km)
            dists = gdf_adm_utm.geometry.distance(pt_utm)
            min_i = int(dists.idxmin())
            if float(dists.loc[min_i]) <= 1500.0:
                adm_idx = min_i
        else:
            adm_idx = int(hits.index[0])

        if adm_idx is not None:
            row_adm = gdf_adm_utm.loc[adm_idx]
            geom_wgs_dict = mapping(gdf_adm_wgs.loc[adm_idx].geometry)

    if row_adm is None:
        return {
            "status": "outside_diy",
            "message": "Titik berada di luar cakupan wilayah riset DIY (Kab. Sleman, Kab. Bantul, Kota Yogyakarta).",
            "koordinat": {
                "lat": round(lat_f, 6),
                "lng": round(lng_f, 6),
                "easting_x": round(x_utm, 2),
                "northing_y": round(y_utm, 2),
                "epsg_wgs84": "EPSG:4326",
                "epsg_utm": "EPSG:32749",
            },
        }

    kalurahan = str(row_adm.get("kalurahan", "-"))
    kapanewon = str(row_adm.get("kapanewon", "-"))
    kabupaten = str(row_adm.get("kabupaten", "Kab. Sleman"))
    luas_ha = float(row_adm.get("luas_ha", 0.0))
    elevasi_mdpl = float(row_adm.get("elevasi_mdpl", 120.0))

    # Tentukan nama Dusun/Padukuhan asli (bukan inisial atau 'Dusun / Area <Kalurahan>')
    nama_dusun = ""
    if dusun_hint:
        hint_clean = str(dusun_hint).strip()
        if (
            hint_clean
            and not hint_clean.lower().startswith("dusun / area")
            and not hint_clean.upper().startswith("MTR-")
            and hint_clean.lower() != f"kalurahan {kalurahan.lower()}"
            and hint_clean.lower() != f"kelurahan {kalurahan.lower()}"
        ):
            nama_dusun = hint_clean

    if not nama_dusun:
        d_near = cari_dusun_terdekat_utm(x_utm, y_utm, kalurahan=kalurahan, kabupaten=kabupaten)
        if d_near and d_near.get("nama_dusun"):
            nama_dusun = str(d_near["nama_dusun"])
        elif "dusun_utama" in row_adm and pd.notna(row_adm["dusun_utama"]) and str(row_adm["dusun_utama"]).strip():
            nama_dusun = str(row_adm["dusun_utama"]).strip()
        else:
            nama_dusun = format_nama_dusun_asli(kalurahan, kabupaten)

    # Ambil nilai dasar dari poligon Kalurahan & ekstraksi piksel kontinu DEMNAS (EPSG:32749)
    lereng_deg = float(row_adm.get("lereng_derajat", 4.0))
    lereng_pct = float(row_adm.get("lereng_persen", 7.0))
    skor_lereng = int(row_adm.get("skor_lereng", 1))
    try:
        dem_pt = sampling_demnas_utm(np.array([x_utm]), np.array([y_utm]), radius_m=50.0)
        if not np.isnan(dem_pt["elevasi_titik_mdpl"][0]):
            elevasi_mdpl = float(dem_pt["elevasi_titik_mdpl"][0])
        if not np.isnan(dem_pt["lereng_area_derajat"][0]) and not np.isnan(dem_pt["lereng_area_persen"][0]):
            lereng_deg = float(dem_pt["lereng_area_derajat"][0])
            lereng_pct = float(dem_pt["lereng_area_persen"][0])
    except Exception:
        pass

    jenis_tanah = str(row_adm.get("jenis_tanah", "Regosol"))
    skor_tanah = int(row_adm.get("skor_tanah", 3))
    c_kpa = None
    phi_deg = None
    formasi_batuan = str(row_adm.get("formasi_batuan", "Formasi Gunungapi Merapi Muda (Qmi)"))
    skor_batuan = int(row_adm.get("skor_batuan", 2))
    ch_mm = float(row_adm.get("ch_idw_mm", 2200.0))
    skor_hujan = int(row_adm.get("skor_hujan", 3))
    rasio_m = None
    tutupan_lahan = str(row_adm.get("tutupan_dominan", "Permukiman dan Tempat Kegiatan"))
    skor_tutupan = int(row_adm.get("skor_tutupan", 3))

    # Query langsung ke Layer Vektor Spesifik DAY 8 pada titik (x_utm, y_utm) bila tersedia
    # CATATAN: Skor lereng 1 s.d. 5 hanya digunakan untuk bobot kerawanan makro, TIDAK menimpa lereng_deg/lereng_pct asli DEMNAS
    d8 = cache.get("day8_layers", {})
    if "lereng" in d8 and not d8["lereng"].empty:
        hit = d8["lereng"][d8["lereng"].geometry.contains(pt_utm)]
        if not hit.empty:
            r8 = hit.iloc[0]
            s_l8 = pd.to_numeric(r8.get("skor_lereng", r8.get("skor", skor_lereng)), errors="coerce")
            if pd.notna(s_l8):
                skor_lereng = int(s_l8)

    if "tanah" in d8 and not d8["tanah"].empty:
        hit = d8["tanah"][d8["tanah"].geometry.contains(pt_utm)]
        if not hit.empty:
            r8 = hit.iloc[0]
            if pd.notna(r8.get("jns_tnh")):
                jenis_tanah = str(r8.get("jns_tnh")).strip()
            if pd.notna(r8.get("skor tanah")):
                skor_tanah = int(r8.get("skor tanah"))
            if pd.notna(r8.get("c_kpa")):
                c_kpa = float(r8.get("c_kpa"))
            if pd.notna(r8.get("phi_deg")):
                phi_deg = float(r8.get("phi_deg"))

    if "geologi" in d8 and not d8["geologi"].empty:
        hit = d8["geologi"][d8["geologi"].geometry.contains(pt_utm)]
        if not hit.empty:
            r8 = hit.iloc[0]
            nm_b = str(r8.get("NAME", "")).strip()
            sym_b = str(r8.get("SYMBOLS", "")).strip()
            ket_b = str(r8.get("ket_batuan", "")).strip()
            if ket_b:
                formasi_batuan = f"{ket_b} ({sym_b})" if sym_b else ket_b
            elif nm_b:
                formasi_batuan = f"{nm_b} ({sym_b})" if sym_b else nm_b
            if pd.notna(r8.get("skor_batuan")):
                skor_batuan = int(r8.get("skor_batuan"))

    if "hujan" in d8 and not d8["hujan"].empty:
        hit = d8["hujan"][d8["hujan"].geometry.contains(pt_utm)]
        if not hit.empty:
            r8 = hit.iloc[0]
            if pd.notna(r8.get("skor_hujan")):
                skor_hujan = int(r8.get("skor_hujan"))
            if pd.notna(r8.get("rasio_m")):
                rasio_m = float(r8.get("rasio_m"))

    if "lahan" in d8 and not d8["lahan"].empty:
        hit = d8["lahan"][d8["lahan"].geometry.contains(pt_utm)]
        if not hit.empty:
            r8 = hit.iloc[0]
            if pd.notna(r8.get("pl")):
                tutupan_lahan = str(r8.get("pl")).strip()
            if pd.notna(r8.get("skor_lahan")):
                skor_tutupan = int(r8.get("skor_lahan"))

    eval_res = evaluasi_geoteknik_day8_backend(
        lereng_deg=lereng_deg,
        lereng_pct=lereng_pct,
        jenis_tanah_str=jenis_tanah,
        formasi_batuan_str=formasi_batuan,
        ch_mm=ch_mm,
        tutupan_str=tutupan_lahan,
        skor_lereng_override=skor_lereng,
        skor_tanah_override=skor_tanah,
        skor_batuan_override=skor_batuan,
        skor_hujan_override=skor_hujan,
        skor_tutupan_override=skor_tutupan,
        c_kpa_override=c_kpa,
        phi_deg_override=phi_deg,
        rasio_m_override=rasio_m,
    )

    prefix_desa = "Kelurahan" if kabupaten == "Kota Yogyakarta" else "Kalurahan"
    prefix_kec = "Kemantren" if kabupaten == "Kota Yogyakarta" else "Kapanewon"

    return {
        "status": "ok",
        "koordinat": {
            "lat": round(lat_f, 6),
            "lng": round(lng_f, 6),
            "easting_x": round(x_utm, 2),
            "northing_y": round(y_utm, 2),
            "epsg_wgs84": "EPSG:4326",
            "epsg_utm": "EPSG:32749",
        },
        "wilayah": {
            "nama_dusun": nama_dusun,
            "kalurahan": kalurahan,
            "kapanewon": kapanewon,
            "kabupaten": kabupaten,
            "prefix_desa": prefix_desa,
            "prefix_kec": prefix_kec,
            "label_lengkap": f"{nama_dusun}, {prefix_desa} {kalurahan}, {prefix_kec} {kapanewon}, {kabupaten}",
            "luas_ha": round(luas_ha, 2),
            "elevasi_mdpl": round(elevasi_mdpl, 1),
        },
        "triase": eval_res["triase"],
        "kondisi_lapangan": eval_res["kondisi_lapangan"],
        "rekomendasi_ai": eval_res["rekomendasi_ai"],
        "geometry_wilayah": geom_wgs_dict,
    }


def cari_lokasi_backend(q="", kab="ALL", zona="ALL", limit=60):
    """
    Cari Dusun/Padukuhan, Kalurahan/Desa, Kapanewon/Kecamatan, atau Kabupaten di DIY
    dari katalog 3.580+ Dusun resmi BIG RBI 25K + 206 Kalurahan.
    """
    cache = muat_data_spasial_server()
    q_low = str(q or "").strip().lower()
    q_clean = re.sub(r"^(dusun|padukuhan|dukuh|kampung|kalurahan|kelurahan|desa|kapanewon|kemantren|kecamatan)\s+", "", q_low).strip()

    results = []
    seen = set()

    # 1. Cari pada katalog 3.580+ Dusun/Padukuhan asli
    for d in cache.get("dusun_list", []):
        kab_d = str(d.get("kabupaten", ""))
        zona_d = str(d.get("zona_kerawanan", "Zona Hijau"))
        if kab != "ALL" and kab_d != kab:
            continue
        if zona != "ALL" and zona_d != zona:
            continue

        nm = str(d.get("nama_dusun", ""))
        kal = str(d.get("kalurahan", ""))
        kec = str(d.get("kapanewon", ""))
        haystack = f"{nm} {kal} {kec} {kab_d}".lower()
        if q_low and (q_low not in haystack and (not q_clean or q_clean not in haystack)):
            continue

        # Beri skor relevansi agar pencarian presisi berada di urutan teratas
        score_rel = 0
        nm_low = nm.lower()
        if q_clean and nm_low.endswith(q_clean):
            score_rel = 100
        elif q_clean and q_clean in nm_low:
            score_rel = 80
        elif q_clean and kal.lower() == q_clean:
            score_rel = 70
        elif q_clean and kec.lower() == q_clean:
            score_rel = 60
        else:
            score_rel = 40

        key_u = f"{nm}|{kal}|{kec}"
        if key_u in seen:
            continue
        seen.add(key_u)
        results.append({
            "tipe": "Dusun",
            "nama_dusun": nm,
            "kalurahan": kal,
            "kapanewon": kec,
            "kabupaten": kab_d,
            "lat": float(d["lat"]),
            "lng": float(d["lng"]),
            "zona_kerawanan": zona_d,
            "_rel": score_rel,
        })
        if not q_low and len(results) >= limit:
            break

    results.sort(key=lambda x: (-x["_rel"], x["nama_dusun"]))
    out = results[:limit]
    for item in out:
        item.pop("_rel", None)
    return {
        "status": "ok",
        "total_katalog_dusun": len(cache.get("dusun_list", [])),
        "count": len(out),
        "results": out,
    }



