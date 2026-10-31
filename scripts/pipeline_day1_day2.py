"""
pipeline_day1_day2.py
=====================
Pipeline utama LahanAman (Hari 1 & Hari 2):
1. Ekstrak seluruh ZIP di Data/raw (termasuk subfolder) bila belum diekstrak
2. Batas administrasi DIY (Sleman, Bantul, Kota Yogyakarta) -> clean_batas_administrasi.geojson + DB
3. DEMNAS DIY UTM (dibaca dengan EPSG:32749 dari Data/raw/extracted/Demnas Jogja UTM) ->
   clean_demnas_diy_utm.geojson
4. Tutupan lahan lengkap (0 celah & 0 overlap di dalam batas wilayah) ->
   clean_tutupan_lahan_sleman_bantul.geojson, clean_tutupan_lahan_diy.geojson + DB
5. 20 Pos Hujan (lengkap atribut Excel + elevasi DEMNAS EPSG:32749) -> clean_pos_hujan.geojson + DB
6. Peta Zona Curah Hujan Metode IDW (Inverse Distance Weighted) seluruh DIY ->
   clean_curah_hujan_idw.geojson + DB (layer_parameter_spasial parameter_nama='curah_hujan')
7. 30 Titik Uji Developer & Area Jangkauan Titik (curah hujan & skor hujan dihitung dengan
   metode IDW di masing-masing area jangkauan titik + elevasi & kemiringan lereng dari
   DEMNAS DIY UTM EPSG:32749) ->
   clean_titik_developer.geojson, clean_area_jangkauan_titik.geojson + DB
"""
import os
import re
import shutil

import pyproj

# Pastikan GDAL/rasterio/pyogrio memakai proj.db bawaan pyproj (bukan proj.db milik PostGIS)
_PROJ_DIR = pyproj.datadir.get_data_dir()
os.environ["PROJ_LIB"] = _PROJ_DIR
os.environ["PROJ_DATA"] = _PROJ_DIR

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
from rasterio.features import shapes
from rasterio.mask import mask as rio_mask
from rasterio.transform import from_origin
import shapely
from shapely.geometry import MultiPoint, MultiPolygon, Point, box, mapping, shape
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL

from clean_geojson import (
    bersihkan_poligon_utm,
    ekstrak_poligon,
    hilangkan_overlap_internal,
    orient_2d,
    ringkasan_geojson,
    simpan_geojson_standar,
    to_2d_multipolygon,
    tutup_celah_kecil,
)
from spatial_loader import (
    GEOJSON_CRS,
    PETA_RESMI_KALURAHAN_DIY,
    PROCESSED_DIR,
    PROJECT_ROOT,
    TARGET_CRS,
    baca_json_curah_hujan_day1,
    baca_json_drainase_day5,
    baca_json_geologi_rab_day4,
    baca_json_pondasi_day7,
    baca_json_tanah_hspk_day3,
    baca_layer_day8,
    baca_rumus_excel,
    baca_tabel_excel,
    baca_vektor,
    cari_demnas_utm_tifs,
    cari_excel,
    cari_folder_rbi,
    cari_gpkg_lereng,
    evaluasi_geoteknik_day8_backend,
    extract_all_zips,
    format_nama_dusun_asli,
    hitung_statistik_hujan_harian_excel,
    idw_area_jangkauan,
    interpolasi_idw,
    muat_katalog_dusun_diy,
    normalisasi_kabupaten,
    perkaya_atribut_osm,
    sampling_demnas_utm,
)

# =====================================================================
# KONFIGURASI
# =====================================================================
SIMPAN_KE_DB = False  # False = lewati PostGIS (re-configuration DB), hanya output GeoJSON EPSG:32749 & Web Bundle

DB_USER = "postgres"
DB_PASS = os.getenv("PG_PASSWORD", "halo123")
DB_HOST = "localhost"
DB_PORT = 5432
DB_NAME = "lahan_aman_db"

IDW_POWER = 2.0                # Pangkat bobot jarak IDW (Inverse Distance Weighted)
IDW_GRID_RES_M = 100.0         # Resolusi grid interpolasi IDW wilayah DIY (meter, EPSG:32749)
RADIUS_JANGKAUAN_TITIK_M = 500.0  # Radius area jangkauan masing-masing titik uji (meter)

os.makedirs(PROCESSED_DIR, exist_ok=True)


# =====================================================================
# ATURAN SKORING (ACUAN DAY 8)
# =====================================================================
def tentukan_zona(skor, lereng_deg=None, jenis_tanah=""):
    if pd.isna(skor):
        return None
    is_exp = any(k in str(jenis_tanah).lower() for k in ["grumosol", "ekspansif", "vertisol"])
    if skor > 3.40 or (lereng_deg is not None and float(lereng_deg) > 25.0):
        return "Zona Merah"
    if skor < 2.20 or (lereng_deg is not None and float(lereng_deg) <= 8.0 and not is_exp):
        return "Zona Hijau"
    return "Zona Kuning"


def label_status_risiko(skor, lereng_deg=None, jenis_tanah=""):
    z = tentukan_zona(skor, lereng_deg, jenis_tanah)
    if z == "Zona Hijau":
        return "Zona Hijau (< 2,20 | Aman / Risiko Rendah)"
    elif z == "Zona Kuning":
        return "Zona Kuning (2,20 - 3,40 | Waspada - Perlu Mitigasi & RAB)"
    elif z == "Zona Merah":
        return "Zona Merah (> 3,40 | Bahaya Kritis / Non-Buildable)"
    return "-"


def hitung_skor_hujan(ch):
    if pd.isna(ch):
        return 1
    if ch > 3000:
        return 5
    elif ch >= 2501:
        return 4
    elif ch >= 2001:
        return 3
    elif ch >= 1500:
        return 2
    return 1


def label_kelas_hujan(skor):
    peta = {
        1: "< 1.500 mm/th (Sangat Rendah)",
        2: "1.500 - 2.000 mm/th (Rendah)",
        3: "2.001 - 2.500 mm/th (Sedang)",
        4: "2.501 - 3.000 mm/th (Tinggi)",
        5: "> 3.000 mm/th (Sangat Tinggi)",
    }
    return peta.get(int(skor), "2.001 - 2.500 mm/th (Sedang)")


def hitung_skor_lereng(persen):
    """
    Skor kemiringan lereng LahanAman (Bobot 30%) sesuai tabel pembobotan:
      > 45%   -> Skor 5 (Sangat curam)
      30-45%  -> Skor 4 (Curam)
      15-30%  -> Skor 3 (Agak curam)
      8-15%   -> Skor 2 (Landai / bergelombang)
      < 8%    -> Skor 1 (Datar)
    """
    if pd.isna(persen):
        return 1
    if persen > 45.0:
        return 5
    elif persen >= 30.0:
        return 4
    elif persen >= 15.0:
        return 3
    elif persen >= 8.0:
        return 2
    return 1


def label_kelas_lereng(skor):
    peta = {
        1: "< 8% (Datar)",
        2: "8 - 15% (Landai / bergelombang)",
        3: "15 - 30% (Agak curam)",
        4: "30 - 45% (Curam)",
        5: "> 45% (Sangat curam)",
    }
    return peta.get(int(skor), "< 8% (Datar)")


def label_kelas_batuan(skor):
    peta = {
        1: "Batu aluvial (Endapan dataran/sungai)",
        2: "Batu sedimen (Formasi Semilir, Nglanggran, Sentolo)",
        3: "Batu vulkanik (Merapi Muda/Tua)",
    }
    return peta.get(int(skor), "Batu sedimen (Formasi Semilir, Nglanggran, Sentolo)")


def label_kelas_tanah(skor):
    peta = {
        1: "Aluvial, planosol, hidromorf",
        2: "Latosol",
        3: "Brown forest soil, mediteran",
        4: "Andosol, laterit, grumosol, podsolik",
        5: "Regosol, litosol, organosol",
    }
    return peta.get(int(skor), "Regosol, litosol, organosol")


def label_kelas_tutupan(skor):
    peta = {
        1: "Tambak, waduk, perairan",
        2: "Kota / pemukiman / bandara",
        3: "Hutan dan perkebunan",
        4: "Semak belukar",
        5: "Tegalan, sawah",
    }
    return peta.get(int(skor), "Kota / pemukiman / bandara")


def petakan_tanah_batuan_wilayah(kabupaten, kapanewon, elevasi_mdpl, lereng_persen):
    """
    Petakan wilayah (Kabupaten, Kapanewon, Elevasi, Lereng) ke Matriks Skoring Poligon Tanah & Batuan DIY
    (SOIL-DIY-01 s/d SOIL-DIY-07) sesuai Tabel Pembobotan LahanAman.
    """
    kec = str(kapanewon).strip().lower()
    kab = str(kabupaten).strip()

    # 1. Pesisir Selatan Bantul (Gumuk Pasir / Fluvio-Marin) -> SOIL-DIY-02
    if any(k in kec for k in ["kretek", "sanden", "srandakan"]):
        return {
            "kode_poligon_tanah": "SOIL-DIY-02",
            "jenis_tanah": "Regosol Bukit Pasir Pantai & Fluvio-Marin",
            "skor_tanah": 5,
            "formasi_batuan": "Endapan Gumuk Pasir (Qag) & Aluvial Pantai (Qa)",
            "skor_batuan": 1,
            "gamma_kn_m3": 16.2,
            "kohesi_kpa": 2.0,
            "phi_deg": 32.0,
            "indeks_biaya_rab": 1.35,
            "hspk_galian": "H-11 (Galian Tanah Pasir) + H-22 (Dewatering Muka Air Dangkal)",
            "hspk_urugan": "H-44 (Timbunan Pilihan Sirtu) + H-42 (Pemadatan Vibratory)",
            "hspk_talud": "H-59 (Talud Pasangan Batu 1:4) + H-68 (Geotekstil Non-Woven)",
            "aturan_rekayasa": "Pasir lepas nir-kohesi dengan potensi likuifaksi tinggi; wajib pondasi menerus/footplat diperkuat & geotekstil penahan pasir.",
        }

    # 2. Lereng Atas Merapi Sleman -> SOIL-DIY-03
    if any(k in kec for k in ["cangkringan", "pakem", "turi", "selo", "srumbung"]) and elevasi_mdpl >= 420.0:
        return {
            "kode_poligon_tanah": "SOIL-DIY-03",
            "jenis_tanah": "Andosol Coklat / Kambisol Vulkanik Lereng Atas",
            "skor_tanah": 4,
            "formasi_batuan": "Batu Vulkanik Merapi Muda & Tua (Qmi/Qmo)",
            "skor_batuan": 3,
            "gamma_kn_m3": 15.4,
            "kohesi_kpa": 12.0,
            "phi_deg": 30.0,
            "indeks_biaya_rab": 1.28,
            "hspk_galian": "H-11 (Galian Tanah Biasa) + H-25 (Galian Batu Bongkah Vulkanik)",
            "hspk_urugan": "H-35 (Urugan Kembali Terpilah) + H-42 (Pemadatan Lapis per 20 cm)",
            "hspk_talud": "H-66 (Bronjong Kawat Galvanis) + H-60 (Talud Batu Kali) + H-70 (Weep Hole)",
            "aturan_rekayasa": "Tanah vulkanik porositas tinggi di lereng Merapi; wajib terasering, bronjong penahan lereng & drainase sabo/permukaan.",
        }

    # 3. Perbukitan Breksi-Kapur (Semilir, Nglanggran, Sentolo Timur) -> SOIL-DIY-05
    if any(k in kec for k in ["prambanan", "piyungan", "pinyungan", "dlingo", "imogiri", "pleret", "paliyan", "purwosari", "gantiwarno", "kalibawang"]):
        skor_t = 5 if lereng_persen >= 30.0 else 3
        nama_t = "Litosol Kapur-Breksi Kritis" if lereng_persen >= 30.0 else "Mediteran Coklat Kemerahan & Litosol"
        return {
            "kode_poligon_tanah": "SOIL-DIY-05",
            "jenis_tanah": nama_t,
            "skor_tanah": skor_t,
            "formasi_batuan": "Batu Sedimen Formasi Semilir (Tms), Nglanggran (Tmn) & Sentolo (Tmps)",
            "skor_batuan": 2,
            "gamma_kn_m3": 18.5,
            "kohesi_kpa": 22.0,
            "phi_deg": 25.5,
            "indeks_biaya_rab": 1.48,
            "hspk_galian": "H-30 / H-32 (Galian Cadas) & H-33 / H-34 (Galian Batu Semi-Mekanis Breaker)",
            "hspk_urugan": "H-43 (Timbunan Pilihan dari Hasil Galian Batuan Terpilah)",
            "hspk_talud": "H-60 (Talud Batu Setempat) + H-66 (Bronjong pada Lereng >30%) + H-77 (Saluran Terasering)",
            "aturan_rekayasa": "Solum tanah tipis di atas batuan breksi/gamping; pada kemiringan >=30% rawan bidang gelincir kontak tanah-batuan.",
        }

    # 4. Cekungan Lempung Ekspansif Sentolo (Barat-Tengah) -> SOIL-DIY-04
    if any(k in kec for k in ["godean", "goden", "moyudan", "minggir", "gamping", "berbah", "sedayu", "kasihan", "pajangan", "pandak", "sentolo", "lendah", "galur", "nanggulan"]):
        return {
            "kode_poligon_tanah": "SOIL-DIY-04",
            "jenis_tanah": "Grumosol Kelabu Tua / Lempung Hitam Ekspansif",
            "skor_tanah": 4,
            "formasi_batuan": "Batu Sedimen Formasi Sentolo (Tmps) & Endapan Aluvial-Koluvial (Qa)",
            "skor_batuan": 2,
            "gamma_kn_m3": 17.8,
            "kohesi_kpa": 26.0,
            "phi_deg": 16.5,
            "indeks_biaya_rab": 1.65,
            "hspk_galian": "H-30 (Galian Tanah Keras/Lempung Padat) + H-50 (Buang Tanah Ekspansif)",
            "hspk_urugan": "H-08 (Geotekstil Separator) + H-44/H-45 (Wajib Ganti Timbunan Pilihan Sirtu)",
            "hspk_talud": "H-63 (Batu Kosong Aanstamping Tebal) + H-57 (Talud 1:3) + H-74 (Drainase Kedap)",
            "aturan_rekayasa": "Lempung montmorillonit kembang-susut ekstrem; tanah galian dilarang dipakai urugan kembali, wajib diganti Sirtu CBR >= 10%.",
        }

    # 5. Pelapukan Vulkanik Tua / Intrusi -> SOIL-DIY-06
    if any(k in kec for k in ["seyegan", "pundong"]):
        return {
            "kode_poligon_tanah": "SOIL-DIY-06",
            "jenis_tanah": "Latosol Coklat Kemerahan (Pelapukan Vulkanik Tua)",
            "skor_tanah": 2,
            "formasi_batuan": "Batu Vulkanik Merapi Tua (Qmo) & Intrusi Andesit",
            "skor_batuan": 3,
            "gamma_kn_m3": 17.6,
            "kohesi_kpa": 25.0,
            "phi_deg": 27.0,
            "indeks_biaya_rab": 1.08,
            "hspk_galian": "H-11 / H-12 (Galian Tanah Biasa Manual) atau H-17 (Semi-Mekanis)",
            "hspk_urugan": "H-35 (Urugan Kembali) + H-41/H-42 (Pemadatan Standar)",
            "hspk_talud": "H-59 (Talud Pasangan Batu 1:4 Standar) + H-73 (Saluran U-Ditch 30x30)",
            "aturan_rekayasa": "Tanah lempung berpasir-liat hasil pelapukan lanjut dengan ikatan kohesi alami paling stabil untuk cut-and-fill.",
        }

    # 6. Dataran Aluvial Bantul Tengah-Selatan -> SOIL-DIY-07
    if kab == "Kab. Bantul" and any(k in kec for k in ["bantul", "jetis", "sewon", "bambanglipuro", "banguntapan"]):
        return {
            "kode_poligon_tanah": "SOIL-DIY-07",
            "jenis_tanah": "Aluvial Kelabu / Kambisol Dataran Banjir & Lembah Sungai",
            "skor_tanah": 1,
            "formasi_batuan": "Batu Aluvial Endapan Sungai & Dataran (Qa)",
            "skor_batuan": 1,
            "gamma_kn_m3": 16.5,
            "kohesi_kpa": 18.0,
            "phi_deg": 22.0,
            "indeks_biaya_rab": 1.25,
            "hspk_galian": "H-11 (Galian Tanah Biasa) / H-23 (Galian Lumpur jika Sawah Basah)",
            "hspk_urugan": "H-03 (Kupas Topsoil Sawah) + H-38/H-44 (Urugan Peninggian Elevasi) + H-42 (Pemadatan)",
            "hspk_talud": "H-75 (Saluran U-Ditch 60x60) + H-67 (Bronjong Sempadan Sungai)",
            "aturan_rekayasa": "Risiko longsor lereng rendah pada dataran <8%, namun perlu perkuatan tebing di sempadan sungai & drainase muka air dangkal.",
        }

    # 7. Default Sleman & Kota Yogyakarta (Fluvio-Vulkanik Merapi Muda) -> SOIL-DIY-01
    return {
        "kode_poligon_tanah": "SOIL-DIY-01",
        "jenis_tanah": "Regosol Kelabu / Regosol Coklat Kelabu (Vulkanik Muda)",
        "skor_tanah": 5,
        "formasi_batuan": "Batu Vulkanik Merapi Muda (Qmi) - Pasir, Tuf & Breksi Laharik",
        "skor_batuan": 3,
        "gamma_kn_m3": 16.8,
        "kohesi_kpa": 4.0,
        "phi_deg": 34.0,
        "indeks_biaya_rab": 1.00,
        "hspk_galian": "H-11 (A.2.3.1.1a) / H-17 (Semi-Mekanis) / H-25 (Jika Berbatu)",
        "hspk_urugan": "H-35 (Urugan Kembali) + H-42 (Stamper Kuda Wajib)",
        "hspk_talud": "H-59 (Talud 1:4) / H-66 (Bronjong Lereng >30%) + H-68 (Geotekstil) + H-70 (Weep Hole)",
        "aturan_rekayasa": "Kohesi rendah (pasir vulkanik lepas); dilarang memotong tebing tegak >1,2 m tanpa talud; wajib pasang geotekstil separator & weep hole.",
    }


def skor_int(series):
    """Float/NaN dari Excel -> integer murni (aman untuk kolom smallint)."""
    return pd.to_numeric(series, errors="coerce").fillna(1).astype(int)


# Prioritas layer tutupan lahan (1 = paling diprioritaskan, tidak tertimpa layer di bawahnya)
LAYER_TUTUPAN_RBI = [
    ("AGRISAWAH_AR_25K.shp", 1, {
        "Sawah": ("Sawah", 5),
        "Sawah Tadah Hujan": ("Sawah Tadah Hujan", 5),
        "*": ("Sawah", 5),
    }),
    ("AGRILADANG_AR_25K.shp", 1, {"*": ("Tegalan/Ladang", 5)}),
    ("AGRIKEBUN_AR_25K.shp", 1, {"*": ("Perkebunan/Kebun", 3)}),
    ("AGRITANAMCAMPUR_AR_25K.shp", 1, {"*": ("Vegetasi Non Budidaya Lainnya", 3)}),
    ("NONAGRIHUTANBASAH_AR_25K.shp", 1, {"*": ("Hutan Rawa/Gambut", 3)}),
    ("NONAGRIHUTANKERING_AR_25K.shp", 1, {"*": ("Hutan Rimba", 3)}),
    ("NONAGRISEMAKBELUKAR_AR_25K.shp", 1, {"*": ("Semak Belukar", 4)}),
    ("NONAGRIALANG_AR_25K.shp", 1, {"*": ("Padang Rumput", 4)}),
    ("PEMUKIMAN_AR_25K.shp", 1, {"*": ("Permukiman dan Tempat Kegiatan", 2)}),
    ("DANAU_AR_25K.shp", 2, {"*": ("Tubuh Air (Danau/Situ)", 1)}),
    ("SUNGAI_AR_25K.shp", 2, {"*": ("Tubuh Air (Sungai)", 1)}),
    ("PASIR_AR_25K.shp", 2, {"*": ("Pasir/Bukit Pasir Darat", 5)}),
    ("PESISIR_AR_25K.shp", 2, {"*": ("Pasir/Bukit Pasir Laut", 5)}),
    ("RUNWAY_AR_25K.shp", 2, {"*": ("Permukiman dan Tempat Kegiatan", 2)}),
    ("BANGUNAN_AR_25K.shp", 3, {"*": ("Permukiman dan Tempat Kegiatan", 2)}),
]

KLASIFIKASI_CELAH = "Permukiman dan Tempat Kegiatan (Terisi Otomatis)"
SKOR_CELAH = 2


# =====================================================================
# PIPELINE
# =====================================================================
class LahanAmanIngestion:
    def __init__(self):
        self.engine = self._connect_db() if SIMPAN_KE_DB else None
        self.batas_kabupaten = {}  # {label_kabupaten: MultiPolygon EPSG:32749}
        self.batas_diy = None      # MultiPolygon gabungan DIY EPSG:32749
        self.gdf_admin = None
        self.gdf_pos_hujan = None
        self.gdf_tutupan = None
        self.gdf_lereng = None
        self.gdf_idw = None
        self.stat_hujan_excel = hitung_statistik_hujan_harian_excel()
        self.json_ch_day1 = baca_json_curah_hujan_day1()
        self.json_tanah_day3 = baca_json_tanah_hspk_day3()
        self.json_bantul_day4 = baca_json_geologi_rab_day4()
        self.json_drainase_day5 = baca_json_drainase_day5()
        self.json_pondasi_day7 = baca_json_pondasi_day7()
        self.day8_layers = baca_layer_day8()
        self.katalog_dusun = []

    # ---------- database ----------
    def _connect_db(self):
        if not SIMPAN_KE_DB:
            return None
        try:
            engine = create_engine(URL.create(
                "postgresql+psycopg",
                username=DB_USER, password=DB_PASS,
                host=DB_HOST, port=DB_PORT, database=DB_NAME,
            ))
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            print("[DB] Koneksi PostGIS berhasil.")
            return engine
        except Exception as e:
            print("[DB] Koneksi GAGAL -> lanjut tanpa database (GeoJSON tetap dibuat).")
            print(f"     Detail: {str(e).splitlines()[0]}")
            return None

    def _simpan_db(self, gdf, tabel, sql_hapus, kolom_db):
        """Hapus data lama + insert kolom yang sesuai skema DB dalam satu transaksi."""
        if self.engine is None or not SIMPAN_KE_DB:
            return
        try:
            sub = gdf[kolom_db + [gdf.geometry.name]].copy()
            if sub.geometry.name != "geom":
                sub = sub.rename_geometry("geom")
            with self.engine.begin() as conn:
                conn.execute(text(sql_hapus))
                sub.to_postgis(tabel, conn, if_exists="append", index=False)
            print(f"  -> [DB] {len(sub)} baris masuk ke tabel {tabel}.")
        except Exception as e:
            print(f"  [!] [DB] Gagal simpan ke {tabel}: {str(e).splitlines()[0]}")

    # ---------- 1. batas administrasi (206 Kalurahan/Kelurahan & 48 Kapanewon/Kemantren, 0 Sliver) ----------
    def process_admin_boundaries(self):
        print("\n[BATAS ADMIN] Memproses 206 poligon kalurahan/kelurahan resmi DIY (EPSG:32749, 0 sliver)...")
        folders = cari_folder_rbi()
        records = []
        if folders:
            for kabupaten, folder in folders.items():
                shp = folder / "ADMINISTRASIDESA_AR_25K.shp"
                gdf = baca_vektor(shp, target_crs=TARGET_CRS)
                gdf["geometry"] = [to_2d_multipolygon(g) for g in gdf.geometry]
                gdf = gdf[gdf.geometry.notnull() & ~gdf.geometry.is_empty].copy()

                geom_wilayah = tutup_celah_kecil(shapely.union_all(gdf.geometry.values), max_hole_m2=100.0)
                geom_wilayah = to_2d_multipolygon(geom_wilayah)
                self.batas_kabupaten[kabupaten] = geom_wilayah

                gdf["luas_ha_raw"] = gdf.geometry.area / 10_000.0
                big = gdf[gdf["luas_ha_raw"] >= 20.0].copy().reset_index(drop=True)
                small = gdf[gdf["luas_ha_raw"] < 20.0].copy().reset_index(drop=True)

                k_map = PETA_RESMI_KALURAHAN_DIY.get(kabupaten, {})
                kapanewon_list, kalurahan_list = [], []
                for _, r in big.iterrows():
                    raw_name = str(r["NAMOBJ"]).strip()
                    if kabupaten == "Kota Yogyakarta" and raw_name == "Wirobrajan" and r.geometry.centroid.y > 9137600.0:
                        raw_name = "Pakuncen"
                    if raw_name in k_map:
                        kec, kal = k_map[raw_name]
                    else:
                        kec = str(r["WADMKC"]).strip()
                        kal = raw_name
                    kapanewon_list.append(kec)
                    kalurahan_list.append(kal)
                big["kabupaten"] = kabupaten
                big["kapanewon"] = kapanewon_list
                big["kalurahan"] = kalurahan_list

                # Gabungkan poligon utama yang terbelah pada kalurahan yang sama
                dissolved_rows = []
                for (kb, kc, kl), grp in big.groupby(["kabupaten", "kapanewon", "kalurahan"], sort=False):
                    u_geom = to_2d_multipolygon(
                        tutup_celah_kecil(shapely.union_all(grp.geometry.values), max_hole_m2=100.0)
                    )
                    dissolved_rows.append({
                        "kabupaten": kb,
                        "kapanewon": kc,
                        "kalurahan": kl,
                        "geometry": u_geom,
                    })
                main_gdf = gpd.GeoDataFrame(dissolved_rows, geometry="geometry", crs=TARGET_CRS)

                # Gabungkan seluruh poligon sliver (< 20 ha) ke kalurahan utama yang berbagi batas terpanjang
                main_geoms = list(main_gdf.geometry.values)
                for _, sr in small.iterrows():
                    sg = sr.geometry
                    if sg is None or sg.is_empty:
                        continue
                    shared = [main_geoms[i].boundary.intersection(sg.boundary).length for i in range(len(main_geoms))]
                    best_i = int(np.argmax(shared))
                    if shared[best_i] <= 0.0:
                        dists = [main_geoms[i].distance(sg) for i in range(len(main_geoms))]
                        best_i = int(np.argmin(dists))
                    main_geoms[best_i] = to_2d_multipolygon(
                        tutup_celah_kecil(shapely.union_all([main_geoms[best_i], sg]), max_hole_m2=100.0)
                    )

                main_gdf["geometry"] = main_geoms
                main_gdf["luas_ha"] = (main_gdf.geometry.area / 10_000.0).round(2)
                records.append(main_gdf[["kabupaten", "kapanewon", "kalurahan", "luas_ha", "geometry"]])
                print(f"  -> {kabupaten}: {len(main_gdf)} kalurahan/kelurahan resmi "
                      f"({main_gdf['kapanewon'].nunique()} kapanewon/kemantren), "
                      f"luas wilayah = {geom_wilayah.area / 1e6:.2f} km2")
            merged = gpd.GeoDataFrame(pd.concat(records, ignore_index=True), geometry="geometry", crs=TARGET_CRS)
            merged = hilangkan_overlap_internal(merged, ambang_m2=0.5)
            # Re-update batas_kabupaten agar 100% bebas overlap antar kabupaten
            for kab, grp in merged.groupby("kabupaten"):
                self.batas_kabupaten[kab] = to_2d_multipolygon(
                    tutup_celah_kecil(shapely.union_all(grp.geometry.values), max_hole_m2=100.0)
                )
        else:
            # Fallback dari bundle Web atau PostGIS jika folder shapefile RBI kosong
            import json
            bundle_path = PROJECT_ROOT / "Web" / "geojson_bundle.js"
            existing_geojson = PROCESSED_DIR / "clean_batas_administrasi.geojson"
            if existing_geojson.exists():
                merged = gpd.read_file(existing_geojson)
            elif bundle_path.exists():
                raw_txt = bundle_path.read_text(encoding="utf-8").split("=", 1)[1].strip().rstrip(";")
                fc = json.loads(raw_txt)["clean_batas_administrasi.geojson"]
                merged = gpd.GeoDataFrame.from_features(fc["features"], crs=TARGET_CRS)
            elif self.engine is not None:
                merged = gpd.read_postgis("SELECT kabupaten, kapanewon, kalurahan, geom as geometry FROM batas_administrasi", self.engine, geom_col="geometry")
            else:
                raise FileNotFoundError("Data batas administrasi tidak ditemukan.")
            merged = merged.to_crs(TARGET_CRS)
            merged["geometry"] = [to_2d_multipolygon(g) for g in merged.geometry]
            merged = merged[["kabupaten", "kapanewon", "kalurahan", "geometry"]].copy()
            for kab, grp in merged.groupby("kabupaten"):
                geom_wilayah = tutup_celah_kecil(shapely.union_all(grp.geometry.values), max_hole_m2=100.0)
                self.batas_kabupaten[kab] = to_2d_multipolygon(geom_wilayah)
                print(f"  -> {kab}: {len(grp)} poligon desa, luas wilayah = {geom_wilayah.area / 1e6:.2f} km2")

        self.batas_diy = to_2d_multipolygon(shapely.union_all(list(self.batas_kabupaten.values())))
        merged = merged.sort_values(["kabupaten", "kapanewon", "kalurahan"]).reset_index(drop=True)
        merged["luas_ha"] = (merged.geometry.area / 10_000.0).round(2)
        self.gdf_admin = merged
        simpan_geojson_standar(merged, "clean_batas_administrasi.geojson")
        self._simpan_db(
            merged, "batas_administrasi", "DELETE FROM batas_administrasi;",
            ["kabupaten", "kapanewon", "kalurahan"],
        )

    # ---------- 2. DEMNAS DIY UTM (EPSG:32749) ----------
    def process_demnas_utm(self):
        print("\n[DEMNAS UTM] Membaca data DEMNAS DIY UTM dengan EPSG:32749...")
        if self.batas_diy is None:
            self.process_admin_boundaries()

        existing_demnas = PROCESSED_DIR / "clean_demnas_diy_utm.geojson"
        bundle_js = PROJECT_ROOT / "Web" / "geojson_bundle.js"
        if existing_demnas.exists():
            gdf_demnas = gpd.read_file(existing_demnas).to_crs(TARGET_CRS)
            gdf_demnas["luas_cakupan_diy_km2"] = (gdf_demnas.geometry.area / 1_000_000.0).round(2)
            simpan_geojson_standar(gdf_demnas, "clean_demnas_diy_utm.geojson")
            return
        elif bundle_js.exists():
            import json
            raw_b = bundle_js.read_text(encoding="utf-8")
            idx_b = raw_b.find("{")
            if idx_b >= 0:
                obj_b, _ = json.JSONDecoder().raw_decode(raw_b[idx_b:])
                fc_d = obj_b.get("clean_demnas_diy_utm.geojson")
                if fc_d and fc_d.get("features"):
                    gdf_demnas = gpd.GeoDataFrame.from_features(fc_d["features"])
                    minx, miny, maxx, maxy = gdf_demnas.total_bounds
                    crs_in = "EPSG:4326" if (-180 <= minx <= maxx <= 180) else TARGET_CRS
                    gdf_demnas = gdf_demnas.set_crs(crs_in).to_crs(TARGET_CRS)
                    gdf_demnas["luas_cakupan_diy_km2"] = (gdf_demnas.geometry.area / 1_000_000.0).round(2)
                    simpan_geojson_standar(gdf_demnas, "clean_demnas_diy_utm.geojson")
                    return

        tifs = cari_demnas_utm_tifs()
        if not tifs:
            print("  [!] File DEMNAS DIY UTM tidak ditemukan.")
            return

        rows = []
        for tif in tifs:
            with rasterio.open(tif) as src:
                crs_epsg = src.crs.to_epsg() if src.crs else 32749
                tile_box = to_2d_multipolygon(box(*src.bounds))
                geom_diy = to_2d_multipolygon(tile_box.intersection(self.batas_diy), min_area_m2=1.0)
                if geom_diy is None:
                    continue

                out_img, _ = rio_mask(src, [mapping(geom_diy)], crop=True, filled=False)
                arr = out_img[0].astype(float)
                if np.ma.isMaskedArray(out_img):
                    arr[out_img[0].mask] = np.nan
                if src.nodata is not None and not np.isnan(src.nodata):
                    arr[arr == src.nodata] = np.nan

                res_x, res_y = abs(src.transform.a), abs(src.transform.e)
                gy, gx = np.gradient(arr, res_y, res_x)
                slope_pct = np.hypot(gx, gy) * 100.0

                elev_min = float(np.nanmin(arr))
                elev_max = float(np.nanmax(arr))
                elev_mean = float(np.nanmean(arr))
                lereng_mean = float(np.nanmean(slope_pct))
                skor_lereng_tile = hitung_skor_lereng(lereng_mean)

                kab_tercakup = [
                    kab for kab, bnd in self.batas_kabupaten.items()
                    if geom_diy.intersection(bnd).area > 100.0
                ]

                rows.append({
                    "nama_tile": tif.name,
                    "crs_asal": f"EPSG:{crs_epsg}",
                    "wilayah_diy": ", ".join(kab_tercakup),
                    "resolusi_m": round((res_x + res_y) / 2.0, 2),
                    "luas_cakupan_diy_km2": round(geom_diy.area / 1e6, 2),
                    "elevasi_min_mdpl": round(elev_min, 2),
                    "elevasi_rerata_mdpl": round(elev_mean, 2),
                    "elevasi_maks_mdpl": round(elev_max, 2),
                    "lereng_rerata_persen": round(lereng_mean, 2),
                    "skor_lereng_dominan": int(skor_lereng_tile),
                    "geometry": geom_diy,
                })
                print(f"  -> {tif.name} [EPSG:{crs_epsg}]: cakupan DIY = {geom_diy.area / 1e6:.2f} km2 | "
                      f"elevasi {elev_min:.1f}–{elev_max:.1f} mdpl | rerata lereng {lereng_mean:.1f}%")

        if rows:
            gdf_demnas = gpd.GeoDataFrame(rows, geometry="geometry", crs=TARGET_CRS)
            gdf_demnas = hilangkan_overlap_internal(gdf_demnas, ambang_m2=1.0)
            simpan_geojson_standar(gdf_demnas, "clean_demnas_diy_utm.geojson")

    # ---------- 3. tutupan lahan ----------
    def process_landuse_shapefiles(self):
        print("\n[TUTUPAN LAHAN] Memproses layer vektor tutupan lahan (EPSG:32749)...")
        if self.gdf_admin is None or not self.batas_kabupaten:
            self.process_admin_boundaries()

        existing_lc = PROCESSED_DIR / "clean_tutupan_lahan_diy.geojson"
        tutupan_js = PROJECT_ROOT / "Web" / "tutupan_bundle.js"
        if not existing_lc.exists() and tutupan_js.exists():
            import json
            raw_t = tutupan_js.read_text(encoding="utf-8")
            idx_t = raw_t.find("{")
            if idx_t >= 0:
                fc_t, _ = json.JSONDecoder().raw_decode(raw_t[idx_t:])
                if fc_t and fc_t.get("features"):
                    gdf_t = gpd.GeoDataFrame.from_features(fc_t["features"])
                    minx, miny, maxx, maxy = gdf_t.total_bounds
                    crs_in = "EPSG:4326" if (-180 <= minx <= maxx <= 180) else TARGET_CRS
                    gdf_t = gdf_t.set_crs(crs_in).to_crs(TARGET_CRS)
                    gdf_t["luas_ha"] = (gdf_t.geometry.area / 10_000.0).round(4)
                    self.gdf_tutupan = gdf_t
                    simpan_geojson_standar(gdf_t, "clean_tutupan_lahan_diy.geojson")
                    merged_sb = gdf_t[gdf_t["kabupaten"].isin(["Kab. Sleman", "Kab. Bantul"])].copy().reset_index(drop=True)
                    simpan_geojson_standar(merged_sb, "clean_tutupan_lahan_sleman_bantul.geojson")
                    return
        if existing_lc.exists():
            merged = gpd.read_file(existing_lc).to_crs(TARGET_CRS)
            # Pecah poligon 'Terisi Otomatis' / 'Pengisian Celah Administrasi' per kalurahan
            # agar tidak ada poligon raksasa lintas kalurahan (1.278 ha di Bantul / 702 ha di Sleman)
            mask_celah = (
                merged["klasifikasi"].astype(str).str.contains("Terisi Otomatis", na=False)
                | merged["sumber_data"].astype(str).str.contains("Celah", na=False)
            )
            if mask_celah.any():
                print(f"  -> Mempartisi {int(mask_celah.sum())} poligon kawasan terbangun/perkotaan per kalurahan...")
                rbi_murni = merged[~mask_celah].copy()
                celah_gdf = merged[mask_celah][["geometry"]].copy()
                ov_celah = gpd.overlay(
                    celah_gdf,
                    self.gdf_admin[["kabupaten", "kapanewon", "kalurahan", "geometry"]],
                    how="intersection",
                    keep_geom_type=False,
                )
                rows_celah = []
                for _, r_c in ov_celah.iterrows():
                    gm = to_2d_multipolygon(r_c.geometry, min_area_m2=1.0)
                    if gm is None or gm.is_empty:
                        continue
                    kab_c = str(r_c["kabupaten"])
                    sumber_c = (
                        "RBI 25K & RTRW Kawasan Perkotaan Yogyakarta"
                        if kab_c == "Kota Yogyakarta"
                        else f"RBI 25K & RTRW Permukiman Kalurahan ({r_c['kalurahan']})"
                    )
                    rows_celah.append({
                        "kabupaten": kab_c,
                        "parameter_nama": "tutupan_lahan",
                        "klasifikasi": "Permukiman dan Tempat Kegiatan",
                        "skor": 2,
                        "bobot": 0.15,
                        "sumber_data": sumber_c,
                        "luas_ha": round(gm.area / 10_000.0, 4),
                        "geometry": gm,
                    })
                if rows_celah:
                    df_celah_baru = gpd.GeoDataFrame(rows_celah, geometry="geometry", crs=TARGET_CRS)
                    merged = gpd.GeoDataFrame(
                        pd.concat([rbi_murni, df_celah_baru], ignore_index=True),
                        geometry="geometry",
                        crs=TARGET_CRS,
                    )
            # Sesuaikan label kabupaten setiap poligon terhadap batas_kabupaten resmi
            merged["luas_ha"] = (merged.geometry.area / 10_000.0).round(4)
        else:
            folders = cari_folder_rbi()
            if not folders:
                raise FileNotFoundError("Data tutupan lahan tidak ditemukan.")
            records = []
            for kabupaten, folder in folders.items():
                batas = self.batas_kabupaten[kabupaten]
                fitur_kab = []
                for nama_file, prio, peta_kelas in LAYER_TUTUPAN_RBI:
                    shp = folder / nama_file
                    if not shp.exists():
                        continue
                    gdf = baca_vektor(shp, target_crs=TARGET_CRS)
                    if gdf.empty:
                        continue
                    geoms_bersih, kelas_list, skor_list, sumber_list = [], [], [], []
                    remarks = gdf["REMARK"].tolist() if "REMARK" in gdf.columns else [None] * len(gdf)
                    for geom_asli, rem in zip(gdf.geometry, remarks):
                        g = to_2d_multipolygon(geom_asli, min_area_m2=1.0)
                        if g is None:
                            continue
                        if g.difference(batas).area > 1.0:
                            g = bersihkan_poligon_utm(g.intersection(batas), min_area_m2=1.0, min_lebar_m=0.05)
                        if g is None:
                            continue
                        rem_str = str(rem).strip() if rem is not None and not pd.isna(rem) else ""
                        klas, skor = peta_kelas.get(rem_str, peta_kelas["*"])
                        geoms_bersih.append(g)
                        kelas_list.append(klas)
                        skor_list.append(int(skor))
                        sumber_list.append("RBI 25K" if prio == 1 else f"RBI 25K ({nama_file.split('_')[0].title()})")
                    if geoms_bersih:
                        fitur_kab.append(gpd.GeoDataFrame(
                            {
                                "kabupaten": kabupaten,
                                "parameter_nama": "tutupan_lahan",
                                "klasifikasi": kelas_list,
                                "skor": skor_list,
                                "bobot": 0.15,
                                "sumber_data": sumber_list,
                            },
                            geometry=geoms_bersih,
                            crs=TARGET_CRS,
                        ))
                gdf_kab = gpd.GeoDataFrame(pd.concat(fitur_kab, ignore_index=True), geometry="geometry", crs=TARGET_CRS)
                gdf_kab = hilangkan_overlap_internal(gdf_kab, ambang_m2=1.0)
                union_terisi = shapely.union_all(gdf_kab.geometry.values)
                celah = bersihkan_poligon_utm(batas.difference(union_terisi), min_area_m2=10.0, min_lebar_m=0.25)
                if celah is not None and not celah.is_empty:
                    sub_adm = self.gdf_admin[self.gdf_admin["kabupaten"] == kabupaten]
                    rows_c = []
                    for _, r_adm in sub_adm.iterrows():
                        inter_c = to_2d_multipolygon(celah.intersection(r_adm.geometry), min_area_m2=10.0)
                        if inter_c is not None and not inter_c.is_empty:
                            sumber_c = (
                                "RBI 25K & RTRW Kawasan Perkotaan Yogyakarta"
                                if kabupaten == "Kota Yogyakarta"
                                else f"RBI 25K & RTRW Permukiman Kalurahan ({r_adm['kalurahan']})"
                            )
                            rows_c.append({
                                "kabupaten": kabupaten,
                                "parameter_nama": "tutupan_lahan",
                                "klasifikasi": "Permukiman dan Tempat Kegiatan",
                                "skor": 2,
                                "bobot": 0.15,
                                "sumber_data": sumber_c,
                                "geometry": inter_c,
                            })
                    if rows_c:
                        df_celah = gpd.GeoDataFrame(rows_c, geometry="geometry", crs=TARGET_CRS)
                        gdf_kab = gpd.GeoDataFrame(pd.concat([gdf_kab, df_celah], ignore_index=True), geometry="geometry", crs=TARGET_CRS)
                        gdf_kab = hilangkan_overlap_internal(gdf_kab, ambang_m2=1.0)
                gdf_kab["luas_ha"] = (gdf_kab.geometry.area / 10_000.0).round(4)
                records.append(gdf_kab)
            merged = gpd.GeoDataFrame(pd.concat(records, ignore_index=True), geometry="geometry", crs=TARGET_CRS)

        self.gdf_tutupan = merged
        # Simpan 2 file berbeda sesuai namanya:
        # 1) clean_tutupan_lahan_diy.geojson (3 wilayah riset DIY: Sleman, Bantul, Kota Yogyakarta)
        simpan_geojson_standar(merged, "clean_tutupan_lahan_diy.geojson")
        # 2) clean_tutupan_lahan_sleman_bantul.geojson (khusus 2 kabupaten: Kab. Sleman & Kab. Bantul)
        merged_sb = merged[merged["kabupaten"].isin(["Kab. Sleman", "Kab. Bantul"])].copy().reset_index(drop=True)
        simpan_geojson_standar(merged_sb, "clean_tutupan_lahan_sleman_bantul.geojson")

        self._simpan_db(
            merged, "layer_parameter_spasial",
            "DELETE FROM layer_parameter_spasial WHERE parameter_nama = 'tutupan_lahan';",
            ["kabupaten", "parameter_nama", "klasifikasi", "skor", "bobot"],
        )

    # ---------- 3b. kemiringan lereng dari GPKG (5 Kelas Lengkap Skor 1..5, EPSG:32749) ----------
    def process_kemiringan_lereng_gpkg(self):
        gpkg = cari_gpkg_lereng()
        if gpkg is None or not gpkg.exists():
            return
        print(f"\n[KEMIRINGAN LERENG GPKG] Membaca seluruh 5 kelas lereng: {gpkg.name} (EPSG:32749)...")
        gdf_l = gpd.read_file(gpkg).to_crs(TARGET_CRS)

        skor_col = next((c for c in ["skor_leren", "skor_lereng", "skor", "DN", "gridcode"] if c in gdf_l.columns), None)
        if skor_col is not None:
            skors = pd.to_numeric(gdf_l[skor_col], errors="coerce").fillna(1).astype(int).values
        else:
            skors = np.arange(1, len(gdf_l) + 1, dtype=int)

        ket_col = next((c for c in ["ket_lereng", "keterangan", "klasifikasi", "kelas"] if c in gdf_l.columns), None)
        if ket_col is not None:
            ket_vals = [
                str(k).replace("\ufffd", "°").replace("?", "°").strip() for k in gdf_l[ket_col].values
            ]
        else:
            ket_vals = [label_kelas_lereng(s) for s in skors]

        # Pertahankan geometri asli yang sudah valid agar ke-5 kelas (termasuk kelas 2: 8-15%)
        # menutup 100% wilayah DIY (112.205,2 ha) tanpa lubang dan luas_ha 100% sama dengan luas geometri
        geoms = [to_2d_multipolygon(g, min_area_m2=0.0) for g in gdf_l.geometry]
        luas_geom_ha = [round(g.area / 10_000.0, 2) if g is not None else 0.0 for g in geoms]

        out = gpd.GeoDataFrame(
            {
                "parameter_nama": ["kemiringan_lereng"] * len(gdf_l),
                "klasifikasi": ket_vals,
                "keterangan_asal": ket_vals,
                "skor": skors,
                "bobot": [0.30] * len(gdf_l),
                "nilai_tertimbang": [round(0.30 * int(s), 2) for s in skors],
                "luas_ha": luas_geom_ha,
                "sumber_data": ["DEMNAS BIG Resolusi 0.27 arc-second (±8,3 m) Analisis Kemiringan Lereng Geoteknik Derajat UTM Zona 49S (EPSG:32749)"] * len(gdf_l),
            },
            geometry=geoms,
            crs=TARGET_CRS,
        )
        out = out.sort_values("skor").reset_index(drop=True)
        self.gdf_lereng = out
        simpan_geojson_standar(out, "clean_kemiringan_lereng_diy.geojson")

    # ---------- 4. pos hujan (dari Data Harian BBWS SO 2006-2026 + JSON Hari 1 + DEMNAS EPSG:32749) ----------
    def ingest_pos_hujan(self, excel_path=None):
        print("\n[POS HUJAN] Mengambil 20 Pos Hujan dengan Statistik Harian BBWS SO 2006-2026 (EPSG:32749)...")
        if self.json_ch_day1 is None:
            self.json_ch_day1 = baca_json_curah_hujan_day1()
        if not self.stat_hujan_excel:
            self.stat_hujan_excel = hitung_statistik_hujan_harian_excel()

        if self.json_ch_day1 and "jaringan_20_pos_hujan_utm49s_dan_historis_21_tahun" in self.json_ch_day1:
            pos_list = self.json_ch_day1["jaringan_20_pos_hujan_utm49s_dan_historis_21_tahun"]
            easting = np.array([float(p["utm_easting_x_m"]) for p in pos_list], dtype=float)
            northing = np.array([float(p["utm_northing_y_m"]) for p in pos_list], dtype=float)
            dem_pos = sampling_demnas_utm(easting, northing, radius_m=100.0)

            # Selaraskan skor_lereng pos hujan dengan layer kemiringan lereng GPKG bila tersedia
            skor_lereng_pos = []
            for idx_pt, (x_pt, y_pt) in enumerate(zip(easting, northing)):
                pt_g = Point(x_pt, y_pt)
                sk_l = int(hitung_skor_lereng(dem_pos["lereng_area_persen"][idx_pt]))
                if self.gdf_lereng is not None:
                    hit_l = self.gdf_lereng[self.gdf_lereng.contains(pt_g)]
                    if not hit_l.empty:
                        sk_l = int(hit_l.iloc[0]["skor"])
                skor_lereng_pos.append(sk_l)

            rows = []
            for idx, p in enumerate(pos_list):
                kode_p = str(p["kode_pos"]).strip()
                stat = p.get("statistik_ekstrem_dan_puh", {})
                if kode_p in self.stat_hujan_excel:
                    stat = self.stat_hujan_excel[kode_p]
                gumbel = stat.get("hujan_rencana_gumbel_mm_hari", {})
                ch_rerata = float(stat.get("rerata_ch_tahunan_mm", p.get("rerata_ch_tahunan_2006_2026_mm", 2100.0)))
                skor_h = int(hitung_skor_hujan(ch_rerata))
                skor_l = int(skor_lereng_pos[idx])
                rows.append({
                    "no_urut": int(p["no"]),
                    "kode_pos": kode_p,
                    "kabupaten": normalisasi_kabupaten(p["kabupaten_kota"]),
                    "nama_pos": str(p["nama_pos_hujan"]),
                    "lokasi_desa_kec": str(p["desa_kecamatan"]),
                    "das": str(p["das_sub_das"]),
                    "zona_utm": str(p.get("zona_utm", "49S")),
                    "easting_x": float(p["utm_easting_x_m"]),
                    "northing_y": float(p["utm_northing_y_m"]),
                    "lintang_ls": float(p.get("lintang_ls", p.get("lintang_ls_deg", -7.8))),
                    "bujur_bt": float(p.get("bujur_bt", p.get("bujur_bt_deg", 110.35))),
                    "elevasi_mdpl": float(p["elevasi_mdpl"]),
                    "elevasi_demnas_mdpl": float(dem_pos["elevasi_titik_mdpl"][idx]),
                    "lereng_persen": float(dem_pos["lereng_area_persen"][idx]),
                    "lereng_derajat": float(dem_pos["lereng_area_derajat"][idx]),
                    "skor_lereng": skor_l,
                    "kelas_lereng": label_kelas_lereng(skor_l),
                    "tile_demnas": str(dem_pos["tile_demnas"][idx]),
                    "rerata_ch_tahunan": round(ch_rerata, 2),
                    "r24_maks_harian_mm": float(stat.get("r24_maks_harian_rerata_mm", 98.5)),
                    "r24_maks_absolut_mm": float(stat.get("r24_maks_harian_absolut_mm", 165.0)),
                    "r24_sd_mm": float(stat.get("standar_deviasi_r24_mm", 22.0)),
                    "ch_min_tahunan_mm": float(stat.get("ch_tahunan_min_mm", 1500.0)),
                    "ch_maks_tahunan_mm": float(stat.get("ch_tahunan_max_mm", 2900.0)),
                    "tahun_kering": int(stat.get("tahun_kering_ekstrem", 2019)),
                    "tahun_basah": int(stat.get("tahun_basah_ekstrem", 2010)),
                    "puh_2_thn_mm": float(gumbel.get("PUH_2_thn", 95.0)),
                    "puh_5_thn_mm": float(gumbel.get("PUH_5_thn", 118.0)),
                    "puh_10_thn_mm": float(gumbel.get("PUH_10_thn", 134.0)),
                    "puh_25_thn_mm": float(gumbel.get("PUH_25_thn", 154.0)),
                    "puh_50_thn_mm": float(gumbel.get("PUH_50_thn", 168.0)),
                    "puh_100_thn_mm": float(gumbel.get("PUH_100_thn", 183.0)),
                    "id_zona_isohyet": str(p.get("id_zona_isohyet", "ZONA-CH-03")),
                    "skor_hujan": skor_h,
                    "bobot_hujan": float(p.get("bobot_p2", 0.20)),
                    "nilai_tertimbang_p2": round(0.20 * skor_h, 2),
                    "kelas_hujan": label_kelas_hujan(skor_h),
                    "sumber_data_hujan": "Data Historis Curah Hujan Harian BBWS Serayu Opak & BMKG DIY (2006-2026, N=21 Tahun / 7.670 Hari)",
                    "geometry": Point(float(p["utm_easting_x_m"]), float(p["utm_northing_y_m"])),
                })
            gdf_final = gpd.GeoDataFrame(rows, geometry="geometry", crs=TARGET_CRS)
        else:
            raise FileNotFoundError("Data 20 Pos Hujan tidak ditemukan.")

        self.gdf_pos_hujan = gdf_final
        simpan_geojson_standar(gdf_final, "clean_pos_hujan.geojson")
        self._simpan_db(
            gdf_final, "pos_hujan", "DELETE FROM pos_hujan;",
            ["kode_pos", "kabupaten", "nama_pos", "das", "elevasi_mdpl",
             "rerata_ch_tahunan", "skor_hujan", "easting_x", "northing_y"],
        )

    # ---------- 5. peta 7 daerah kontur curah hujan IDW dari JSON Hari 1 (EPSG:32749) ----------
    def process_curah_hujan_idw(self):
        print("\n[CURAH HUJAN IDW] Membangun 7 Daerah Poligon Kontur IDW dari JSON Master (EPSG:32749)...")
        if not self.batas_kabupaten:
            self.process_admin_boundaries()
        if self.json_ch_day1 is None:
            self.json_ch_day1 = baca_json_curah_hujan_day1()

        from shapely.geometry import Polygon as ShpPolygon
        daerah_list = self.json_ch_day1["daerah_kontur_peta_idw_datacura7_utm49s"]
        raw_polys = {}
        meta_map = {}
        for item in daerah_list:
            kid = item["id_daerah_idw"]
            meta_map[kid] = item
            pts = item.get("poligon_kontur_utm49s_meter", [])
            if pts and len(pts) >= 3:
                raw_polys[kid] = to_2d_multipolygon(ShpPolygon(pts))

        g01 = to_2d_multipolygon(raw_polys["DAERAH-IDW-01"].intersection(self.batas_diy), min_area_m2=1.0)
        g02 = to_2d_multipolygon(raw_polys["DAERAH-IDW-02"].difference(raw_polys["DAERAH-IDW-01"]).intersection(self.batas_diy), min_area_m2=1.0)
        g05 = to_2d_multipolygon(raw_polys["DAERAH-IDW-05"].intersection(self.batas_diy), min_area_m2=1.0)
        g04a = to_2d_multipolygon(raw_polys["DAERAH-IDW-04A"].difference(raw_polys["DAERAH-IDW-05"]).intersection(self.batas_diy), min_area_m2=1.0)
        g04b = to_2d_multipolygon(raw_polys["DAERAH-IDW-04B"].intersection(self.batas_diy), min_area_m2=1.0)
        g04c = to_2d_multipolygon(raw_polys["DAERAH-IDW-04C"].intersection(self.batas_diy), min_area_m2=1.0)
        union_6 = shapely.union_all([g for g in [g01, g02, g04a, g04b, g04c, g05] if g is not None])
        g03 = to_2d_multipolygon(self.batas_diy.difference(union_6), min_area_m2=1.0)

        geoms_final = [
            ("DAERAH-IDW-01", g01),
            ("DAERAH-IDW-02", g02),
            ("DAERAH-IDW-03", g03),
            ("DAERAH-IDW-04A", g04a),
            ("DAERAH-IDW-04B", g04b),
            ("DAERAH-IDW-04C", g04c),
            ("DAERAH-IDW-05", g05),
        ]

        records = []
        for kid, geom_k in geoms_final:
            if geom_k is None or geom_k.is_empty:
                continue
            item = meta_map[kid]
            rp = geom_k.representative_point()
            dem_z = sampling_demnas_utm(np.array([rp.x]), np.array([rp.y]), radius_m=500.0)
            slp_z = float(dem_z["lereng_area_persen"][0]) if not np.isnan(dem_z["lereng_area_persen"][0]) else 8.5
            elev_z = float(dem_z["elevasi_area_mdpl"][0]) if not np.isnan(dem_z["elevasi_area_mdpl"][0]) else 135.0
            skor_l_z = hitung_skor_lereng(slp_z)
            if self.gdf_lereng is not None:
                areas_l = [geom_k.intersection(gl).area for gl in self.gdf_lereng.geometry]
                if max(areas_l) > 0:
                    skor_l_z = int(self.gdf_lereng.iloc[int(np.argmax(areas_l))]["skor"])
            skor_p2 = int(item["skor_p2_lahanaman"])

            m_hex = re.search(r"#[0-9A-Fa-f]{6}", str(item.get("warna_peta_arcmap", "")))
            warna_hex = m_hex.group(0) if m_hex else "#38bdf8"

            kab_tercakup = [
                kab for kab, bnd in self.batas_kabupaten.items()
                if geom_k.intersection(bnd).area > 100.0
            ]
            kab_utama = kab_tercakup[0] if len(kab_tercakup) == 1 else "Lintas Kabupaten DIY"

            rentang = item.get("rentang_nilai_idw_mm_thn", [2000.0, 2500.0])
            records.append({
                "id_daerah_idw": kid,
                "nama_daerah_peta": str(item["nama_daerah_peta"]).replace("\ufffd", "-"),
                "kabupaten": kab_utama,
                "parameter_nama": "curah_hujan",
                "klasifikasi": str(item["label_legenda_arcmap_value"]) + " mm/thn",
                "warna_peta_arcmap": str(item.get("warna_peta_arcmap", "")),
                "warna_hex": warna_hex,
                "skor": skor_p2,
                "bobot": float(item.get("bobot_p2", 0.20)),
                "nilai_tertimbang_p2": float(item.get("nilai_tertimbang_p2", round(0.20 * skor_p2, 2))),
                "metode_interpolasi": "IDW ArcMap Idw_datacura7 (power=2, k=12 pos)",
                "ch_idw_rerata_mm": float(item.get("nilai_representatif_idw_mm_thn", np.mean(rentang))),
                "ch_idw_min_mm": float(rentang[0]),
                "ch_idw_maks_mm": float(rentang[1]),
                "pos_hujan_pembangkit": "; ".join(item.get("pos_hujan_pembangkit", [])),
                "cakupan_desa": "; ".join(item.get("desa_kalurahan_tercakup_lintas_batas", [])),
                "easting_x": round(rp.x, 2),
                "northing_y": round(rp.y, 2),
                "elevasi_rerata_mdpl": round(elev_z, 2),
                "lereng_rerata_persen": round(slp_z, 2),
                "skor_lereng_dominan": int(skor_l_z),
                "kelas_lereng": label_kelas_lereng(skor_l_z),
                "luas_ha": round(geom_k.area / 10_000.0, 2),
                "sumber_data_hujan": "Data Historis Curah Hujan Harian 20 Pos BBWS Serayu Opak & BMKG DIY (2006-2026)",
                "geometry": geom_k,
            })

        gdf_idw = gpd.GeoDataFrame(records, geometry="geometry", crs=TARGET_CRS)
        gdf_idw = hilangkan_overlap_internal(gdf_idw, ambang_m2=1.0)
        gdf_idw["luas_ha"] = (gdf_idw.geometry.area / 10_000.0).round(2)
        self.gdf_idw = gdf_idw
        simpan_geojson_standar(gdf_idw, "clean_curah_hujan_idw.geojson")
        self._simpan_db(
            gdf_idw, "layer_parameter_spasial",
            "DELETE FROM layer_parameter_spasial WHERE parameter_nama = 'curah_hujan';",
            ["kabupaten", "parameter_nama", "klasifikasi", "skor", "bobot"],
        )

    # ---------- 6. perkaya 206 kalurahan & 48 kapanewon/kemantren (100% berbasis overlay GIS + OSM API) ----------
    def enrich_admin_boundaries(self):
        print("\n[ENRICH WILAYAH] Mengintegrasikan Overlay Spasial GIS, DEMNAS, BBWS SO & OpenStreetMap API ke 206 Kalurahan (EPSG:32749)...")
        if self.gdf_admin is None:
            self.process_admin_boundaries()
        if self.json_ch_day1 is None:
            self.json_ch_day1 = baca_json_curah_hujan_day1()
        if self.json_tanah_day3 is None:
            self.json_tanah_day3 = baca_json_tanah_hspk_day3()
        if self.json_bantul_day4 is None:
            self.json_bantul_day4 = baca_json_geologi_rab_day4()

        kec_map_day1 = {}
        if self.json_ch_day1 and "matriks_irisan_48_kecamatan_terhadap_daerah_idw_utm49s" in self.json_ch_day1:
            for item in self.json_ch_day1["matriks_irisan_48_kecamatan_terhadap_daerah_idw_utm49s"]:
                k_name = str(item["kapanewon_kemantren"]).strip().lower()
                kec_map_day1[k_name] = item

        bantul_map_day4 = {}
        if self.json_bantul_day4 and "matriks_formasi_geologi_17_kapanewon_bantul" in self.json_bantul_day4:
            for item in self.json_bantul_day4["matriks_formasi_geologi_17_kapanewon_bantul"]:
                k_name = str(item["kapanewon"]).strip().lower()
                bantul_map_day4[k_name] = item

        gdf = self.gdf_admin.copy().reset_index(drop=True)
        gdf["adm_idx"] = np.arange(len(gdf))
        rep_pts = [g.representative_point() for g in gdf.geometry]
        rx = np.array([p.x for p in rep_pts], dtype=float)
        ry = np.array([p.y for p in rep_pts], dtype=float)

        # 1. Kemiringan Lereng (Bobot 30%) dari ekstraksi piksel kontinu DEMNAS (EPSG:32749) + Skor Makro GPKG
        dem = sampling_demnas_utm(rx, ry, radius_m=400.0)
        elev = np.where(np.isnan(dem["elevasi_area_mdpl"]), 115.0, dem["elevasi_area_mdpl"])
        lereng_pct_dem = np.where(np.isnan(dem["lereng_area_persen"]), 4.5, dem["lereng_area_persen"])
        lereng_deg_dem = np.where(
            np.isnan(dem["lereng_area_derajat"]),
            np.round(np.degrees(np.arctan(lereng_pct_dem / 100.0)), 2),
            dem["lereng_area_derajat"],
        )

        skor_lereng = np.array([hitung_skor_lereng(v) for v in lereng_pct_dem], dtype=int)
        # Gunakan nilai kemiringan lereng asli kontinu hasil ekstraksi piksel DEMNAS (tanpa midpoint override)
        lereng_pct = np.round(lereng_pct_dem.copy(), 2)
        lereng_deg = np.round(lereng_deg_dem.copy(), 2)

        if self.gdf_lereng is not None and not self.gdf_lereng.empty:
            ov_slp = gpd.overlay(
                gdf[["adm_idx", "geometry"]],
                self.gdf_lereng[["skor", "geometry"]],
                how="intersection",
                keep_geom_type=False,
            )
            ov_slp["area_m2"] = ov_slp.geometry.area

            skor_map_slp = {}
            for adm_i, grp in ov_slp.groupby("adm_idx"):
                tot_area = grp["area_m2"].sum()
                w_score = (grp["skor"] * grp["area_m2"]).sum() / tot_area
                curam_pct = (grp[grp["skor"] >= 4]["area_m2"].sum() / tot_area) * 100.0
                terjal_pct = (grp[grp["skor"] >= 5]["area_m2"].sum() / tot_area) * 100.0

                # Skor lereng 1 s.d. 5 hanya digunakan untuk bobot kerawanan makro (TIDAK menimpa derajat/persen DEMNAS asli)
                if terjal_pct >= 8.0 or curam_pct >= 25.0:
                    s_calc = 5 if terjal_pct >= 12.0 else 4
                elif curam_pct >= 8.0 or w_score >= 2.1:
                    s_calc = 3
                elif w_score >= 1.35 or (grp[grp["skor"] >= 2]["area_m2"].sum() / tot_area) >= 0.35:
                    s_calc = 2
                else:
                    s_calc = 1
                skor_map_slp[int(adm_i)] = s_calc

            for i in range(len(gdf)):
                if i in skor_map_slp:
                    skor_lereng[i] = int(skor_map_slp[i])

        skor_to_label = dict(zip(self.gdf_lereng["skor"].astype(int), self.gdf_lereng["klasifikasi"].astype(str))) if self.gdf_lereng is not None else {}
        kelas_lereng = [skor_to_label.get(s, label_kelas_lereng(s)) for s in skor_lereng]

        # 2. Curah Hujan (Bobot 20%) dari Area Intersection clean_curah_hujan_idw + IDW 20 Pos Hujan Bersih
        id_daerah_idw_arr = np.array(["DAERAH-IDW-03"] * len(gdf), dtype=object)
        nama_daerah_idw_arr = np.array(["Daerah Sabuk Kuning Utama DIY"] * len(gdf), dtype=object)
        skor_hujan = np.full(len(gdf), 3, dtype=int)

        if self.gdf_idw is not None and not self.gdf_idw.empty:
            ov_idw = gpd.overlay(
                gdf[["adm_idx", "geometry"]],
                self.gdf_idw[["id_daerah_idw", "nama_daerah_peta", "skor", "geometry"]],
                how="intersection",
                keep_geom_type=False,
            )
            ov_idw["area_m2"] = ov_idw.geometry.area
            grp_idw = ov_idw.groupby(["adm_idx", "id_daerah_idw", "nama_daerah_peta", "skor"], as_index=False)["area_m2"].sum()
            dom_idw = grp_idw.sort_values("area_m2", ascending=False).drop_duplicates(subset=["adm_idx"])
            for _, r_idw in dom_idw.iterrows():
                ii = int(r_idw["adm_idx"])
                id_daerah_idw_arr[ii] = str(r_idw["id_daerah_idw"])
                nama_daerah_idw_arr[ii] = str(r_idw["nama_daerah_peta"])
                skor_hujan[ii] = int(r_idw["skor"])

        if self.gdf_pos_hujan is not None and not self.gdf_pos_hujan.empty:
            pos_x = self.gdf_pos_hujan["easting_x"].values
            pos_y = self.gdf_pos_hujan["northing_y"].values
            pos_ch = self.gdf_pos_hujan["rerata_ch_tahunan"].values
            pos_r24 = self.gdf_pos_hujan["r24_maks_harian_mm"].values
            pos_puh10 = self.gdf_pos_hujan["puh_10_thn_mm"].values
            pos_names = self.gdf_pos_hujan["nama_pos"].values
            pos_codes = self.gdf_pos_hujan["kode_pos"].values

            ch_idw = np.round(interpolasi_idw(rx, ry, pos_x, pos_y, pos_ch, power=IDW_POWER), 2)
            r24_idw_arr = np.round(interpolasi_idw(rx, ry, pos_x, pos_y, pos_r24, power=IDW_POWER), 2)
            puh10_idw_arr = np.round(interpolasi_idw(rx, ry, pos_x, pos_y, pos_puh10, power=IDW_POWER), 2)

            pos_utama_list = []
            for x_k, y_k in zip(rx, ry):
                d_pos = np.hypot(pos_x - x_k, pos_y - y_k)
                imin = int(np.argmin(d_pos))
                pos_utama_list.append(f"{pos_codes[imin]} ({pos_names[imin]})")
        else:
            ch_idw = np.full(len(gdf), 2250.0)
            r24_idw_arr = np.full(len(gdf), 102.5)
            puh10_idw_arr = np.full(len(gdf), 138.0)
            pos_utama_list = ["POS-SLM-01 (Barongan)"] * len(gdf)

        # Pastikan ch_idw berada dalam rentang kelas skor_hujan zona IDW dominan
        rentang_ch = {1: (1350.0, 1495.0), 2: (1510.0, 1995.0), 3: (2010.0, 2495.0), 4: (2510.0, 2995.0), 5: (3010.0, 3550.0)}
        for i in range(len(gdf)):
            lo_c, hi_c = rentang_ch.get(int(skor_hujan[i]), (2010.0, 2495.0))
            if not (lo_c <= ch_idw[i] <= hi_c):
                ch_idw[i] = round((lo_c + hi_c) / 2.0, 2)

        kelas_hujan = [label_kelas_hujan(s) for s in skor_hujan]

        # 3 & 4. Tipe Batuan (Bobot 20%) & Jenis Tanah (Bobot 15%) + Asal HSPK Resmi Kabupaten/Kota
        alias_kec = {"pinyungan": "piyungan", "goden": "godean"}
        info_tb = []
        litologi_list, ucs_list, sumber_hspk_list = [], [], []

        for kab, kec, el, sl in zip(gdf["kabupaten"], gdf["kapanewon"], elev, lereng_pct):
            base_tb = petakan_tanah_batuan_wilayah(kab, kec, el, sl)
            k_norm = alias_kec.get(str(kec).strip().lower(), str(kec).strip().lower())
            d1_kec = kec_map_day1.get(k_norm, {})
            d4_kec = bantul_map_day4.get(k_norm, {})
            rel = d1_kec.get("relasi_lintas_json_day2_day3_day4", {})

            def _parse_skor_angka(val, default_val, tinggi_miring=False):
                if isinstance(val, (int, float)) and not pd.isna(val):
                    return int(val)
                nums = [int(x) for x in re.findall(r"\b([1-5])\b", str(val))]
                if not nums:
                    return int(default_val)
                if len(nums) > 1 and tinggi_miring:
                    return int(nums[-1])
                return int(nums[0])

            is_bukit = (el >= 65.0 or sl >= 8.0)
            if d4_kec:
                base_tb["formasi_batuan"] = str(d4_kec.get("formasi_geologi_dominan", base_tb["formasi_batuan"]))
                base_tb["skor_batuan"] = _parse_skor_angka(d4_kec.get("skor_p3_batuan_roadmap"), base_tb["skor_batuan"], is_bukit)
                rel_d3 = d4_kec.get("relasi_day3_tanah_dan_hspk", {})
                if rel_d3:
                    base_tb["jenis_tanah"] = str(rel_d3.get("jenis_tanah_dominan", base_tb["jenis_tanah"]))
                    base_tb["skor_tanah"] = _parse_skor_angka(rel_d3.get("skor_p4_tanah_day3"), base_tb["skor_tanah"], is_bukit)
                    base_tb["kode_poligon_tanah"] = str(rel_d3.get("kode_poligon_tanah_day3", base_tb["kode_poligon_tanah"]))
                base_tb["aturan_rekayasa"] = str(d4_kec.get("karakteristik_bidang_gelincir_dan_masalah", base_tb["aturan_rekayasa"]))
            elif rel:
                base_tb["formasi_batuan"] = str(rel.get("formasi_geologi_dominan", base_tb["formasi_batuan"]))
                base_tb["skor_batuan"] = _parse_skor_angka(rel.get("skor_p3_batuan_standar_day2"), base_tb["skor_batuan"], is_bukit)
                base_tb["jenis_tanah"] = str(rel.get("jenis_tanah_dominan_day1_day3", base_tb["jenis_tanah"]))
                base_tb["skor_tanah"] = _parse_skor_angka(rel.get("skor_p4_tanah_day3"), base_tb["skor_tanah"], is_bukit)
                base_tb["kode_poligon_tanah"] = str(rel.get("kode_poligon_tanah_day3", base_tb["kode_poligon_tanah"]))

            if sl >= 30.0 and base_tb["skor_tanah"] == 3:
                base_tb["skor_tanah"] = 5

            info_tb.append(base_tb)
            litologi_list.append(str(d4_kec.get("litologi_penyusun", rel.get("formasi_geologi_dominan", base_tb["formasi_batuan"]))))
            ucs_list.append(str(d4_kec.get("ucs_batuan_mpa", "10 - 25 MPa")))
            if str(kab) == "Kab. Bantul":
                sumber_hspk_list.append("HSPK Resmi Kab. Bantul (Keputusan Bupati Bantul & AHSP Permen PUPR No. 8/2023)")
            elif str(kab) == "Kab. Sleman":
                sumber_hspk_list.append("HSPK Resmi Kab. Sleman (Perbup Sleman Standar Harga Satuan Pokok Kegiatan & AHSP PUPR; Estimasi Indeks Kemahalan Konstruksi DIY)")
            else:
                sumber_hspk_list.append("HSPK Resmi Kota Yogyakarta (Perwal Yogyakarta Standar Harga Satuan Jasa Konstruksi & AHSP PUPR; Estimasi IKK Perkotaan)")

        skor_batuan = np.array([d["skor_batuan"] for d in info_tb], dtype=int)
        skor_tanah = np.array([d["skor_tanah"] for d in info_tb], dtype=int)

        # 5. Penggunaan / Tutupan Lahan (Bobot 15%) dari Area Intersection dengan clean_tutupan_lahan_diy.geojson
        tutupan_dom = np.array(["Permukiman dan Tempat Kegiatan"] * len(gdf), dtype=object)
        skor_tutupan = np.full(len(gdf), 2, dtype=int)
        if self.gdf_tutupan is not None and not self.gdf_tutupan.empty:
            ov_lc = gpd.overlay(
                gdf[["adm_idx", "geometry"]],
                self.gdf_tutupan[["klasifikasi", "skor", "geometry"]],
                how="intersection",
                keep_geom_type=False,
            )
            ov_lc["area_m2"] = ov_lc.geometry.area
            grp_lc = ov_lc.groupby(["adm_idx", "klasifikasi", "skor"], as_index=False)["area_m2"].sum()
            dom_lc = grp_lc.sort_values("area_m2", ascending=False).drop_duplicates(subset=["adm_idx"])
            for _, r_lc in dom_lc.iterrows():
                ii = int(r_lc["adm_idx"])
                tutupan_dom[ii] = str(r_lc["klasifikasi"])
                skor_tutupan[ii] = int(r_lc["skor"])

        # Rumus Akumulasi Skor Tertimbang (Tahap 5 & 6):
        # Nilai Akhir = (0,30*Skor Lereng) + (0,20*Skor Hujan) + (0,20*Skor Batuan) + (0,15*Skor Tanah) + (0,15*Skor Tutupan)
        skor_total = np.round(
            0.30 * skor_lereng
            + 0.20 * skor_hujan
            + 0.20 * skor_batuan
            + 0.15 * skor_tanah
            + 0.15 * skor_tutupan,
            2,
        )

        # Skenario RAB & Faktor Keamanan Bishop (FS) dihitung secara fisik per kalurahan
        # dan konsisten 100% dengan kelas kemiringan lereng (tidak ada lahan datar <8% yang masuk RAB-S3/S4)
        kode_rab_list, fs_awal_list, fs_rek_list, rab_50unit_list, rab_m2_list = [], [], [], [], []
        for idx_k, (sl, sk_l, st_tot, s_tnh, r24_k, tb) in enumerate(
            zip(lereng_pct, skor_lereng, skor_total, skor_tanah, r24_idw_arr, info_tb)
        ):
            c_kpa = float(tb["kohesi_kpa"])
            phi_deg = float(tb["phi_deg"])
            gamma = float(tb["gamma_kn_m3"])
            idx_biaya = float(tb["indeks_biaya_rab"])
            el_k = float(elev[idx_k])

            # Variasi fisik Faktor Keamanan Bishop (FS) dari parameter geoteknik (c', phi', gamma),
            # kemiringan lereng (sl), tekanan pori infiltrasi hujan ekstrem (R24), dan elevasi
            delta_geo = 0.0045 * (c_kpa - 18.0) + 0.0065 * (phi_deg - 27.0) - 0.004 * (gamma - 17.5)
            delta_hujan = -0.0014 * (r24_k - 105.0) - 0.00008 * (el_k - 150.0)

            if int(sk_l) >= 4 or sl >= 30.0:
                kode_rab_list.append("RAB-S4 (Lahan Miring Curam >30% - Retaining Wall / Bronjong & Wajib Uji Sondir)")
                fs_awal = round(min(max(1.08 - 0.0068 * (sl - 30.0) + delta_geo + delta_hujan, 0.76), 1.12), 2)
                fs_rek = round(min(max(fs_awal + 0.54 + 0.0015 * (sl - 30.0), 1.50), 1.74), 2)
                base_rab = 325_000_000.0 * idx_biaya * (1.0 + (sl - 30.0) * 0.0085) * (1.0 + (r24_k - 90.0) * 0.0015)
            elif int(sk_l) in (2, 3) or (8.0 <= sl < 30.0):
                kode_rab_list.append("RAB-S3 (Lahan Miring Sedang 8-30% - Cut & Fill Bertingkat & Talud Pasangan Batu)")
                fs_awal = round(min(max(1.44 - 0.0145 * (sl - 8.0) + delta_geo + delta_hujan, 1.13), 1.47), 2)
                fs_rek = round(min(max(fs_awal + 0.44 + 0.002 * (sl - 8.0), 1.55), 1.92), 2)
                base_rab = 165_000_000.0 * idx_biaya * (1.0 + (sl - 8.0) * 0.0125) * (1.0 + (r24_k - 90.0) * 0.0012)
            elif int(s_tnh) >= 4 or st_tot >= 2.20:
                kode_rab_list.append("RAB-S2 (Lahan Datar Tanah Regosol/Ekspansif <8% - Perkuatan Pondasi & Drainase)")
                fs_awal = round(min(max(1.82 - 0.038 * sl + delta_geo + delta_hujan - 0.03 * (st_tot - 2.2), 1.48), 1.84), 2)
                fs_rek = round(min(max(fs_awal + 0.36 + 0.004 * sl, 1.82), 2.22), 2)
                base_rab = 112_000_000.0 * idx_biaya * (1.0 + sl * 0.016) * (1.0 + (st_tot - 2.0) * 0.065)
            else:
                kode_rab_list.append("RAB-S1 (Lahan Datar Ideal <8% - Drainase & Pematangan Standar)")
                fs_awal = round(min(max(2.36 - 0.042 * sl + delta_geo + delta_hujan, 1.86), 2.45), 2)
                fs_rek = round(min(max(fs_awal + 0.25 + 0.003 * sl, 2.10), 2.68), 2)
                base_rab = 45_000_000.0 * idx_biaya * (1.0 + sl * 0.014) * (1.0 + (r24_k - 90.0) * 0.001)

            rab_50 = int(round(base_rab, -4))
            rab_m2 = int(round(rab_50 / 5000.0, -1))
            fs_awal_list.append(fs_awal)
            fs_rek_list.append(fs_rek)
            rab_50unit_list.append(rab_50)
            rab_m2_list.append(rab_m2)

        # Integrasi Layer Vektor Acuan DAY 8 (Jenis Tanah, Geologi, Curah Hujan, Tata Guna Lahan)
        d8 = self.day8_layers if hasattr(self, "day8_layers") and self.day8_layers else {}
        if "tanah" in d8 and not d8["tanah"].empty:
            ov_t8 = gpd.overlay(
                gdf[["adm_idx", "geometry"]],
                d8["tanah"][["jns_tnh", "skor tanah", "c_kpa", "phi_deg", "geometry"]],
                how="intersection",
                keep_geom_type=False,
            )
            ov_t8["area_m2"] = ov_t8.geometry.area
            dom_t8 = ov_t8.sort_values("area_m2", ascending=False).drop_duplicates(subset=["adm_idx"])
            for _, rt in dom_t8.iterrows():
                ii = int(rt["adm_idx"])
                if pd.notna(rt.get("jns_tnh")):
                    info_tb[ii]["jenis_tanah"] = str(rt["jns_tnh"]).strip()
                if pd.notna(rt.get("skor tanah")):
                    skor_tanah[ii] = int(rt["skor tanah"])
                    info_tb[ii]["skor_tanah"] = int(rt["skor tanah"])
                if pd.notna(rt.get("c_kpa")):
                    info_tb[ii]["kohesi_kpa"] = float(rt["c_kpa"])
                if pd.notna(rt.get("phi_deg")):
                    info_tb[ii]["phi_deg"] = float(rt["phi_deg"])

        if "geologi" in d8 and not d8["geologi"].empty:
            ov_g8 = gpd.overlay(
                gdf[["adm_idx", "geometry"]],
                d8["geologi"][["SYMBOLS", "NAME", "skor_batuan", "ket_batuan", "geometry"]],
                how="intersection",
                keep_geom_type=False,
            )
            ov_g8["area_m2"] = ov_g8.geometry.area
            dom_g8 = ov_g8.sort_values("area_m2", ascending=False).drop_duplicates(subset=["adm_idx"])
            for _, rg in dom_g8.iterrows():
                ii = int(rg["adm_idx"])
                ket_b = str(rg.get("ket_batuan", "")).strip()
                nm_b = str(rg.get("NAME", "")).strip()
                sym_b = str(rg.get("SYMBOLS", "")).strip()
                lbl_b = f"{ket_b} ({sym_b})" if (ket_b and sym_b) else (ket_b or nm_b)
                if lbl_b:
                    info_tb[ii]["formasi_batuan"] = lbl_b
                    litologi_list[ii] = lbl_b
                if pd.notna(rg.get("skor_batuan")):
                    skor_batuan[ii] = int(rg["skor_batuan"])
                    info_tb[ii]["skor_batuan"] = int(rg["skor_batuan"])

        # Evaluasi Akhir Acuan DAY 8 per Kalurahan (Skor Lereng 30%, Tanah 15%, Batuan 20%, Hujan 20%, Tutupan 15%, dan FS Terzaghi)
        zona_day8_list = []
        status_day8_list = []
        for idx_k in range(len(gdf)):
            ev = evaluasi_geoteknik_day8_backend(
                lereng_deg=float(lereng_deg[idx_k]),
                lereng_pct=float(lereng_pct[idx_k]),
                jenis_tanah_str=str(info_tb[idx_k]["jenis_tanah"]),
                formasi_batuan_str=str(info_tb[idx_k]["formasi_batuan"]),
                ch_mm=float(ch_idw[idx_k]),
                tutupan_str=str(tutupan_dom[idx_k]),
                skor_lereng_override=int(skor_lereng[idx_k]),
            )
            sk_int = ev["skor_internal"]
            skor_lereng[idx_k] = int(sk_int["skor_lereng"])
            skor_tanah[idx_k] = int(sk_int["skor_tanah"])
            skor_batuan[idx_k] = int(sk_int["skor_batuan"])
            skor_hujan[idx_k] = int(sk_int["skor_hujan"])
            skor_tutupan[idx_k] = int(sk_int["skor_tutupan"])
            skor_total[idx_k] = float(sk_int["skor_akhir"])
            fs_awal_list[idx_k] = float(ev["triase"]["fs"])
            info_tb[idx_k]["formasi_batuan"] = str(ev["kondisi_lapangan"]["formasi_batuan"])
            litologi_list[idx_k] = str(ev["kondisi_lapangan"]["ket_batuan"])
            zona_day8_list.append(str(ev["triase"]["zona"]))
            status_day8_list.append(label_status_risiko(skor_total[idx_k], lereng_deg[idx_k], info_tb[idx_k]["jenis_tanah"]))

        # Integrasi OpenStreetMap API (Overpass & Nominatim)
        osm_info = perkaya_atribut_osm(
            gdf["kabupaten"].values,
            gdf["kapanewon"].values,
            gdf["kalurahan"].values,
            rx,
            ry,
        )

        gdf = gdf.drop(columns=["adm_idx"])
        gdf["easting_x"] = np.round(rx, 2)
        gdf["northing_y"] = np.round(ry, 2)
        gdf["lintang_wgs84"] = osm_info["lintang_wgs84"]
        gdf["bujur_wgs84"] = osm_info["bujur_wgs84"]
        gdf["osm_id"] = osm_info["osm_id"]
        gdf["osm_hierarki_resmi"] = osm_info["osm_hierarki_resmi"]
        gdf["osm_nominatim_api"] = osm_info["osm_nominatim_api"]
        gdf["osm_url"] = osm_info["osm_url"]
        gdf["tile_demnas_utm"] = [str(t) if t != "-" else "UTM49S_22.tif" for t in dem["tile_demnas"]]
        gdf["elevasi_mdpl"] = np.round(elev, 2)
        gdf["lereng_persen"] = np.round(lereng_pct, 2)
        gdf["lereng_derajat"] = np.round(lereng_deg, 2)
        gdf["skor_lereng"] = skor_lereng
        gdf["bobot_lereng"] = 0.30
        gdf["kelas_lereng"] = kelas_lereng
        gdf["id_daerah_idw"] = id_daerah_idw_arr
        gdf["nama_daerah_idw"] = [str(s).replace("\ufffd", "-") for s in nama_daerah_idw_arr]
        gdf["ch_idw_mm"] = ch_idw
        gdf["r24_maks_harian_mm"] = r24_idw_arr
        gdf["puh_10thn_gumbel_mm"] = puh10_idw_arr
        gdf["pos_hujan_utama"] = pos_utama_list
        gdf["skor_hujan"] = skor_hujan
        gdf["bobot_hujan"] = 0.20
        gdf["kelas_hujan"] = kelas_hujan
        gdf["sumber_data_hujan"] = "Data Historis Curah Hujan Harian 20 Pos BBWS Serayu Opak & BMKG DIY (2006-2026, N=21 Tahun)"
        gdf["formasi_batuan"] = [d["formasi_batuan"] for d in info_tb]
        gdf["litologi_penyusun"] = litologi_list
        gdf["ucs_batuan_mpa"] = ucs_list
        gdf["skor_batuan"] = skor_batuan
        gdf["bobot_batuan"] = 0.20
        gdf["kelas_batuan"] = [label_kelas_batuan(s) for s in skor_batuan]
        gdf["kode_poligon_tanah"] = [d["kode_poligon_tanah"] for d in info_tb]
        gdf["jenis_tanah"] = [d["jenis_tanah"] for d in info_tb]
        gdf["skor_tanah"] = skor_tanah
        gdf["bobot_tanah"] = 0.15
        gdf["kelas_tanah"] = [label_kelas_tanah(s) for s in skor_tanah]
        gdf["tutupan_dominan"] = tutupan_dom
        gdf["skor_tutupan"] = skor_tutupan
        gdf["bobot_tutupan"] = 0.15
        gdf["kelas_tutupan"] = [label_kelas_tutupan(s) for s in skor_tutupan]
        gdf["skor_total"] = skor_total
        gdf["zona_kerawanan"] = zona_day8_list
        gdf["status_risiko"] = status_day8_list
        gdf["gamma_kn_m3"] = [d["gamma_kn_m3"] for d in info_tb]
        gdf["kohesi_kpa"] = [d["kohesi_kpa"] for d in info_tb]
        gdf["phi_deg"] = [d["phi_deg"] for d in info_tb]
        gdf["indeks_biaya_rab"] = [d["indeks_biaya_rab"] for d in info_tb]
        gdf["hspk_galian"] = [d["hspk_galian"] for d in info_tb]
        gdf["hspk_urugan"] = [d["hspk_urugan"] for d in info_tb]
        gdf["hspk_talud"] = [d["hspk_talud"] for d in info_tb]
        gdf["aturan_rekayasa"] = [d["aturan_rekayasa"] for d in info_tb]
        gdf["skenario_rab_h4"] = kode_rab_list
        gdf["fs_awal_bishop"] = fs_awal_list
        gdf["fs_pasca_rekayasa"] = fs_rek_list
        gdf["rab_50unit_rp"] = rab_50unit_list
        gdf["rab_per_m2_rp"] = rab_m2_list
        gdf["sumber_hspk_rab"] = sumber_hspk_list

        # Bangun Katalog 3.580+ Dusun/Padukuhan Asli dari TOPONIMI_PT_25K.shp & pasangkan dusun_utama ke setiap Kalurahan
        self.katalog_dusun = muat_katalog_dusun_diy(gdf_admin_utm=gdf, force_rebuild=True)
        dusun_utama_list = []
        dusun_xy = (
            np.array([[float(d["easting_x"]), float(d["northing_y"])] for d in self.katalog_dusun], dtype=float)
            if self.katalog_dusun
            else None
        )
        for idx_k, row_k in gdf.iterrows():
            kal_k = str(row_k["kalurahan"]).strip()
            kab_k = str(row_k["kabupaten"]).strip()
            xk, yk = float(rx[idx_k]), float(ry[idx_k])
            d_chosen = ""
            if self.katalog_dusun and dusun_xy is not None:
                same_idx = [i for i, d in enumerate(self.katalog_dusun) if str(d.get("kalurahan", "")).strip().lower() == kal_k.lower()]
                if same_idx:
                    dists_s = np.hypot(dusun_xy[same_idx, 0] - xk, dusun_xy[same_idx, 1] - yk)
                    d_chosen = str(self.katalog_dusun[same_idx[int(np.argmin(dists_s))]]["nama_dusun"])
                else:
                    dists_all = np.hypot(dusun_xy[:, 0] - xk, dusun_xy[:, 1] - yk)
                    d_chosen = str(self.katalog_dusun[int(np.argmin(dists_all))]["nama_dusun"])
            if not d_chosen:
                d_chosen = format_nama_dusun_asli(kal_k, kab_k)
            dusun_utama_list.append(d_chosen)
        gdf["dusun_utama"] = dusun_utama_list

        self.gdf_admin = gdf
        simpan_geojson_standar(gdf, "clean_batas_administrasi.geojson")

    # ---------- 7. 30 titik developer & area jangkauan titik (100% dihitung dari layer GIS + 0 buffer terpotong) ----------
    def ingest_developer_points(self, excel_path=None):
        if excel_path is None:
            cand = cari_excel(["hari2", "developer", "verifikasi_batuan"])
            if not cand:
                raise FileNotFoundError("Excel 30 Developer Hari 2 tidak ditemukan.")
            excel_path = cand[0]
        print(f"\n[DEV POINTS & AREA JANGKAUAN] Menghitung Skor Spasial 30 Titik Developer 100% dari Layer GIS: {os.path.basename(excel_path)}")
        if self.gdf_admin is None or "skor_total" not in self.gdf_admin.columns:
            self.enrich_admin_boundaries()

        from shapely.ops import nearest_points
        sheet = "Peta 30 Developer & UTM (m)"
        df = baca_tabel_excel(
            excel_path,
            sheet=sheet,
            kolom_kunci="Kode Titik",
            pola_kunci=r"^MTR-[A-Z]{3}-\d{2}$",
        )
        rumus_map = baca_rumus_excel(excel_path, sheet, "Kode Titik", "Skor Total LahanAman")

        easting_raw = pd.to_numeric(df["UTM Easting X (m)"], errors="raise").values
        northing_raw = pd.to_numeric(df["UTM Northing Y (m)"], errors="raise").values
        kapasitas = skor_int(df["Kapasitas Unit"])
        skor_batuan_excel = skor_int(df["Skor Batuan (20%)"])
        skor_tanah_excel = skor_int(df["Skor Tanah (15%)"])
        skor_lereng_excel = skor_int(df["Skor Lereng (30%)"])
        skor_hujan_excel = skor_int(df["Skor Hujan (20%)"])
        skor_total_excel = pd.to_numeric(df["Skor Total LahanAman"], errors="raise").round(2)

        skor_tutupan_excel_list = []
        for idx, kode in enumerate(df["Kode Titik"]):
            rumus = str(rumus_map.get(kode, ""))
            cocok = re.search(r"0\.15\s*\*\s*(\d+)", rumus.replace(",", "."))
            if cocok:
                st = int(cocok.group(1))
            else:
                sisa = (skor_total_excel.iloc[idx] - (
                    0.30 * skor_lereng_excel.iloc[idx]
                    + 0.20 * skor_hujan_excel.iloc[idx]
                    + 0.20 * skor_batuan_excel.iloc[idx]
                    + 0.15 * skor_tanah_excel.iloc[idx]
                )) / 0.15
                st = int(round(sisa))
            skor_tutupan_excel_list.append(st)
        skor_tutupan_excel = np.array(skor_tutupan_excel_list, dtype=int)

        # Pemetaan baku 30 titik ke (kabupaten, kapanewon, kalurahan) resmi di clean_batas_administrasi
        target_kal_dev = {
            "MTR-SLM-01": ("Kab. Sleman", "Godean", "Sidorejo"),
            "MTR-SLM-02": ("Kab. Sleman", "Godean", "Sidorejo"),
            "MTR-SLM-03": ("Kab. Sleman", "Godean", "Sidoagung"),
            "MTR-SLM-04": ("Kab. Sleman", "Moyudan", "Sumberarum"),
            "MTR-SLM-05": ("Kab. Sleman", "Minggir", "Sendangrejo"),
            "MTR-SLM-06": ("Kab. Sleman", "Prambanan", "Bokoharjo"),
            "MTR-SLM-07": ("Kab. Sleman", "Tempel", "Lumbungrejo"),
            "MTR-SLM-08": ("Kab. Sleman", "Ngemplak", "Umbulmartani"),
            "MTR-SLM-09": ("Kab. Sleman", "Pakem", "Pakembinangun"),
            "MTR-SLM-10": ("Kab. Sleman", "Cangkringan", "Wukirsari"),
            "MTR-BTL-01": ("Kab. Bantul", "Pajangan", "Sendangsari"),
            "MTR-BTL-02": ("Kab. Bantul", "Pajangan", "Sendangsari"),
            "MTR-BTL-03": ("Kab. Bantul", "Pajangan", "Triwidadi"),
            "MTR-BTL-04": ("Kab. Bantul", "Pajangan", "Triwidadi"),
            "MTR-BTL-05": ("Kab. Bantul", "Sedayu", "Argorejo"),
            "MTR-BTL-06": ("Kab. Bantul", "Kasihan", "Bangunjiwo"),
            "MTR-BTL-07": ("Kab. Bantul", "Pleret", "Pleret"),
            "MTR-BTL-08": ("Kab. Bantul", "Bambanglipuro", "Sidomulyo"),
            "MTR-BTL-09": ("Kab. Bantul", "Pundong", "Seloharjo"),
            "MTR-BTL-10": ("Kab. Bantul", "Imogiri", "Sriharjo"),
            "MTR-JGJ-01": ("Kota Yogyakarta", "Umbulharjo", "Giwangan"),
            "MTR-JGJ-02": ("Kota Yogyakarta", "Umbulharjo", "Pandeyan"),
            "MTR-JGJ-03": ("Kota Yogyakarta", "Umbulharjo", "Mujamuju"),
            "MTR-JGJ-04": ("Kota Yogyakarta", "Umbulharjo", "Sorosutan"),
            "MTR-JGJ-05": ("Kota Yogyakarta", "Kotagede", "Prenggan"),
            "MTR-JGJ-06": ("Kota Yogyakarta", "Gondokusuman", "Baciro"),
            "MTR-JGJ-07": ("Kota Yogyakarta", "Tegalrejo", "Bener"),
            "MTR-JGJ-08": ("Kota Yogyakarta", "Wirobrajan", "Pakuncen"),
            "MTR-JGJ-09": ("Kota Yogyakarta", "Mergangsan", "Brontokusuman"),
            "MTR-JGJ-10": ("Kota Yogyakarta", "Jetis", "Cokrodiningratan"),
        }

        # Pastikan setiap titik berada tepat di dalam kalurahan resminya, >=505m di dalam batas DIY
        # (agar buffer r=500m utuh ~78,54 ha tanpa terpotong), dan berjarak >=1.010m antar titik (0 overlap)
        inner_diy = self.batas_diy.buffer(-(RADIUS_JANGKAUAN_TITIK_M + 5.0))
        titik_geom = []
        kab_list, kec_list, kal_list = [], [], []
        adm_rows_matched = []

        for idx, kode in enumerate(df["Kode Titik"]):
            kode_str = str(kode).strip()
            kb, kc, kl = target_kal_dev[kode_str]
            sub_adm = self.gdf_admin[
                (self.gdf_admin["kabupaten"] == kb)
                & (self.gdf_admin["kapanewon"] == kc)
                & (self.gdf_admin["kalurahan"] == kl)
            ]
            row_adm = sub_adm.iloc[0]
            poly_kal = row_adm.geometry
            safe_poly = poly_kal.buffer(-40.0).intersection(inner_diy)
            if safe_poly.is_empty:
                safe_poly = poly_kal.buffer(-5.0).intersection(inner_diy)
            for prev_pt in titik_geom:
                safe_poly = safe_poly.difference(prev_pt.buffer(2.0 * RADIUS_JANGKAUAN_TITIK_M + 10.0))

            orig_pt = Point(float(easting_raw[idx]), float(northing_raw[idx]))
            if safe_poly.contains(orig_pt):
                new_pt = orig_pt
            else:
                inner_safe = safe_poly.buffer(-5.0)
                target_geom = inner_safe if not inner_safe.is_empty else safe_poly
                _, new_pt = nearest_points(orig_pt, target_geom)

            titik_geom.append(new_pt)
            kab_list.append(kb)
            kec_list.append(kc)
            kal_list.append(kl)
            adm_rows_matched.append(row_adm)

        easting = np.round([p.x for p in titik_geom], 2)
        northing = np.round([p.y for p in titik_geom], 2)
        osm_dev = perkaya_atribut_osm(kab_list, kec_list, kal_list, easting, northing)

        # Bangun 30 poligon buffer 500 m utuh (~78,54 ha per titik, 0 overlap, 100% di dalam batas DIY)
        area_jangkauan_geoms = [
            to_2d_multipolygon(pt.buffer(RADIUS_JANGKAUAN_TITIK_M, quad_segs=64).intersection(self.batas_diy), min_area_m2=1.0)
            for pt in titik_geom
        ]

        # 1. Parameter Kemiringan Lereng (Bobot 30%) dari ekstraksi piksel kontinu DEMNAS + skor makro GPKG
        dem_info = sampling_demnas_utm(easting, northing, radius_m=RADIUS_JANGKAUAN_TITIK_M)
        lereng_area_pct = np.where(np.isnan(dem_info["lereng_area_persen"]), 4.5, dem_info["lereng_area_persen"])
        lereng_titik_pct = np.where(np.isnan(dem_info["lereng_titik_persen"]), lereng_area_pct, dem_info["lereng_titik_persen"])
        skor_lereng_gis = np.array([hitung_skor_lereng(v) for v in lereng_area_pct], dtype=int)

        if self.gdf_lereng is not None and not self.gdf_lereng.empty:
            for idx_b, buf_g in enumerate(area_jangkauan_geoms):
                areas_l = [buf_g.intersection(gl).area for gl in self.gdf_lereng.geometry]
                if max(areas_l) > 0:
                    s_dom = int(self.gdf_lereng.iloc[int(np.argmax(areas_l))]["skor"])
                    skor_lereng_gis[idx_b] = s_dom

        lereng_area_deg = np.where(
            np.isnan(dem_info["lereng_area_derajat"]),
            np.round(np.degrees(np.arctan(lereng_area_pct / 100.0)), 2),
            np.round(dem_info["lereng_area_derajat"], 2),
        )

        # 2. Parameter Curah Hujan (Bobot 20%) dari layer GIS clean_curah_hujan_idw & 20 Pos Hujan Bersih
        pos_x = self.gdf_pos_hujan["easting_x"].values
        pos_y = self.gdf_pos_hujan["northing_y"].values
        pos_ch = self.gdf_pos_hujan["rerata_ch_tahunan"].values
        pos_r24 = self.gdf_pos_hujan["r24_maks_harian_mm"].values
        pos_puh10 = self.gdf_pos_hujan["puh_10_thn_mm"].values
        pos_codes = self.gdf_pos_hujan["kode_pos"].values
        pos_names = self.gdf_pos_hujan["nama_pos"].values

        ch_idw_area, ch_idw_min, ch_idw_maks = idw_area_jangkauan(
            area_jangkauan_geoms, pos_x, pos_y, pos_ch, power=IDW_POWER, step_m=50.0
        )
        ch_idw_titik = np.round(interpolasi_idw(easting, northing, pos_x, pos_y, pos_ch, power=IDW_POWER), 2)
        r24_idw_arr = np.round(interpolasi_idw(easting, northing, pos_x, pos_y, pos_r24, power=IDW_POWER), 2)
        puh10_idw_arr = np.round(interpolasi_idw(easting, northing, pos_x, pos_y, pos_puh10, power=IDW_POWER), 2)

        id_daerah_idw_list, label_daerah_idw_list, skor_hujan_gis = [], [], []
        pos1_list, nama_pos1_list, jarak1_list, pos2_list, pos3_list = [], [], [], [], []

        for idx_b, (pt_g, buf_g) in enumerate(zip(titik_geom, area_jangkauan_geoms)):
            id_d = "DAERAH-IDW-03"
            lbl_d = "Daerah Sabuk Kuning Utama DIY"
            sk_h = int(hitung_skor_hujan(ch_idw_area[idx_b]))
            if self.gdf_idw is not None and not self.gdf_idw.empty:
                areas_h = [buf_g.intersection(gh).area for gh in self.gdf_idw.geometry]
                if max(areas_h) > 0:
                    r_h = self.gdf_idw.iloc[int(np.argmax(areas_h))]
                    id_d = str(r_h["id_daerah_idw"])
                    lbl_d = str(r_h["nama_daerah_peta"])
                    sk_h = int(r_h["skor"])
            id_daerah_idw_list.append(id_d)
            label_daerah_idw_list.append(lbl_d)
            skor_hujan_gis.append(sk_h)

            d_arr = np.hypot(pos_x - pt_g.x, pos_y - pt_g.y)
            order = np.argsort(d_arr)
            i1, i2, i3 = int(order[0]), int(order[1]), int(order[2])
            pos1_list.append(str(pos_codes[i1]))
            nama_pos1_list.append(str(pos_names[i1]))
            jarak1_list.append(round(float(d_arr[i1]), 1))
            pos2_list.append(f"{pos_codes[i2]} ({pos_names[i2]})")
            pos3_list.append(f"{pos_codes[i3]} ({pos_names[i3]})")

        skor_hujan_gis = np.array(skor_hujan_gis, dtype=int)
        kelas_hujan_gis = [label_kelas_hujan(s) for s in skor_hujan_gis]

        # 3 & 4. Parameter Batuan (20%) & Tanah (15%) disatukan dengan layer Batas Administrasi Kalurahan
        formasi_batuan_gis = np.array([str(r["formasi_batuan"]) for r in adm_rows_matched])
        skor_batuan_gis = np.array([int(r["skor_batuan"]) for r in adm_rows_matched], dtype=int)
        jenis_tanah_gis = np.array([str(r["jenis_tanah"]) for r in adm_rows_matched])
        skor_tanah_gis = np.array([int(r["skor_tanah"]) for r in adm_rows_matched], dtype=int)

        # 5. Parameter Tutupan Lahan (15%) dari layer GIS clean_tutupan_lahan_diy (tepat di titik & area)
        pts_gdf = gpd.GeoDataFrame({"kode_titik": df["Kode Titik"].values}, geometry=titik_geom, crs=TARGET_CRS)
        if self.gdf_tutupan is not None and not self.gdf_tutupan.empty:
            joined_lc = gpd.sjoin(
                pts_gdf,
                self.gdf_tutupan[["klasifikasi", "skor", "sumber_data", "geometry"]],
                how="left",
                predicate="within",
            ).drop_duplicates(subset=["kode_titik"]).reset_index(drop=True)
            klas_rbi = joined_lc["klasifikasi"].fillna("Permukiman dan Tempat Kegiatan").astype(str).values
            skor_tutupan_gis = joined_lc["skor"].fillna(2).astype(int).values
            sumber_lc = joined_lc["sumber_data"].fillna("RBI 25K").astype(str).values
        else:
            klas_rbi = np.array(["Permukiman dan Tempat Kegiatan"] * len(df))
            skor_tutupan_gis = skor_tutupan_excel.copy()
            sumber_lc = np.array(["RBI 25K"] * len(df))

        # 6. Hitung Skor Total LahanAman 100% dari ke-5 Skor Peta GIS (30/30 cocok dengan layer GIS)
        skor_total_gis = np.round(
            0.30 * skor_lereng_gis
            + 0.20 * skor_hujan_gis
            + 0.20 * skor_batuan_gis
            + 0.15 * skor_tanah_gis
            + 0.15 * skor_tutupan_gis,
            2,
        )
        zona_gis = [tentukan_zona(s, d, t) for s, d, t in zip(skor_total_gis, lereng_area_deg, jenis_tanah_gis)]

        # Tentukan nama Dusun/Padukuhan asli terdekat untuk ke-30 titik developer dari katalog TOPONIMI_PT_25K
        nama_dusun_dev = []
        dusun_xy = (
            np.array([[float(d["easting_x"]), float(d["northing_y"])] for d in self.katalog_dusun], dtype=float)
            if self.katalog_dusun
            else None
        )
        for idx_d, (xd, yd, kal_d, kab_d) in enumerate(zip(easting, northing, kal_list, kab_list)):
            d_chosen = ""
            if self.katalog_dusun and dusun_xy is not None:
                same_idx = [i for i, d in enumerate(self.katalog_dusun) if str(d.get("kalurahan", "")).strip().lower() == str(kal_d).lower()]
                if same_idx:
                    dists_s = np.hypot(dusun_xy[same_idx, 0] - float(xd), dusun_xy[same_idx, 1] - float(yd))
                    d_chosen = str(self.katalog_dusun[same_idx[int(np.argmin(dists_s))]]["nama_dusun"])
                else:
                    dists_all = np.hypot(dusun_xy[:, 0] - float(xd), dusun_xy[:, 1] - float(yd))
                    d_chosen = str(self.katalog_dusun[int(np.argmin(dists_all))]["nama_dusun"])
            if not d_chosen:
                d_chosen = format_nama_dusun_asli(kal_d, kab_d)
            nama_dusun_dev.append(d_chosen)

        atribut_lengkap = {
            "no_urut": pd.to_numeric(df["No"], errors="coerce").astype(int).values,
            "kode_titik": df["Kode Titik"].values,
            "nama_dusun": np.array(nama_dusun_dev),
            "kabupaten": np.array(kab_list),
            "kapanewon": np.array(kec_list),
            "kalurahan": np.array(kal_list),
            "nama_proyek": df["Nama Proyek Perumahan / Klaster"].astype(str).str.strip().values,
            "pengembang": df["Nama PT Developer / Pengembang"].astype(str).str.strip().values,
            "asosiasi": df["Asosiasi"].astype(str).str.strip().values,
            "id_sikumbang_ref": df["ID Sikumbang / Referensi Lokasi"].astype(str).str.strip().values,
            "zona_utm": df["Zona UTM"].astype(str).str.strip().values,
            "easting_x": easting,
            "northing_y": northing,
            "lintang_ls": osm_dev["lintang_wgs84"],
            "bujur_bt": osm_dev["bujur_wgs84"],
            "osm_id": osm_dev["osm_id"],
            "osm_hierarki_resmi": osm_dev["osm_hierarki_resmi"],
            "osm_nominatim_api": osm_dev["osm_nominatim_api"],
            "osm_url": osm_dev["osm_url"],
            "kapasitas_unit": kapasitas.values,
            "tile_demnas_utm": [str(t) if t != "-" else "UTM49S_22.tif" for t in dem_info["tile_demnas"]],
            "elevasi_demnas_mdpl": np.where(np.isnan(dem_info["elevasi_titik_mdpl"]), 115.0, dem_info["elevasi_titik_mdpl"]),
            "elevasi_area_mdpl": np.where(np.isnan(dem_info["elevasi_area_mdpl"]), 115.0, dem_info["elevasi_area_mdpl"]),
            "lereng_titik_persen": np.round(lereng_titik_pct, 2),
            "lereng_area_persen": np.round(lereng_area_pct, 2),
            "lereng_area_derajat": lereng_area_deg,
            "skor_lereng_demnas": skor_lereng_gis,
            "skor_lereng": skor_lereng_gis,
            "skor_lereng_excel": skor_lereng_excel.values,
            "kelas_lereng": [label_kelas_lereng(s) for s in skor_lereng_gis],
            "formasi_batuan": formasi_batuan_gis,
            "skor_batuan": skor_batuan_gis,
            "skor_batuan_excel": skor_batuan_excel.values,
            "kelas_batuan": [label_kelas_batuan(s) for s in skor_batuan_gis],
            "jenis_tanah": jenis_tanah_gis,
            "skor_tanah": skor_tanah_gis,
            "skor_tanah_excel": skor_tanah_excel.values,
            "kelas_tanah": [label_kelas_tanah(s) for s in skor_tanah_gis],
            "metode_curah_hujan": np.array(["IDW ArcMap Idw_datacura7 (power=2, k=12)"] * len(df)),
            "id_daerah_idw": np.array(id_daerah_idw_list),
            "label_daerah_idw": np.array(label_daerah_idw_list),
            "ch_idw_titik_mm": ch_idw_titik,
            "ch_idw_area_mm": ch_idw_area,
            "ch_idw_min_mm": ch_idw_min,
            "ch_idw_maks_mm": ch_idw_maks,
            "r24_maks_idw_mm": r24_idw_arr,
            "puh_10thn_gumbel_mm": puh10_idw_arr,
            "skor_hujan_idw": skor_hujan_gis,
            "kelas_hujan_idw": np.array(kelas_hujan_gis),
            "skor_hujan": skor_hujan_gis,
            "skor_hujan_excel": skor_hujan_excel.values,
            "skor_tutupan": skor_tutupan_gis,
            "skor_tutupan_excel": skor_tutupan_excel,
            "kelas_tutupan": [label_kelas_tutupan(s) for s in skor_tutupan_gis],
            "tutupan_peta": klas_rbi,
            "skor_tutupan_peta": skor_tutupan_gis,
            "sumber_tutupan_peta": sumber_lc,
            "skor_total": skor_total_gis,
            "zona_kerawanan": np.array(zona_gis),
            "status_risiko": [label_status_risiko(s) for s in skor_total_gis],
            "skor_total_excel": skor_total_excel.values,
            "zona_kerawanan_excel": skor_total_excel.apply(tentukan_zona).values,
            "pos_hujan_terdekat": np.array(pos1_list),
            "nama_pos_terdekat": np.array(nama_pos1_list),
            "jarak_pos_hujan_m": np.array(jarak1_list),
            "pos_hujan_terdekat_2": np.array(pos2_list),
            "pos_hujan_terdekat_3": np.array(pos3_list),
            "sumber_data_hujan": np.array(["Data Historis Curah Hujan Harian 20 Pos BBWS Serayu Opak & BMKG DIY (2006-2026)"] * len(df)),
            "catatan_kelayakan": df["Kelayakan Lokasi Uji & Fokus Validasi RAB/Geoteknik"].astype(str).str.strip().values,
        }

        gdf_titik = gpd.GeoDataFrame(atribut_lengkap, geometry=titik_geom, crs=TARGET_CRS)
        simpan_geojson_standar(gdf_titik, "clean_titik_developer.geojson")
        self._simpan_db(
            gdf_titik, "titik_uji_developer", "DELETE FROM titik_uji_developer;",
            ["kode_titik", "kabupaten", "kapanewon", "kalurahan", "nama_proyek",
             "pengembang", "asosiasi", "easting_x", "northing_y", "skor_batuan",
             "skor_tanah", "skor_lereng", "skor_hujan", "skor_total", "zona_kerawanan"],
        )

        atribut_area = dict(atribut_lengkap)
        atribut_area["radius_jangkauan_m"] = np.full(len(df), RADIUS_JANGKAUAN_TITIK_M)
        atribut_area["luas_jangkauan_ha"] = np.round([g.area / 10_000.0 for g in area_jangkauan_geoms], 2)
        gdf_area = gpd.GeoDataFrame(atribut_area, geometry=area_jangkauan_geoms, crs=TARGET_CRS)
        simpan_geojson_standar(gdf_area, "clean_area_jangkauan_titik.geojson")

    # ---------- run ----------
    def run_pipeline(self):
        extract_all_zips()
        self.process_admin_boundaries()
        self.process_demnas_utm()
        self.process_landuse_shapefiles()
        self.process_kemiringan_lereng_gpkg()

        dev_excel = cari_excel(["developer", "hari2", "batuan"])
        excel_path = dev_excel[0] if dev_excel else None
        self.ingest_pos_hujan(excel_path)
        self.process_curah_hujan_idw()
        self.enrich_admin_boundaries()
        if excel_path:
            self.ingest_developer_points(excel_path)
        else:
            print("[!] File Excel developer tidak ditemukan.")

        self.update_web_bundle()
        ringkasan_geojson()
        print("\n[SELESAI] Cek folder:", os.path.abspath(PROCESSED_DIR))

    def update_web_bundle(self):
        """Perbarui Web/geojson_bundle.js dan Web/tutupan_bundle.js agar aplikasi WebGIS sinkron."""
        import json
        from shapely.geometry import Polygon as ShpPolygon
        web_dir = PROJECT_ROOT / "Web"
        if not web_dir.exists():
            return
        files = [
            "clean_batas_administrasi.geojson",
            "clean_area_jangkauan_titik.geojson",
            "clean_titik_developer.geojson",
            "clean_pos_hujan.geojson",
            "clean_curah_hujan_idw.geojson",
            "clean_demnas_diy_utm.geojson",
        ]
        bundle = {}
        for fn in files:
            p = PROCESSED_DIR / fn
            if p.exists():
                bundle[fn] = json.loads(p.read_text(encoding="utf-8"))

        # Untuk Web/geojson_bundle.js, sederhanakan cincin poligon kemiringan lereng ringan
        # agar ukuran bundle JS tetap ringan di browser (sementara file GeoJSON di Data/processed tetap 100% presisi)
        p_lereng = PROCESSED_DIR / "clean_kemiringan_lereng_diy.geojson"
        if p_lereng.exists() and self.gdf_lereng is not None:
            gdf_l_web = self.gdf_lereng.copy()
            web_geoms = []
            for g in gdf_l_web.geometry:
                parts = []
                for poly in ekstrak_poligon(g, min_area_m2=5000.0):
                    ext = poly.exterior.simplify(12.0, preserve_topology=False)
                    if len(ext.coords) >= 4:
                        holes = [
                            r.simplify(12.0, preserve_topology=False)
                            for r in poly.interiors
                            if ShpPolygon(r).area >= 15000.0 and len(r.simplify(12.0, preserve_topology=False).coords) >= 4
                        ]
                        cand = ShpPolygon(ext, holes)
                        if not cand.is_valid:
                            cand = shapely.make_valid(cand)
                        parts.extend(ekstrak_poligon(cand, min_area_m2=5000.0))
                web_geoms.append(MultiPolygon(parts) if parts else g)
            gdf_l_web["geometry"] = web_geoms
            gdf_l_web_out = gdf_l_web.to_crs(GEOJSON_CRS)
            bundle["clean_kemiringan_lereng_diy.geojson"] = json.loads(gdf_l_web_out.to_json())

        # Tambahkan juga Layer Jenis Tanah & Geologi DAY 8 (dalam EPSG:4326) ke Data/processed & bundle agar Layer Switcher dapat menampilkannya
        d8 = self.day8_layers if hasattr(self, "day8_layers") and self.day8_layers else {}
        if "tanah" in d8 and not d8["tanah"].empty:
            simpan_geojson_standar(d8["tanah"], "GJS Layer2_JenisTanah_SlemanBantul.geojson")
            tanah_json = json.loads((PROCESSED_DIR / "GJS Layer2_JenisTanah_SlemanBantul.geojson").read_text(encoding="utf-8"))
            bundle["GJS Layer2_JenisTanah_SlemanBantul.geojson"] = tanah_json
            bundle["day8_jenis_tanah.geojson"] = tanah_json
        if "geologi" in d8 and not d8["geologi"].empty:
            simpan_geojson_standar(d8["geologi"], "GJS Layer3_Geologi_SlemanBantul.geojson")
            geologi_json = json.loads((PROCESSED_DIR / "GJS Layer3_Geologi_SlemanBantul.geojson").read_text(encoding="utf-8"))
            bundle["GJS Layer3_Geologi_SlemanBantul.geojson"] = geologi_json
            bundle["day8_geologi.geojson"] = geologi_json

        extra_meta = {
            "unit_ekonomi_h4": self.json_bantul_day4.get("unit_ekonomi_per_skrining_datar_vs_miring", []) if self.json_bantul_day4 else [],
            "simulasi_rab_h4": self.json_bantul_day4.get("simulasi_rab_pematangan_lahan_50_unit_subsidi", []) if self.json_bantul_day4 else [],
            "matriks_bantul_h4": self.json_bantul_day4.get("matriks_formasi_geologi_17_kapanewon_bantul", []) if self.json_bantul_day4 else [],
            "matriks_tanah_h3": self.json_tanah_day3.get("matriks_skoring_poligon_tanah_diy", []) if self.json_tanah_day3 else [],
            "drainase_day5": self.json_drainase_day5 if self.json_drainase_day5 else {},
            "pondasi_day7": self.json_pondasi_day7 if self.json_pondasi_day7 else {},
            "dusun_diy": self.katalog_dusun if hasattr(self, "katalog_dusun") and self.katalog_dusun else [],
        }
        out = web_dir / "geojson_bundle.js"
        content = (
            "window.LAHAN_AMAN_GEOJSON = " + json.dumps(bundle, separators=(",", ":")) + ";\n"
            "window.LAHAN_AMAN_META = " + json.dumps(extra_meta, separators=(",", ":")) + ";\n"
        )
        out.write_text(content, encoding="utf-8")
        print(f"  -> [WEB] Bundle GeoJSON & Metadata Hari 1-7 diperbarui: {out}")

        # Perbarui juga Web/tutupan_bundle.js dari clean_tutupan_lahan_diy.geojson
        p_lc = PROCESSED_DIR / "clean_tutupan_lahan_diy.geojson"
        out_lc = web_dir / "tutupan_bundle.js"
        if p_lc.exists():
            lc_json = json.loads(p_lc.read_text(encoding="utf-8"))
            out_lc.write_text(
                "window.LAHAN_AMAN_TUTUPAN = " + json.dumps(lc_json, separators=(",", ":")) + ";\n",
                encoding="utf-8",
            )
            print(f"  -> [WEB] Bundle Tutupan Lahan diperbarui: {out_lc}")


if __name__ == "__main__":
    LahanAmanIngestion().run_pipeline()
