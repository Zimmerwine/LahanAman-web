import json
import math
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory

# =====================================================================
# 1. KONFIGURASI PATH & DIREKTORI
# =====================================================================
API_DIR = Path(__file__).resolve().parent
ROOT_DIR = API_DIR.parent
WEB_DIR = ROOT_DIR / "Web"

def resolve_data_dir() -> Path:
    candidates = [
        ROOT_DIR / "public" / "data",
        ROOT_DIR / "Data" / "processed",
        Path("/var/task/public/data"),
        Path.cwd() / "public" / "data",
        API_DIR.parent / "public" / "data",
    ]
    for c in candidates:
        if c.exists() and (c / "clean_batas_administrasi.geojson").exists():
            return c
    return ROOT_DIR / "public" / "data"

DATA_DIR = resolve_data_dir()

try:
    os.chdir(ROOT_DIR)
except Exception:
    pass

app = Flask(__name__)

@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response

# =====================================================================
# 2. IN-MEMORY CACHE & SPATIAL BBOX INDEXING
# =====================================================================
DATA_CACHE = {
    "loaded": False,
    "admin": [],
    "kerawanan": [],
    "lereng": [],
    "tanah": [],
    "batuan": [],
    "hujan": [],
    "land_use": [],
}

LAND_USE_FILE = "clean_tutupan_lahan_diy.geojson"
LAND_USE_SOURCE = {
    "id": "land-use-diy-rbi25k",
    "title": "Layer5 Tata Guna Lahan (RBI 25K)",
    "localFile": "public/data/clean_tutupan_lahan_diy.geojson",
    "sourceDataset": "GPKG/GJS Layer5_Tata Guna Lahan (RBI 25K)",
    "sourceInstitution": None,
    "sourceUrl": None,
    "sourceDate": None,
    "sourceCrs": "EPSG:32749 (pipeline source), delivered as OGC:CRS84 / EPSG:4326",
    "coverage": "Kab. Sleman, Kab. Bantul, Kota Yogyakarta; tidak mencakup seluruh wilayah DIY",
    "verificationStatus": "source_metadata_incomplete",
    "legalDesignationVerified": False,
    "notes": [
        "Nama kelas berasal dari atribut pl/klasifikasi sumber.",
        "Institusi, versi, tanggal publikasi, dan lisensi sumber belum tercatat di aplikasi.",
        "Label Hutan Lindung/Konservasi/Produksi bukan bukti batas atau status kawasan resmi.",
    ],
}

LAND_USE_GROUP_LABELS = {
    "hutan": "Tutupan hutan",
    "pertanian": "Pertanian dan perkebunan",
    "terbangun": "Permukiman dan infrastruktur",
    "badan_air": "Badan air",
    "lainnya": "Kelas lain",
}

LAND_USE_GROUPS = {
    "Hutan Lindung": "hutan",
    "Hutan Konservasi": "hutan",
    "Hutan Produksi": "hutan",
    "Kebun": "pertanian",
    "Sawah Irigasi": "pertanian",
    "Sawah Tadah Hujan": "pertanian",
    "Tegalan/Ladang": "pertanian",
    "Permukiman": "terbangun",
    "Emplasemen": "terbangun",
    "Industri": "terbangun",
    "Bandara": "terbangun",
    "Lapangan Olah Raga": "terbangun",
    "Sungai": "badan_air",
    "Danau/Waduk": "badan_air",
    "Kolam Air Tawar": "badan_air",
    "Tambak": "badan_air",
    "Semak/Belukar": "lainnya",
    "Rumput/Tanah Kosong": "lainnya",
    "Makam": "lainnya",
    "Candi Prambanan": "lainnya",
}

SENSITIVE_CLASS_RULES = {
    "Hutan Lindung": {
        "id": "forest_lindung_cover",
        "category": "forest_cover",
        "severity": "high",
        "label": "Tutupan hutan lindung",
        "message": "Kelas guna lahan Hutan Lindung teridentifikasi. Ini label tutupan lahan, bukan penetapan atau batas kawasan lindung resmi.",
    },
    "Hutan Konservasi": {
        "id": "forest_konservasi_cover",
        "category": "forest_cover",
        "severity": "high",
        "label": "Tutupan hutan konservasi",
        "message": "Kelas guna lahan Hutan Konservasi teridentifikasi. Status dan batas kawasan konservasi resmi belum diverifikasi.",
    },
    "Hutan Produksi": {
        "id": "forest_produksi_cover",
        "category": "forest_cover",
        "severity": "low",
        "label": "Tutupan hutan produksi",
        "message": "Kelas guna lahan Hutan Produksi teridentifikasi. Kelas ini bukan penetapan kawasan lindung.",
    },
    "Candi Prambanan": {
        "id": "cultural_candi_prambanan",
        "category": "cultural_object",
        "severity": "high",
        "label": "Objek budaya Candi Prambanan",
        "message": "Objek budaya Candi Prambanan terpetakan sebagai kelas guna lahan. Zona perlindungan resmi dan batasnya belum tersedia.",
    },
    "Makam": {
        "id": "cultural_makam",
        "category": "cultural_land_use",
        "severity": "low",
        "label": "Guna lahan makam",
        "message": "Guna lahan makam terpetakan. Status perlindungan budaya dan batas resminya belum tersedia.",
    },
    "Sungai": {
        "id": "water_sungai",
        "category": "water_body",
        "severity": "medium",
        "label": "Sungai",
        "message": "Sungai terdeteksi dari kelas guna lahan. Garis sempadan resmi dan lebar buffer belum tersedia.",
    },
    "Danau/Waduk": {
        "id": "water_danau_waduk",
        "category": "water_body",
        "severity": "medium",
        "label": "Danau/waduk",
        "message": "Danau/waduk terdeteksi dari kelas guna lahan. Sempadan resmi belum tersedia.",
    },
    "Kolam Air Tawar": {
        "id": "water_kolam",
        "category": "water_body",
        "severity": "low",
        "label": "Kolam air tawar",
        "message": "Kolam air tawar terdeteksi dari kelas guna lahan. Status dan sempadan resmi belum tersedia.",
    },
    "Tambak": {
        "id": "water_tambak",
        "category": "water_body",
        "severity": "low",
        "label": "Tambak",
        "message": "Tambak terdeteksi dari kelas guna lahan. Status dan sempadan resmi belum tersedia.",
    },
}

SENSITIVE_CATEGORY_LABELS = {
    "forest_cover": "Tutupan hutan",
    "cultural_object": "Objek budaya",
    "cultural_land_use": "Guna lahan budaya",
    "water_body": "Badan air",
}

def _collect_polygonal_coords(geom, xs, ys):
    if not geom or not isinstance(geom, dict):
        return
    g_type = geom.get("type")
    if g_type == "Polygon":
        for ring in geom.get("coordinates", []):
            for pt in ring:
                xs.append(pt[0])
                ys.append(pt[1])
    elif g_type == "MultiPolygon":
        for poly in geom.get("coordinates", []):
            for ring in poly:
                for pt in ring:
                    xs.append(pt[0])
                    ys.append(pt[1])
    elif g_type == "GeometryCollection":
        for sub in geom.get("geometries", []):
            _collect_polygonal_coords(sub, xs, ys)


def _compute_geom_bbox(geom):
    if not geom or not isinstance(geom, dict):
        return None
    xs, ys = [], []
    try:
        _collect_polygonal_coords(geom, xs, ys)
        if xs and ys:
            return (min(xs), min(ys), max(xs), max(ys), sum(xs) / len(xs), sum(ys) / len(ys))
    except Exception:
        pass
    return None

def _load_bundle_fallback():
    bundle_path = WEB_DIR / "geojson_bundle.js"
    if not bundle_path.exists():
        return {}
    try:
        txt = bundle_path.read_text(encoding="utf-8")
        match = re.search(r"window\.LAHAN_AMAN_GEOJSON\s*=\s*(\{.*?\});\s*(?:window\.LAHAN_AMAN_META|\n|$)", txt, re.DOTALL)
        if match:
            return json.loads(match.group(1))
    except Exception as e:
        print(f"[API] Error loading fallback bundle: {e}")
    return {}


_AREA_FACTOR_M2 = (111320.0 ** 2) * math.cos(math.radians(-7.8))


def _round(value, digits=1):
    return round(float(value), digits)


def _polygonal_geometry(geom):
    import shapely
    from shapely.geometry import MultiPolygon, Polygon

    if geom is None or geom.is_empty:
        return None
    geom = shapely.force_2d(geom)
    if not geom.is_valid:
        geom = shapely.make_valid(geom)
    if isinstance(geom, (Polygon, MultiPolygon)):
        return geom if geom.area > 0 else None
    if geom.geom_type == "GeometryCollection":
        parts = [
            part
            for part in geom.geoms
            if isinstance(part, (Polygon, MultiPolygon)) and not part.is_empty and part.area > 0
        ]
        if not parts:
            return None
        merged = _union_geometry(parts)
        return merged if merged is not None and not merged.is_empty and merged.area > 0 else None
    return None


def _union_geometry(geometries):
    import shapely
    from shapely.geometry import MultiPolygon, Polygon

    polys = []
    for geom in geometries:
        if geom is None or geom.is_empty:
            continue
        g = shapely.force_2d(geom)
        if not g.is_valid:
            g = shapely.make_valid(g)
        if isinstance(g, (Polygon, MultiPolygon)) and g.area > 0:
            polys.append(g)
        elif g.geom_type == "GeometryCollection":
            for part in g.geoms:
                if isinstance(part, (Polygon, MultiPolygon)) and not part.is_empty and part.area > 0:
                    polys.append(part)
    if not polys:
        return None
    if len(polys) == 1:
        return polys[0]
    try:
        merged = shapely.union_all(polys)
    except Exception:
        acc = polys[0]
        for p in polys[1:]:
            try:
                acc = acc.union(p)
            except Exception:
                acc = acc.buffer(0).union(p.buffer(0))
        merged = acc
    if merged is None or merged.is_empty:
        return None
    if isinstance(merged, (Polygon, MultiPolygon)):
        return merged if merged.area > 0 else None
    if merged.geom_type == "GeometryCollection":
        sub = [p for p in merged.geoms if isinstance(p, (Polygon, MultiPolygon)) and not p.is_empty and p.area > 0]
        if not sub:
            return None
        flat = []
        for s in sub:
            if isinstance(s, Polygon):
                flat.append(s)
            elif isinstance(s, MultiPolygon):
                flat.extend([p for p in s.geoms if not p.is_empty and p.area > 0])
        return MultiPolygon(flat) if len(flat) > 1 else (flat[0] if flat else None)
    return None


def _load_land_use_dataset():
    features = DATA_CACHE.get("land_use") or []
    fpath = DATA_DIR / LAND_USE_FILE
    available = bool(features)
    last_modified = None
    if fpath.exists():
        last_modified = datetime.fromtimestamp(fpath.stat().st_mtime, tz=timezone.utc).isoformat()
    source = dict(LAND_USE_SOURCE)
    source["lastModifiedAt"] = last_modified
    return {
        "available": available,
        "features": features,
        "source": source,
        "error": None if available else "Dataset guna lahan tidak tersedia atau gagal dimuat.",
    }


def _land_use_class(props):
    value = str((props or {}).get("pl") or (props or {}).get("klasifikasi") or "").strip()
    return value or "Tidak diketahui"


def _land_use_feature_payload(feature, index, inter, class_name):
    from shapely.geometry import mapping

    props = feature.get("properties") or {}
    area_m2 = inter.area * _AREA_FACTOR_M2
    group = LAND_USE_GROUPS.get(class_name, "lainnya")
    return {
        "landUseId": f"LU-{index + 1:04d}",
        "sourceFeatureIndex": index,
        "className": class_name,
        "group": group,
        "groupLabel": LAND_USE_GROUP_LABELS.get(group, "Kelas lain"),
        "areaM2": _round(area_m2),
        "percentOfPolygon": None,
        "sourceProperties": {
            "kabupaten": props.get("kabupaten"),
            "klasifikasi": props.get("klasifikasi"),
            "skor_lahan": props.get("skor_lahan"),
            "ket_lahan": props.get("ket_lahan"),
            "cr_kpa": props.get("cr_kpa"),
            "q_kpa": props.get("q_kpa"),
            "warna_hex": props.get("warna_hex"),
            "luas_ha": props.get("luas_ha"),
        },
        "geometry": mapping(inter),
    }


def build_land_use_report(user_poly, polygon_area_m2):
    from shapely.geometry import shape

    dataset = _load_land_use_dataset()
    base = {
        "status": "evaluated" if dataset["available"] else "not_evaluated",
        "available": dataset["available"],
        "dataset": dataset["source"],
        "polygonAreaM2": _round(polygon_area_m2),
        "coveredAreaM2": None,
        "uncoveredAreaM2": None,
        "coverageRatio": None,
        "overlapAreaM2": None,
        "classes": [],
        "features": [],
        "warnings": [],
        "note": None,
    }
    if not dataset["available"]:
        base["warnings"].append(dataset["error"])
        base["note"] = "Penggunaan lahan belum dapat dievaluasi; ini bukan bukti tidak adanya penggunaan lahan."
        return base

    intersections = []
    class_geometries = {}
    class_feature_counts = {}
    unsupported_geometry = 0
    invalid_geometry = 0

    for index, feature in enumerate(dataset["features"]):
        if "_minx" in feature:
            u_minx, u_miny, u_maxx, u_maxy = user_poly.bounds
            if (
                feature["_maxx"] < u_minx
                or feature["_minx"] > u_maxx
                or feature["_maxy"] < u_miny
                or feature["_miny"] > u_maxy
            ):
                continue
        geometry = feature.get("geometry")
        if not geometry:
            unsupported_geometry += 1
            continue
        try:
            source_poly = shape(geometry)
        except Exception:
            invalid_geometry += 1
            continue
        if source_poly.geom_type not in ("Polygon", "MultiPolygon"):
            unsupported_geometry += 1
            continue
        if not source_poly.is_valid:
            import shapely

            source_poly = shapely.make_valid(source_poly)
            invalid_geometry += 1
        source_poly = _polygonal_geometry(source_poly)
        if source_poly is None:
            continue
        if not user_poly.intersects(source_poly):
            continue
        inter = _polygonal_geometry(user_poly.intersection(source_poly))
        if inter is None or inter.area <= 0:
            continue
        class_name = _land_use_class(feature.get("properties"))
        intersections.append((feature, index, inter, class_name))
        class_geometries.setdefault(class_name, []).append(inter)
        class_feature_counts[class_name] = class_feature_counts.get(class_name, 0) + 1

    features_out = []
    classes_out = []
    covered_parts = []
    class_area_total = 0.0
    for feature, index, inter, class_name in intersections:
        payload = _land_use_feature_payload(feature, index, inter, class_name)
        payload["percentOfPolygon"] = (
            _round((payload["areaM2"] / polygon_area_m2) * 100.0, 2)
            if polygon_area_m2 > 0
            else None
        )
        features_out.append(payload)
        covered_parts.append(inter)

    for class_name, geometries in class_geometries.items():
        class_union = _union_geometry(geometries)
        if class_union is None:
            continue
        area_m2 = class_union.area * _AREA_FACTOR_M2
        class_area_total += area_m2
        group = LAND_USE_GROUPS.get(class_name, "lainnya")
        classes_out.append(
            {
                "className": class_name,
                "group": group,
                "groupLabel": LAND_USE_GROUP_LABELS.get(group, "Kelas lain"),
                "featureCount": class_feature_counts.get(class_name, 0),
                "areaM2": _round(area_m2),
                "percentOfPolygon": _round((area_m2 / polygon_area_m2) * 100.0, 2)
                if polygon_area_m2 > 0
                else None,
            }
        )

    classes_out.sort(key=lambda item: (-item["areaM2"], item["className"]))
    covered_union = _union_geometry(covered_parts)
    covered_area_m2 = covered_union.area * _AREA_FACTOR_M2 if covered_union is not None else 0.0
    uncovered_area_m2 = max(float(polygon_area_m2) - covered_area_m2, 0.0)
    overlap_area_m2 = max(class_area_total - covered_area_m2, 0.0)
    coverage_ratio = (
        min(max(covered_area_m2 / float(polygon_area_m2), 0.0), 1.0)
        if polygon_area_m2 > 0
        else None
    )

    base.update(
        {
            "coveredAreaM2": _round(covered_area_m2),
            "uncoveredAreaM2": _round(uncovered_area_m2),
            "coverageRatio": _round(coverage_ratio, 4) if coverage_ratio is not None else None,
            "overlapAreaM2": _round(overlap_area_m2),
            "classes": classes_out,
            "features": features_out,
        }
    )

    if not classes_out:
        base["warnings"].append(
            "Tidak ada poligon guna lahan yang beririsan dengan area analisis pada dataset yang tersedia."
        )
        base["note"] = (
            "Area ini belum tercakup kelas guna lahan pada dataset. Ketiadaan kelas bukan bukti bahwa area tidak memiliki penggunaan lahan."
        )
    else:
        base["note"] = (
            "Sebaran guna lahan dihitung dari irisan poligon sumber; persentase memakai luas area analisis sebagai penyebut."
        )
        if overlap_area_m2 > 0.5:
            base["warnings"].append(
                f"Terdapat tumpang tindih geometri sumber sekitar {_round(overlap_area_m2)} m2. Luas per kelas dapat melebihi luas cakupan gabungan."
            )
        if coverage_ratio is not None and coverage_ratio < 0.8:
            base["warnings"].append(
                f"Cakupan guna lahan hanya {_round(coverage_ratio * 100.0, 1)}% dari area analisis; area yang tidak tercakup tidak boleh dianggap tanpa penggunaan lahan."
            )
    if unsupported_geometry:
        base["warnings"].append(
            f"{unsupported_geometry} fitur sumber bukan poligon dan tidak diikutkan dalam irisan areal."
        )
    if invalid_geometry:
        base["warnings"].append(
            f"{invalid_geometry} geometri sumber tidak valid dan diperbaiki sebelum irisan."
        )
    return base


def build_sensitive_areas(land_use):
    dataset = land_use.get("dataset") if land_use else None
    available = bool(land_use and land_use.get("available"))
    polygon_area_m2 = float((land_use or {}).get("polygonAreaM2") or 0.0)
    base = {
        "available": available,
        "dataset": dataset,
        "items": [],
        "features": [],
        "summary": {
            "status": "not_evaluated",
            "detected": False,
            "itemCount": 0,
            "featureCount": 0,
            "categories": [],
            "totalClassAreaM2": 0.0,
            "uniqueAreaM2": 0.0,
            "percentOfPolygon": None,
            "legalDesignationVerified": False,
            "officialBoundaryAvailable": False,
            "note": "Objek/kawasan sensitif belum dapat dievaluasi.",
        },
    }
    if not available:
        base["summary"]["note"] = (
            "Dataset guna lahan tidak tersedia; objek dan kawasan sensitif belum dapat dievaluasi. Ini bukan bukti bahwa lokasi bebas objek atau kawasan sensitif."
        )
        return base

    grouped = {}
    for feature in land_use.get("features") or []:
        class_name = feature.get("className")
        rule = SENSITIVE_CLASS_RULES.get(class_name)
        if not rule:
            continue
        entry = grouped.setdefault(
            rule["id"],
            {
                "rule": rule,
                "className": class_name,
                "geometries": [],
                "features": [],
                "featureCount": 0,
            },
        )
        geometry = feature.get("geometry")
        if not geometry:
            continue
        try:
            from shapely.geometry import shape

            geom = _polygonal_geometry(shape(geometry))
        except Exception:
            geom = None
        if geom is None:
            continue
        entry["geometries"].append(geom)
        entry["featureCount"] += 1
        entry["features"].append(feature)

    items = []
    all_geometries = []
    for entry in grouped.values():
        merged = _union_geometry(entry["geometries"])
        if merged is None:
            continue
        area_m2 = merged.area * _AREA_FACTOR_M2
        all_geometries.append(merged)
        rule = entry["rule"]
        item = {
            "id": rule["id"],
            "label": rule["label"],
            "category": rule["category"],
            "categoryLabel": SENSITIVE_CATEGORY_LABELS.get(rule["category"], "Objek/kawasan"),
            "severity": rule["severity"],
            "status": "indication_detected",
            "detected": True,
            "binding": False,
            "authoritative": False,
            "legalDesignationVerified": False,
            "geometryAvailable": True,
            "sourceClass": entry["className"],
            "featureCount": entry["featureCount"],
            "areaM2": _round(area_m2),
            "percentOfPolygon": _round((area_m2 / polygon_area_m2) * 100.0, 2)
            if polygon_area_m2 > 0
            else None,
            "message": rule["message"],
            "dataset": LAND_USE_SOURCE["localFile"],
            "verification": "Batas/status resmi belum tersedia; verifikasi ke instansi berwenang.",
        }
        items.append(item)
        for feature in entry["features"]:
            base["features"].append(
                {
                    "sensitivityId": item["id"],
                    "label": item["label"],
                    "category": item["category"],
                    "severity": item["severity"],
                    "sourceClass": item["sourceClass"],
                    "landUseId": feature.get("landUseId"),
                    "areaM2": feature.get("areaM2"),
                    "percentOfPolygon": feature.get("percentOfPolygon"),
                    "geometry": feature.get("geometry"),
                }
            )

    severity_rank = {"high": 3, "medium": 2, "low": 1}
    items.sort(key=lambda item: (-severity_rank.get(item["severity"], 0), -item["areaM2"], item["label"]))
    unique_union = _union_geometry(all_geometries)
    unique_area_m2 = unique_union.area * _AREA_FACTOR_M2 if unique_union is not None else 0.0
    total_class_area_m2 = sum(item["areaM2"] for item in items)
    categories = sorted({item["categoryLabel"] for item in items})
    detected = bool(items)
    base["items"] = items
    base["summary"] = {
        "status": "indication_detected" if detected else "not_detected",
        "detected": detected,
        "itemCount": len(items),
        "featureCount": sum(item["featureCount"] for item in items),
        "categories": categories,
        "totalClassAreaM2": _round(total_class_area_m2),
        "uniqueAreaM2": _round(unique_area_m2),
        "percentOfPolygon": _round((unique_area_m2 / polygon_area_m2) * 100.0, 2)
        if polygon_area_m2 > 0
        else None,
        "legalDesignationVerified": False,
        "officialBoundaryAvailable": False,
        "note": (
            "Objek/kawasan sensitif teridentifikasi dari kelas guna lahan pada area yang tercakup. Status dan batas resmi belum diverifikasi."
            if detected
            else "Tidak ada kelas sensitif yang teridentifikasi pada data guna lahan yang tersedia. Ini bukan verifikasi bahwa lokasi bebas objek atau kawasan sensitif."
        ),
    }
    return base

def load_processed_data():
    if DATA_CACHE["loaded"]:
        return

    layer_map = {
        "admin": "clean_batas_administrasi.geojson",
        "kerawanan": "clean_kerawanan_longsor.geojson",
        "lereng": "clean_kemiringan_lereng_diy.geojson",
        "tanah": "GJS Layer2_JenisTanah_SlemanBantul.geojson",
        "batuan": "GJS Layer3_Geologi_SlemanBantul.geojson",
        "hujan": "clean_curah_hujan_idw.geojson",
        "land_use": LAND_USE_FILE,
    }

    bundle_cache = None

    for key, fname in layer_map.items():
        features = []
        fpath = DATA_DIR / fname
        if fpath.exists():
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    features = json.load(f).get("features", [])
            except Exception as e:
                print(f"[API] Error loading {fname} from disk: {e}")

        # Fallback to Web/geojson_bundle.js if empty on Vercel
        if not features:
            if bundle_cache is None:
                bundle_cache = _load_bundle_fallback()
            if fname in bundle_cache:
                features = bundle_cache[fname].get("features", [])

        # Index bboxes and centroids for fast lookup
        for feat in features:
            box = _compute_geom_bbox(feat.get("geometry"))
            if box:
                feat["_minx"], feat["_miny"], feat["_maxx"], feat["_maxy"], feat["_cx"], feat["_cy"] = box

        DATA_CACHE[key] = features

    DATA_CACHE["loaded"] = True

load_processed_data()

# =====================================================================
# 3. ENGINE GEOTEKNIK TERPADU BERBASIS DASAR.XLSX & SNI 8460:2017
# =====================================================================
GAMMA_W = 9.81
SNI_FS_SAFE_THRESHOLD = 1.50
SNI_FS_TARGET_LABEL = "Syarat Aman SNI 8460:2017: FS \u2265 1,50"

SOIL_MATRIX = {
    "grumusol":  {"skor": 5, "c": 9.0,  "phi": 15.0, "gamma_sat": 19.0, "z": 2.0, "is_expansive": True,  "label": "Grumusol (Vertisol)"},
    "grumosol":  {"skor": 5, "c": 9.0,  "phi": 15.0, "gamma_sat": 19.0, "z": 2.0, "is_expansive": True,  "label": "Grumusol (Vertisol)"},
    "latosol":   {"skor": 4, "c": 10.0, "phi": 18.0, "gamma_sat": 18.5, "z": 2.0, "is_expansive": False, "label": "Latosol (Inceptisol/Ultisol)"},
    "mediteran": {"skor": 4, "c": 11.0, "phi": 20.0, "gamma_sat": 18.5, "z": 2.0, "is_expansive": False, "label": "Mediteran (Alfisol)"},
    "regosol":   {"skor": 3, "c": 3.5,  "phi": 36.0, "gamma_sat": 17.5, "z": 1.5, "is_expansive": False, "label": "Regosol (Entisol Vulkanik)"},
    "kambisol":  {"skor": 2, "c": 8.0,  "phi": 30.0, "gamma_sat": 18.0, "z": 1.5, "is_expansive": False, "label": "Kambisol (Inceptisol)"},
    "aluvial":   {"skor": 1, "c": 14.0, "phi": 25.0, "gamma_sat": 18.5, "z": 2.0, "is_expansive": False, "label": "Aluvial (Endapan Dataran)"},
}

def get_soil_params(soil_str: str) -> dict:
    s = (soil_str or "").lower()
    for key, val in SOIL_MATRIX.items():
        if key in s:
            return val
    return SOIL_MATRIX["regosol"]

def sanitize_rasio_m(m_input, fallback: float = 0.60) -> float:
    """Pastikan rasio_m berada di rentang [0.0, 1.0] (jangan sampai terisi skor_hujan atau curah hujan mm)."""
    try:
        val = float(m_input)
        if not math.isfinite(val):
            return fallback
    except (TypeError, ValueError):
        return fallback
    if 0.0 <= val <= 1.0:
        return val
    s_map = {1: 0.45, 2: 0.45, 3: 0.60, 4: 0.75, 5: 0.90}
    if 1 <= round(val) <= 5 and abs(val - round(val)) < 1e-6:
        return s_map.get(int(round(val)), fallback)
    if val > 3000:
        return 0.90
    elif val >= 2501:
        return 0.75
    elif val >= 2001:
        return 0.60
    elif val >= 1500:
        return 0.45
    return fallback

def get_slope_params(beta_deg: float) -> dict:
    b = max(0.0, float(beta_deg))
    pct = round(math.tan(math.radians(b)) * 100.0, 1)
    if b <= 8.0:
        return {"skor": 1, "beta": round(b, 2), "persen": pct, "kelas": "0\u00b0 - 8\u00b0 (Datar - Landai)"}
    elif b <= 15.0:
        return {"skor": 2, "beta": round(b, 2), "persen": pct, "kelas": ">8\u00b0 - 15\u00b0 (Agak Curam / Transisi)"}
    elif b <= 25.0:
        return {"skor": 3, "beta": round(b, 2), "persen": pct, "kelas": ">15\u00b0 - 25\u00b0 (Curam / Kritis)"}
    elif b <= 35.0:
        return {"skor": 4, "beta": round(b, 2), "persen": pct, "kelas": ">25\u00b0 - 35\u00b0 (Sangat Curam)"}
    else:
        return {"skor": 5, "beta": round(b, 2), "persen": pct, "kelas": ">35\u00b0 (Terjal / Ekstrem)"}

def get_rock_params(rock_str: str) -> dict:
    r = (rock_str or "").lower()
    if any(k in r for k in ["semilir", "tmse", "tms3", "sambipitu", "tmss", "nanggulan", "teon", "avalanche", "endapan longsoran", "(na)"]):
        return {"skor": 5}
    if any(k in r for k in ["nglanggran", "tmng", "kebobutak", "tomk", "jonggrangan"]):
        return {"skor": 4}
    if any(k in r for k in ["sentolo", "tmps", "merapi tua", "qmo", "dagotirto", "tmd"]):
        return {"skor": 3}
    if any(k in r for k in ["merapi muda", "qmi", "qvu", "vulkanik"]):
        return {"skor": 2}
    if any(k in r for k in ["wonosari", "tmwl", "aluvial", "qa", "wates"]):
        return {"skor": 1}
    return {"skor": 2}

def get_rain_params(rain_mm: float) -> dict:
    ch = float(rain_mm or 2250.0)
    if ch > 3000:
        return {"skor": 5, "m": 0.90}
    elif ch > 2500:
        return {"skor": 4, "m": 0.75}
    elif ch > 2000:
        return {"skor": 3, "m": 0.60}
    elif ch >= 1500:
        return {"skor": 2, "m": 0.45}
    else:
        return {"skor": 1, "m": 0.45}

def get_land_params(land_str: str, beta_deg: float = 0.0) -> dict:
    l = (land_str or "").lower()
    if any(k in l for k in ["terbuka", "tambang", "tegalan", "ladang"]) or ("sawah" in l and beta_deg > 8.0):
        return {"skor": 5, "cr": 0.0, "q": 0.0}
    if any(k in l for k in ["semak", "belukar", "alang", "rumput"]):
        return {"skor": 4, "cr": 0.5, "q": 0.0}
    if any(k in l for k in ["permukiman", "pemukiman", "bangunan", "jalan", "industri", "sawah"]):
        return {"skor": 3, "cr": 0.0, "q": 15.0 if any(k in l for k in ["permukiman", "pemukiman", "bangunan", "jalan"]) else 0.0}
    if any(k in l for k in ["perkebunan", "kebun"]):
        return {"skor": 2, "cr": 3.5, "q": 0.0}
    if any(k in l for k in ["hutan", "air", "danau", "sungai"]):
        return {"skor": 1, "cr": 10.0, "q": 0.0}
    return {"skor": 3, "cr": 0.0, "q": 15.0}

def _calc_raw_infinite_slope_fs(beta_deg: float, c_kpa: float, phi_deg: float, gamma_sat: float, z: float, m: float) -> dict:
    """
    2. Hitung FS_awal (Infinite Slope with Seepage):
       - Wajib konversi beta_deg dan phi_deg ke radian sebelum masuk fungsi sin, cos, tan.
       - Pastikan rasio_m berada di rentang [0.0, 1.0].
       - Penanganan lereng datar (beta <= 0.5°): Cegah ZeroDivisionError. Jika beta <= 0.5°, langsung tetapkan FS_awal = 9.99.
       - sigma_v = gamma_sat * z (kPa)
       - u = m * 9.81 * z (kPa)
       - sigma_n_prime = (sigma_v - u) * cos^2(beta_rad) (kPa)
       - tau_f = c' + sigma_n_prime * tan(phi_rad) (kPa)
       - tau_d = sigma_v * sin(beta_rad) * cos(beta_rad) (kPa)
       - FS_awal = tau_f / tau_d
    """
    b = max(0.0, float(beta_deg))
    m_clean = sanitize_rasio_m(m, 0.60)
    sigma_v = float(gamma_sat) * float(z)
    u_raw = m_clean * GAMMA_W * float(z)
    u_kpa = round(u_raw, 2)

    if b <= 0.5:
        phi_rad = math.radians(float(phi_deg))
        return {
            "fs_raw": 9.99,
            "fs": 9.99,
            "u_kpa": u_kpa,
            "sigma_v": round(sigma_v, 2),
            "sigma_n_prime": round(sigma_v - u_raw, 4),
            "tau_f": round(float(c_kpa) + (sigma_v - u_raw) * math.tan(phi_rad), 4),
            "tau_d": 0.0,
        }

    beta_rad = math.radians(b)
    phi_rad = math.radians(float(phi_deg))
    cos_b = math.cos(beta_rad)
    sin_b = math.sin(beta_rad)
    tan_phi = math.tan(phi_rad)

    tau_d = sigma_v * sin_b * cos_b
    if tau_d <= 1e-6:
        return {
            "fs_raw": 9.99,
            "fs": 9.99,
            "u_kpa": u_kpa,
            "sigma_v": round(sigma_v, 2),
            "sigma_n_prime": round((sigma_v - u_raw) * (cos_b ** 2), 4),
            "tau_f": round(float(c_kpa) + (sigma_v - u_raw) * (cos_b ** 2) * tan_phi, 4),
            "tau_d": 0.0,
        }

    sigma_n_prime = (sigma_v - u_raw) * (cos_b ** 2)
    tau_f = float(c_kpa) + sigma_n_prime * tan_phi
    fs_raw = min(9.99, max(0.05, tau_f / tau_d))
    return {
        "fs_raw": round(fs_raw, 4),
        "fs": round(fs_raw, 2),
        "u_kpa": u_kpa,
        "sigma_v": round(sigma_v, 2),
        "sigma_n_prime": round(sigma_n_prime, 4),
        "tau_f": round(tau_f, 4),
        "tau_d": round(tau_d, 4),
    }

def evaluate_spk_corridor(
    beta_deg: float,
    fs_awal_raw: float,
    c_kpa: float,
    phi_deg: float,
    gamma_sat: float,
    z: float,
    soil_str: str = "",
    rock_str: str = "",
    is_expansive: bool = False,
) -> dict:
    """
    3. Penentuan FS_pasca sesuai Koridor SPK (Target SNI 8460:2017 >= 1.50):
       - KOR-01 / KOR-02 (beta <= 8°): beta_pasca = beta_awal, drainase keliling menurunkan kejenuhan ke m_pasca = 0.45.
         Khusus Grumusol tetap diarahkan ke KOR-02 untuk perbaikan tanah ekspansif.
       - KOR-03 (8° < beta <= 15°): Pelandaian ringan ke beta_pasca = min(beta_awal, 10°) + drainase (m_pasca = 0.45).
       - KOR-04 (15° < beta <= 25° atau 1.25 <= FS_awal < 1.50): Cut & fill terasering ke beta_pasca = 14°
         (atau diturunkan bertahap hingga FS_pasca >= 1.50) + sub-drain (m_pasca = 0.45).
       - KOR-05 (25° < beta <= 35° atau FS_awal < 1.25): Terasering + Dinding Penahan Tanah (DPT) dengan lereng antar-teras
         memenuhi FS_pasca >= 1.50 dan desain DPT memenuhi FK_geser >= 1.50 serta FK_guling >= 2.00 (SNI 8460:2017).
       - KOR-06 (beta > 35° atau endapan longsoran na): Tidak direkomendasikan untuk bangunan (status Zona Konservasi).
    """
    b_awal = max(0.0, float(beta_deg))
    s_low = (soil_str or "").lower()
    r_low = (rock_str or "").lower()
    exp = bool(is_expansive) or any(k in s_low for k in ["grumusol", "grumosol", "vertisol"])
    is_na = bool(re.search(r"\bna\b", r_low)) or "(na)" in r_low or "endapan longsoran" in r_low or "avalanche" in r_low

    if b_awal > 35.0 or is_na:
        return {
            "koridor": "KOR-06",
            "beta_pasca": None,
            "m_pasca": None,
            "fs_pasca_raw": None,
            "fs_pasca": None,
            "rekomendasi_koridor": "KOR-06 (\u03b2 > 35\u00b0 atau endapan longsoran na): Tidak direkomendasikan untuk bangunan (status Zona Konservasi).",
        }
    if b_awal > 25.0 or fs_awal_raw < 1.25:
        b_pasca = min(b_awal, 14.0)
        m_pasca = 0.45
        res_p = _calc_raw_infinite_slope_fs(b_pasca, c_kpa, phi_deg, gamma_sat, z, m_pasca)
        while res_p["fs_raw"] < 1.50 and b_pasca > 0.5:
            b_pasca = round(max(0.5, b_pasca - 0.5), 2)
            res_p = _calc_raw_infinite_slope_fs(b_pasca, c_kpa, phi_deg, gamma_sat, z, m_pasca)
        return {
            "koridor": "KOR-05",
            "beta_pasca": b_pasca,
            "m_pasca": m_pasca,
            "fs_pasca_raw": res_p["fs_raw"],
            "fs_pasca": res_p["fs"],
            "rekomendasi_koridor": "KOR-05 (25\u00b0 < \u03b2 \u2264 35\u00b0 atau FS_awal < 1,25): Terasering + Dinding Penahan Tanah (DPT) dengan lereng antar-teras memenuhi FS_pasca \u2265 1,50 dan desain DPT memenuhi FK_geser \u2265 1,50 serta FK_guling \u2265 2,00 (SNI 8460:2017).",
        }
    if b_awal > 15.0 or fs_awal_raw < 1.50:
        b_pasca = min(b_awal, 14.0)
        m_pasca = 0.45
        res_p = _calc_raw_infinite_slope_fs(b_pasca, c_kpa, phi_deg, gamma_sat, z, m_pasca)
        while res_p["fs_raw"] < 1.50 and b_pasca > 0.5:
            b_pasca = round(max(0.5, b_pasca - 0.5), 2)
            res_p = _calc_raw_infinite_slope_fs(b_pasca, c_kpa, phi_deg, gamma_sat, z, m_pasca)
        return {
            "koridor": "KOR-04",
            "beta_pasca": b_pasca,
            "m_pasca": m_pasca,
            "fs_pasca_raw": res_p["fs_raw"],
            "fs_pasca": res_p["fs"],
            "rekomendasi_koridor": "KOR-04 (15\u00b0 < \u03b2 \u2264 25\u00b0 atau 1,25 \u2264 FS_awal < 1,50): Cut & fill terasering ke \u03b2_pasca = 14\u00b0 (atau diturunkan bertahap hingga FS_pasca \u2265 1,50) + sub-drain (m_pasca = 0,45).",
        }
    if b_awal > 8.0:
        b_pasca = min(b_awal, 10.0)
        m_pasca = 0.45
        res_p = _calc_raw_infinite_slope_fs(b_pasca, c_kpa, phi_deg, gamma_sat, z, m_pasca)
        return {
            "koridor": "KOR-03",
            "beta_pasca": b_pasca,
            "m_pasca": m_pasca,
            "fs_pasca_raw": res_p["fs_raw"],
            "fs_pasca": res_p["fs"],
            "rekomendasi_koridor": "KOR-03 (8\u00b0 < \u03b2 \u2264 15\u00b0): Pelandaian ringan ke \u03b2_pasca = min(\u03b2_awal, 10\u00b0) + drainase (m_pasca = 0,45).",
        }

    kor_code = "KOR-02" if exp else "KOR-01"
    b_pasca = b_awal
    m_pasca = 0.45
    res_p = _calc_raw_infinite_slope_fs(b_pasca, c_kpa, phi_deg, gamma_sat, z, m_pasca)
    return {
        "koridor": kor_code,
        "beta_pasca": b_pasca,
        "m_pasca": m_pasca,
        "fs_pasca_raw": res_p["fs_raw"],
        "fs_pasca": res_p["fs"],
        "rekomendasi_koridor": (
            "KOR-02 (\u03b2 \u2264 8\u00b0, Grumusol Ekspansif): \u03b2_pasca = \u03b2_awal, drainase keliling menurunkan kejenuhan ke m_pasca = 0,45 + perbaikan tanah ekspansif."
            if exp
            else "KOR-01 (\u03b2 \u2264 8\u00b0): \u03b2_pasca = \u03b2_awal, drainase keliling menurunkan kejenuhan ke m_pasca = 0,45."
        ),
    }

def calc_infinite_slope_fs(
    beta_deg: float,
    c_kpa: float,
    cr_kpa: float,
    phi_deg: float,
    gamma_sat: float,
    z: float,
    m: float,
    q: float,
    soil_str: str = "",
    rock_str: str = "",
    is_expansive: bool = False,
) -> dict:
    raw = _calc_raw_infinite_slope_fs(beta_deg, c_kpa, phi_deg, gamma_sat, z, m)
    kor = evaluate_spk_corridor(
        beta_deg,
        raw["fs_raw"],
        c_kpa,
        phi_deg,
        gamma_sat,
        z,
        soil_str=soil_str,
        rock_str=rock_str,
        is_expansive=is_expansive,
    )
    fs_val = raw["fs"]
    fs_raw = raw["fs_raw"]
    kor_code = kor["koridor"]

    if kor_code == "KOR-06":
        status_label = f"Zona Konservasi \u2014 {kor_code}"
        hex_color = "#ef4444"
    elif fs_raw >= 1.50:
        status_label = f"Aman \u2014 {kor_code}"
        hex_color = "#10b981"
    elif fs_raw >= 1.25:
        status_label = f"Tidak Aman \u2014 {kor_code}"
        hex_color = "#f59e0b"
    else:
        status_label = f"Kritis \u2014 {kor_code}"
        hex_color = "#ef4444"

    desc = f"{SNI_FS_TARGET_LABEL}. {kor['rekomendasi_koridor']}"
    return {
        "fs": fs_val,
        "fs_raw": fs_raw,
        "fs_awal": fs_val,
        "fs_awal_raw": fs_raw,
        "fs_pasca": kor["fs_pasca"],
        "fs_pasca_raw": kor["fs_pasca_raw"],
        "koridor": kor_code,
        "beta_pasca": kor["beta_pasca"],
        "m_pasca": kor["m_pasca"],
        "rekomendasi_koridor": kor["rekomendasi_koridor"],
        "sni_label": SNI_FS_TARGET_LABEL,
        "u_kpa": raw["u_kpa"],
        "sigma_v": raw["sigma_v"],
        "sigma_n_prime": raw["sigma_n_prime"],
        "tau_f": raw["tau_f"],
        "tau_d": raw["tau_d"],
        "label": status_label,
        "hex": hex_color,
        "desc": desc,
    }

def calc_gpkg_score(s_lereng: int, s_tanah: int, s_batuan: int, s_hujan: int, s_lahan: int) -> dict:
    skor_akhir = round(
        0.30 * s_lereng + 0.25 * s_tanah + 0.20 * s_batuan + 0.15 * s_hujan + 0.10 * s_lahan,
        2
    )
    if skor_akhir < 2.20:
        return {
            "skor_akhir": skor_akhir,
            "zona": "Zona Hijau",
            "zona_kode": "ZONA HIJAU",
            "warna_hex": "#10b981",
            "border_hex": "#059669",
            "rekomendasi": "Datar / Risiko Rendah / Konstruksi Standar",
        }
    elif skor_akhir <= 3.40:
        return {
            "skor_akhir": skor_akhir,
            "zona": "Zona Kuning",
            "zona_kode": "ZONA KUNING",
            "warna_hex": "#f59e0b",
            "border_hex": "#d97706",
            "rekomendasi": "Risiko Sedang / Perlu Mitigasi Drainase, Pondasi Khusus / Talud",
        }
    else:
        return {
            "skor_akhir": skor_akhir,
            "zona": "Zona Merah",
            "zona_kode": "ZONA MERAH",
            "warna_hex": "#ef4444",
            "border_hex": "#dc2626",
            "rekomendasi": "Risiko Tinggi / Rawan Longsor / Non-Buildable",
        }

def read_spk_score(props: dict, field: str):
    value = props.get(field)
    if (value is None or value == "") and field == "skor_tanah":
        value = props.get("skor tanah")
    if value is None or value == "":
        return None
    try:
        score = int(value)
    except (TypeError, ValueError):
        return None
    return score if 1 <= score <= 5 else None

# =====================================================================
# 4. UTILITAS GEOMETRI POINT-IN-POLYGON DENGAN BBOX PRE-FILTER & NEAREST
# =====================================================================
def point_in_ring(x: float, y: float, ring: list) -> bool:
    inside = False
    n = len(ring)
    for i in range(n):
        j = (i - 1) % n
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        intersect = ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / ((yj - yi) + 1e-12) + xi)
        if intersect:
            inside = not inside
    return inside

def point_in_geometry(x: float, y: float, geom: dict) -> bool:
    if not geom or not isinstance(geom, dict):
        return False
    g_type = geom.get("type")
    if g_type == "GeometryCollection":
        for sub in geom.get("geometries", []):
            if point_in_geometry(x, y, sub):
                return True
        return False
    if "coordinates" not in geom:
        return False
    coords = geom.get("coordinates", [])
    if g_type == "Polygon":
        if not coords or not point_in_ring(x, y, coords[0]):
            return False
        for hole in coords[1:]:
            if point_in_ring(x, y, hole):
                return False
        return True
    elif g_type == "MultiPolygon":
        for poly in coords:
            if poly and point_in_ring(x, y, poly[0]):
                in_hole = False
                for hole in poly[1:]:
                    if point_in_ring(x, y, hole):
                        in_hole = True
                        break
                if not in_hole:
                    return True
    return False

def find_feature_at_point(features: list, lng: float, lat: float, allow_nearest: bool = True):
    """
    Pencarian spasial point-in-polygon dengan akselerasi Bounding Box.
    Jika titik sedikit di luar poligon (toleransi tepi administrasi), gunakan fitur terdekat.
    """
    if not features:
        return None

    # 1. Exact Hit dengan pre-filter BBox
    for feat in features:
        if "_minx" in feat:
            if not (feat["_minx"] <= lng <= feat["_maxx"] and feat["_miny"] <= lat <= feat["_maxy"]):
                continue
        if point_in_geometry(lng, lat, feat.get("geometry")):
            return feat.get("properties", {})

    if not allow_nearest:
        return None

    # 2. Nearest Neighbor Fallback (Maksimal jarak ~0.08 derajat / ~8.8 km di DIY)
    closest_feat = None
    min_dist_sq = 0.08 ** 2
    for feat in features:
        cx = feat.get("_cx")
        cy = feat.get("_cy")
        if cx is not None and cy is not None:
            dist_sq = (lng - cx) ** 2 + (lat - cy) ** 2
            if dist_sq < min_dist_sq:
                min_dist_sq = dist_sq
                closest_feat = feat

    if closest_feat:
        return closest_feat.get("properties", {})

    # 3. Default ke elemen pertama jika ada
    return features[0].get("properties", {}) if features else None

# =====================================================================
# 5. ENDPOINT API REST
# =====================================================================
@app.route('/api/query', methods=['GET'])
def endpoint_query():
    try:
        lat = float(request.args.get("lat", "-7.797068"))
        lng = float(request.args.get("lng", "110.370529"))

        # Cari fitur di layer kerawanan longsor master dan batas administrasi
        kr_hit = find_feature_at_point(DATA_CACHE["kerawanan"], lng, lat, allow_nearest=True) or {}
        adm_hit = find_feature_at_point(DATA_CACHE["admin"], lng, lat, allow_nearest=True) or {}
        lr_hit = find_feature_at_point(DATA_CACHE["lereng"], lng, lat, allow_nearest=False) or {}
        tn_hit = find_feature_at_point(DATA_CACHE["tanah"], lng, lat, allow_nearest=False) or {}
        bt_hit = find_feature_at_point(DATA_CACHE["batuan"], lng, lat, allow_nearest=False) or {}
        hj_hit = find_feature_at_point(DATA_CACHE["hujan"], lng, lat, allow_nearest=False) or {}
        lu_hit = find_feature_at_point(DATA_CACHE["land_use"], lng, lat, allow_nearest=False) or {}
        lu_name = str(lu_hit.get("pl") or lu_hit.get("tutupan_lahan") or lu_hit.get("klasifikasi") or "").strip()

        # Label wilayah selalu mengikuti layer administrasi resmi agar tidak
        # tercemar atribusi yang salah pada layer tematik/pipeline.
        kalurahan = (
            adm_hit.get("kalurahan")
            or adm_hit.get("KALURAHAN")
            or kr_hit.get("kalurahan")
            or kr_hit.get("KALURAHAN")
            or "Mulyodadi"
        )
        if kalurahan == "-":
            kalurahan = kr_hit.get("kalurahan") or "Mulyodadi"

        kapanewon = (
            adm_hit.get("kapanewon")
            or adm_hit.get("KECAMATAN")
            or kr_hit.get("kapanewon")
            or kr_hit.get("KECAMATAN")
            or "Bambanglipuro"
        )
        if kapanewon == "-":
            kapanewon = kr_hit.get("kapanewon") or "Bambanglipuro"

        kabupaten = (
            adm_hit.get("kabupaten")
            or adm_hit.get("KABUPATEN")
            or kr_hit.get("kabupaten")
            or kr_hit.get("KABUPATEN")
            or "Kab. Bantul"
        )

        label_wilayah = f"Kal. {kalurahan}, Kapanewon {kapanewon}, {kabupaten}"
        elevasi = float(adm_hit.get("elevasi_mdpl") or kr_hit.get("elevasi_mdpl") or 115.0)

        # PRIORITAS 1: Bila poligon master kerawanan longsor sudah memiliki kalkulasi resmi pipeline
        if kr_hit.get("skor_akhir") is not None:
            skor_akhir = round(float(kr_hit["skor_akhir"]), 2)
            beta_deg = round(float(kr_hit.get("lereng_derajat", 3.0)), 2)
            beta_pct = round(float(kr_hit.get("lereng_persen", math.tan(math.radians(beta_deg)) * 100.0)), 1)
            slope_info = get_slope_params(beta_deg)

            jenis_tanah = str(kr_hit.get("ket_tanah") or "Regosol")
            soil_info = get_soil_params(jenis_tanah)
            c_kpa = float(kr_hit.get("c_kpa") or soil_info["c"])
            phi_deg = float(kr_hit.get("phi_deg") or soil_info["phi"])
            gamma_sat = float(soil_info["gamma_sat"])
            z_depth = float(soil_info["z"])

            formasi_batuan = str(kr_hit.get("ket_batuan") or "Endapan Gunungapi Merapi Muda (Qmi)")
            curah_hujan_mm = float(kr_hit.get("curah_hujan_mm", 2250.0))
            rasio_m = sanitize_rasio_m(kr_hit.get("rasio_m"), 0.60)

            tutupan_lahan = str(kr_hit.get("ket_lahan") or kr_hit.get("pl") or "Permukiman")
            cr_kpa = float(kr_hit.get("cr_kpa", 0.0))
            q_kpa = float(kr_hit.get("q_kpa", 0.0))

            skor_l = int(kr_hit.get("skor_lereng", slope_info["skor"]))
            skor_t = int(kr_hit.get("skor_tanah") or kr_hit.get("skor tanah") or soil_info["skor"])
            skor_b = int(kr_hit.get("skor_batuan", 2))
            skor_h = int(kr_hit.get("skor_hujan", 3))
            skor_lh = int(kr_hit.get("skor_lahan", 3))

            fs_res = calc_infinite_slope_fs(
                beta_deg, c_kpa, cr_kpa, phi_deg, gamma_sat, z_depth, rasio_m, q_kpa,
                soil_str=jenis_tanah, rock_str=formasi_batuan, is_expansive=soil_info["is_expansive"]
            )
            fs_val = fs_res["fs"]
            fs_status = fs_res["label"]
            fs_hex = fs_res["hex"]
            fs_desc = fs_res["desc"]
            u_kpa = fs_res["u_kpa"]

            z_triase_str = str(kr_hit.get("zona_triase") or "").upper()
            if "MERAH" in z_triase_str:
                zona_kode = "ZONA MERAH"
                zona_nama = "Zona Merah"
                warna_hex = "#D32F2F"
                rekomendasi = str(kr_hit.get("zona_triase") or "Risiko Tinggi / Rawan Longsor / Non-Buildable")
            elif "KUNING" in z_triase_str:
                zona_kode = "ZONA KUNING"
                zona_nama = "Zona Kuning"
                warna_hex = "#FB8C00"
                rekomendasi = str(kr_hit.get("zona_triase") or "Risiko Sedang / Perlu Mitigasi Drainase, Pondasi Khusus / Talud")
            elif "HIJAU" in z_triase_str:
                zona_kode = "ZONA HIJAU"
                zona_nama = "Zona Hijau"
                warna_hex = "#2E7D32"
                rekomendasi = str(kr_hit.get("zona_triase") or "Datar / Risiko Rendah / Konstruksi Standar")
            elif skor_akhir < 2.20:
                zona_kode = "ZONA HIJAU"
                zona_nama = "Zona Hijau"
                warna_hex = "#10b981"
                rekomendasi = "Datar / Risiko Rendah / Konstruksi Standar"
            elif skor_akhir <= 3.40:
                zona_kode = "ZONA KUNING"
                zona_nama = "Zona Kuning"
                warna_hex = "#f59e0b"
                rekomendasi = "Risiko Sedang / Perlu Mitigasi Drainase, Pondasi Khusus / Talud"
            else:
                zona_kode = "ZONA MERAH"
                zona_nama = "Zona Merah"
                warna_hex = "#ef4444"
                rekomendasi = "Risiko Tinggi / Rawan Longsor / Non-Buildable"

        # PRIORITAS 2: Gunakan atribut layer administrasi resmi bila ada
        elif adm_hit.get("skor_total") is not None:
            skor_akhir = round(float(adm_hit["skor_total"]), 2)
            beta_deg = round(float(adm_hit.get("lereng_derajat", 3.0)), 2)
            beta_pct = round(float(adm_hit.get("lereng_persen", math.tan(math.radians(beta_deg)) * 100.0)), 1)
            slope_info = get_slope_params(beta_deg)

            jenis_tanah = str(adm_hit.get("jenis_tanah") or "Regosol")
            soil_info = get_soil_params(jenis_tanah)
            c_kpa = float(adm_hit.get("c_kpa") or soil_info["c"])
            phi_deg = float(adm_hit.get("phi_deg") or soil_info["phi"])
            gamma_sat = float(soil_info["gamma_sat"])
            z_depth = float(soil_info["z"])

            formasi_batuan = str(adm_hit.get("formasi_batuan") or "Endapan Gunungapi Merapi Muda (Qmi)")
            curah_hujan_mm = float(adm_hit.get("curah_hujan_mm", 2250.0))
            rasio_m = sanitize_rasio_m(adm_hit.get("rasio_m"), 0.60)

            tutupan_lahan = str(adm_hit.get("tutupan_dominan") or "Permukiman")
            cr_kpa = float(adm_hit.get("cr_kpa", 0.0))
            q_kpa = float(adm_hit.get("q_kpa", 0.0))

            skor_l = int(adm_hit.get("skor_lereng", slope_info["skor"]))
            skor_t = int(adm_hit.get("skor_tanah", soil_info["skor"]))
            skor_b = int(adm_hit.get("skor_batuan", 2))
            skor_h = int(adm_hit.get("skor_hujan", 3))
            skor_lh = int(adm_hit.get("skor_tutupan", 3))

            fs_res = calc_infinite_slope_fs(
                beta_deg, c_kpa, cr_kpa, phi_deg, gamma_sat, z_depth, rasio_m, q_kpa,
                soil_str=jenis_tanah, rock_str=formasi_batuan, is_expansive=soil_info["is_expansive"]
            )
            fs_val = fs_res["fs"]
            fs_status = fs_res["label"]
            fs_hex = fs_res["hex"]
            fs_desc = fs_res["desc"]
            u_kpa = fs_res["u_kpa"]

            if skor_akhir < 2.20:
                zona_kode = "ZONA HIJAU"
                zona_nama = "Zona Hijau"
                warna_hex = "#10b981"
                rekomendasi = "Datar / Risiko Rendah / Konstruksi Standar"
            elif skor_akhir <= 3.40:
                zona_kode = "ZONA KUNING"
                zona_nama = "Zona Kuning"
                warna_hex = "#f59e0b"
                rekomendasi = "Risiko Sedang / Perlu Mitigasi Drainase, Pondasi Khusus / Talud"
            else:
                zona_kode = "ZONA MERAH"
                zona_nama = "Zona Merah"
                warna_hex = "#ef4444"
                rekomendasi = "Risiko Tinggi / Rawan Longsor / Non-Buildable"

        # PRIORITAS 3: Kalkulasi dinamis dari layer tematik murni
        else:
            beta_deg = float(lr_hit.get("lereng_derajat") or 2.5)
            slope_info = get_slope_params(beta_deg)

            jenis_tanah = str(tn_hit.get("jenis_tanah") or "Regosol")
            soil_info = get_soil_params(jenis_tanah)

            formasi_batuan = str(bt_hit.get("formasi_batuan") or "Endapan Gunungapi Merapi Muda (Qmi)")
            rock_info = get_rock_params(formasi_batuan)

            curah_hujan_mm = float(hj_hit.get("curah_hujan_mm") or 2250.0)
            rain_info = get_rain_params(curah_hujan_mm)

            tutupan_lahan = lu_name or "Permukiman"
            land_info = get_land_params(tutupan_lahan, beta_deg)

            skor_l = slope_info["skor"]
            skor_t = soil_info["skor"]
            skor_b = rock_info["skor"]
            skor_h = rain_info["skor"]
            skor_lh = land_info["skor"]

            c_kpa = soil_info["c"]
            cr_kpa = land_info["cr"]
            phi_deg = soil_info["phi"]
            gamma_sat = soil_info["gamma_sat"]
            z_depth = soil_info["z"]
            rasio_m = rain_info["m"]
            q_kpa = land_info["q"]

            gpkg = calc_gpkg_score(skor_l, skor_t, skor_b, skor_h, skor_lh)
            fs_res = calc_infinite_slope_fs(
                beta_deg, c_kpa, cr_kpa, phi_deg, gamma_sat, z_depth, rasio_m, q_kpa,
                soil_str=jenis_tanah, rock_str=formasi_batuan, is_expansive=soil_info["is_expansive"]
            )

            skor_akhir = gpkg["skor_akhir"]
            zona_kode = gpkg["zona_kode"]
            zona_nama = gpkg["zona"]
            warna_hex = gpkg["warna_hex"]
            rekomendasi = gpkg["rekomendasi"]
            fs_val = fs_res["fs"]
            fs_status = fs_res["label"]
            fs_hex = fs_res["hex"]
            fs_desc = fs_res["desc"]
            u_kpa = fs_res["u_kpa"]

        return jsonify({
            "status": "ok",
            "wilayah": {
                "label_wilayah": label_wilayah,
                "kalurahan": kalurahan,
                "kapanewon": kapanewon,
                "kabupaten": kabupaten,
                "elevasi_mdpl": elevasi,
            },
            "kondisi_lapangan": {
                "lereng_derajat": slope_info["beta"],
                "lereng_persen": slope_info["persen"],
                "kelas_lereng": slope_info["kelas"],
                "jenis_tanah": jenis_tanah,
                "c_kpa": c_kpa,
                "cr_kpa": cr_kpa,
                "phi_deg": phi_deg,
                "gamma_sat": gamma_sat,
                "z_depth": z_depth,
                "formasi_batuan": formasi_batuan,
                "curah_hujan_mm": curah_hujan_mm,
                "skor_hujan": skor_h,
                "rasio_m": rasio_m,
                "u_kpa": u_kpa,
                "q_kpa": q_kpa,
                "tutupan_lahan": tutupan_lahan,
            },
            "skor_internal": {
                "skor_lereng": skor_l,
                "skor_tanah": skor_t,
                "skor_batuan": skor_b,
                "skor_hujan": skor_h,
                "skor_tutupan": skor_lh,
                "skor_lahan": skor_lh,
                "skor_akhir": skor_akhir,
            },
            "triase": {
                "zona": zona_nama,
                "zona_kode": zona_kode,
                "zona_triase": f"{zona_kode} (Skor {skor_akhir:.2f})",
                "badge": f"SKOR {skor_akhir:.2f} — {zona_kode}",
                "rekomendasi": rekomendasi,
                "warna_hex": warna_hex,
                "fs": fs_val,
                "fs_raw": fs_res["fs_raw"],
                "fs_awal": fs_res["fs_awal"],
                "fs_pasca": fs_res["fs_pasca"],
                "koridor": fs_res["koridor"],
                "beta_pasca": fs_res["beta_pasca"],
                "m_pasca": fs_res["m_pasca"],
                "rekomendasi_koridor": fs_res["rekomendasi_koridor"],
                "sni_label": SNI_FS_TARGET_LABEL,
                "fs_label": fs_status,
                "fs_warna_hex": fs_hex,
                "fs_desc": fs_desc,
            }
        }), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

@app.route('/api/analisis-segmen-kavling', methods=['POST'])
def endpoint_analisis():
    try:
        from shapely.geometry import shape as shp_shape, mapping
        import shapely

        payload = request.get_json(silent=True)
        if not payload or "geometry" not in payload:
            return jsonify({"status": "error", "message": "Geometri poligon kosong."}), 400

        geometry = payload["geometry"]
        if not isinstance(geometry, dict) or geometry.get("type") not in ("Polygon", "MultiPolygon"):
            return jsonify({
                "status": "error",
                "message": "Jenis geometri harus Polygon atau MultiPolygon.",
            }), 400

        user_poly = shp_shape(geometry)
        user_poly = shapely.force_2d(user_poly)
        if not user_poly.is_valid:
            user_poly = shapely.make_valid(user_poly)
        user_poly = _polygonal_geometry(user_poly)
        if user_poly is None or user_poly.is_empty or user_poly.area <= 0:
            return jsonify({"status": "error", "message": "Luas geometri poligon harus lebih dari nol."}), 400

        features_out = []
        seg_idx = 1
        total_area_deg = max(user_poly.area, 1e-12)
        area_factor = (111320.0 ** 2) * math.cos(math.radians(-7.8))
        polygon_area_m2 = round(total_area_deg * area_factor, 1)
        proporsi_zona = {
            "Hijau": {"luas_m2": 0.0, "persen": 0.0},
            "Kuning": {"luas_m2": 0.0, "persen": 0.0},
            "Merah": {"luas_m2": 0.0, "persen": 0.0},
        }

        weighted_beta_sum = 0.0

        for feat in DATA_CACHE["kerawanan"]:
            if "_minx" in feat:
                # Cepat cek bbox intersection
                u_minx, u_miny, u_maxx, u_maxy = user_poly.bounds
                if feat["_maxx"] < u_minx or feat["_minx"] > u_maxx or feat["_maxy"] < u_miny or feat["_miny"] > u_maxy:
                    continue

            try:
                kr_poly = shp_shape(feat["geometry"])
            except Exception:
                continue
            if not kr_poly.is_valid:
                kr_poly = shapely.make_valid(kr_poly)
            kr_poly = _polygonal_geometry(kr_poly)
            if kr_poly is None:
                continue
            if user_poly.intersects(kr_poly):
                inter = _polygonal_geometry(user_poly.intersection(kr_poly))
                if inter is None or inter.is_empty or inter.area <= 0:
                    continue

                p = feat.get("properties", {})
                luas_m2 = round(inter.area * (111320.0 ** 2) * math.cos(math.radians(-7.8)), 1)
                persen_luas = round((inter.area / total_area_deg) * 100.0, 1)

                skor_l = int(p.get("skor_lereng", 1))
                skor_t = int(p.get("skor_tanah") or p.get("skor tanah") or 3)
                skor_b = int(p.get("skor_batuan", 2))
                skor_h = int(p.get("skor_hujan", 3))
                skor_lh = int(p.get("skor_lahan", 3))
                skor_akhir = float(p.get("skor_akhir") or (0.30 * skor_l + 0.25 * skor_t + 0.20 * skor_b + 0.15 * skor_h + 0.10 * skor_lh))
                spk_scores = {
                    "slope": read_spk_score(p, "skor_lereng"),
                    "soil": read_spk_score(p, "skor_tanah"),
                    "geology": read_spk_score(p, "skor_batuan"),
                    "rainfall": read_spk_score(p, "skor_hujan"),
                    "landCover": read_spk_score(p, "skor_lahan"),
                }
                score_completeness = {key: value is not None for key, value in spk_scores.items()}
                data_missing = [key for key, present in score_completeness.items() if not present]

                if skor_akhir < 2.20:
                    kat = "Hijau"
                    zona_kode = "ZONA HIJAU"
                    hex_color = "#10b981"
                    border_color = "#059669"
                elif skor_akhir <= 3.40:
                    kat = "Kuning"
                    zona_kode = "ZONA KUNING"
                    hex_color = "#f59e0b"
                    border_color = "#d97706"
                else:
                    kat = "Merah"
                    zona_kode = "ZONA MERAH"
                    hex_color = "#ef4444"
                    border_color = "#dc2626"

                beta_seg = float(p.get("lereng_derajat", 3.0))
                soil_str = str(p.get("ket_tanah") or p.get("jns_tnh") or "Regosol")
                soil_info = get_soil_params(soil_str)
                rock_str = str(p.get("ket_batuan") or "")
                c_kpa = float(p.get("c_kpa") or soil_info["c"])
                cr_kpa = float(p.get("cr_kpa", 0.0))
                phi_deg = float(p.get("phi_deg") or soil_info["phi"])
                gamma_sat = float(soil_info["gamma_sat"])
                z_depth = float(soil_info["z"])
                rasio_m = sanitize_rasio_m(p.get("rasio_m"), 0.60)
                q_kpa = float(p.get("q_kpa", 15.0))

                fs_res = calc_infinite_slope_fs(
                    beta_seg, c_kpa, cr_kpa, phi_deg, gamma_sat, z_depth, rasio_m, q_kpa,
                    soil_str=soil_str, rock_str=rock_str, is_expansive=soil_info["is_expansive"]
                )
                fs_val = fs_res["fs"]

                proporsi_zona[kat]["luas_m2"] = round(proporsi_zona[kat]["luas_m2"] + luas_m2, 1)
                proporsi_zona[kat]["persen"] = round(proporsi_zona[kat]["persen"] + persen_luas, 1)
                weighted_beta_sum += beta_seg * luas_m2

                features_out.append({
                    "type": "Feature",
                    "id": f"SEG-{seg_idx:02d}",
                    "properties": {
                        "segmen_id": f"SEG-{seg_idx:02d}",
                        "zona_triase": f"{zona_kode} (Skor {skor_akhir:.2f})",
                        "zona_singkat": f"Zona {kat}",
                        "kategori_zona": kat,
                        "skor_akhir": skor_akhir,
                        "warna_hex": hex_color,
                        "border_hex": border_color,
                        "luas_m2": luas_m2,
                        "persen_luas": persen_luas,
                        "beta_mean": beta_seg,
                        "c_kpa": c_kpa,
                        "cr_kpa": cr_kpa,
                        "phi_deg": phi_deg,
                        "gamma_sat": gamma_sat,
                        "z_depth": z_depth,
                        "rasio_m": rasio_m,
                        "u_kpa": fs_res["u_kpa"],
                        "q_kpa": q_kpa,
                        "fs": fs_val,
                        "fs_awal": fs_res["fs_awal"],
                        "fs_pasca": fs_res["fs_pasca"],
                        "koridor": fs_res["koridor"],
                        "beta_pasca": fs_res["beta_pasca"],
                        "m_pasca": fs_res["m_pasca"],
                        "rekomendasi_koridor": fs_res["rekomendasi_koridor"],
                        "sni_label": SNI_FS_TARGET_LABEL,
                        "fs_label": fs_res["label"],
                        "spk_scores": spk_scores,
                        "score_completeness": score_completeness,
                        "data_missing": data_missing,
                        "spk_actual": {
                            "slopeDeg": p.get("lereng_derajat"),
                            "soilType": p.get("ket_tanah") or p.get("jns_tnh"),
                            "geologyUnit": p.get("ket_batuan"),
                            "rainfallMm": p.get("curah_hujan_mm"),
                            "landCover": p.get("ket_lahan") or p.get("pl"),
                        },
                    },
                    "geometry": mapping(inter),
                })
                seg_idx += 1

        total_luas = round(sum(f["properties"]["luas_m2"] for f in features_out), 1)
        beta_mean_kavling = round(weighted_beta_sum / total_luas, 2) if total_luas > 0 else 2.5
        land_use_report = build_land_use_report(user_poly, polygon_area_m2)
        sensitive_area_report = build_sensitive_areas(land_use_report)

        return jsonify({
            "type": "FeatureCollection",
            "status": "ok",
            "summary": {
                "total_luas_m2": total_luas,
                "luas_poligon_m2": polygon_area_m2,
                "persen_cakupan": round((total_luas / polygon_area_m2) * 100.0, 1) if polygon_area_m2 > 0 else 0.0,
                "jumlah_segmen": len(features_out),
                "beta_mean_kavling": beta_mean_kavling,
                "proporsi_zona": proporsi_zona,
                "land_use_coverage_ratio": land_use_report.get("coverageRatio"),
                "sensitive_indication_count": sensitive_area_report.get("summary", {}).get("itemCount", 0),
            },
            "land_use": land_use_report,
            "sensitive_areas": sensitive_area_report,
            "features": features_out,
        }), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

# =====================================================================
# 6. ROUTING HALAMAN WEB & ASET STATIS (BEBAS 404 & BEBAS STALE CACHE)
# =====================================================================
@app.route('/')
def home():
    return send_from_directory(WEB_DIR, 'index.html')

@app.route('/Web/<path:filename>')
def serve_web_dir(filename):
    return send_from_directory(WEB_DIR, filename)

@app.route('/data/<path:filename>')
def serve_public_data(filename):
    if (DATA_DIR / filename).exists():
        return send_from_directory(DATA_DIR, filename)
    if (ROOT_DIR / "public" / "data" / filename).exists():
        return send_from_directory(ROOT_DIR / "public" / "data", filename)
    return "File data tidak ditemukan", 404

@app.route('/<path:filename>')
def serve_static(filename):
    if (WEB_DIR / filename).exists():
        return send_from_directory(WEB_DIR, filename)
    if (DATA_DIR / filename).exists():
        return send_from_directory(DATA_DIR, filename)
    if (ROOT_DIR / "public" / filename).exists():
        return send_from_directory(ROOT_DIR / "public", filename)
    if (ROOT_DIR / "public" / "data" / filename).exists():
        return send_from_directory(ROOT_DIR / "public" / "data", filename)
    if filename.startswith("Data/processed/"):
        clean_name = filename.replace("Data/processed/", "")
        if (DATA_DIR / clean_name).exists():
            return send_from_directory(DATA_DIR, clean_name)
    return "File tidak ditemukan", 404

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)
