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

from spatial_loader import GEOJSON_CRS, PROCESSED_DIR, TARGET_CRS


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


if __name__ == "__main__":
    ringkasan_geojson()
