import json
import math
import os
import re
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
}

def _compute_geom_bbox(geom):
    if not geom or "coordinates" not in geom:
        return None
    coords = geom.get("coordinates", [])
    g_type = geom.get("type")
    xs, ys = [], []
    try:
        if g_type == "Polygon":
            for ring in coords:
                for pt in ring:
                    xs.append(pt[0])
                    ys.append(pt[1])
        elif g_type == "MultiPolygon":
            for poly in coords:
                for ring in poly:
                    for pt in ring:
                        xs.append(pt[0])
                        ys.append(pt[1])
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
# 3. ENGINE GEOTEKNIK TERPADU BERBASIS DASAR.XLSX
# =====================================================================
GAMMA_W = 9.81

SOIL_MATRIX = {
    "grumusol":  {"skor": 5, "c": 9.0,  "phi": 15.0, "gamma_sat": 19.0, "z": 2.0, "label": "Grumusol (Vertisol)"},
    "latosol":   {"skor": 4, "c": 10.0, "phi": 18.0, "gamma_sat": 18.5, "z": 2.0, "label": "Latosol (Inceptisol/Ultisol)"},
    "mediteran": {"skor": 4, "c": 11.0, "phi": 20.0, "gamma_sat": 18.5, "z": 2.5, "label": "Mediteran (Alfisol)"},
    "regosol":   {"skor": 3, "c": 3.5,  "phi": 36.0, "gamma_sat": 17.5, "z": 1.0, "label": "Regosol (Entisol Vulkanik)"},
    "kambisol":  {"skor": 2, "c": 8.0,  "phi": 30.0, "gamma_sat": 18.0, "z": 2.0, "label": "Kambisol (Inceptisol)"},
    "aluvial":   {"skor": 1, "c": 14.0, "phi": 25.0, "gamma_sat": 18.5, "z": 4.0, "label": "Aluvial (Endapan Dataran)"},
}

def get_soil_params(soil_str: str) -> dict:
    s = (soil_str or "").lower()
    for key, val in SOIL_MATRIX.items():
        if key in s:
            return val
    return SOIL_MATRIX["regosol"]

def get_slope_params(beta_deg: float) -> dict:
    b = max(0.0, float(beta_deg))
    pct = round(math.tan(math.radians(b)) * 100.0, 1)
    if b <= 8.0:
        return {"skor": 1, "beta": round(b, 2), "persen": pct, "kelas": "0° - 8° (Datar - Landai)"}
    elif b <= 15.0:
        return {"skor": 2, "beta": round(b, 2), "persen": pct, "kelas": ">8° - 15° (Agak Curam / Transisi)"}
    elif b <= 25.0:
        return {"skor": 3, "beta": round(b, 2), "persen": pct, "kelas": ">15° - 25° (Curam / Kritis)"}
    elif b <= 35.0:
        return {"skor": 4, "beta": round(b, 2), "persen": pct, "kelas": ">25° - 35° (Sangat Curam)"}
    else:
        return {"skor": 5, "beta": round(b, 2), "persen": pct, "kelas": ">35° (Terjal / Ekstrem)"}

def get_rock_params(rock_str: str) -> dict:
    r = (rock_str or "").lower()
    if any(k in r for k in ["semilir", "tmse", "tms3", "sambipitu", "tmss", "nanggulan", "teon", "avalanche"]):
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
        return {"skor": 1, "m": 0.30}

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

def calc_infinite_slope_fs(beta_deg: float, c_kpa: float, cr_kpa: float, phi_deg: float, gamma_sat: float, z: float, m: float, q: float) -> dict:
    u_kpa = round(m * GAMMA_W * z, 2)
    if beta_deg <= 2.0:
        fs_val = 5.00
    else:
        beta_rad = math.radians(beta_deg)
        phi_rad = math.radians(phi_deg)
        cos_b = math.cos(beta_rad)
        sin_b = math.sin(beta_rad)
        tan_phi = math.tan(phi_rad)

        total_c = c_kpa + cr_kpa
        eff_normal = ((gamma_sat * z - m * GAMMA_W * z) + q) * (cos_b ** 2)
        resisting = total_c + max(0.0, eff_normal) * tan_phi
        driving = (gamma_sat * z + q) * sin_b * cos_b

        if driving <= 1e-6:
            fs_val = 5.00
        else:
            fs_val = round(min(5.00, max(0.05, resisting / driving)), 2)

    if fs_val > 1.25:
        return {"fs": fs_val, "u_kpa": u_kpa, "label": "STABIL", "hex": "#10b981", "desc": "Lereng stabil terhadap gelincir translasi (FS > 1,25)"}
    elif fs_val >= 1.07:
        return {"fs": fs_val, "u_kpa": u_kpa, "label": "KRITIS", "hex": "#f59e0b", "desc": "Kestabilan kritis / rawan rayapan (1,07 <= FS <= 1,25)"}
    else:
        return {"fs": fs_val, "u_kpa": u_kpa, "label": "LABIL / LONGSOR", "hex": "#ef4444", "desc": "Lereng labil, rawan longsor saat jenuh (FS < 1,07)"}

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
    if not geom or "coordinates" not in geom:
        return False
    g_type = geom.get("type")
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

        # Ekstraksi Nama Wilayah Administrasi (Dukung Uppercase & Lowercase, BEBAS DUMMY "-")
        kalurahan = (
            kr_hit.get("kalurahan")
            or kr_hit.get("KALURAHAN")
            or adm_hit.get("kalurahan")
            or adm_hit.get("KALURAHAN")
            or "Mulyodadi"
        )
        if kalurahan == "-":
            kalurahan = adm_hit.get("kalurahan") or "Mulyodadi"

        kapanewon = (
            kr_hit.get("kapanewon")
            or kr_hit.get("KECAMATAN")
            or adm_hit.get("kapanewon")
            or adm_hit.get("KECAMATAN")
            or "Bambanglipuro"
        )
        if kapanewon == "-":
            kapanewon = adm_hit.get("kapanewon") or "Bambanglipuro"

        kabupaten = (
            kr_hit.get("kabupaten")
            or kr_hit.get("KABUPATEN")
            or adm_hit.get("kabupaten")
            or adm_hit.get("KABUPATEN")
            or "Kab. Bantul"
        )

        label_wilayah = f"Kal. {kalurahan}, Kapanewon {kapanewon}, {kabupaten}"
        elevasi = float(kr_hit.get("elevasi_mdpl") or adm_hit.get("elevasi_mdpl") or 115.0)

        # PRIORITAS 1: Bila poligon master kerawanan longsor sudah memiliki kalkulasi resmi pipeline
        if kr_hit.get("skor_akhir") is not None:
            skor_akhir = round(float(kr_hit["skor_akhir"]), 2)
            beta_deg = round(float(kr_hit.get("lereng_derajat", 3.0)), 2)
            beta_pct = round(float(kr_hit.get("lereng_persen", math.tan(math.radians(beta_deg)) * 100.0)), 1)
            slope_info = get_slope_params(beta_deg)

            jenis_tanah = str(kr_hit.get("ket_tanah") or "Regosol")
            c_kpa = float(kr_hit.get("c_kpa", 3.5))
            phi_deg = float(kr_hit.get("phi_deg", 36.0))
            gamma_sat = float(kr_hit.get("gamma_sat", 17.5))
            z_depth = float(kr_hit.get("z", 1.0))

            formasi_batuan = str(kr_hit.get("ket_batuan") or "Endapan Gunungapi Merapi Muda (Qmi)")
            curah_hujan_mm = float(kr_hit.get("curah_hujan_mm", 2250.0))
            rasio_m = float(kr_hit.get("rasio_m", 0.60))

            tutupan_lahan = str(kr_hit.get("ket_lahan") or "Permukiman")
            cr_kpa = float(kr_hit.get("cr_kpa", 0.0))
            q_kpa = float(kr_hit.get("q_kpa", 0.0))
            u_kpa = float(kr_hit.get("u_kpa", round(rasio_m * GAMMA_W * z_depth, 2)))

            skor_l = int(kr_hit.get("skor_lereng", slope_info["skor"]))
            skor_t = int(kr_hit.get("skor_tanah", 3))
            skor_b = int(kr_hit.get("skor_batuan", 2))
            skor_h = int(kr_hit.get("skor_hujan", 3))
            skor_lh = int(kr_hit.get("skor_lahan", 3))

            fs_val = round(float(kr_hit.get("fs", 5.0)), 2)
            fs_status = str(kr_hit.get("fs_status") or ("STABIL" if fs_val > 1.25 else ("KRITIS" if fs_val >= 1.07 else "LABIL / LONGSOR")))
            fs_hex = "#10b981" if fs_val > 1.25 else ("#f59e0b" if fs_val >= 1.07 else "#ef4444")
            fs_desc = "Lereng stabil terhadap gelincir translasi (FS > 1,25)" if fs_val > 1.25 else ("Kestabilan kritis / rawan rayapan" if fs_val >= 1.07 else "Lereng labil, rawan longsor saat jenuh")

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

        # PRIORITAS 2: Gunakan atribut layer administrasi resmi bila ada
        elif adm_hit.get("skor_total") is not None:
            skor_akhir = round(float(adm_hit["skor_total"]), 2)
            beta_deg = round(float(adm_hit.get("lereng_derajat", 3.0)), 2)
            beta_pct = round(float(adm_hit.get("lereng_persen", math.tan(math.radians(beta_deg)) * 100.0)), 1)
            slope_info = get_slope_params(beta_deg)

            jenis_tanah = str(adm_hit.get("jenis_tanah") or "Regosol")
            c_kpa = float(adm_hit.get("c_kpa", 3.5))
            phi_deg = float(adm_hit.get("phi_deg", 36.0))
            gamma_sat = float(adm_hit.get("gamma_sat", 17.5))
            z_depth = float(adm_hit.get("z", 1.0))

            formasi_batuan = str(adm_hit.get("formasi_batuan") or "Endapan Gunungapi Merapi Muda (Qmi)")
            curah_hujan_mm = float(adm_hit.get("curah_hujan_mm", 2250.0))
            rasio_m = float(adm_hit.get("rasio_m", 0.60))

            tutupan_lahan = str(adm_hit.get("tutupan_dominan") or "Permukiman")
            cr_kpa = float(adm_hit.get("cr_kpa", 0.0))
            q_kpa = float(adm_hit.get("q_kpa", 0.0))
            u_kpa = float(adm_hit.get("u_kpa", round(rasio_m * GAMMA_W * z_depth, 2)))

            skor_l = int(adm_hit.get("skor_lereng", slope_info["skor"]))
            skor_t = int(adm_hit.get("skor_tanah", 3))
            skor_b = int(adm_hit.get("skor_batuan", 2))
            skor_h = int(adm_hit.get("skor_hujan", 3))
            skor_lh = int(adm_hit.get("skor_tutupan", 3))

            fs_val = round(float(adm_hit.get("fs", 5.0)), 2)
            fs_status = str(adm_hit.get("fs_status") or "STABIL")
            fs_hex = "#10b981" if fs_val > 1.25 else ("#f59e0b" if fs_val >= 1.07 else "#ef4444")
            fs_desc = "Lereng stabil terhadap gelincir translasi (FS > 1,25)" if fs_val > 1.25 else ("Kestabilan kritis" if fs_val >= 1.07 else "Lereng labil")

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

            tutupan_lahan = "Permukiman"
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
            fs_res = calc_infinite_slope_fs(beta_deg, c_kpa, cr_kpa, phi_deg, gamma_sat, z_depth, rasio_m, q_kpa)

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

        user_poly = shp_shape(payload["geometry"])
        if not user_poly.is_valid:
            user_poly = shapely.make_valid(user_poly)

        features_out = []
        seg_idx = 1
        total_area_deg = max(user_poly.area, 1e-12)
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

            kr_poly = shp_shape(feat["geometry"])
            if user_poly.intersects(kr_poly):
                inter = user_poly.intersection(kr_poly)
                if inter.is_empty or inter.area <= 0:
                    continue

                p = feat.get("properties", {})
                luas_m2 = round(inter.area * (111320.0 ** 2) * math.cos(math.radians(-7.8)), 1)
                persen_luas = round((inter.area / total_area_deg) * 100.0, 1)

                skor_l = int(p.get("skor_lereng", 1))
                skor_t = int(p.get("skor_tanah", 3))
                skor_b = int(p.get("skor_batuan", 2))
                skor_h = int(p.get("skor_hujan", 3))
                skor_lh = int(p.get("skor_lahan", 3))
                skor_akhir = float(p.get("skor_akhir") or (0.30 * skor_l + 0.25 * skor_t + 0.20 * skor_b + 0.15 * skor_h + 0.10 * skor_lh))

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
                c_kpa = float(p.get("c_kpa", 8.0))
                cr_kpa = float(p.get("cr_kpa", 0.0))
                phi_deg = float(p.get("phi_deg", 25.0))
                gamma_sat = float(p.get("gamma_sat", 18.0))
                z_depth = float(p.get("z", 2.0))
                rasio_m = float(p.get("rasio_m", 0.60))
                q_kpa = float(p.get("q_kpa", 15.0))

                fs_res = calc_infinite_slope_fs(beta_seg, c_kpa, cr_kpa, phi_deg, gamma_sat, z_depth, rasio_m, q_kpa)
                fs_val = float(p.get("fs") or fs_res["fs"])

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
                        "fs_label": fs_res["label"],
                    },
                    "geometry": mapping(inter),
                })
                seg_idx += 1

        total_luas = round(sum(f["properties"]["luas_m2"] for f in features_out), 1)
        beta_mean_kavling = round(weighted_beta_sum / total_luas, 2) if total_luas > 0 else 2.5

        return jsonify({
            "type": "FeatureCollection",
            "status": "ok",
            "summary": {
                "total_luas_m2": total_luas,
                "jumlah_segmen": len(features_out),
                "beta_mean_kavling": beta_mean_kavling,
                "proporsi_zona": proporsi_zona,
            },
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
