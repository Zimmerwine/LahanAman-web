import json
import math
import os
import sys
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory

# 1. Konfigurasi path
API_DIR = Path(__file__).resolve().parent
ROOT_DIR = API_DIR.parent
WEB_DIR = ROOT_DIR / "Web"

# Arahkan ke public/data (dengan fallback ke Data/processed jika masih ada)
if (ROOT_DIR / "public" / "data").exists():
    DATA_DIR = ROOT_DIR / "public" / "data"
elif (ROOT_DIR / "Data" / "processed").exists():
    DATA_DIR = ROOT_DIR / "Data" / "processed"
else:
    DATA_DIR = ROOT_DIR / "public" / "data"

os.chdir(ROOT_DIR)

app = Flask(__name__)

@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response

# 2. In-Memory Cache Dataset
DATA_CACHE = {
    "loaded": False,
    "admin": [],
    "kerawanan": [],
    "dusun": [],
}

def load_processed_data():
    if DATA_CACHE["loaded"]:
        return

    # A. Muat clean_batas_administrasi.geojson
    p_adm = DATA_DIR / "clean_batas_administrasi.geojson"
    if p_adm.exists():
        with open(p_adm, "r", encoding="utf-8") as f:
            DATA_CACHE["admin"] = json.load(f).get("features", [])

    # B. Muat clean_kerawanan_longsor.geojson
    p_kr = DATA_DIR / "clean_kerawanan_longsor.geojson"
    if p_kr.exists():
        with open(p_kr, "r", encoding="utf-8") as f:
            DATA_CACHE["kerawanan"] = json.load(f).get("features", [])

    # C. Muat katalog_dusun_diy.json
    p_ds = DATA_DIR / "katalog_dusun_diy.json"
    if p_ds.exists():
        with open(p_ds, "r", encoding="utf-8") as f:
            DATA_CACHE["dusun"] = json.load(f)

    DATA_CACHE["loaded"] = True

load_processed_data()

# 3. Utilitas Geometri
def point_in_ring(x, y, ring):
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

def point_in_geometry(x, y, geom):
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

# =====================================================================
# ENDPOINT API
# =====================================================================
@app.route('/api/query', methods=['GET'])
def endpoint_query():
    try:
        lat = float(request.args.get("lat", "-7.797068"))
        lng = float(request.args.get("lng", "110.370529"))
        dusun_hint = request.args.get("dusun", "").strip()

        adm_hit = None
        for feat in DATA_CACHE["admin"]:
            if point_in_geometry(lng, lat, feat.get("geometry")):
                adm_hit = feat.get("properties", {})
                break

        if not adm_hit and DATA_CACHE["admin"]:
            adm_hit = DATA_CACHE["admin"][0].get("properties", {})

        kr_hit = None
        for feat in DATA_CACHE["kerawanan"]:
            if point_in_geometry(lng, lat, feat.get("geometry")):
                kr_hit = feat.get("properties", {})
                break

        if not kr_hit:
            kr_hit = adm_hit or {}

        kalurahan = adm_hit.get("kalurahan", "-")
        kapanewon = adm_hit.get("kapanewon", "-")
        kabupaten = adm_hit.get("kabupaten", "Kab. Sleman")
        dusun = dusun_hint or adm_hit.get("dusun_utama") or f"Dusun {kalurahan}"

        skor_l = int(kr_hit.get("skor_lereng", adm_hit.get("skor_lereng", 1)))
        skor_t = int(kr_hit.get("skor_tanah", adm_hit.get("skor_tanah", 3)))
        skor_b = int(kr_hit.get("skor_batuan", adm_hit.get("skor_batuan", 2)))
        skor_h = int(kr_hit.get("skor_hujan", adm_hit.get("skor_hujan", 3)))
        skor_lh = int(kr_hit.get("skor_lahan", adm_hit.get("skor_tutupan", 3)))

        skor_akhir = round(
            0.30 * skor_l + 0.25 * skor_t + 0.20 * skor_b + 0.15 * skor_h + 0.10 * skor_lh, 2
        )

        zona = "Zona Hijau"
        if skor_akhir > 3.40 or skor_l >= 5:
            zona = "Zona Merah"
        elif skor_akhir >= 2.20 or skor_t == 5:
            zona = "Zona Kuning"

        warna_hex = "#D32F2F" if zona == "Zona Merah" else ("#FB8C00" if zona == "Zona Kuning" else "#2E7D32")
        if skor_t == 5 and zona == "Zona Kuning":
            warna_hex = "#FFB300"

        c_kpa = float(kr_hit.get("c_kpa", 8.0))
        phi_deg = float(kr_hit.get("phi_deg", 25.0))
        lereng_deg = float(adm_hit.get("lereng_derajat", 4.5))
        rasio_m = float(kr_hit.get("rasio_m", 0.60))

        gamma_sat = 18.0
        z_depth = 2.0
        beta_rad = math.radians(max(lereng_deg, 1.0))
        phi_rad = math.radians(phi_deg)
        cos_b = math.cos(beta_rad)
        sin_b = math.sin(beta_rad)
        normal_eff = (gamma_sat * z_depth - rasio_m * 9.81 * z_depth) * (cos_b ** 2)
        fs_val = round((c_kpa + normal_eff * math.tan(phi_rad)) / (gamma_sat * z_depth * sin_b * cos_b), 2)

        return jsonify({
            "status": "ok",
            "wilayah": {
                "nama_dusun": dusun,
                "kalurahan": kalurahan,
                "kapanewon": kapanewon,
                "kabupaten": kabupaten,
                "elevasi_mdpl": adm_hit.get("elevasi_mdpl", 115),
            },
            "kondisi_lapangan": {
                "lereng_derajat": lereng_deg,
                "lereng_persen": adm_hit.get("lereng_persen", 7.9),
                "kelas_lereng": adm_hit.get("kelas_lereng", "Datar - Landai"),
                "jenis_tanah": kr_hit.get("ket_tanah", adm_hit.get("jenis_tanah", "Regosol")),
                "c_kpa": c_kpa,
                "phi_deg": phi_deg,
                "gamma_sat": gamma_sat,
                "z_depth": z_depth,
                "formasi_batuan": kr_hit.get("ket_batuan", adm_hit.get("formasi_batuan", "Merapi Muda")),
                "curah_hujan_mm": kr_hit.get("curah_hujan_mm", adm_hit.get("ch_idw_mm", 2250)),
                "skor_hujan": skor_h,
                "rasio_m": rasio_m,
                "tutupan_lahan": kr_hit.get("ket_lahan", adm_hit.get("tutupan_dominan", "Permukiman")),
            },
            "skor_internal": {
                "skor_lereng": skor_l,
                "skor_tanah": skor_t,
                "skor_batuan": skor_b,
                "skor_hujan": skor_h,
                "skor_tutupan": skor_lh,
                "skor_akhir": skor_akhir,
            },
            "triase": {
                "zona": zona,
                "zona_triase": kr_hit.get("zona_triase", f"{zona.upper()} (Skor {skor_akhir})"),
                "badge": f"SKOR {skor_akhir:.2f} — {zona.upper()}",
                "warna_hex": warna_hex,
                "fs": fs_val,
                "fs_label": "STABIL" if fs_val >= 1.5 else ("RAWAN RAYAPAN" if fs_val >= 1.15 else "LABIL"),
                "fs_desc": "Kestabilan geser lereng tanah.",
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
        total_area_deg = user_poly.area
        proporsi_zona = {
            "Hijau": {"luas_m2": 0.0, "persen": 0.0},
            "Kuning": {"luas_m2": 0.0, "persen": 0.0},
            "Merah": {"luas_m2": 0.0, "persen": 0.0},
        }

        for feat in DATA_CACHE["kerawanan"]:
            kr_poly = shp_shape(feat["geometry"])
            if user_poly.intersects(kr_poly):
                inter = user_poly.intersection(kr_poly)
                if inter.is_empty or inter.area <= 0:
                    continue

                p = feat["properties"]
                luas_m2 = round(inter.area * (111320.0 ** 2) * math.cos(math.radians(-7.8)), 1)
                persen_luas = round((inter.area / total_area_deg) * 100.0, 1)

                zona_str = str(p.get("zona_triase", "Hijau")).upper()
                kat = "Merah" if "MERAH" in zona_str else ("Kuning" if "KUNING" in zona_str else "Hijau")
                warna_hex = p.get("warna_hex", "#2E7D32")
                border_hex = p.get("border_hex", "#1B5E20")

                proporsi_zona[kat]["luas_m2"] += luas_m2
                proporsi_zona[kat]["persen"] += persen_luas

                features_out.append({
                    "type": "Feature",
                    "id": f"SEG-{seg_idx:02d}",
                    "properties": {
                        "segmen_id": f"SEG-{seg_idx:02d}",
                        "zona_triase": p.get("zona_triase", f"Zona {kat}"),
                        "zona_singkat": f"Zona {kat}",
                        "kategori_zona": kat,
                        "warna_hex": warna_hex,
                        "border_hex": border_hex,
                        "luas_m2": luas_m2,
                        "persen_luas": persen_luas,
                        "beta_mean": 4.5,
                        "elev_min": 115.0,
                        "elev_max": 120.0,
                        "tinggi_H": 5.0,
                        "c_kpa": p.get("c_kpa", 8.0),
                        "phi_deg": p.get("phi_deg", 25.0),
                        "rasio_m": p.get("rasio_m", 0.60),
                    },
                    "geometry": mapping(inter),
                })
                seg_idx += 1

        total_luas = sum(f["properties"]["luas_m2"] for f in features_out)

        return jsonify({
            "type": "FeatureCollection",
            "status": "ok",
            "summary": {
                "total_luas_m2": total_luas,
                "jumlah_segmen": len(features_out),
                "beta_mean_kavling": 4.5,
                "tinggi_H_kavling": 5.0,
                "proporsi_zona": proporsi_zona,
            },
            "features": features_out,
        }), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

@app.route('/api/search', methods=['GET'])
def endpoint_search():
    try:
        q = request.args.get("q", "").strip().lower()
        kab = request.args.get("kab", "ALL")
        zona = request.args.get("zona", "ALL")
        limit = int(request.args.get("limit", "60"))

        results = []
        for item in DATA_CACHE.get("dusun", []):
            kab_item = str(item.get("kabupaten", ""))
            zona_item = str(item.get("status_zona", ""))
            if kab != "ALL" and kab.lower() not in kab_item.lower():
                continue
            if zona != "ALL" and zona.lower() not in zona_item.lower():
                continue
            nama = str(item.get("nama", "")).lower()
            kel = str(item.get("kelurahan", "")).lower()
            kec = str(item.get("kapanewon", "")).lower()
            if q and (q not in nama and q not in kel and q not in kec):
                continue
            results.append(item)
            if len(results) >= limit:
                break
        return jsonify({"status": "ok", "results": results, "count": len(results)}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

# =====================================================================
# ROUTING HALAMAN WEB & ASET STATIS (BEBAS 404)
# =====================================================================
@app.route('/')
def home():
    return send_from_directory(WEB_DIR, 'index.html')

@app.route('/Web/<path:filename>')
def serve_web_dir(filename):
    return send_from_directory(WEB_DIR, filename)

@app.route('/<path:filename>')
def serve_static(filename):
    if (WEB_DIR / filename).exists():
        return send_from_directory(WEB_DIR, filename)
    if (DATA_DIR / filename).exists():
        return send_from_directory(DATA_DIR, filename)
    if (ROOT_DIR / "public" / filename).exists():
        return send_from_directory(ROOT_DIR / "public", filename)
    if filename.startswith("Data/processed/"):
        clean_name = filename.replace("Data/processed/", "")
        if (DATA_DIR / clean_name).exists():
            return send_from_directory(DATA_DIR, clean_name)
    return "File tidak ditemukan", 404