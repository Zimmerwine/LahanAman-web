"""
clean_geojson.py
================
Fungsi pembersihan geometri 2D, perbaikan topologi (anti-overlap, anti-sliver,
anti-duplicate-node, anti-nested-shell), dan penyimpanan ke file GeoJSON
dengan sistem koordinat standar proyek EPSG:32749 (WGS 84 / UTM Zone 49S).
"""
import os
import pyproj

_PROJ_DIR = pyproj.datadir.get_data_dir()
os.environ["PROJ_LIB"] = _PROJ_DIR
os.environ["PROJ_DATA"] = _PROJ_DIR

import geopandas as gpd
import shapely
from shapely import force_2d, make_valid, remove_repeated_points
from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry.polygon import orient
from shapely.strtree import STRtree

from spatial_loader import (
    EXTRACT_DIR,
    GEOJSON_CRS,
    PROCESSED_DIR,
    PROJECT_ROOT,
    TARGET_CRS,
    interpolasi_idw,
)


# =====================================================================
# GEOMETRI 2D & VALIDASI (EPSG:32749)
# =====================================================================
def ekstrak_poligon(geom, min_area_m2=0.0):
    """Ambil semua Polygon dari geometri apa pun (buang garis/titik hasil make_valid)."""
    if geom is None or geom.is_empty:
        return []
    parts = shapely.get_parts(geom)
    polys = [p for p in parts if isinstance(p, Polygon) and not p.is_empty]
    if min_area_m2 > 0:
        polys = [p for p in polys if p.area >= min_area_m2]
    return polys


def _bersihkan_ring_duplikat(poly, tol_m=1e-3, min_area_m2=0.0):
    """Hapus titik berurutan yang berjarak < tol_m agar bebas duplicate node di QGIS."""
    if poly is None or poly.is_empty:
        return []
    poly_awal = poly
    poly = remove_repeated_points(poly, tolerance=tol_m)
    if poly is None or poly.is_empty:
        poly = remove_repeated_points(poly_awal, tolerance=1e-6)
    if not poly.is_valid:
        poly = make_valid(poly)
    hasil = []
    for p in ekstrak_poligon(poly, min_area_m2=min_area_m2):
        p_clean = remove_repeated_points(p, tolerance=tol_m)
        if p_clean is None or p_clean.is_empty or len(p_clean.exterior.coords) < 4:
            p_clean = remove_repeated_points(p, tolerance=1e-6)
        if p_clean is not None and not p_clean.is_empty and len(p_clean.exterior.coords) >= 4:
            if not p_clean.is_valid:
                p_clean = make_valid(p_clean)
                for sub in ekstrak_poligon(p_clean, min_area_m2=min_area_m2):
                    hasil.append(orient(sub, sign=1.0))
            else:
                hasil.append(orient(p_clean, sign=1.0))
    if not hasil and min_area_m2 == 0.0:
        for sub in ekstrak_poligon(make_valid(poly_awal)):
            if len(sub.exterior.coords) >= 4:
                hasil.append(orient(sub, sign=1.0))
    return hasil


def orient_2d(geom):
    """Pastikan 2D, valid, tanpa titik duplikat, dan mengikuti right-hand rule."""
    if geom is None or geom.is_empty:
        return None
    geom = force_2d(geom)
    if not geom.is_valid:
        geom = make_valid(geom)
    if isinstance(geom, Polygon):
        polys = _bersihkan_ring_duplikat(geom)
        return polys[0] if len(polys) == 1 else (MultiPolygon(polys) if polys else None)
    if isinstance(geom, MultiPolygon):
        polys = []
        for p in geom.geoms:
            polys.extend(_bersihkan_ring_duplikat(p))
        return MultiPolygon(polys) if polys else None
    return geom


def to_2d_multipolygon(geom, min_area_m2=0.0):
    """Perbaiki geometri, buang Z, hapus duplicate node, dan kembalikan MultiPolygon valid."""
    if geom is None or geom.is_empty:
        return None
    geom = force_2d(geom)
    # Jalur cepat untuk MultiPolygon besar (mis. layer lereng GPKG) yang sudah valid
    if isinstance(geom, MultiPolygon) and min_area_m2 <= 0.0 and len(geom.geoms) > 250 and geom.is_valid:
        g_clean = remove_repeated_points(geom, tolerance=1e-3)
        if g_clean is not None and not g_clean.is_empty and g_clean.is_valid:
            polys_fast = [orient(p, sign=1.0) for p in ekstrak_poligon(g_clean) if len(p.exterior.coords) >= 4]
            if polys_fast:
                mp_fast = MultiPolygon(polys_fast)
                if mp_fast.is_valid:
                    return mp_fast
    if not geom.is_valid:
        geom = make_valid(geom)
    polys = []
    for p in ekstrak_poligon(geom, min_area_m2=min_area_m2):
        polys.extend(_bersihkan_ring_duplikat(p, tol_m=1e-3, min_area_m2=min_area_m2))
    if not polys:
        return None
    mp = MultiPolygon(polys)
    if not mp.is_valid:
        # Union bagian yang bersarang/beririsan (mis. 'Polygon 3 lies inside polygon 1')
        unioned = shapely.union_all(polys)
        if not unioned.is_valid:
            unioned = make_valid(unioned)
        polys = []
        for p in ekstrak_poligon(unioned, min_area_m2=min_area_m2):
            polys.extend(_bersihkan_ring_duplikat(p, tol_m=1e-3, min_area_m2=min_area_m2))
        mp = MultiPolygon(polys) if polys else None
    return mp


def bersihkan_poligon_utm(geom, min_area_m2=1.0, min_lebar_m=0.05):
    """
    Saring bagian poligon/lubang sliver yang terlalu sempit (< 2*min_lebar_m),
    gabungkan pulau di dalam lubang yang tertutup dengan union_all agar tidak terjadi
    'Polygon lies inside polygon', dan hapus titik duplikat (< 1 mm).
    """
    mp = to_2d_multipolygon(geom, min_area_m2=min_area_m2)
    if mp is None:
        return None
    polys = []
    for p in mp.geoms:
        p = remove_repeated_points(p, tolerance=1e-3)
        if not p.is_valid:
            p = make_valid(p)
        for sub in ekstrak_poligon(p, min_area_m2=min_area_m2):
            if min_lebar_m > 0 and sub.buffer(-min_lebar_m).is_empty:
                continue
            holes = [
                r for r in sub.interiors
                if Polygon(r).area >= min_area_m2
                and (min_lebar_m <= 0 or not Polygon(r).buffer(-min_lebar_m).is_empty)
            ]
            utuh = Polygon(sub.exterior, holes).buffer(0)
            for b in ekstrak_poligon(utuh, min_area_m2=min_area_m2):
                polys.extend(_bersihkan_ring_duplikat(b, tol_m=1e-3, min_area_m2=min_area_m2))
    if not polys:
        return None
    # Union seluruh komponen poligon agar tidak ada pulau bersarang di dalam poligon utama
    gabung = shapely.union_all(polys) if len(polys) > 1 else polys[0]
    return to_2d_multipolygon(gabung, min_area_m2=min_area_m2)


def tutup_celah_kecil(poly_atau_mp, max_hole_m2=100.0):
    """Tutup lubang/sliver mikro di dalam batas wilayah akibat digitasi desa."""
    polys = []
    for p in ekstrak_poligon(poly_atau_mp):
        interiors = [ring for ring in p.interiors if Polygon(ring).area > max_hole_m2]
        polys.append(orient(Polygon(p.exterior, interiors), sign=1.0))
    if not polys:
        return None
    gabung = shapely.union_all(polys) if len(polys) > 1 else polys[0]
    return to_2d_multipolygon(gabung)


# =====================================================================
# PERBAIKAN & HITUNG OVERLAP ANTAR FITUR
# =====================================================================
def hilangkan_overlap_internal(gdf_utm, ambang_m2=1.0):
    """
    Hilangkan tumpang-tindih nyata (> ambang_m2) antar poligon di dalam satu
    GeoDataFrame (EPSG:32749) tanpa menyentuh pasangan yang hanya bersinggungan batas.
    """
    geoms = list(gdf_utm.geometry.values)
    tree = STRtree(geoms)
    left, right = tree.query(geoms, predicate="intersects")
    mask = left < right
    left, right = left[mask], right[mask]
    if len(left) > 0:
        inter_area = shapely.area(shapely.intersection(
            [geoms[i] for i in left],
            [geoms[j] for j in right],
        ))
        for i, j, area in zip(left, right, inter_area):
            if area > ambang_m2 and geoms[i] is not None and geoms[j] is not None:
                potong = geoms[j].difference(geoms[i])
                geoms[j] = bersihkan_poligon_utm(potong, min_area_m2=ambang_m2, min_lebar_m=0.05)

    out = gdf_utm.copy()
    out["geometry"] = geoms
    out = out[out.geometry.notnull() & ~out.geometry.is_empty].copy()
    return out.reset_index(drop=True)


def hitung_overlap_m2(gdf_utm, ambang_m2=1.0):
    """Kembalikan (jumlah_pasangan, total_luas_m2) poligon yang saling tumpang-tindih."""
    geoms = [to_2d_multipolygon(g) if not g.is_valid else g for g in gdf_utm.geometry.values]
    tree = STRtree(geoms)
    left, right = tree.query(geoms, predicate="intersects")
    mask = left < right
    left, right = left[mask], right[mask]
    if len(left) == 0:
        return 0, 0.0
    inter_area = shapely.area(shapely.intersection(
        [geoms[i] for i in left],
        [geoms[j] for j in right],
    ))
    sig = inter_area > ambang_m2
    return int(sig.sum()), float(inter_area[sig].sum())


# =====================================================================
# EKSPOR GEOJSON STANDAR PROYEK (Metrik EPSG:32749 -> Output EPSG:4326)
# =====================================================================
def simpan_geojson_standar(gdf, nama_file):
    """
    Hitung metrik geometri (luas_ha, luas_jangkauan_ha, luas_cakupan_diy_km2)
    dan validasi topologi 2D secara presisi di EPSG:32749 (UTM 49S), lalu
    ekspor dan simpan hasil akhirnya sebagai GeoJSON berproyeksi EPSG:4326 (WGS84)
    agar terbaca langsung oleh Leaflet.
    """
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    path = PROCESSED_DIR / nama_file

    if gdf.crs is None:
        gdf_utm = gdf.set_crs(TARGET_CRS).copy()
    elif str(gdf.crs).upper() != TARGET_CRS:
        gdf_utm = gdf.to_crs(TARGET_CRS).copy()
    else:
        gdf_utm = gdf.copy()

    is_poly = gdf_utm.geom_type.isin(["Polygon", "MultiPolygon"]).all()
    if is_poly:
        gdf_utm["geometry"] = [to_2d_multipolygon(g) for g in gdf_utm.geometry]
    else:
        gdf_utm["geometry"] = [orient_2d(g) for g in gdf_utm.geometry]
    gdf_utm = gdf_utm[gdf_utm.geometry.notnull() & ~gdf_utm.geometry.is_empty].copy()

    # Pastikan atribut luas selalu 100% dihitung dalam EPSG:32749 (UTM 49S, satuan meter)
    if is_poly:
        if "luas_ha" in gdf_utm.columns:
            decimals = 4 if "tutupan_lahan" in nama_file else 2
            gdf_utm["luas_ha"] = (gdf_utm.geometry.area / 10_000.0).round(decimals)
        if "luas_jangkauan_ha" in gdf_utm.columns:
            gdf_utm["luas_jangkauan_ha"] = (gdf_utm.geometry.area / 10_000.0).round(2)
        if "luas_cakupan_diy_km2" in gdf_utm.columns:
            gdf_utm["luas_cakupan_diy_km2"] = (gdf_utm.geometry.area / 1_000_000.0).round(2)

    # Ekspor hasil akhir sebagai EPSG:4326 (WGS84) untuk kompatibilitas langsung Leaflet
    gdf_out = gdf_utm.to_crs(GEOJSON_CRS).copy()
    gdf_out.to_file(path, driver="GeoJSON", layer=path.stem)
    print(f"  -> [GEOJSON] Tersimpan: {path} ({len(gdf_out)} fitur | Metrik={TARGET_CRS} -> Output={GEOJSON_CRS})")
    return path


def ringkasan_geojson():
    """Cetak ringkasan cepat seluruh file GeoJSON yang dihasilkan di Data/processed."""
    print(f"\n[RINGKASAN GEOJSON] Seluruh output GeoJSON dalam {GEOJSON_CRS}:")
    for p in sorted(PROCESSED_DIR.glob("*.geojson")):
        gdf = gpd.read_file(p)
        n_invalid = int((~gdf.is_valid).sum())
        n_null_attr = int(gdf.drop(columns="geometry").isna().sum().sum())
        tipe = gdf.geom_type.value_counts().to_dict()
        print(f"  - {p.name}: {len(gdf)} fitur | CRS={gdf.crs} | tipe={tipe} | "
              f"invalid={n_invalid} | null_atribut={n_null_attr}")


def ekstrak_curah_hujan_day8_standar():
    """
    Ekstrak dan standarisasi langsung data spasial curah hujan asli dari repositori DAY 8:
      - Sumber Poligon Kontur: `Data/raw/extracted/DAY 8/.../Layer4_Curah Hujan/GJS_Layer4_CurahHujan_SlemanBantul.geojson`
      - Sumber Stasiun Hujan IDW: `GPKG_Baru Curah Hujan.gpkg` (22 stasiun hujan dengan atribut
        'Rata-rata Curah Hujan (mm/tahun)' & koordinat UTM 49S)
    Menghasilkan `Data/processed/clean_curah_hujan_idw.geojson` dalam proyeksi `EPSG:4326` (WGS84)
    dengan atribut standar:
      - `curah_hujan_mm` : Nilai curah hujan tahunan hasil interpolasi IDW stasiun asli pada kontur (mm/thn)
      - `skor_hujan`     : Klasifikasi acuan DAY 8 (1 s.d. 5)
      - `rasio_m`        : Rasio kejenuhan air tanah geoteknik Terzaghi (0.30, 0.45, 0.60, 0.75, 0.90)
    """
    import glob
    import numpy as np
    import pandas as pd

    matches_gjs = glob.glob(
        str(EXTRACT_DIR / "**" / "*Layer4_CurahHujan_SlemanBantul*.geojson"),
        recursive=True,
    )
    if not matches_gjs:
        raise FileNotFoundError("File GJS_Layer4_CurahHujan_SlemanBantul.geojson tidak ditemukan di Data/raw/extracted.")

    src_path = matches_gjs[0]
    print(f"\n[CURAH HUJAN DAY 8] Membaca kontur curah hujan asli: {src_path}")
    gdf_raw = gpd.read_file(src_path)
    if gdf_raw.crs is None:
        gdf_raw = gdf_raw.set_crs(TARGET_CRS)
    elif str(gdf_raw.crs).upper() != TARGET_CRS:
        gdf_raw = gdf_raw.to_crs(TARGET_CRS)

    # Baca titik stasiun hujan asli dari GPKG_Baru Curah Hujan.gpkg untuk menghitung nilai kontinu curah_hujan_mm per poligon kontur
    matches_gpkg = glob.glob(
        str(EXTRACT_DIR / "**" / "*Baru Curah Hujan*.gpkg"),
        recursive=True,
    )
    pos_x, pos_y, pos_ch = None, None, None
    if matches_gpkg:
        gdf_st = gpd.read_file(matches_gpkg[0])
        if gdf_st.crs is None:
            gdf_st = gdf_st.set_crs(TARGET_CRS)
        elif str(gdf_st.crs).upper() != TARGET_CRS:
            gdf_st = gdf_st.to_crs(TARGET_CRS)
        col_ch = next(
            (c for c in gdf_st.columns if "curah hujan" in c.lower() or "rerata" in c.lower()),
            None,
        )
        if col_ch is not None:
            pos_x = np.array([g.centroid.x for g in gdf_st.geometry], dtype=float)
            pos_y = np.array([g.centroid.y for g in gdf_st.geometry], dtype=float)
            pos_ch = pd.to_numeric(gdf_st[col_ch], errors="coerce").dropna().values

    # Peta klasifikasi acuan asli GPKG/GJS Layer4_CurahHujan & Day1_Master_Curah_Hujan (warna_peta_arcmap)
    peta_skor_day8 = {
        1: {
            "ket_hujan": "< 1.500 mm/th (Sangat Rendah)",
            "rasio_m": 0.30,
            "warna_hex": "#1F7A1F",
            "rentang": (1200.0, 1499.0),
        },
        2: {
            "ket_hujan": "1.500 - 2.000 mm/th (Rendah)",
            "rasio_m": 0.45,
            "warna_hex": "#66CC00",
            "rentang": (1500.0, 2000.0),
        },
        3: {
            "ket_hujan": "2.001 - 2.500 mm/th (Sedang)",
            "rasio_m": 0.60,
            "warna_hex": "#FFFF00",
            "rentang": (2001.0, 2500.0),
        },
        4: {
            "ket_hujan": "2.501 - 3.000 mm/th (Tinggi)",
            "rasio_m": 0.75,
            "warna_hex": "#FF8C00",
            "rentang": (2501.0, 3000.0),
        },
        5: {
            "ket_hujan": "> 3.000 mm/th (Sangat Tinggi)",
            "rasio_m": 0.90,
            "warna_hex": "#FF1A00",
            "rentang": (3001.0, 3600.0),
        },
    }

    # Pecah MultiPolygon menjadi zona kontur regional (gabungkan sliver mikro < 2 ha ke poligon induk kelas yang sama)
    exploded_rows = []
    for _, row in gdf_raw.iterrows():
        skor_raw = int(pd.to_numeric(row.get("skor_hujan", row.get("skor", 3)), errors="coerce"))
        skor_h = min(max(skor_raw, 1), 5)
        info_s = peta_skor_day8[skor_h]
        ket_h = str(row.get("ket_hujan", info_s["ket_hujan"])).strip() or info_s["ket_hujan"]
        rasio_m = float(info_s["rasio_m"])

        geom_clean = to_2d_multipolygon(row.geometry, min_area_m2=0.0)
        if geom_clean is None or geom_clean.is_empty:
            continue
        parts = list(geom_clean.geoms) if isinstance(geom_clean, MultiPolygon) else [geom_clean]
        big_parts = [p for p in parts if p.area >= 20_000.0]
        small_parts = [p for p in parts if p.area < 20_000.0]
        if not big_parts:
            big_parts = parts
            small_parts = []
        for sp in small_parts:
            dists = [bp.distance(sp) for bp in big_parts]
            imin = int(np.argmin(dists))
            big_parts[imin] = to_2d_multipolygon(shapely.union_all([big_parts[imin], sp]))

        for bp in big_parts:
            exploded_rows.append({
                "skor_hujan": skor_h,
                "ket_hujan": ket_h,
                "rasio_m": rasio_m,
                "geometry": to_2d_multipolygon(bp),
            })

    # Urutkan dari skor tertinggi ke terendah dan lokasi utara ke selatan
    exploded_rows.sort(key=lambda r: (-r["skor_hujan"], -r["geometry"].centroid.y))

    records = []
    for idx, item in enumerate(exploded_rows, start=1):
        geom_k = item["geometry"]
        skor_h = int(item["skor_hujan"])
        rasio_m = float(item["rasio_m"])
        ket_h = str(item["ket_hujan"])
        info_s = peta_skor_day8[skor_h]
        lo_ch, hi_ch = info_s["rentang"]

        # Hitung nilai curah_hujan_mm kontinu dari grid IDW stasiun asli di dalam poligon kontur
        ch_mean = round((lo_ch + hi_ch) / 2.0)
        ch_min = round(lo_ch)
        ch_max = round(hi_ch)
        if pos_x is not None and len(pos_x) > 0:
            minx, miny, maxx, maxy = geom_k.bounds
            step_m = 250.0
            xs = np.arange(minx + step_m / 2.0, maxx, step_m)
            ys = np.arange(miny + step_m / 2.0, maxy, step_m)
            if len(xs) > 0 and len(ys) > 0:
                gx, gy = np.meshgrid(xs, ys)
                px, py = gx.ravel(), gy.ravel()
                mask = shapely.contains_xy(geom_k, px, py)
                if np.any(mask):
                    vals = interpolasi_idw(px[mask], py[mask], pos_x, pos_y, pos_ch, power=2.0)
                    ch_mean = int(round(float(np.mean(vals))))
                    ch_min = int(round(float(np.min(vals))))
                    ch_max = int(round(float(np.max(vals))))
                else:
                    rp = geom_k.representative_point()
                    val_c = float(interpolasi_idw([rp.x], [rp.y], pos_x, pos_y, pos_ch, power=2.0)[0])
                    ch_mean = int(round(val_c))
                    ch_min = ch_mean
                    ch_max = ch_mean

        # Pastikan nilai curah_hujan_mm konsisten dengan rentang klasifikasi DAY 8 pada poligon kontur tersebut
        if ch_mean < lo_ch:
            ch_mean = int(round(lo_ch + 25.0))
        elif ch_mean > hi_ch and skor_h < 5:
            ch_mean = int(round(hi_ch - 25.0))

        rp = geom_k.representative_point()
        kid = f"KONTUR-CH-{idx:02d}"
        nama_zona = f"Zona Kontur Curah Hujan Skor {skor_h} ({ket_h})"

        records.append({
            "id_daerah_idw": kid,
            "nama_daerah_peta": nama_zona,
            "parameter_nama": "curah_hujan",
            "curah_hujan_mm": int(ch_mean),
            "skor_hujan": int(skor_h),
            "rasio_m": round(float(rasio_m), 2),
            "ket_hujan": ket_h,
            "klasifikasi": ket_h,
            "skor": int(skor_h),
            "bobot": 0.20,
            "nilai_tertimbang_p2": round(0.20 * skor_h, 2),
            "warna_hex": info_s["warna_hex"],
            "ch_idw_rerata_mm": float(ch_mean),
            "ch_idw_min_mm": float(ch_min),
            "ch_idw_maks_mm": float(ch_max),
            "easting_x": round(rp.x, 2),
            "northing_y": round(rp.y, 2),
            "luas_ha": round(geom_k.area / 10_000.0, 2),
            "sumber_data_hujan": "Ekstraksi Spasial Asli GJS_Layer4_CurahHujan_SlemanBantul.geojson & GPKG_Baru Curah Hujan (DAY 8)",
            "geometry": geom_k,
        })

    gdf_out = gpd.GeoDataFrame(records, geometry="geometry", crs=TARGET_CRS)
    simpan_geojson_standar(gdf_out, "clean_curah_hujan_idw.geojson")
    return gdf_out


def ekstrak_kerawanan_longsor_day8_standar(gdf_admin_utm=None, gdf_hujan_utm=None):
    """
    Ekstrak dan standarisasi file master Peta Kerawanan Longsor komposit 5 parameter:
      `Peta_Kerawanan_Longsor_SlemanBantul_Final.gpkg`
    menjadi `Data/processed/clean_kerawanan_longsor.geojson` dalam proyeksi `EPSG:4326` (WGS84),
    lengkap dengan nama wilayah administrasi, skor akhir tertimbang, dan status zona triase
    (Zona Hijau, Zona Kuning, Zona Merah).
    """
    import glob
    import numpy as np
    import pandas as pd

    matches_kr = glob.glob(
        str(EXTRACT_DIR / "**" / "*Peta_Kerawanan_Longsor_SlemanBantul_Final*.gpkg"),
        recursive=True,
    )
    if not matches_kr:
        matches_kr = glob.glob(
            str(EXTRACT_DIR / "**" / "*Peta_Kerawanan_Longsor_SlemanBantul_Final*.geojson"),
            recursive=True,
        )
    if not matches_kr:
        raise FileNotFoundError("File Peta_Kerawanan_Longsor_SlemanBantul_Final tidak ditemukan di Data/raw/extracted.")

    src_path = matches_kr[0]
    print(f"\n[KERAWANAN LONGSOR DAY 8] Membaca peta master komposit 5 parameter: {src_path}")
    gdf_kr = gpd.read_file(src_path)
    if gdf_kr.crs is None:
        gdf_kr = gdf_kr.set_crs(TARGET_CRS)
    elif str(gdf_kr.crs).upper() != TARGET_CRS:
        gdf_kr = gdf_kr.to_crs(TARGET_CRS)

    gdf_kr["geometry"] = [to_2d_multipolygon(g, min_area_m2=1.0) for g in gdf_kr.geometry]
    gdf_kr = gdf_kr[gdf_kr.geometry.notnull() & ~gdf_kr.geometry.is_empty].copy().reset_index(drop=True)

    # Muat batas administrasi untuk mengisi nama_wilayah (Kalurahan, Kapanewon, Kabupaten)
    if gdf_admin_utm is None:
        p_adm = PROCESSED_DIR / "clean_batas_administrasi.geojson"
        if p_adm.exists():
            gdf_admin_utm = gpd.read_file(p_adm).to_crs(TARGET_CRS)

    # Muat curah hujan standar untuk menyertakan curah_hujan_mm pada setiap poligon kerawanan
    if gdf_hujan_utm is None:
        p_ch = PROCESSED_DIR / "clean_curah_hujan_idw.geojson"
        if p_ch.exists():
            gdf_hujan_utm = gpd.read_file(p_ch).to_crs(TARGET_CRS)

    rep_pts = gpd.GeoDataFrame(
        {"kr_idx": np.arange(len(gdf_kr))},
        geometry=[g.representative_point() for g in gdf_kr.geometry],
        crs=TARGET_CRS,
    )

    kal_arr = np.array(["-"] * len(gdf_kr), dtype=object)
    kec_arr = np.array(["-"] * len(gdf_kr), dtype=object)
    kab_arr = np.array(["Kab. Sleman"] * len(gdf_kr), dtype=object)
    nama_wilayah_arr = np.array(["Wilayah DIY"] * len(gdf_kr), dtype=object)

    if gdf_admin_utm is not None and not gdf_admin_utm.empty:
        joined_adm = gpd.sjoin(
            rep_pts,
            gdf_admin_utm[["kalurahan", "kapanewon", "kabupaten", "geometry"]],
            how="left",
            predicate="within",
        ).drop_duplicates(subset=["kr_idx"])
        for _, r_a in joined_adm.iterrows():
            ii = int(r_a["kr_idx"])
            if pd.notna(r_a.get("kalurahan")):
                kal = str(r_a["kalurahan"]).strip()
                kec = str(r_a.get("kapanewon", "-")).strip()
                kab = str(r_a.get("kabupaten", "Kab. Sleman")).strip()
                kal_arr[ii] = kal
                kec_arr[ii] = kec
                kab_arr[ii] = kab
                p_desa = "Kelurahan" if kab == "Kota Yogyakarta" else "Kalurahan"
                p_kec = "Kemantren" if kab == "Kota Yogyakarta" else "Kapanewon"
                nama_wilayah_arr[ii] = f"{p_desa} {kal}, {p_kec} {kec}, {kab}"

    ch_mm_arr = np.full(len(gdf_kr), 2394, dtype=int)
    if gdf_hujan_utm is not None and not gdf_hujan_utm.empty and "curah_hujan_mm" in gdf_hujan_utm.columns:
        joined_ch = gpd.sjoin(
            rep_pts,
            gdf_hujan_utm[["curah_hujan_mm", "geometry"]],
            how="left",
            predicate="within",
        ).drop_duplicates(subset=["kr_idx"])
        for _, r_c in joined_ch.iterrows():
            ii = int(r_c["kr_idx"])
            if pd.notna(r_c.get("curah_hujan_mm")):
                ch_mm_arr[ii] = int(r_c["curah_hujan_mm"])

    skor_lereng = pd.to_numeric(gdf_kr.get("skor_lereng", 1), errors="coerce").fillna(1).astype(int).values
    skor_tanah = pd.to_numeric(gdf_kr.get("skor tanah", gdf_kr.get("skor_tanah", 3)), errors="coerce").fillna(3).astype(int).values
    skor_batuan = pd.to_numeric(gdf_kr.get("skor_batuan", 2), errors="coerce").fillna(2).astype(int).values
    skor_hujan = pd.to_numeric(gdf_kr.get("skor_hujan", 3), errors="coerce").fillna(3).astype(int).values
    skor_lahan = pd.to_numeric(gdf_kr.get("skor_lahan", 3), errors="coerce").fillna(3).astype(int).values

    # Rumus komposit asli GPKG/GJS Peta_Kerawanan_Longsor_SlemanBantul_Final:
    # 30% Lereng + 25% Tanah + 20% Batuan + 15% Hujan + 10% Tutupan Lahan
    skor_akhir_calc = np.round(
        0.30 * skor_lereng
        + 0.25 * skor_tanah
        + 0.20 * skor_batuan
        + 0.15 * skor_hujan
        + 0.10 * skor_lahan,
        2,
    )
    skor_akhir = pd.to_numeric(gdf_kr.get("skor_akhir", skor_akhir_calc), errors="coerce").fillna(pd.Series(skor_akhir_calc)).round(2).values

    m_map = {1: 0.30, 2: 0.45, 3: 0.60, 4: 0.75, 5: 0.90}
    rasio_m_raw = pd.to_numeric(gdf_kr.get("rasio_m", np.nan), errors="coerce").values
    rasio_m = np.array([
        float(rm) if not np.isnan(rm) and rm > 0 else m_map.get(int(sh), 0.60)
        for rm, sh in zip(rasio_m_raw, skor_hujan)
    ], dtype=float)

    status_zona_list = []
    zona_triase_list = []
    warna_hex_list = []
    border_hex_list = []

    for idx in range(len(gdf_kr)):
        raw_z = str(gdf_kr.iloc[idx].get("zona_triase", "")).strip()
        sk_a = float(skor_akhir[idx])
        sk_l = int(skor_lereng[idx])
        sk_t = int(skor_tanah[idx])
        ket_t = str(gdf_kr.iloc[idx].get("ket_tanah", "")).lower()
        is_exp = (sk_t == 5) or ("grumosol" in ket_t) or ("ekspansif" in ket_t)

        # Penentuan skoring & simbolisme warna sesuai data asli GPKG/GeoJSON & Matriks Korelasi Data/
        z_up = raw_z.upper()
        if "MERAH" in z_up or (sk_l > 1 and (sk_a > 3.40 or sk_l >= 5)):
            status_z = "Zona Merah"
            warna_h = "#D32F2F"
            border_h = "#B71C1C"
            label_z = raw_z if raw_z else "ZONA MERAH (Risiko Tinggi - Rawan Longsor & Wajib Uji Sondir)"
        elif "HIJAU" in z_up or (sk_l == 1 and not is_exp) or (sk_a < 2.20 and not is_exp):
            status_z = "Zona Hijau"
            if "KONSTRUKSI STANDAR" in z_up or (sk_l > 1 and sk_a < 2.20):
                warna_h = "#66BB6A"
                border_h = "#2E7D32"
                label_z = raw_z if raw_z else "ZONA HIJAU (Risiko Rendah - Konstruksi Standar)"
            else:
                warna_h = "#2E7D32"
                border_h = "#1B5E20"
                label_z = raw_z if raw_z else "ZONA HIJAU (Risiko Rendah - Lahan Datar Stabil)"
        else:
            status_z = "Zona Kuning"
            if "EKSPANSIF" in z_up or (sk_l == 1 and is_exp):
                warna_h = "#FFB300"
                border_h = "#E65100"
                label_z = raw_z if raw_z else "ZONA KUNING (Datar - Waspada Lempung Ekspansif / Pondasi)"
            else:
                warna_h = "#FB8C00"
                border_h = "#BF360C"
                label_z = raw_z if raw_z else "ZONA KUNING (Risiko Sedang - Perlu Mitigasi Drainase/Talud & RAB)"

        status_zona_list.append(status_z)
        zona_triase_list.append(label_z)
        warna_hex_list.append(warna_h)
        border_hex_list.append(border_h)

    # Sederhanakan geometri sedikit (toleransi 2.5 meter di EPSG:32749) agar rendering WebGIS mulus tanpa mengubah topologi
    geoms_opt = [
        to_2d_multipolygon(g.simplify(2.5, preserve_topology=True), min_area_m2=1.0) or g
        for g in gdf_kr.geometry
    ]

    out_gdf = gpd.GeoDataFrame(
        {
            "fid": np.arange(1, len(gdf_kr) + 1),
            "nama_wilayah": nama_wilayah_arr,
            "kalurahan": kal_arr,
            "kapanewon": kec_arr,
            "kabupaten": kab_arr,
            "skor_lereng": skor_lereng,
            "ket_lereng": gdf_kr.get("ket_lereng", "").astype(str).values,
            "skor_tanah": skor_tanah,
            "ket_tanah": gdf_kr.get("ket_tanah", "").astype(str).values,
            "c_kpa": pd.to_numeric(gdf_kr.get("c_kpa", 8.0), errors="coerce").fillna(8.0).round(2).values,
            "phi_deg": pd.to_numeric(gdf_kr.get("phi_deg", 28.0), errors="coerce").fillna(28.0).round(2).values,
            "skor_batuan": skor_batuan,
            "ket_batuan": gdf_kr.get("ket_batuan", "").astype(str).values,
            "skor_hujan": skor_hujan,
            "ket_hujan": gdf_kr.get("ket_hujan", "").astype(str).values,
            "curah_hujan_mm": ch_mm_arr,
            "rasio_m": np.round(rasio_m, 2),
            "skor_lahan": skor_lahan,
            "ket_lahan": gdf_kr.get("ket_lahan", gdf_kr.get("pl", "")).astype(str).values,
            "skor_akhir": skor_akhir,
            "status_zona": status_zona_list,
            "zona_triase": zona_triase_list,
            "warna_hex": warna_hex_list,
            "border_hex": border_hex_list,
            "luas_ha": np.round([g.area / 10_000.0 for g in gdf_kr.geometry], 2),
        },
        geometry=geoms_opt,
        crs=TARGET_CRS,
    )

    simpan_geojson_standar(out_gdf, "clean_kerawanan_longsor.geojson")
    return out_gdf


def ekstrak_tutupan_lahan_day8_standar(gdf_admin_utm=None):
    """
    Ekstrak dan standarisasi file master Tutupan Lahan / Tata Guna Lahan:
      `GPKG Layer5_Tata Guna Lahan.gpkg` / `GJS Layer5_Tata Guna Lahan.geojson`
    menjadi `Data/processed/clean_tutupan_lahan_diy.geojson` dan `Web/tutupan_bundle.js`
    sesuai 100% dengan skoring (`skor_lahan` 1..5), klasifikasi (`pl`, `peruntukan`, `ket_lahan`),
    dan pewarnaan asli di folder Data.
    """
    import glob
    import json
    import numpy as np
    import pandas as pd

    matches_lc = glob.glob(
        str(EXTRACT_DIR / "**" / "*Layer5_Tata Guna Lahan*.gpkg"),
        recursive=True,
    )
    if not matches_lc:
        matches_lc = glob.glob(
            str(EXTRACT_DIR / "**" / "*Layer5_Tata Guna Lahan*.geojson"),
            recursive=True,
        )
    if not matches_lc:
        raise FileNotFoundError("File Layer5_Tata Guna Lahan tidak ditemukan di Data/raw/extracted.")

    src_lc = matches_lc[0]
    print(f"\n[TUTUPAN LAHAN DAY 8] Membaca layer asli GPKG/GJS Layer5_Tata Guna Lahan: {src_lc}")
    gdf_lc = gpd.read_file(src_lc)
    if gdf_lc.crs is None:
        gdf_lc = gdf_lc.set_crs(TARGET_CRS)
    elif str(gdf_lc.crs).upper() != TARGET_CRS:
        gdf_lc = gdf_lc.to_crs(TARGET_CRS)

    # Palet warna berdasarkan skor_lahan (1-5) & kategori RBI asli pada GPKG/GJS Layer5_Tata Guna Lahan
    warna_skor_lahan = {
        1: "#2E7D32",  # Skor 1: Hutan Lindung/Konservasi/Produksi & Badan Air Datar (Aman)
        2: "#66BB6A",  # Skor 2: Kebun / Perkebunan (Kohesi Akar Pohon Sedang 2-5 kPa - Rendah)
        3: "#FFB300",  # Skor 3: Permukiman, Industri, Bandara, Emplasemen, Candi, Makam (Beban Konstruksi - Sedang)
        4: "#FB8C00",  # Skor 4: Semak/Belukar & Rumput/Tanah Kosong (Akar Dangkal <0.3m - Rawan)
        5: "#D32F2F",  # Skor 5: Sawah Irigasi, Sawah Tadah Hujan, Tegalan/Ladang (Tanpa Akar Dalam & Infiltrasi Tinggi - Sangat Rawan)
    }

    warna_rbi_pl = {
        "Hutan Konservasi": "#1B5E20",
        "Hutan Lindung": "#2E7D32",
        "Hutan Produksi": "#388E3C",
        "Sungai": "#0284C7",
        "Danau/Waduk": "#0369A1",
        "Kolam Air Tawar": "#0EA5E9",
        "Tambak": "#38BDF8",
        "Kebun": "#66BB6A",
        "Permukiman": "#FFB300",
        "Bandara": "#F59E0B",
        "Emplasemen": "#D97706",
        "Industri": "#B45309",
        "Lapangan Olah Raga": "#FBBF24",
        "Candi Prambanan": "#CA8A04",
        "Makam": "#EAB308",
        "Rumput/Tanah Kosong": "#FB8C00",
        "Semak/Belukar": "#F97316",
        "Sawah Irigasi": "#EF4444",
        "Sawah Tadah Hujan": "#DC2626",
        "Tegalan/Ladang": "#B91C1C",
    }

    # Explode MultiPolygon menjadi bagian poligon bersih agar dapat di-join dengan kabupaten & dirender tajam
    rows_exp = []
    for _, r in gdf_lc.iterrows():
        pl_str = str(r.get("pl", "Permukiman")).strip()
        peruntukan_str = str(r.get("peruntukan", pl_str)).strip()
        skor_l = int(pd.to_numeric(r.get("skor_lahan", 3), errors="coerce") or 3)
        skor_l = min(max(skor_l, 1), 5)
        ket_l = str(r.get("ket_lahan", f"{pl_str} (Skor {skor_l})")).strip()
        w_skor = warna_skor_lahan.get(skor_l, "#FFB300")
        w_rbi = warna_rbi_pl.get(pl_str, w_skor)

        geom_c = to_2d_multipolygon(r.geometry, min_area_m2=25.0)
        if geom_c is None or geom_c.is_empty:
            continue
        parts = list(geom_c.geoms) if isinstance(geom_c, MultiPolygon) else [geom_c]
        for pt_poly in parts:
            if pt_poly.area < 25.0:
                continue
            rows_exp.append({
                "parameter_nama": "tutupan_lahan",
                "pl": pl_str,
                "peruntukan": peruntukan_str,
                "klasifikasi": pl_str,
                "skor_lahan": skor_l,
                "skor": skor_l,
                "ket_lahan": ket_l,
                "bobot": 0.10,
                "warna_hex": w_skor,
                "warna_rbi_hex": w_rbi,
                "sumber_data": "GPKG/GJS Layer5_Tata Guna Lahan (RBI 25K & Dasar Skoring DAY 8)",
                "luas_ha": round(pt_poly.area / 10_000.0, 4),
                "geometry": to_2d_multipolygon(pt_poly, min_area_m2=10.0) or pt_poly,
            })

    gdf_exp = gpd.GeoDataFrame(rows_exp, geometry="geometry", crs=TARGET_CRS)

    # Tentukan atribut kabupaten dari batas administrasi
    kab_arr = np.array(["Kab. Sleman"] * len(gdf_exp), dtype=object)
    if gdf_admin_utm is not None and not gdf_admin_utm.empty:
        rep_pts = gpd.GeoDataFrame(
            {"lc_idx": np.arange(len(gdf_exp))},
            geometry=[g.representative_point() for g in gdf_exp.geometry],
            crs=TARGET_CRS,
        )
        joined_adm = gpd.sjoin(
            rep_pts,
            gdf_admin_utm[["kabupaten", "geometry"]],
            how="left",
            predicate="within",
        ).drop_duplicates(subset=["lc_idx"])
        for _, r_a in joined_adm.iterrows():
            ii = int(r_a["lc_idx"])
            if pd.notna(r_a.get("kabupaten")):
                kab_arr[ii] = str(r_a["kabupaten"]).strip()

    gdf_exp["kabupaten"] = kab_arr
    simpan_geojson_standar(gdf_exp, "clean_tutupan_lahan_diy.geojson")

    gdf_sb = gdf_exp[gdf_exp["kabupaten"].isin(["Kab. Sleman", "Kab. Bantul"])].copy().reset_index(drop=True)
    simpan_geojson_standar(gdf_sb, "clean_tutupan_lahan_sleman_bantul.geojson")

    # Untuk Web/tutupan_bundle.js, gunakan 20 fitur MultiPolygon ter-dissolve asli dari GPKG/GJS Layer5_Tata Guna Lahan
    # (disederhanakan ringan 1.5 m di EPSG:32749) agar ukuran bundle JS ringan & 100% sesuai GPKG/GeoJSON asli
    rows_dissolved = []
    for _, r in gdf_lc.iterrows():
        pl_str = str(r.get("pl", "Permukiman")).strip()
        peruntukan_str = str(r.get("peruntukan", pl_str)).strip()
        skor_l = int(pd.to_numeric(r.get("skor_lahan", 3), errors="coerce") or 3)
        skor_l = min(max(skor_l, 1), 5)
        ket_l = str(r.get("ket_lahan", f"{pl_str} (Skor {skor_l})")).strip()
        w_skor = warna_skor_lahan.get(skor_l, "#FFB300")
        w_rbi = warna_rbi_pl.get(pl_str, w_skor)
        geom_s = to_2d_multipolygon(r.geometry.simplify(1.5, preserve_topology=True), min_area_m2=10.0)
        if geom_s is None or geom_s.is_empty:
            continue
        rows_dissolved.append({
            "parameter_nama": "tutupan_lahan",
            "pl": pl_str,
            "peruntukan": peruntukan_str,
            "klasifikasi": pl_str,
            "skor_lahan": skor_l,
            "skor": skor_l,
            "ket_lahan": ket_l,
            "bobot": 0.10,
            "warna_hex": w_skor,
            "warna_rbi_hex": w_rbi,
            "sumber_data": "GPKG/GJS Layer5_Tata Guna Lahan (RBI 25K & Dasar Skoring DAY 8)",
            "luas_ha": round(r.geometry.area / 10_000.0, 2),
            "geometry": geom_s,
        })

    gdf_web_lc = gpd.GeoDataFrame(rows_dissolved, geometry="geometry", crs=TARGET_CRS).to_crs(GEOJSON_CRS)
    out_lc_js = PROJECT_ROOT / "Web" / "tutupan_bundle.js"
    if out_lc_js.parent.exists():
        lc_json = json.loads(gdf_web_lc.to_json())
        out_lc_js.write_text(
            "window.LAHAN_AMAN_TUTUPAN = " + json.dumps(lc_json, separators=(",", ":")) + ";\n",
            encoding="utf-8",
        )
        print(f"  -> [WEB BUNDLE] Tutupan Lahan GPKG/GJS Layer5 tersimpan ke {out_lc_js} ({len(rows_dissolved)} kelas MultiPolygon)")

    return gdf_exp


def sinkronisasi_layer_day8_ke_bundle():
    """
    Pastikan seluruh layer di `Data/processed/` dan `Web/geojson_bundle.js` selalu sinkron
    dengan skoring, label klasifikasi (`zona_triase`), dan warna asli di folder `Data/`.
    """
    import json

    bundle_path = PROJECT_ROOT / "Web" / "geojson_bundle.js"
    if not bundle_path.exists():
        return

    raw_txt = bundle_path.read_text(encoding="utf-8")
    idx_start = raw_txt.find("{")
    if idx_start < 0:
        return
    decoder = json.JSONDecoder()
    bundle_obj, idx_end = decoder.raw_decode(raw_txt[idx_start:])
    rest_txt = raw_txt[idx_start + idx_end:]

    # Ekspor layer yang ada di bundle ke Data/processed/ bila belum ada di disk
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    for k_name, fc_val in list(bundle_obj.items()):
        p_out = PROCESSED_DIR / k_name
        if not p_out.exists() and isinstance(fc_val, dict) and fc_val.get("type") == "FeatureCollection":
            p_out.write_text(json.dumps(fc_val, separators=(",", ":")), encoding="utf-8")

    # Sinkronkan status_risiko & zona_kerawanan pada batas administrasi dan titik/area developer
    for adm_key in ["clean_batas_administrasi.geojson", "clean_titik_developer.geojson", "clean_area_jangkauan_titik.geojson"]:
        fc_adm = bundle_obj.get(adm_key)
        if isinstance(fc_adm, dict) and "features" in fc_adm:
            for feat in fc_adm["features"]:
                pr = feat.get("properties") or {}
                sk = float(pr.get("skor_total", pr.get("skor_akhir", 2.5)) or 2.5)
                deg = float(pr.get("lereng_derajat", pr.get("lereng_area_derajat", 4.5)) or 4.5)
                tnh = str(pr.get("jenis_tanah", "")).lower()
                is_exp = ("grumosol" in tnh) or ("ekspansif" in tnh) or (int(pr.get("skor_tanah", 3) or 3) == 5 and "regosol" not in tnh)
                if deg <= 8.0 and not is_exp:
                    pr["zona_kerawanan"] = "Zona Hijau"
                    pr["zona_triase"] = "ZONA HIJAU (Risiko Rendah - Lahan Datar Stabil)"
                    pr["status_risiko"] = "ZONA HIJAU (Risiko Rendah - Lahan Datar Stabil)"
                    pr["warna_hex"] = "#2E7D32"
                elif deg <= 8.0 and is_exp:
                    pr["zona_kerawanan"] = "Zona Kuning"
                    pr["zona_triase"] = "ZONA KUNING (Datar - Waspada Lempung Ekspansif / Pondasi)"
                    pr["status_risiko"] = "ZONA KUNING (Datar - Waspada Lempung Ekspansif / Pondasi)"
                    pr["warna_hex"] = "#FFB300"
                elif sk > 3.40 or deg > 35.0:
                    pr["zona_kerawanan"] = "Zona Merah"
                    pr["zona_triase"] = "ZONA MERAH (Risiko Tinggi - Rawan Longsor & Wajib Uji Sondir)"
                    pr["status_risiko"] = "ZONA MERAH (Risiko Tinggi - Rawan Longsor & Wajib Uji Sondir)"
                    pr["warna_hex"] = "#D32F2F"
                elif sk < 2.20:
                    pr["zona_kerawanan"] = "Zona Hijau"
                    pr["zona_triase"] = "ZONA HIJAU (Risiko Rendah - Konstruksi Standar)"
                    pr["status_risiko"] = "ZONA HIJAU (Risiko Rendah - Konstruksi Standar)"
                    pr["warna_hex"] = "#66BB6A"
                else:
                    pr["zona_kerawanan"] = "Zona Kuning"
                    pr["zona_triase"] = "ZONA KUNING (Risiko Sedang - Perlu Mitigasi Drainase/Talud & RAB)"
                    pr["status_risiko"] = "ZONA KUNING (Risiko Sedang - Perlu Mitigasi Drainase/Talud & RAB)"
                    pr["warna_hex"] = "#FB8C00"
            (PROCESSED_DIR / adm_key).write_text(json.dumps(fc_adm, separators=(",", ":")), encoding="utf-8")

    for fname in ["clean_curah_hujan_idw.geojson", "clean_batas_administrasi.geojson", "clean_kerawanan_longsor.geojson"]:
        fpath = PROCESSED_DIR / fname
        if fpath.exists():
            bundle_obj[fname] = json.loads(fpath.read_text(encoding="utf-8"))

    new_content = (
        "window.LAHAN_AMAN_GEOJSON = "
        + json.dumps(bundle_obj, separators=(",", ":"))
        + rest_txt
    )
    bundle_path.write_text(new_content, encoding="utf-8")
    print(f"  -> [WEB BUNDLE] Sinkronisasi {bundle_path} selesai.")


if __name__ == "__main__":
    sinkronisasi_layer_day8_ke_bundle()
    gdf_ch = ekstrak_curah_hujan_day8_standar()
    p_adm = PROCESSED_DIR / "clean_batas_administrasi.geojson"
    gdf_adm = gpd.read_file(p_adm).to_crs(TARGET_CRS) if p_adm.exists() else None
    ekstrak_tutupan_lahan_day8_standar(gdf_admin_utm=gdf_adm)
    ekstrak_kerawanan_longsor_day8_standar(gdf_admin_utm=gdf_adm, gdf_hujan_utm=gdf_ch)
    sinkronisasi_layer_day8_ke_bundle()
    ringkasan_geojson()
