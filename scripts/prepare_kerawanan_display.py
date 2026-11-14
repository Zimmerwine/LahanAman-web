"""Create a local display-only GeoJSON with polygonal invalid geometries repaired."""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import shapely
from shapely.geometry import mapping, shape

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "data" / "clean_kerawanan_longsor.geojson"
OUTPUT_DIR = ROOT / "outputs" / "dem-slope-regeneration"
OUTPUT = OUTPUT_DIR / "kerawanan_display.geojson"
APP_OUTPUT = ROOT / "public" / "data" / "clean_kerawanan_longsor_display.geojson"
REPORT = OUTPUT_DIR / "kerawanan_display_geometry_report.json"


def polygonal_only(geometry):
    if geometry is None or geometry.is_empty:
        return None
    if geometry.geom_type in {"Polygon", "MultiPolygon"}:
        return geometry
    if geometry.geom_type == "GeometryCollection":
        polygons = []
        for part in geometry.geoms:
            if part.geom_type == "Polygon" and not part.is_empty and part.area > 0:
                polygons.append(part)
            elif part.geom_type == "MultiPolygon":
                polygons.extend(p for p in part.geoms if not p.is_empty and p.area > 0)
        return shapely.union_all(polygons) if polygons else None
    return None


def run():
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    out = dict(source)
    features = []
    counts = Counter()
    red_audit = []
    for index, feature in enumerate(source.get("features", [])):
        copy = dict(feature)
        props = dict(feature.get("properties") or {})
        raw_geometry = feature.get("geometry")
        red = "MERAH" in str(props.get("zona_triase") or props.get("status_zona") or "").upper()
        original = shape(raw_geometry) if raw_geometry else None
        original_type = original.geom_type if original is not None else "missing"
        original_valid = bool(original is not None and original.is_valid)
        display_geometry = original
        repaired = False
        outcome = "kept"
        if original is None or original.is_empty:
            outcome = "empty_or_missing"
        else:
            if not original_valid:
                display_geometry = shapely.make_valid(original)
                repaired = True
            if display_geometry.geom_type == "GeometryCollection":
                polygonal = polygonal_only(display_geometry)
                if polygonal is not None:
                    display_geometry = polygonal
                    outcome = "polygon_components_extracted"
                else:
                    outcome = "nonpolygon_components_preserved"
            elif display_geometry.geom_type in {"Polygon", "MultiPolygon"}:
                outcome = "polygon_repaired" if repaired else "polygon_valid"
            elif display_geometry.geom_type in {"LineString", "MultiLineString", "Point", "MultiPoint"}:
                outcome = "nonpolygon_preserved"
            else:
                outcome = "unsupported_geometry_preserved"
        props["_display_geometry_original_type"] = original_type
        props["_display_geometry_repaired"] = repaired
        props["_display_geometry_outcome"] = outcome
        copy["properties"] = props
        copy["geometry"] = mapping(display_geometry) if display_geometry is not None else raw_geometry
        features.append(copy)
        counts[f"type:{original_type}"] += 1
        counts[f"valid:{'yes' if original_valid else 'no'}"] += 1
        counts[f"outcome:{outcome}"] += 1
        if red:
            red_audit.append({
                "feature_index": index,
                "fid": props.get("fid", feature.get("id", index)),
                "original_geometry_type": original_type,
                "original_geometry_valid": original_valid,
                "display_geometry_type": display_geometry.geom_type if display_geometry is not None else "missing",
                "display_geometry_repaired": repaired,
                "display_geometry_outcome": outcome,
                "polygon_area_available": bool(display_geometry is not None and display_geometry.geom_type in {"Polygon", "MultiPolygon"}),
            })
    out["features"] = features
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    OUTPUT.write_text(serialized, encoding="utf-8")
    APP_OUTPUT.write_text(serialized, encoding="utf-8")
    red_count = len(red_audit)
    report = {
        "source": str(SOURCE),
        "output_display_only": str(OUTPUT),
        "application_display_only": str(APP_OUTPUT),
        "source_unchanged": True,
        "feature_count": len(features),
        "red_feature_count": red_count,
        "red_displayable_polygon_count": sum(row["polygon_area_available"] for row in red_audit),
        "red_not_polygon_count": sum(not row["polygon_area_available"] for row in red_audit),
        "geometry_counts": dict(counts),
        "red_feature_audit": red_audit,
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


if __name__ == "__main__":
    print(json.dumps(run(), ensure_ascii=False, indent=2))
