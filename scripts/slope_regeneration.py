"""Local-only slope raster audit and candidate regeneration for LahanAman.

This module reads source rasters/vectors and writes only beneath
``outputs/dem-slope-regeneration``. It never updates production datasets.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from collections import Counter
from pathlib import Path
from typing import Any

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.windows import Window, from_bounds
import shapely
from shapely.geometry import shape, mapping

ROOT = Path(__file__).resolve().parents[1]
PRODUCTION_GEOJSON = ROOT / "public" / "data" / "clean_kerawanan_longsor.geojson"
OUT_DIR = ROOT / "outputs" / "dem-slope-regeneration"
MIN_VALID_PIXELS = 5
MIN_PIXEL_COVERAGE = 0.80
SLOPE_UNIT_STATUS = "unit_unverified"
SLOPE_THRESHOLDS = (8.0, 15.0, 25.0, 35.0)
WEIGHTS = {"skor_lereng": 0.30, "skor_tanah": 0.25, "skor_batuan": 0.20, "skor_hujan": 0.15, "skor_lahan": 0.10}
SCORE_ALIASES = {"skor_lereng": ("skor_lereng", "skor lereng"), "skor_tanah": ("skor_tanah", "skor tanah")}


def slope_score(degrees: float | None) -> int | None:
    if degrees is None or not math.isfinite(float(degrees)) or not 0 <= float(degrees) < 90:
        return None
    value = float(degrees)
    for score, threshold in enumerate(SLOPE_THRESHOLDS, start=1):
        if value <= threshold:
            return score
    return 5


def slope_percent(degrees: float | None) -> float | None:
    if degrees is None or not math.isfinite(float(degrees)) or not 0 <= float(degrees) < 90:
        return None
    return math.tan(math.radians(float(degrees))) * 100.0


def wlc_score(scores: dict[str, Any]) -> float | None:
    vals = {}
    for field in WEIGHTS:
        try:
            value = float(scores[field])
        except (KeyError, TypeError, ValueError):
            return None
        if not math.isfinite(value) or not 1 <= value <= 5:
            return None
        vals[field] = value
    return round(sum(vals[field] * weight for field, weight in WEIGHTS.items()), 2)


def zone_for_wlc(score: float | None) -> str | None:
    if score is None:
        return None
    if score < 2.20:
        return "Hijau"
    if score <= 3.40:
        return "Kuning"
    return "Merah"


def _is_valid_value(values: np.ndarray, nodata: float | None) -> np.ndarray:
    valid = np.isfinite(values) & (values >= 0.0) & (values < 90.0)
    if nodata is not None:
        valid &= values != nodata
    return valid


def raster_fingerprint(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _histogram_quantile(hist: np.ndarray, edges: np.ndarray, q: float) -> float:
    target = q * max(0, int(hist.sum()) - 1)
    cumulative = np.cumsum(hist)
    idx = int(np.searchsorted(cumulative, target + 1, side="left"))
    return float((edges[idx] + edges[idx + 1]) / 2.0)


def inspect_raster(path: Path) -> dict[str, Any]:
    """Revalidate complete metadata and stream pixel statistics without loading all pixels."""
    hist_edges = np.arange(0.0, 90.0001, 0.01)
    histogram = np.zeros(len(hist_edges) - 1, dtype=np.int64)
    n_valid = n_nodata = n_invalid = 0
    total = total_sq = 0.0
    minimum, maximum = math.inf, -math.inf
    with rasterio.open(path) as src:
        if src.count != 1:
            raise ValueError(f"Raster harus satu band; ditemukan {src.count}.")
        if src.crs is None or src.crs.to_epsg() != 32749:
            raise ValueError(f"CRS raster tidak sesuai EPSG:32749: {src.crs}")
        for _, window in src.block_windows(1):
            arr = src.read(1, window=window, masked=False).astype(np.float64, copy=False)
            valid = _is_valid_value(arr, src.nodata)
            n_valid += int(valid.sum())
            n_nodata += int((~np.isfinite(arr) | ((arr == src.nodata) if src.nodata is not None else False)).sum())
            n_invalid += int((np.isfinite(arr) & ~valid & ((arr != src.nodata) if src.nodata is not None else True)).sum())
            vals = arr[valid]
            if vals.size:
                minimum = min(minimum, float(vals.min()))
                maximum = max(maximum, float(vals.max()))
                total += float(vals.sum(dtype=np.float64))
                total_sq += float(np.square(vals).sum(dtype=np.float64))
                histogram += np.histogram(vals, bins=hist_edges)[0]
        mean = total / n_valid if n_valid else None
        std = math.sqrt(max(0.0, total_sq / n_valid - mean * mean)) if n_valid else None
        total_pixels = src.width * src.height
        metadata = {
            "path": str(path), "sha256": raster_fingerprint(path), "driver": src.driver,
            "crs": str(src.crs), "epsg": src.crs.to_epsg(), "transform": list(src.transform),
            "resolution_x_m": abs(src.transform.a), "resolution_y_m": abs(src.transform.e),
            "width": src.width, "height": src.height, "band_count": src.count,
            "dtype": src.dtypes[0], "nodata": src.nodata, "units": src.units[0],
            "band_description": src.descriptions[0], "tags": src.tags(),
            "band_tags": src.tags(1), "bounds": [src.bounds.left, src.bounds.bottom, src.bounds.right, src.bounds.top],
            "pixel_count_total": total_pixels, "pixel_count_valid": n_valid,
            "pixel_count_nodata": n_nodata, "pixel_count_invalid_non_nodata": n_invalid,
            "valid_coverage_percent": 100.0 * n_valid / total_pixels,
            "valid_min": minimum if n_valid else None, "valid_max": maximum if n_valid else None,
            "valid_mean": mean, "valid_std_population": std,
            "valid_median_histogram_estimate_deg": _histogram_quantile(histogram, hist_edges, 0.5),
            "valid_p25_histogram_estimate_deg": _histogram_quantile(histogram, hist_edges, 0.25),
            "valid_p75_histogram_estimate_deg": _histogram_quantile(histogram, hist_edges, 0.75),
            "histogram_bin_width_deg": 0.01,
            "histogram": [{"lower_deg": float(hist_edges[i]), "count": int(c)} for i, c in enumerate(histogram) if c],
            "unit_assessment": "Band metadata has no units. Degree is plausible from the 0–89.42 range and layer naming, but requires source-method/provenance confirmation.",
        }
    return metadata


def _polygonal(geom: Any) -> Any:
    if geom is None or geom.is_empty:
        return None
    if not geom.is_valid:
        geom = shapely.make_valid(geom)
    if geom.geom_type in ("Polygon", "MultiPolygon"):
        return geom
    if geom.geom_type == "GeometryCollection":
        parts = [g for g in geom.geoms if g.geom_type in ("Polygon", "MultiPolygon") and not g.is_empty and g.area > 0]
        return shapely.union_all(parts) if parts else None
    return None


def _window_for_geom(geom: Any, src: rasterio.DatasetReader) -> Window | None:
    try:
        raw = from_bounds(*geom.bounds, transform=src.transform)
    except Exception:
        return None
    col0, row0 = math.floor(raw.col_off), math.floor(raw.row_off)
    col1, row1 = math.ceil(raw.col_off + raw.width), math.ceil(raw.row_off + raw.height)
    col0, row0 = max(0, col0), max(0, row0)
    col1, row1 = min(src.width, col1), min(src.height, row1)
    if col1 <= col0 or row1 <= row0:
        return None
    return Window(col0, row0, col1 - col0, row1 - row0)


def _read_zonal(geom: Any, src: rasterio.DatasetReader, all_touched: bool) -> tuple[np.ndarray, int]:
    window = _window_for_geom(geom, src)
    if window is None:
        return np.empty(0, dtype=np.float32), 0
    arr = src.read(1, window=window, masked=False)
    transform = src.window_transform(window)
    inside = geometry_mask([mapping(geom)], out_shape=arr.shape, transform=transform, all_touched=all_touched, invert=True)
    selected_count = int(inside.sum())
    valid = inside & _is_valid_value(arr, src.nodata)
    return arr[valid].astype(np.float64, copy=False), selected_count


def _summary(values: np.ndarray, selected_count: int) -> dict[str, Any]:
    if values.size == 0:
        return {"mean": None, "median": None, "min": None, "max": None, "std": None, "p25": None, "p75": None, "valid_count": 0, "selected_pixel_count": selected_count, "valid_selected_pixel_ratio": 0.0 if selected_count else None, "dominant_score": None}
    q = np.quantile(values, [0.25, 0.5, 0.75])
    counts = np.bincount([slope_score(v) for v in values], minlength=6)[1:]
    return {
        "mean": float(values.mean()), "median": float(q[1]), "min": float(values.min()), "max": float(values.max()),
        "std": float(values.std(ddof=0)), "p25": float(q[0]), "p75": float(q[2]),
        "valid_count": int(values.size), "selected_pixel_count": selected_count,
        "valid_selected_pixel_ratio": float(values.size / selected_count) if selected_count else None,
        "dominant_score": int(np.argmax(counts) + 1), "class_pixel_counts": [int(x) for x in counts],
    }


def _area_weighted_summary(geom: Any, src: rasterio.DatasetReader) -> dict[str, Any]:
    """Compute exact pixel/polygon intersection weights for touched cells."""
    window = _window_for_geom(geom, src)
    if window is None:
        return {"mean": None, "std": None, "median": None, "valid_count": 0,
                "selected_count": 0, "valid_area_m2": 0.0, "valid_coverage_ratio": 0.0,
                "effective_pixel_support": 0.0}
    arr = src.read(1, window=window, masked=False)
    win_transform = src.window_transform(window)
    touched = geometry_mask([mapping(geom)], out_shape=arr.shape, transform=win_transform,
                            all_touched=True, invert=True)
    rows, cols = np.nonzero(touched)
    selected_count = int(len(rows))
    if not len(rows):
        return {"mean": None, "std": None, "median": None, "valid_count": 0,
                "selected_count": 0, "valid_area_m2": 0.0, "valid_coverage_ratio": 0.0,
                "effective_pixel_support": 0.0}
    values = arr[rows, cols].astype(np.float64, copy=False)
    valid = _is_valid_value(values, src.nodata)
    rows, cols, values = rows[valid], cols[valid], values[valid]
    if not len(values):
        return {"mean": None, "std": None, "median": None, "valid_count": 0,
                "selected_count": selected_count, "valid_area_m2": 0.0, "valid_coverage_ratio": 0.0,
                "effective_pixel_support": 0.0}
    x0 = win_transform.c + cols * win_transform.a
    x1 = x0 + win_transform.a
    y1 = win_transform.f + rows * win_transform.e
    y0 = y1 + win_transform.e
    cells = shapely.box(np.minimum(x0, x1), np.minimum(y0, y1), np.maximum(x0, x1), np.maximum(y0, y1))
    weights = np.asarray(shapely.area(shapely.intersection(cells, geom)), dtype=np.float64)
    keep = np.isfinite(weights) & (weights > 0)
    values, weights = values[keep], weights[keep]
    if not len(values):
        return {"mean": None, "std": None, "median": None, "valid_count": 0,
                "selected_count": selected_count, "valid_area_m2": 0.0, "valid_coverage_ratio": 0.0,
                "effective_pixel_support": 0.0}
    area = float(weights.sum())
    mean = float(np.average(values, weights=weights))
    std = float(math.sqrt(max(0.0, np.average(np.square(values - mean), weights=weights))))
    order = np.argsort(values, kind="stable")
    sorted_values, sorted_weights = values[order], weights[order]
    median = float(sorted_values[min(len(sorted_values) - 1, int(np.searchsorted(np.cumsum(sorted_weights), area * 0.5, side="left")))])
    coverage = min(1.0, area / geom.area) if geom.area > 0 else 0.0
    squared_weights = float(np.square(weights).sum())
    support = area * area / squared_weights if squared_weights > 0 else 0.0
    return {"mean": mean, "std": std, "median": median, "valid_count": int(len(values)),
            "selected_count": selected_count, "valid_area_m2": area,
            "valid_coverage_ratio": coverage, "effective_pixel_support": support}


def _point_windows(geom: Any, src: rasterio.DatasetReader) -> dict[str, float | None]:
    point = geom.representative_point()
    row, col = src.index(point.x, point.y)
    result = {"representative_point_deg": None, "window_5x5_mean_deg": None, "window_9x9_mean_deg": None}
    if 0 <= row < src.height and 0 <= col < src.width:
        v = src.read(1, window=Window(col, row, 1, 1))[0, 0]
        if _is_valid_value(np.array([v]), src.nodata)[0]:
            result["representative_point_deg"] = float(v)
    for size in (5, 9):
        radius = size // 2
        r0, c0 = max(0, row - radius), max(0, col - radius)
        r1, c1 = min(src.height, row + radius + 1), min(src.width, col + radius + 1)
        if r1 <= r0 or c1 <= c0:
            continue
        arr = src.read(1, window=Window(c0, r0, c1 - c0, r1 - r0))
        vals = arr[_is_valid_value(arr, src.nodata)]
        result[f"window_{size}x{size}_mean_deg"] = float(vals.mean()) if vals.size else None
    return result


def sample_geometry(geom: Any, geom_crs: Any, src: rasterio.DatasetReader, force_area_weighted: bool = False) -> dict[str, Any]:
    original_valid = bool(geom is not None and geom.is_valid)
    geom = _polygonal(geom)
    if geom is None or geom.is_empty:
        return {"geometry_status": "empty_or_nonpolygon", "original_geometry_valid": original_valid,
                "sampling_status": "insufficient_coverage", "sampling_reason": "no_polygon_geometry",
                "valid_count": 0, "selected_pixel_count": 0, "valid_coverage_ratio": 0.0,
                "valid_selected_pixel_ratio": 0.0, "raster_extent_overlap_ratio": 0.0,
                "area_weighted_mean_deg": None, "area_weighted_std_deg": None,
                "area_weighted_median_deg": None, "area_weighted_valid_pixel_count": 0,
                "area_weighted_valid_area_m2": 0.0, "area_weighted_effective_pixel_support": 0.0,
                "candidate_method": None, "candidate_eligible": False,
                "pixel_center_passed": False, "slope_quality": "INSUFFICIENT DATA",
                "slope_unit_status": SLOPE_UNIT_STATUS,
                "area_weighted_computed": False, "valid_coverage_method": "not_computable",
                "distance_to_raster_edge_m": None}
    if geom_crs is None:
        raise ValueError("Geometry lacks CRS; refusing to guess or relabel coordinates.")
    if str(geom_crs) != str(src.crs):
        geom = shapely.transform(geom, __import__("pyproj").Transformer.from_crs(geom_crs, src.crs, always_xy=True).transform, interleaved=False)
    center, center_selected = _read_zonal(geom, src, False)
    touched, touched_selected = _read_zonal(geom, src, True)
    center_stats = _summary(center, center_selected)
    touched_stats = _summary(touched, touched_selected)
    pixel_area = abs(src.transform.a * src.transform.e)
    pixel_area_ratio = float(center_stats["valid_count"] * pixel_area / geom.area) if geom.area else None
    estimated_coverage_ratio = min(1.0, pixel_area_ratio) if pixel_area_ratio is not None else 0.0
    extent_geom = shapely.box(src.bounds.left, src.bounds.bottom, src.bounds.right, src.bounds.top)
    extent_ratio = min(1.0, float(geom.intersection(extent_geom).area / geom.area)) if geom.area else None
    point_stats = _point_windows(geom, src)
    stats = dict(center_stats)
    center_pass = (center_stats["valid_count"] >= MIN_VALID_PIXELS
                   and (extent_ratio or 0) >= MIN_PIXEL_COVERAGE
                   and (center_stats["valid_selected_pixel_ratio"] or 0) >= MIN_PIXEL_COVERAGE
                   and estimated_coverage_ratio >= MIN_PIXEL_COVERAGE)
    area_stats = None
    if force_area_weighted or not center_pass:
        area_stats = _area_weighted_summary(geom, src)
    coverage_ratio = area_stats["valid_coverage_ratio"] if area_stats else estimated_coverage_ratio
    area_pass = (area_stats is not None and area_stats["valid_count"] > 0
                 and (coverage_ratio or 0) >= MIN_PIXEL_COVERAGE
                 and (extent_ratio or 0) >= MIN_PIXEL_COVERAGE)
    status = "ok" if center_pass else "provisional" if area_pass else "insufficient_coverage"
    if center_stats["valid_count"] == 0:
        reason = "no_valid_raster_pixels"
    elif (extent_ratio or 0) < MIN_PIXEL_COVERAGE:
        reason = "raster_extent_overlap_below_threshold"
    elif center_stats["valid_count"] < MIN_VALID_PIXELS and area_pass:
        reason = "area_weighted_fallback_low_resolution_support"
    elif center_stats["valid_count"] < MIN_VALID_PIXELS:
        reason = "fewer_than_minimum_valid_pixels"
    elif (coverage_ratio or 0) < MIN_PIXEL_COVERAGE:
        reason = "valid_pixel_area_coverage_below_threshold"
    elif (extent_ratio or 0) < MIN_PIXEL_COVERAGE:
        reason = "raster_extent_overlap_below_threshold"
    elif (center_stats["valid_selected_pixel_ratio"] or 0) < MIN_PIXEL_COVERAGE:
        reason = "nodata_fraction_exceeds_threshold"
    else:
        reason = "passed"
    return {
        **stats, "all_touched_mean_deg": touched_stats["mean"], "all_touched_median_deg": touched_stats["median"],
        "all_touched_valid_pixel_count": touched_stats["valid_count"],
        "all_touched_valid_selected_pixel_ratio": touched_stats["valid_selected_pixel_ratio"],
        "representative_point_deg": point_stats["representative_point_deg"],
        "window_5x5_mean_deg": point_stats["window_5x5_mean_deg"],
        "window_9x9_mean_deg": point_stats["window_9x9_mean_deg"],
        "geometry_status": "repaired_for_sampling" if not original_valid else "valid",
        "original_geometry_valid": original_valid, "sampling_status": status, "sampling_reason": reason,
        "valid_coverage_ratio": coverage_ratio,
        "valid_selected_pixel_ratio": center_stats["valid_selected_pixel_ratio"],
        "raster_extent_overlap_ratio": extent_ratio,
        "distance_to_raster_edge_m": float(geom.distance(extent_geom.boundary)),
        "approx_valid_pixel_area_ratio": pixel_area_ratio,
        "area_weighted_mean_deg": area_stats["mean"] if area_stats else None,
        "area_weighted_std_deg": area_stats["std"] if area_stats else None,
        "area_weighted_median_deg": area_stats["median"] if area_stats else None,
        "area_weighted_valid_pixel_count": area_stats["valid_count"] if area_stats else 0,
        "area_weighted_valid_area_m2": area_stats["valid_area_m2"] if area_stats else 0.0,
        "area_weighted_effective_pixel_support": area_stats["effective_pixel_support"] if area_stats else None,
        "area_weighted_computed": area_stats is not None,
        "valid_coverage_method": "exact_area_intersection" if area_stats else "pixel_area_estimate",
        "candidate_method": "pixel_center" if center_pass else "area_weighted" if area_pass else None,
        "pixel_center_passed": bool(center_pass),
        "candidate_eligible": bool(center_pass or area_pass),
        "slope_quality": "PROVISIONAL" if area_pass or center_pass else "INSUFFICIENT DATA",
        "slope_unit_status": SLOPE_UNIT_STATUS,
    }


def _to_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _old_zone(props: dict[str, Any]) -> str | None:
    value = str(props.get("status_zona") or props.get("zona_triase") or "").lower()
    if "merah" in value:
        return "Merah"
    if "kuning" in value:
        return "Kuning"
    if "hijau" in value:
        return "Hijau"
    return zone_for_wlc(_to_float(props.get("skor_akhir")))


def _candidate_values(props: dict[str, Any], stats: dict[str, Any]) -> dict[str, Any]:
    old_slope = _to_float(props.get("lereng_derajat", props.get("beta_mean")))
    old_score = _to_float(next((props[k] for k in SCORE_ALIASES["skor_lereng"] if props.get(k) is not None), None))
    valid = bool(stats.get("candidate_eligible"))
    new_slope = (stats.get("mean") if stats.get("candidate_method") == "pixel_center"
                 else stats.get("area_weighted_mean_deg")) if valid else None
    new_score = slope_score(new_slope)
    old_inputs = dict(props)
    old_inputs["skor_lereng"] = old_score
    if old_inputs.get("skor_tanah") is None:
        old_inputs["skor_tanah"] = props.get("skor tanah")
    candidate_inputs = dict(props)
    candidate_inputs["skor_lereng"] = new_score
    if candidate_inputs.get("skor_tanah") is None:
        candidate_inputs["skor_tanah"] = props.get("skor tanah")
    old_recomputed_wlc = wlc_score(old_inputs) if old_score is not None else None
    candidate_wlc = wlc_score(candidate_inputs) if new_score is not None else None
    candidate = {
        "slope_old_deg": old_slope, "slope_old_score": old_score,
        "slope_raster_mean_deg": stats.get("mean"), "slope_raster_median_deg": stats.get("median"),
        "slope_area_weighted_mean_deg": stats.get("area_weighted_mean_deg"),
        "slope_area_weighted_std_deg": stats.get("area_weighted_std_deg"),
        "slope_area_weighted_median_deg": stats.get("area_weighted_median_deg"),
        "slope_raster_min_deg": stats.get("min"), "slope_raster_max_deg": stats.get("max"),
        "slope_raster_std_deg": stats.get("std"), "slope_raster_p25_deg": stats.get("p25"),
        "slope_raster_p75_deg": stats.get("p75"), "slope_raster_percent_from_mean": slope_percent(stats.get("mean")),
        "slope_all_touched_mean_deg": stats.get("all_touched_mean_deg"),
        "slope_dominant_pixel_score": stats.get("dominant_score"),
        "slope_representative_point_deg": stats.get("representative_point_deg"),
        "slope_window_5x5_mean_deg": stats.get("window_5x5_mean_deg"),
        "slope_window_9x9_mean_deg": stats.get("window_9x9_mean_deg"),
        "slope_valid_pixel_count": stats.get("valid_count", 0),
        "slope_selected_pixel_count": stats.get("selected_pixel_count", 0),
        "slope_valid_pixel_coverage_ratio": stats.get("valid_coverage_ratio"),
        "slope_valid_selected_pixel_ratio": stats.get("valid_selected_pixel_ratio"),
        "slope_raster_extent_overlap_ratio": stats.get("raster_extent_overlap_ratio"),
        "slope_approx_valid_pixel_area_ratio": stats.get("approx_valid_pixel_area_ratio"),
        "slope_sampling_method": stats.get("candidate_method"),
        "slope_sampling_status": stats.get("sampling_status", "failed"),
        "slope_quality": stats.get("slope_quality") or "INSUFFICIENT DATA",
        "slope_unit_status": SLOPE_UNIT_STATUS,
        "slope_effective_pixel_support": stats.get("area_weighted_effective_pixel_support"),
        "slope_mean_deg": new_slope,
        "slope_std_deg": stats.get("std") if stats.get("candidate_method") == "pixel_center" else stats.get("area_weighted_std_deg"),
        "slope_valid_coverage": stats.get("valid_coverage_ratio"),
        "slope_valid_coverage_method": stats.get("valid_coverage_method"),
        "slope_pixel_count": stats.get("valid_count") if stats.get("candidate_method") == "pixel_center" else stats.get("area_weighted_valid_pixel_count"),
        "slope_score_candidate": new_score,
        "slope_low_resolution_support": bool(valid and stats.get("area_weighted_computed") and (stats.get("area_weighted_effective_pixel_support") or 0) < 5),
        "slope_validation_note": (
            "Unit raster belum dikonfirmasi; nilai hanya kandidat dengan asumsi derajat."
            + (" Dukungan efektif kurang dari 5 piksel; hasil peka terhadap resolusi raster." if valid and stats.get("area_weighted_computed") and (stats.get("area_weighted_effective_pixel_support") or 0) < 5 else "")
        ),
        "slope_geometry_status": stats.get("geometry_status"),
        "slope_candidate_deg": new_slope, "slope_candidate_score": new_score,
        "slope_candidate_wlc_recomputed": candidate_wlc,
        "slope_old_wlc_recomputed_same_other_scores": old_recomputed_wlc,
        "slope_candidate_zone_from_wlc": zone_for_wlc(candidate_wlc),
        "slope_old_zone": _old_zone(props),
    }
    try:
        if all(props.get(k) is not None for k in ("c_kpa", "cr_kpa", "phi_deg", "gamma_sat", "z", "rasio_m", "q_kpa")) and new_slope is not None:
            fs_old, fs_new = _fs(props, old_slope), _fs(props, new_slope)
            candidate["fs_old_formula_recomputed"] = fs_old[0]
            candidate["fs_old_formula_status_recomputed"] = fs_old[1]
            candidate["fs_candidate_formula_simulation"] = fs_new[0]
            candidate["fs_candidate_formula_status"] = fs_new[1]
            candidate["fs_simulation_caveat"] = "Sensitivity simulation only: existing physical inputs are reused and were not independently validated against field data/DEM."
    except (TypeError, ValueError, ZeroDivisionError):
        pass
    return candidate


def _fs(props: dict[str, Any], beta: float | None) -> tuple[float | None, str | None]:
    if beta is None:
        return None, None
    c, cr, phi, gamma, z, m, q = (float(props[k]) for k in ("c_kpa", "cr_kpa", "phi_deg", "gamma_sat", "z", "rasio_m", "q_kpa"))
    u = round(m * 9.81 * z, 2)
    if beta <= 2.0:
        return 5.0, "STABIL"
    b, p = math.radians(beta), math.radians(phi)
    cb, sb = math.cos(b), math.sin(b)
    denom = (gamma * z + q) * sb * cb
    if denom <= 1e-6:
        return 5.0, "STABIL"
    normal = ((gamma * z - u) + q) * cb ** 2
    fs = round(min(5.0, max(0.10, ((c + cr) + normal * math.tan(p)) / denom)), 2)
    return fs, "STABIL" if fs > 1.25 else "KRITIS" if fs >= 1.07 else "LABIL / LONGSOR"


def _source_id(props: dict[str, Any], fallback: int) -> str:
    for name in ("fid", "id-kavling", "id_kavling", "kavling_id", "segmen_id", "id", "ID"):
        if props.get(name) is not None:
            return str(props[name])
    return str(fallback)


def _process_gdf(gdf: gpd.GeoDataFrame, source: str, src: rasterio.DatasetReader) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if gdf.crs is None:
        raise ValueError(f"{source} lacks CRS; refusing to guess.")
    metrics, comparison = [], []
    for index, row in gdf.iterrows():
        props = {k: (v.item() if isinstance(v, np.generic) else v) for k, v in row.drop(labels="geometry").to_dict().items()}
        stats = sample_geometry(row.geometry, gdf.crs, src)
        center_mean = stats.get("mean")
        near_class_boundary = center_mean is not None and any(abs(center_mean - threshold) <= 0.5 for threshold in SLOPE_THRESHOLDS)
        benchmark_btl05 = source.startswith("benchmark:") and "BTL-05" in _source_id(props, int(index) + 1).upper()
        systematic_sample = source == "production_geojson" and int(index) % 50 == 0
        if not stats.get("area_weighted_computed") and stats.get("candidate_method") == "pixel_center" and (near_class_boundary or benchmark_btl05 or systematic_sample):
            stats = sample_geometry(row.geometry, gdf.crs, src, force_area_weighted=True)
        area_geom = _polygonal(row.geometry)
        if area_geom is not None:
            if str(gdf.crs) != str(src.crs):
                transformer = __import__("pyproj").Transformer.from_crs(gdf.crs, src.crs, always_xy=True)
                area_geom = shapely.transform(area_geom, transformer.transform, interleaved=False)
            geometry_area_ha = float(area_geom.area / 10000.0)
        else:
            geometry_area_ha = None
        cid = _source_id(props, int(index) + 1)
        candidate = _candidate_values(props, stats)
        score_old = _to_float(next((props[k] for k in SCORE_ALIASES["skor_lereng"] if props.get(k) is not None), None))
        score_new = candidate.get("slope_candidate_score")
        metrics.append({"source": source, "source_index": int(index), "source_id": cid, "geometry_area_ha": geometry_area_ha, **props, **stats, **candidate})
        comparison.append({
            "source": source, "id": cid, "slope_old_deg": candidate.get("slope_old_deg"),
            "raster_mean_deg": stats.get("mean"), "raster_median_deg": stats.get("median"),
            "slope_candidate_deg": candidate.get("slope_candidate_deg"), "old_score": score_old,
            "new_score": score_new, "old_wlc": _to_float(props.get("skor_akhir")),
            "old_wlc_recomputed_same_other_scores": candidate.get("slope_old_wlc_recomputed_same_other_scores"),
            "candidate_wlc": candidate.get("slope_candidate_wlc_recomputed"),
            "old_zone": candidate.get("slope_old_zone"), "candidate_zone": candidate.get("slope_candidate_zone_from_wlc"),
            "sampling_status": stats.get("sampling_status"), "valid_pixel_count": stats.get("valid_count"),
            "coverage_ratio": stats.get("valid_coverage_ratio"),
        })
    return metrics, comparison


def _impact_summary(metrics: list[dict[str, Any]], source: str) -> dict[str, Any]:
    rows = [r for r in metrics if r["source"] == source]
    old_score_counts, old_score_eligible_counts, new_score_counts = Counter(), Counter(), Counter()
    zone_old, zone_old_eligible, zone_baseline, zone_baseline_eligible, zone_new = Counter(), Counter(), Counter(), Counter(), Counter()
    changed_scores, changed_zones, stored_zone_wlc_conflicts = 0, 0, 0
    area_old, area_old_eligible, area_baseline_eligible, area_new = Counter(), Counter(), Counter(), Counter()
    wlc_deltas, fs_deltas, fs_status_changes, fs_slope_status_changes = [], [], 0, 0
    slope_old, slope_new = [], []
    fs_changed = 0
    for r in rows:
        old_s, new_s = r.get("slope_old_score"), r.get("slope_candidate_score")
        if old_s is not None:
            old_score_counts[str(int(old_s))] += 1
        if r.get("slope_sampling_status") in {"ok", "provisional"} and new_s is not None:
            new_score_counts[str(int(new_s))] += 1
            slope_new.append(r["slope_candidate_deg"])
            if old_s is not None:
                old_score_eligible_counts[str(int(old_s))] += 1
        if r.get("slope_old_deg") is not None:
            slope_old.append(r["slope_old_deg"])
        if old_s is not None and new_s is not None and int(old_s) != int(new_s):
            changed_scores += 1
        oz, nz = r.get("slope_old_zone"), r.get("slope_candidate_zone_from_wlc")
        base_wlc_zone = zone_for_wlc(r.get("slope_old_wlc_recomputed_same_other_scores"))
        if oz:
            zone_old[oz] += 1
            if r.get("slope_sampling_status") in {"ok", "provisional"}:
                zone_old_eligible[oz] += 1
        if nz:
            zone_new[nz] += 1
        if base_wlc_zone:
            zone_baseline[base_wlc_zone] += 1
            if r.get("slope_sampling_status") in {"ok", "provisional"}:
                zone_baseline_eligible[base_wlc_zone] += 1
            if oz and oz != base_wlc_zone:
                stored_zone_wlc_conflicts += 1
        if base_wlc_zone and nz and base_wlc_zone != nz:
            changed_zones += 1
        area = _to_float(r.get("luas_ha")) or _to_float(r.get("geometry_area_ha"))
        if area and oz:
            area_old[oz] += area
            if r.get("slope_sampling_status") in {"ok", "provisional"}:
                area_old_eligible[oz] += area
        if area and base_wlc_zone and r.get("slope_sampling_status") in {"ok", "provisional"}:
            area_baseline_eligible[base_wlc_zone] += area
        if area and nz:
            area_new[nz] += area
        if r.get("fs_old_formula_recomputed") is not None and r.get("fs_candidate_formula_simulation") is not None and r["fs_old_formula_recomputed"] != r["fs_candidate_formula_simulation"]:
            fs_changed += 1
        old_formula_wlc = r.get("slope_old_wlc_recomputed_same_other_scores")
        candidate_wlc = r.get("slope_candidate_wlc_recomputed")
        if old_formula_wlc is not None and candidate_wlc is not None:
            wlc_deltas.append(candidate_wlc - old_formula_wlc)
        fs_old = r.get("fs_old_formula_recomputed")
        fs_new = r.get("fs_candidate_formula_simulation")
        if fs_old is not None and fs_new is not None:
            fs_deltas.append(fs_new - fs_old)
            if r.get("fs_status") and r.get("fs_candidate_formula_status") and r["fs_status"] != r["fs_candidate_formula_status"]:
                fs_status_changes += 1
            if r.get("fs_old_formula_status_recomputed") and r.get("fs_candidate_formula_status") and r["fs_old_formula_status_recomputed"] != r["fs_candidate_formula_status"]:
                fs_slope_status_changes += 1
    def stats(values: list[float]) -> dict[str, float | None]:
        return {"n": len(values), "mean": float(np.mean(values)) if values else None, "median": float(np.median(values)) if values else None, "min": float(np.min(values)) if values else None, "max": float(np.max(values)) if values else None}
    return {
        "source": source, "features": len(rows),
        "sampling_ok": sum(r.get("slope_sampling_status") in {"ok", "provisional"} for r in rows),
        "insufficient_or_failed": sum(r.get("slope_sampling_status") not in {"ok", "provisional"} for r in rows),
        "old_slope_statistics_deg": stats(slope_old), "candidate_slope_statistics_deg": stats(slope_new),
        "old_score_distribution": dict(old_score_counts), "candidate_score_distribution": dict(new_score_counts),
        "old_score_distribution_eligible_only": dict(old_score_eligible_counts),
        "score_changed_count": changed_scores, "old_zone_feature_counts": dict(zone_old),
        "old_zone_feature_counts_eligible_only": dict(zone_old_eligible),
        "old_recomputed_wlc_zone_feature_counts": dict(zone_baseline),
        "old_recomputed_wlc_zone_feature_counts_eligible_only": dict(zone_baseline_eligible),
        "candidate_zone_feature_counts": dict(zone_new), "zone_changed_count": changed_zones,
        "stored_zone_vs_old_recomputed_wlc_conflict_count": stored_zone_wlc_conflicts,
        "old_zone_area_ha_from_existing_area_attribute": dict(area_old),
        "old_zone_area_ha_eligible_only": dict(area_old_eligible),
        "old_recomputed_wlc_zone_area_ha_eligible_only": dict(area_baseline_eligible),
        "candidate_zone_area_ha_from_existing_area_attribute": dict(area_new),
        "wlc_delta_candidate_minus_recomputed_old_same_other_scores": stats(wlc_deltas),
        "fs_simulation_changed_count": fs_changed, "fs_status_transition_count_vs_stored": fs_status_changes,
        "fs_status_transition_count_due_to_slope_vs_recomputed_old": fs_slope_status_changes,
        "fs_value_delta_candidate_minus_recomputed_old": stats(fs_deltas),
    }


def _write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")


def _match_master_to_production(master: gpd.GeoDataFrame, production: gpd.GeoDataFrame) -> list[dict[str, Any]]:
    """Best-overlap match without assuming feature IDs align."""
    prod = production.to_crs(master.crs) if production.crs != master.crs else production
    sindex = prod.sindex
    rows = []
    for mi, mr in master.iterrows():
        mg = _polygonal(mr.geometry)
        if mg is None or mg.area <= 0:
            continue
        candidates = sindex.query(mg, predicate="intersects")
        best = None
        for pi in candidates:
            pg = _polygonal(prod.iloc[int(pi)].geometry)
            if pg is None or pg.area <= 0:
                continue
            intersection = mg.intersection(pg).area
            union = mg.area + pg.area - intersection
            iou = intersection / union if union else 0.0
            if best is None or iou > best["iou"]:
                best = {"production_index": int(pi), "iou": iou, "intersection_area_m2": intersection,
                        "master_overlap_ratio": intersection / mg.area, "production_overlap_ratio": intersection / pg.area}
        if best:
            rows.append({"master_index": int(mi), "master_id": _source_id(mr.drop(labels="geometry").to_dict(), int(mi) + 1),
                         "production_index": best["production_index"],
                         "production_id": _source_id(prod.iloc[best["production_index"]].drop(labels="geometry").to_dict(), best["production_index"] + 1), **best})
    return rows


def _make_candidate_geojson(source_json: dict[str, Any], metrics: list[dict[str, Any]]) -> dict[str, Any]:
    lookup = {r["source_index"]: r for r in metrics if r["source"] == "production_geojson"}
    result = dict(source_json)
    features = []
    for index, feature in enumerate(source_json.get("features", [])):
        copy = dict(feature)
        props = dict(feature.get("properties") or {})
        metric = lookup.get(index, {})
        fields = {key: metric.get(key) for key in (
            "slope_old_deg", "slope_old_score", "slope_raster_mean_deg", "slope_raster_median_deg",
            "slope_raster_min_deg", "slope_raster_max_deg", "slope_raster_std_deg", "slope_raster_p25_deg",
            "slope_raster_p75_deg", "slope_raster_percent_from_mean", "slope_all_touched_mean_deg",
            "slope_area_weighted_mean_deg", "slope_area_weighted_std_deg", "slope_area_weighted_median_deg",
            "slope_dominant_pixel_score", "slope_representative_point_deg", "slope_window_5x5_mean_deg",
            "slope_window_9x9_mean_deg", "slope_valid_pixel_count", "slope_selected_pixel_count",
            "slope_valid_pixel_coverage_ratio", "slope_valid_selected_pixel_ratio", "slope_raster_extent_overlap_ratio",
            "slope_approx_valid_pixel_area_ratio", "slope_sampling_method",
            "slope_sampling_status", "slope_quality", "slope_unit_status", "slope_effective_pixel_support",
            "slope_mean_deg", "slope_std_deg", "slope_valid_coverage", "slope_valid_coverage_method", "slope_pixel_count", "slope_score_candidate",
            "slope_low_resolution_support", "slope_validation_note", "slope_sampling_reason", "slope_geometry_status", "slope_candidate_deg", "slope_candidate_score",
            "slope_candidate_wlc_recomputed", "slope_old_wlc_recomputed_same_other_scores",
            "slope_candidate_zone_from_wlc", "slope_old_zone", "fs_old_formula_recomputed", "fs_old_formula_status_recomputed",
            "fs_candidate_formula_simulation", "fs_candidate_formula_status", "fs_simulation_caveat",
        )}
        props.update(fields)
        copy["properties"] = props
        features.append(copy)
    result["features"] = features
    return result


def run(
    raster_path: Path,
    out_dir: Path = OUT_DIR,
    master_gpkg: Path | None = None,
    benchmark_gpkg: Path | None = None,
    production_geojson: Path = PRODUCTION_GEOJSON,
) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    raster_path = raster_path.expanduser().resolve()
    production_geojson = production_geojson.expanduser().resolve()
    if not raster_path.exists():
        raise FileNotFoundError(raster_path)
    if not production_geojson.exists():
        raise FileNotFoundError(production_geojson)
    if master_gpkg is not None:
        master_gpkg = master_gpkg.expanduser().resolve()
        if not master_gpkg.exists():
            raise FileNotFoundError(master_gpkg)
    if benchmark_gpkg is not None:
        benchmark_gpkg = benchmark_gpkg.expanduser().resolve()
        if not benchmark_gpkg.exists():
            raise FileNotFoundError(benchmark_gpkg)
    raster_meta = inspect_raster(raster_path)
    with rasterio.open(raster_path) as src:
        prod_json = json.loads(production_geojson.read_text(encoding="utf-8"))
        prod_gdf = gpd.GeoDataFrame.from_features(prod_json["features"], crs="EPSG:4326")
        prod_metrics, prod_comparison = _process_gdf(prod_gdf, "production_geojson", src)
        master_gdf = gpd.read_file(master_gpkg) if master_gpkg is not None else None
        if master_gdf is not None:
            master_metrics, master_comparison = _process_gdf(master_gdf, "day8_master_gpkg", src)
        else:
            master_metrics, master_comparison = [], []
        metrics = prod_metrics + master_metrics
        comparisons = prod_comparison + master_comparison
        benchmark_metrics: list[dict[str, Any]] = []
        benchmark_comparisons: list[dict[str, Any]] = []
        if benchmark_gpkg is not None:
            for layer in ("GPKG_Benchmark_Segmen_10_Kavling_QGIS", "zonal_statistics"):
                try:
                    b_gdf = gpd.read_file(benchmark_gpkg, layer=layer)
                except (ValueError, OSError):
                    continue
                bm, bc = _process_gdf(b_gdf, f"benchmark:{layer}", src)
                benchmark_metrics.extend(bm)
                benchmark_comparisons.extend(bc)
        metrics.extend(benchmark_metrics)
        comparisons.extend(benchmark_comparisons)
        candidate = _make_candidate_geojson(prod_json, metrics)
        _write_json(out_dir / "slope_regenerated_candidate.geojson", candidate)
        pd = __import__("pandas")
        pd.DataFrame(comparisons).to_csv(out_dir / "slope_regenerated_comparison.csv", index=False, encoding="utf-8-sig")
        pd.DataFrame([{k: r.get(k) for k in ("source", "source_index", "source_id", "geometry_area_ha", "slope_old_deg", "mean", "median", "min", "max", "std", "p25", "p75", "valid_count", "selected_pixel_count", "valid_coverage_ratio", "valid_coverage_method", "valid_selected_pixel_ratio", "raster_extent_overlap_ratio", "distance_to_raster_edge_m", "area_weighted_mean_deg", "area_weighted_std_deg", "area_weighted_median_deg", "area_weighted_valid_pixel_count", "area_weighted_valid_area_m2", "area_weighted_effective_pixel_support", "candidate_method", "candidate_eligible", "slope_quality", "slope_unit_status", "all_touched_mean_deg", "dominant_score", "representative_point_deg", "window_5x5_mean_deg", "window_9x9_mean_deg", "sampling_status", "sampling_reason", "geometry_status")} for r in metrics]).to_csv(out_dir / "slope_coverage_report.csv", index=False, encoding="utf-8-sig")
        failed_rows = [r for r in prod_metrics if not r.get("pixel_center_passed")]
        failure_report = []
        for r in failed_rows:
            overlap = float(r.get("raster_extent_overlap_ratio") or 0.0)
            coverage = float(r.get("valid_coverage_ratio") or 0.0)
            if r.get("geometry_status") == "empty_or_nonpolygon":
                category, alternative = "invalid_or_nonpolygon_geometry", "Periksa geometri; tanpa komponen polygon jangan mengisi slope."
            elif r.get("slope_sampling_status") == "provisional":
                category, alternative = "pixel_center_insufficient_area_weighted_fallback_available", "Kandidat area-weighted tersedia; status tetap provisional karena unit belum terkonfirmasi dan dukungan resolusi mungkin rendah."
            elif overlap == 0:
                category, alternative = "outside_raster_extent", "Periksa CRS dan tile resmi lain; tanpa cakupan tetap insufficient data."
            elif overlap < MIN_PIXEL_COVERAGE:
                category, alternative = "partial_raster_extent", "Cari tile resmi yang bersebelahan atau tandai insufficient data."
            elif r.get("area_weighted_valid_pixel_count", 0) == 0:
                category, alternative = "nodata_or_no_valid_intersection", "Periksa NoData dan tile lain yang provenance-nya sama; jangan pinjam nilai tetangga."
            elif coverage < MIN_PIXEL_COVERAGE:
                category, alternative = "valid_area_coverage_below_threshold", "Tinjau coverage/NoData; jangan klasifikasikan sebelum memenuhi ambang."
            else:
                category, alternative = "low_resolution_or_sampling_support", "Gunakan area-weighted hanya bila coverage cukup; tandai provisional/dukungan resolusi rendah."
            failure_report.append({
                "fid": r.get("source_id"), "source_index": r.get("source_index"),
                "area_m2": (r.get("geometry_area_ha") or 0) * 10000,
                "pixel_center_count": r.get("selected_pixel_count"),
                "pixel_center_valid_count": r.get("valid_count"),
                "area_weighted_intersecting_valid_pixels": r.get("area_weighted_valid_pixel_count"),
                "valid_coverage_percent": coverage * 100,
                "pixel_center_nodata_percent": (1 - float(r.get("valid_selected_pixel_ratio") or 0)) * 100 if r.get("selected_pixel_count") else None,
                "extent_overlap_percent": overlap * 100,
                "distance_to_raster_edge_m": r.get("distance_to_raster_edge_m"),
                "geometry_status": r.get("geometry_status"),
                "failure_category": category, "sampling_reason": r.get("slope_sampling_reason"),
                "alternative_method_or_action": alternative,
            })
        pd.DataFrame(failure_report).to_csv(out_dir / "slope_failed_features_review.csv", index=False, encoding="utf-8-sig")
        methods = []
        for r in prod_metrics:
            base = {"id": r["source_id"], "old_deg": r.get("slope_old_deg"), "old_score": r.get("slope_old_score"), "coverage": r.get("valid_coverage_ratio"), "valid_pixels": r.get("valid_count")}
            for name, value in (("zonal_mean_pixel_center", r.get("mean")), ("zonal_mean_area_weighted", r.get("area_weighted_mean_deg")), ("zonal_median_area_weighted", r.get("area_weighted_median_deg")), ("zonal_mean_all_touched", r.get("all_touched_mean_deg")), ("dominant_pixel_class", r.get("dominant_score")), ("representative_point", r.get("representative_point_deg")), ("window_5x5_mean", r.get("window_5x5_mean_deg")), ("window_9x9_mean", r.get("window_9x9_mean_deg"))):
                methods.append({**base, "method": name, "slope_deg_or_score": value, "derived_score": slope_score(value) if name != "dominant_pixel_class" else value})
        pd.DataFrame(methods).to_csv(out_dir / "slope_method_comparison.csv", index=False, encoding="utf-8-sig")
        method_df = pd.DataFrame(methods)
        primary_by_id = method_df[method_df.method == "zonal_mean_pixel_center"].set_index("id")
        method_summary = []
        for method, group in method_df.groupby("method"):
            numeric = pd.to_numeric(group["slope_deg_or_score"], errors="coerce")
            comparable = group[group.id.isin(primary_by_id.index)].copy()
            primary_vals = comparable.id.map(primary_by_id["slope_deg_or_score"])
            current_vals = pd.to_numeric(comparable["slope_deg_or_score"], errors="coerce")
            method_summary.append({"method": method, "n": int(numeric.notna().sum()), "mean": float(numeric.mean()) if numeric.notna().any() else None,
                                   "median": float(numeric.median()) if numeric.notna().any() else None,
                                   "value_unit": "class_score" if method == "dominant_pixel_class" else "degrees",
                                   "mean_absolute_difference_from_primary": (None if method == "dominant_pixel_class" else float((current_vals - pd.to_numeric(primary_vals, errors="coerce")).abs().mean()) if method != "zonal_mean_pixel_center" and current_vals.notna().any() else 0.0),
                                   "score_matches_old_count_diagnostic_only": int((group.derived_score == group.old_score).sum()),
                                   "score_differs_from_primary_count": int((group.derived_score != group.id.map(primary_by_id.derived_score)).sum()) if method != "zonal_mean_pixel_center" else 0})
        _write_json(out_dir / "slope_method_comparison_summary.json", method_summary)
        matches = _match_master_to_production(master_gdf, prod_gdf) if master_gdf is not None else []
        pd.DataFrame(matches).to_csv(out_dir / "day8_master_to_production_spatial_matches.csv", index=False, encoding="utf-8-sig")
    summary = {
        "generated_at_local": __import__("datetime").datetime.now().astimezone().isoformat(),
        "mode": "local_candidate_only",
        "raster": raster_meta,
        "method": {"primary": "pixel-center zonal mean when the count/coverage rules pass; exact area-weighted mean is computed for pixel-center failures, benchmark BTL-05, a 2% systematic production sample, and slopes within 0.5 degree of a class boundary",
                   "alternatives": ["exact area-weighted zonal mean on fallback and diagnostic subsets", "all_touched mean (diagnostic only)", "pixel-center median", "dominant pixel class", "representative point", "5x5 mean", "9x9 mean"],
                   "no_data": "exclude raster NoData, non-finite, and values outside [0, 90) degrees",
                   "minimum_coverage": {"minimum_valid_pixels": MIN_VALID_PIXELS, "minimum_valid_pixel_fraction_of_center-selected_pixels": MIN_PIXEL_COVERAGE},
                   "coverage_note": "Coverage is exact valid cell intersection area where area-weighted sampling was run; otherwise it is an explicitly labeled pixel-area estimate. Pixel-center support remains a separate count/valid ratio. Area-weighted effective support is (sum weights)^2/sum(weight^2); a small support is marked low-resolution.",
                   "unit_status": SLOPE_UNIT_STATUS,
                   "geometry": "repair invalid polygon geometry with make_valid for sampling only; source geometry remains unchanged",
                   "slope_unit": "unconfirmed; degree interpretation is operational and provenance limitation is retained"},
        "thresholds": {"slope_score": {"1": "0–8 inclusive", "2": ">8–15 inclusive", "3": ">15–25 inclusive", "4": ">25–35 inclusive", "5": ">35–<90"},
                       "wlc_weights": WEIGHTS, "zone": {"green": "<2.20", "yellow": "2.20–3.40 inclusive", "red": ">3.40"}},
        "source_counts": {name: sum(r["source"] == name for r in metrics) for name in sorted({r["source"] for r in metrics})},
        "impact": {name: _impact_summary(metrics, name) for name in sorted({r["source"] for r in metrics})},
        "spatial_match": {"master_features": len(master_gdf) if master_gdf is not None else None, "production_features": len(prod_gdf), "matched_by_best_iou_count": len(matches), "iou_ge_0_5_count": sum(m["iou"] >= 0.5 for m in matches)},
        "fs_note": "FS values are sensitivity simulations reusing existing GeoJSON physical inputs and pipeline formula; inputs have not been independently validated against field measurements or DEM. They are not an independently validated stability result.",
        "source_files_read_only": [str(raster_path), str(master_gpkg) if master_gpkg else None, str(production_geojson), str(benchmark_gpkg) if benchmark_gpkg else None],
        "quality_counts": {quality: sum(r.get("slope_quality") == quality for r in prod_metrics) for quality in ("HIGH CONFIDENCE", "MEDIUM CONFIDENCE", "PROVISIONAL", "INSUFFICIENT DATA")},
        "output_files": ["slope_regenerated_candidate.geojson", "slope_regenerated_comparison.csv", "slope_regenerated_summary.json", "slope_method_comparison.csv", "slope_method_comparison_summary.json", "slope_coverage_report.csv", "slope_failed_features_review.csv", "slope_source_config.json", "btL05_validation.json", "day8_master_to_production_spatial_matches.csv"],
    }
    _write_json(out_dir / "slope_source_config.json", {
        "path": raster_meta["path"], "sha256": raster_meta["sha256"],
        "crs": raster_meta["crs"], "resolution_x_m": raster_meta["resolution_x_m"],
        "resolution_y_m": raster_meta["resolution_y_m"], "nodata": raster_meta["nodata"],
        "assumed_unit": "degree", "unit_status": SLOPE_UNIT_STATUS,
        "provenance": raster_meta.get("unit_assessment"),
    })
    _write_json(out_dir / "slope_regenerated_summary.json", summary)
    btl_rows = [r for r in metrics if r["source"].startswith("benchmark:") and "BTL-05" in str(r.get("id_kavling", r.get("source_id", ""))).upper()]
    if not btl_rows:
        btl_rows = [r for r in metrics if r["source"].startswith("benchmark:") and "BTL-05" in r["source_id"].upper()]
    _write_json(out_dir / "btL05_validation.json", {
        "benchmark": str(benchmark_gpkg) if benchmark_gpkg else None, "id": "BTL-05", "source_rows": btl_rows,
        "finding": "Compare pixel-center and exact area-weighted zonal statistics with stored beta_mean and score. A mismatch can reflect raster/geometric/method differences; do not alter source record.",
    })
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raster", type=Path, default=Path(os.environ["LAHANAMAN_SLOPE_RASTER"]) if os.environ.get("LAHANAMAN_SLOPE_RASTER") else None, help="Path raster slope; defaults to LAHANAMAN_SLOPE_RASTER")
    parser.add_argument("--master-gpkg", type=Path, default=Path(os.environ["LAHANAMAN_MASTER_GPKG"]) if os.environ.get("LAHANAMAN_MASTER_GPKG") else None, help="Optional Day 8 GeoPackage path")
    parser.add_argument("--benchmark-gpkg", type=Path, default=Path(os.environ["LAHANAMAN_BENCHMARK_GPKG"]) if os.environ.get("LAHANAMAN_BENCHMARK_GPKG") else None, help="Optional benchmark GeoPackage path")
    parser.add_argument("--production-geojson", type=Path, default=Path(os.environ.get("LAHANAMAN_PRODUCTION_GEOJSON", str(PRODUCTION_GEOJSON))), help="Production GeoJSON source (read only)")
    parser.add_argument("--output-dir", type=Path, default=OUT_DIR)
    args = parser.parse_args()
    if args.raster is None:
        parser.error("pass --raster or set LAHANAMAN_SLOPE_RASTER")
    result = run(args.raster, args.output_dir, args.master_gpkg, args.benchmark_gpkg, args.production_geojson)
    print(json.dumps({"output_dir": str(args.output_dir), "source_counts": result["source_counts"], "impact": result["impact"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
