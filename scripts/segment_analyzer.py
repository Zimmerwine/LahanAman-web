"""
segment_analyzer.py
===================
MILESTONE FASE 2: Backend Spatial Engine untuk Pemotongan Poligon Kavling (Intersection),
Perhitungan Luas Metrik Presisi (EPSG:32749), dan Zonal Statistics Raster Kontinu
(Sudut Kemiringan Rata-Rata beta_mean ° & Beda Tinggi Elevasi tinggi_H m).

Batasan Ketat Fase 2:
- Murni pemrosesan spasial poligon dan statistik raster (tanpa rumus FS Bishop & tanpa RAB PUPR).
- Menggunakan Dual-CRS ketat:
  * Input & Output GeoJSON Web: WGS 84 (EPSG:4326)
  * Geoprocessing & Zonal Statistics: WGS 84 / UTM Zone 49S (EPSG:32749)
"""

from __future__ import annotations

import json
import os
import warnings
from pathlib import Path
from typing import Any, Dict, List, Union

import pyproj

# Pastikan PROJ memakai database milik pyproj agar tidak bentrok dengan PostGIS lokal
_PROJ_DIR = pyproj.datadir.get_data_dir()
os.environ["PROJ_LIB"] = _PROJ_DIR
os.environ["PROJ_DATA"] = _PROJ_DIR

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
from rasterstats import zonal_stats
import shapely
from shapely.geometry import MultiPolygon, Polygon, shape, mapping
from shapely.ops import transform

# =====================================================================
# KONSTANTA PATH & SISTEM KOORDINAT (DUAL-CRS)
# =====================================================================
PROJECT_ROOT = Path(__file__).resolve().parents[1]
EXTRACT_DIR = PROJECT_ROOT / "Data" / "raw" / "extracted"

RASTER_SLOPE_PATH = (
    EXTRACT_DIR
    / "TIF SLOPE & DEMNAS CLIP"
    / "TIF SLOPE & DEMNAS CLIP"
    / "Raster_Slope_Derajat_SlemanBantul.tif"
)
RASTER_DEMNAS_PATH = (
    EXTRACT_DIR
    / "TIF SLOPE & DEMNAS CLIP"
    / "TIF SLOPE & DEMNAS CLIP"
    / "Raster_DEMNAS_Elevasi_SlemanBantul.tif"
)
VEKTOR_TRIASE_PATH = (
    EXTRACT_DIR
    / "DAY 8"
    / "DAY 8"
    / "Layer dan dasar"
    / "Data Layer & Dasar Penentuan Lengkap"
    / "Layer"
    / "Final kerawanan longsor"
    / "Peta_Kerawanan_Longsor_SlemanBantul_Final.gpkg"
)

WGS84_CRS = "EPSG:4326"
METRIC_CRS = "EPSG:32749"  # WGS 84 / UTM Zone 49S

SLOPE_NODATA = -9999.0
DEM_NODATA = 0.0  # Piksel luar batas clip Sleman-Bantul pada DEMNAS bernilai 0.0

# Skema warna skoring kerawanan sesuai Peta_Kerawanan_Longsor_SlemanBantul_Final.gpkg & Tabel 5.2 Hari 7
WARNA_ZONA = {
    "Hijau": {"fill": "#2E7D32", "border": "#1B5E20", "urutan": 1},
    "Kuning": {"fill": "#FB8C00", "border": "#BF360C", "urutan": 2},
    "Merah": {"fill": "#D32F2F", "border": "#B71C1C", "urutan": 3},
}

_ENGINE_CACHE: Dict[str, Any] = {
    "loaded": False,
    "triase_gdf": None,
    "slope_meta": None,
    "dem_meta": None,
}


# =====================================================================
# FUNGSI UTILITAS & PEMUATAN DATA MASTER
# =====================================================================
def klasifikasi_warna_triase(zona_triase_str: str) -> Dict[str, Any]:
    """Petakan teks `zona_triase` dari GPKG Master ke kategori (Hijau/Kuning/Merah) & kode warna hex asli."""
    teks = str(zona_triase_str or "").upper()
    if "MERAH" in teks:
        return {
            "kategori": "Merah",
            "zona_singkat": "Zona Merah (Skor > 3,40)",
            "warna_hex": "#D32F2F",
            "border_hex": "#B71C1C",
            "urutan": 3,
        }
    elif "KUNING" in teks:
        if "LEMPUNG EKSPANSIF" in teks or "DATAR -" in teks:
            return {
                "kategori": "Kuning",
                "zona_singkat": "Zona Kuning (Datar Lempung Ekspansif)",
                "warna_hex": "#FFB300",
                "border_hex": "#E65100",
                "urutan": 2,
            }
        return {
            "kategori": "Kuning",
            "zona_singkat": "Zona Kuning (Skor 2,20–3,40)",
            "warna_hex": "#FB8C00",
            "border_hex": "#BF360C",
            "urutan": 2,
        }
    else:
        if "KONSTRUKSI STANDAR" in teks:
            return {
                "kategori": "Hijau",
                "zona_singkat": "Zona Hijau (Skor < 2,20 Standar)",
                "warna_hex": "#66BB6A",
                "border_hex": "#2E7D32",
                "urutan": 1,
            }
        return {
            "kategori": "Hijau",
            "zona_singkat": "Zona Hijau (Lahan Datar Stabil)",
            "warna_hex": "#2E7D32",
            "border_hex": "#1B5E20",
            "urutan": 1,
        }


def _pastikan_2d(geom):
    """Konversi geometri 3D (jika ada koordinat Z) menjadi 2D murni."""
    if geom is None or geom.is_empty:
        return geom
    return shapely.force_2d(geom)


def muat_engine_fase2(force: bool = False) -> Dict[str, Any]:
    """
    Validasi dan muat Vektor Master Triase (`Peta_Kerawanan_Longsor_SlemanBantul_Final.gpkg`)
    serta metadata kedua Raster Master (`Raster_Slope_Derajat_SlemanBantul.tif` dan
    `Raster_DEMNAS_Elevasi_SlemanBantul.tif`) ke memori beserta Spatial Index (R-tree).
    """
    if _ENGINE_CACHE["loaded"] and not force:
        return _ENGINE_CACHE

    if not RASTER_SLOPE_PATH.exists():
        raise FileNotFoundError(f"Raster Slope tidak ditemukan di: {RASTER_SLOPE_PATH}")
    if not RASTER_DEMNAS_PATH.exists():
        raise FileNotFoundError(f"Raster DEMNAS tidak ditemukan di: {RASTER_DEMNAS_PATH}")
    if not VEKTOR_TRIASE_PATH.exists():
        raise FileNotFoundError(f"Vektor Master Triase tidak ditemukan di: {VEKTOR_TRIASE_PATH}")

    with rasterio.open(RASTER_SLOPE_PATH) as src_slope:
        _ENGINE_CACHE["slope_meta"] = {
            "crs": str(src_slope.crs),
            "bounds": src_slope.bounds,
            "shape": src_slope.shape,
            "nodata": src_slope.nodata if src_slope.nodata is not None else SLOPE_NODATA,
            "res": (abs(src_slope.transform.a), abs(src_slope.transform.e)),
        }

    with rasterio.open(RASTER_DEMNAS_PATH) as src_dem:
        _ENGINE_CACHE["dem_meta"] = {
            "crs": str(src_dem.crs),
            "bounds": src_dem.bounds,
            "shape": src_dem.shape,
            "nodata": DEM_NODATA,
            "res": (abs(src_dem.transform.a), abs(src_dem.transform.e)),
        }

    gdf = gpd.read_file(VEKTOR_TRIASE_PATH)
    if gdf.crs is None:
        gdf = gdf.set_crs(METRIC_CRS)
    elif gdf.crs.to_epsg() != 32749:
        gdf = gdf.to_crs(METRIC_CRS)

    gdf["geometry"] = gdf.geometry.map(_pastikan_2d)
    invalid_mask = ~gdf.geometry.is_valid
    if invalid_mask.any():
        gdf.loc[invalid_mask, "geometry"] = gdf.loc[invalid_mask, "geometry"].make_valid()

    # Bangun spatial index R-tree di awal agar pemotongan poligon berjalan instan
    _ = gdf.sindex

    _ENGINE_CACHE["triase_gdf"] = gdf
    _ENGINE_CACHE["loaded"] = True
    return _ENGINE_CACHE


def _ekstrak_gdf_input(
    geojson_feature: Union[str, Dict[str, Any], gpd.GeoDataFrame, gpd.GeoSeries, Polygon, MultiPolygon]
) -> gpd.GeoDataFrame:
    """
    Normalisasi berbagai bentuk input poligon kavling menjadi GeoDataFrame berproyeksi
    metrik EPSG:32749 (UTM Zona 49S).
    """
    if isinstance(geojson_feature, str):
        geojson_feature = json.loads(geojson_feature)

    if isinstance(geojson_feature, gpd.GeoDataFrame):
        gdf_in = geojson_feature.copy()
    elif isinstance(geojson_feature, gpd.GeoSeries):
        gdf_in = gpd.GeoDataFrame(geometry=geojson_feature.values, crs=geojson_feature.crs)
    elif isinstance(geojson_feature, (Polygon, MultiPolygon)):
        gdf_in = gpd.GeoDataFrame({"kavling_id": [1]}, geometry=[geojson_feature])
    elif isinstance(geojson_feature, dict):
        tipe = geojson_feature.get("type")
        if tipe == "FeatureCollection":
            feats = geojson_feature.get("features", [])
            if not feats:
                raise ValueError("FeatureCollection kosong: tidak ada geometri poligon kavling.")
            geoms = [shape(f["geometry"]) for f in feats if f.get("geometry")]
            gdf_in = gpd.GeoDataFrame({"kavling_id": range(1, len(geoms) + 1)}, geometry=geoms)
        elif tipe == "Feature":
            geom_dict = geojson_feature.get("geometry")
            if not geom_dict:
                raise ValueError("Feature GeoJSON tidak memiliki atribut 'geometry'.")
            gdf_in = gpd.GeoDataFrame(
                [geojson_feature.get("properties") or {"kavling_id": 1}],
                geometry=[shape(geom_dict)],
            )
        elif tipe in ("Polygon", "MultiPolygon"):
            gdf_in = gpd.GeoDataFrame({"kavling_id": [1]}, geometry=[shape(geojson_feature)])
        elif "geometry" in geojson_feature and isinstance(geojson_feature["geometry"], dict):
            geom_inner = geojson_feature["geometry"]
            if geom_inner.get("type") == "Feature":
                geom_inner = geom_inner.get("geometry", {})
            gdf_in = gpd.GeoDataFrame({"kavling_id": [1]}, geometry=[shape(geom_inner)])
        else:
            raise ValueError(f"Format payload GeoJSON tidak dikenali: {list(geojson_feature.keys())}")
    else:
        raise TypeError(f"Tipe input tidak didukung: {type(geojson_feature)}")

    if gdf_in.empty:
        raise ValueError("Geometri poligon kavling kosong.")

    gdf_in["geometry"] = gdf_in.geometry.map(_pastikan_2d)
    invalid_mask = ~gdf_in.geometry.is_valid
    if invalid_mask.any():
        gdf_in.loc[invalid_mask, "geometry"] = gdf_in.loc[invalid_mask, "geometry"].make_valid()

    # Deteksi CRS bila belum terdefinisi: koordinat derajat WGS84 vs meter UTM 49S
    if gdf_in.crs is None:
        minx, miny, maxx, maxy = gdf_in.total_bounds
        if -180.0 <= minx <= maxx <= 180.0 and -90.0 <= miny <= maxy <= 90.0:
            gdf_in = gdf_in.set_crs(WGS84_CRS)
        elif 100_000.0 <= minx <= maxx <= 900_000.0 and 8_000_000.0 <= miny <= maxy <= 10_000_000.0:
            gdf_in = gdf_in.set_crs(METRIC_CRS)
        else:
            raise ValueError(f"Rentang koordinat poligon di luar batas wajar: {gdf_in.total_bounds}")

    # Reproyeksikan ke EPSG:32749 (Strict Dual-CRS)
    if gdf_in.crs.to_epsg() != 32749:
        gdf_utm = gdf_in.to_crs(METRIC_CRS)
    else:
        gdf_utm = gdf_in.copy()

    # Gabungkan bila input memiliki lebih dari 1 poligon sketsa menjadi satu kesatuan kavling
    union_geom = gdf_utm.geometry.union_all()
    if not union_geom.is_valid:
        union_geom = shapely.make_valid(union_geom)
    if union_geom.is_empty or union_geom.area <= 0.1:
        raise ValueError("Luas poligon kavling terlalu kecil atau tidak valid (< 0.1 m²).")

    return gpd.GeoDataFrame({"kavling_id": [1]}, geometry=[union_geom], crs=METRIC_CRS)


def _sampling_titik_raster(geom_utm, raster_path: Path, nodata_val: float) -> float:
    """Fallback pembacaan nilai piksel tepat di titik representatif segmen bila segmen lebih kecil dari 1 piksel."""
    pt = geom_utm.representative_point()
    with rasterio.open(raster_path) as src:
        row, col = src.index(pt.x, pt.y)
        if 0 <= row < src.height and 0 <= col < src.width:
            val = float(src.read(1, window=((row, row + 1), (col, col + 1)))[0, 0])
            if not np.isnan(val) and val != nodata_val and val > -100.0:
                return val
    return 0.0


def _hitung_zonal_stats_segmen(geometries: List[Any]) -> List[Dict[str, float]]:
    """
    Hitung statistik raster untuk setiap geometri segmen dalam EPSG:32749:
      - `beta_mean`: rata-rata sudut kemiringan kontinu (derajat °) dari `Raster_Slope_Derajat_SlemanBantul.tif`
      - `elev_min`, `elev_max`, `tinggi_H`: elevasi minimum, maksimum, dan beda tinggi (m)
        dari `Raster_DEMNAS_Elevasi_SlemanBantul.tif`
    """
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        # Pass 1: Zonal stats standar (pusat piksel di dalam poligon)
        slope_stats = zonal_stats(
            geometries,
            str(RASTER_SLOPE_PATH),
            stats=["mean", "count"],
            nodata=SLOPE_NODATA,
            all_touched=False,
        )
        dem_stats = zonal_stats(
            geometries,
            str(RASTER_DEMNAS_PATH),
            stats=["min", "max", "count"],
            nodata=DEM_NODATA,
            all_touched=False,
        )

        # Pass 2: Fallback `all_touched=True` khusus untuk segmen sempit/kecil yang tidak memuat pusat piksel
        hasil = []
        for idx, geom in enumerate(geometries):
            s_item = slope_stats[idx]
            d_item = dem_stats[idx]

            if s_item.get("mean") is None:
                s_touch = zonal_stats(
                    [geom],
                    str(RASTER_SLOPE_PATH),
                    stats=["mean"],
                    nodata=SLOPE_NODATA,
                    all_touched=True,
                )[0]
                beta_val = s_touch.get("mean")
                if beta_val is None:
                    beta_val = _sampling_titik_raster(geom, RASTER_SLOPE_PATH, SLOPE_NODATA)
            else:
                beta_val = s_item["mean"]

            if d_item.get("min") is None or d_item.get("max") is None:
                d_touch = zonal_stats(
                    [geom],
                    str(RASTER_DEMNAS_PATH),
                    stats=["min", "max"],
                    nodata=DEM_NODATA,
                    all_touched=True,
                )[0]
                e_min = d_touch.get("min")
                e_max = d_touch.get("max")
                if e_min is None or e_max is None:
                    e_pt = _sampling_titik_raster(geom, RASTER_DEMNAS_PATH, DEM_NODATA)
                    e_min, e_max = e_pt, e_pt
            else:
                e_min = d_item["min"]
                e_max = d_item["max"]

            beta_mean = round(max(0.0, float(beta_val)), 2)
            elev_min = round(float(e_min), 2)
            elev_max = round(float(e_max), 2)
            tinggi_h = round(max(0.0, float(e_max) - float(e_min)), 2)

            hasil.append({
                "beta_mean": beta_mean,
                "elev_min": elev_min,
                "elev_max": elev_max,
                "tinggi_H": tinggi_h,
            })

    return hasil


# =====================================================================
# FUNGSI UTAMA ANALISIS SEGMEN KAVLING (TAHAP 1)
# =====================================================================
def analyze_user_kavling(
    geojson_feature: Union[str, Dict[str, Any], gpd.GeoDataFrame, gpd.GeoSeries, Polygon, MultiPolygon]
) -> Dict[str, Any]:
    """
    Memotong poligon kavling pengguna terhadap Vektor Master Triase (`EPSG:32749`),
    menghitung luas metrik tiap segmen (`luas_m2` & `persen_luas`), mengekstrak
    sudut kemiringan rata-rata kontinu (`beta_mean` °) dan beda tinggi (`tinggi_H` m)
    dari raster DEMNAS & Slope, lalu mengekspor kembali ke GeoJSON `EPSG:4326`.
    """
    cache = muat_engine_fase2()
    triase_gdf: gpd.GeoDataFrame = cache["triase_gdf"]

    # 1. Reproyeksi input poligon kavling ke EPSG:32749
    kavling_gdf = _ekstrak_gdf_input(geojson_feature)
    kavling_geom = kavling_gdf.geometry.iloc[0]
    luas_input_m2 = float(kavling_geom.area)

    # 2. Filter kandidat poligon triase menggunakan Spatial Index (R-tree)
    kandidat_idx = triase_gdf.sindex.query(kavling_geom, predicate="intersects")
    if len(kandidat_idx) == 0:
        raise ValueError(
            "Poligon kavling berada di luar cakupan wilayah peta kerawanan Sleman & Bantul (DIY)."
        )

    sub_triase_gdf = triase_gdf.iloc[kandidat_idx].copy()

    # 3. Pemotongan Spasial (Intersection) di EPSG:32749
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        inter_gdf = gpd.overlay(kavling_gdf, sub_triase_gdf, how="intersection", keep_geom_type=False)

    if inter_gdf.empty:
        raise ValueError("Hasil perpotongan spasial (intersection) kosong.")

    # Saring hanya geometri poligon (abaikan titik/garis singgung di batas luar)
    def _ambil_poligon_saja(g):
        if g is None or g.is_empty:
            return None
        if g.geom_type in ("Polygon", "MultiPolygon"):
            return g
        if g.geom_type == "GeometryCollection":
            polys = [p for p in g.geoms if p.geom_type in ("Polygon", "MultiPolygon") and p.area > 0.05]
            if not polys:
                return None
            return shapely.unary_union(polys)
        return None

    inter_gdf["geometry"] = inter_gdf.geometry.map(_ambil_poligon_saja)
    inter_gdf = inter_gdf[inter_gdf.geometry.notna() & (inter_gdf.geometry.area > 0.05)].copy()

    if inter_gdf.empty:
        raise ValueError("Tidak ada segmen poligon valid yang terbentuk dari hasil intersection.")

    # 4. Gabungkan (dissolve) sub-poligon yang memiliki atribut triase & geoteknik identik
    #    agar poligon kavling terbelah bersih menurut zona risikonya (Hijau, Kuning, Merah)
    kolom_dissolve = ["zona_triase", "c_kpa", "phi_deg", "rasio_m"]
    for col in kolom_dissolve:
        if col not in inter_gdf.columns:
            inter_gdf[col] = "-" if col == "zona_triase" else 0.0

    segmen_gdf = inter_gdf.dissolve(by=kolom_dissolve, as_index=False)

    # Saring sliver mikroskopis (< 0.1 m²) bila ada
    segmen_gdf = segmen_gdf[segmen_gdf.geometry.area >= 0.1].copy().reset_index(drop=True)

    # 5. Perhitungan Luas Metrik (EPSG:32749)
    raw_areas = segmen_gdf.geometry.area.to_numpy(dtype=float)
    total_luas_terpotong_m2 = float(np.sum(raw_areas))
    pembagi_luas = total_luas_terpotong_m2 if total_luas_terpotong_m2 > 0 else luas_input_m2
    target_total_bulat = round(pembagi_luas, 1)

    segmen_gdf["luas_m2"] = np.round(raw_areas, 1)
    if len(segmen_gdf) > 0:
        selisih_luas = round(target_total_bulat - float(segmen_gdf["luas_m2"].sum()), 1)
        if abs(selisih_luas) <= 0.5 and selisih_luas != 0.0:
            idx_max_area = int(segmen_gdf["luas_m2"].idxmax())
            segmen_gdf.loc[idx_max_area, "luas_m2"] = round(
                float(segmen_gdf.loc[idx_max_area, "luas_m2"]) + selisih_luas, 1
            )

    segmen_gdf["persen_luas"] = np.round((segmen_gdf["luas_m2"] / target_total_bulat) * 100.0, 1)

    # Urutkan segmen berdasarkan tingkat zona (Hijau -> Kuning -> Merah), lalu luas terbesar
    info_warna = [klasifikasi_warna_triase(z) for z in segmen_gdf["zona_triase"]]
    segmen_gdf["_urutan_zona"] = [w["urutan"] for w in info_warna]
    segmen_gdf["warna_hex"] = [w["warna_hex"] for w in info_warna]
    segmen_gdf["border_hex"] = [w["border_hex"] for w in info_warna]
    segmen_gdf["zona_singkat"] = [w["zona_singkat"] for w in info_warna]
    segmen_gdf["kategori_zona"] = [w["kategori"] for w in info_warna]

    segmen_gdf = (
        segmen_gdf.sort_values(by=["_urutan_zona", "luas_m2"], ascending=[True, False])
        .reset_index(drop=True)
    )

    # Koreksi pembulatan persentase pada segmen terbesar agar total persentase tepat 100.0%
    if len(segmen_gdf) > 0:
        selisih_pct = round(100.0 - float(segmen_gdf["persen_luas"].sum()), 1)
        if abs(selisih_pct) <= 0.5 and selisih_pct != 0.0:
            idx_max = int(segmen_gdf["luas_m2"].idxmax())
            segmen_gdf.loc[idx_max, "persen_luas"] = round(
                float(segmen_gdf.loc[idx_max, "persen_luas"]) + selisih_pct, 1
            )

    # 6. Zonal Statistics Raster terhadap Slope (mean) & DEMNAS (min, max -> tinggi_H)
    zstats_list = _hitung_zonal_stats_segmen(list(segmen_gdf.geometry))
    segmen_gdf["beta_mean"] = [z["beta_mean"] for z in zstats_list]
    segmen_gdf["elev_min"] = [z["elev_min"] for z in zstats_list]
    segmen_gdf["elev_max"] = [z["elev_max"] for z in zstats_list]
    segmen_gdf["tinggi_H"] = [z["tinggi_H"] for z in zstats_list]
    segmen_gdf["segmen_id"] = [f"SEG-{i + 1:02d}" for i in range(len(segmen_gdf))]

    # 7. Reproyeksi hasil akhir kembali ke EPSG:4326 (WGS 84) untuk dikirim ke Frontend Leaflet
    segmen_wgs84 = segmen_gdf.to_crs(WGS84_CRS)

    features_out: List[Dict[str, Any]] = []
    proporsi_zona = {
        "Hijau": {"luas_m2": 0.0, "persen": 0.0, "jumlah_segmen": 0},
        "Kuning": {"luas_m2": 0.0, "persen": 0.0, "jumlah_segmen": 0},
        "Merah": {"luas_m2": 0.0, "persen": 0.0, "jumlah_segmen": 0},
    }

    for idx, row in segmen_wgs84.iterrows():
        kat = str(row["kategori_zona"])
        luas_seg = round(float(row["luas_m2"]), 1)
        persen_seg = round(float(row["persen_luas"]), 1)

        if kat in proporsi_zona:
            proporsi_zona[kat]["luas_m2"] = round(proporsi_zona[kat]["luas_m2"] + luas_seg, 1)
            proporsi_zona[kat]["persen"] = round(proporsi_zona[kat]["persen"] + persen_seg, 1)
            proporsi_zona[kat]["jumlah_segmen"] += 1

        props = {
            "segmen_id": str(row["segmen_id"]),
            "zona_triase": str(row["zona_triase"]),
            "warna_hex": str(row["warna_hex"]),
            "luas_m2": luas_seg,
            "persen_luas": persen_seg,
            "beta_mean": round(float(row["beta_mean"]), 2),
            "elev_min": round(float(row["elev_min"]), 2),
            "elev_max": round(float(row["elev_max"]), 2),
            "tinggi_H": round(float(row["tinggi_H"]), 2),
            "c_kpa": round(float(row["c_kpa"]), 2),
            "phi_deg": round(float(row["phi_deg"]), 2),
            "rasio_m": round(float(row["rasio_m"]), 2),
            # Atribut konteks tambahan untuk tooltip & tabel UI
            "zona_singkat": str(row["zona_singkat"]),
            "kategori_zona": kat,
            "border_hex": str(row["border_hex"]),
            "ket_tanah": str(row.get("ket_tanah", "-")),
            "ket_batuan": str(row.get("ket_batuan", "-")),
            "ket_hujan": str(row.get("ket_hujan", "-")),
            "tutupan_lahan": str(row.get("pl", "-")),
            "skor_akhir": round(float(row.get("skor_akhir", 0.0)), 2),
        }

        features_out.append({
            "type": "Feature",
            "id": str(row["segmen_id"]),
            "properties": props,
            "geometry": mapping(row.geometry),
        })

    # Statistik agregat tingkat kavling
    total_luas_bulat = round(float(segmen_gdf["luas_m2"].sum()), 1)
    deviasi_luas_pct = (
        round(abs(total_luas_terpotong_m2 - luas_input_m2) / luas_input_m2 * 100.0, 4)
        if luas_input_m2 > 0
        else 0.0
    )
    beta_tertimbang = (
        round(
            float(np.sum(segmen_gdf["beta_mean"] * segmen_gdf["luas_m2"]) / total_luas_bulat),
            2,
        )
        if total_luas_bulat > 0
        else 0.0
    )
    elev_min_kavling = round(float(segmen_gdf["elev_min"].min()), 2)
    elev_max_kavling = round(float(segmen_gdf["elev_max"].max()), 2)
    tinggi_h_kavling = round(max(0.0, elev_max_kavling - elev_min_kavling), 2)

    return {
        "type": "FeatureCollection",
        "status": "ok",
        "crs_input": WGS84_CRS,
        "crs_processing": METRIC_CRS,
        "crs_output": WGS84_CRS,
        "summary": {
            "total_luas_m2": total_luas_bulat,
            "total_luas_input_m2": round(luas_input_m2, 1),
            "deviasi_luas_persen": deviasi_luas_pct,
            "jumlah_segmen": len(features_out),
            "beta_mean_kavling": beta_tertimbang,
            "elev_min_kavling": elev_min_kavling,
            "elev_max_kavling": elev_max_kavling,
            "tinggi_H_kavling": tinggi_h_kavling,
            "proporsi_zona": proporsi_zona,
        },
        "features": features_out,
    }


if __name__ == "__main__":
    import sys
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    # Uji cepat lokal dengan poligon sampel di Bukit Imogiri-Dlingo (melintasi Zona Hijau, Kuning, Merah)
    from shapely.geometry import box

    print("[TEST] Memuat engine spasial Fase 2...")
    muat_engine_fase2()

    sample_utm = gpd.GeoDataFrame(
        {"nama": ["Kavling Uji Imogiri"]},
        geometry=[box(434000, 9124000, 434300, 9124300)],
        crs=METRIC_CRS,
    ).to_crs(WGS84_CRS)

    sample_geojson = json.loads(sample_utm.to_json())["features"][0]
    res = analyze_user_kavling(sample_geojson)
    print(f"[TEST] Total Luas Kavling: {res['summary']['total_luas_m2']} m² "
          f"(Deviasi proyeksi: {res['summary']['deviasi_luas_persen']}%)")
    for feat in res["features"]:
        p = feat["properties"]
        print(
            f"  - {p['segmen_id']} | {p['zona_singkat']} | Luas: {p['luas_m2']} m² ({p['persen_luas']}%) | "
            f"beta_mean: {p['beta_mean']}° | H: {p['tinggi_H']} m (elev {p['elev_min']}..{p['elev_max']} m) | "
            f"c'={p['c_kpa']} kPa, phi'={p['phi_deg']}°, m={p['rasio_m']}"
        )
