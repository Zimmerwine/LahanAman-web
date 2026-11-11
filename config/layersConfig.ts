/**
 * config/layersConfig.ts
 * ============================================================================
 * MODUL 3 & 4: KONFIGURASI METADATA LAYER SPASIAL TEMATIK & REFERENSI
 * LahanAman GeoAnalytics DIY
 *
 * Catatan Arsitektur:
 * - Seluruh label visual, deskripsi, dan legenda telah dibersihkan dari istilah "IDW"
 *   dan diganti menjadi "Curah Hujan Tahunan (Isohyet)".
 * - Path fisik `/data/clean_curah_hujan_idw.geojson` tetap dipertahankan agar tidak
 *   merusak mapping fetch data di produksi/Vercel.
 * ============================================================================
 */

export type LayerGroupType = "thematic" | "reference";
export type LegendModeKey = "triase" | "lereng" | "geologi" | "tanah" | "hujan" | "tutupan";

export interface LayerLegendItem {
  color: string;
  borderColor?: string;
  label: string;
  subLabel?: string;
}

export interface SpatialLayerConfig {
  id: string;
  checkboxId: string;
  title: string;
  shortTitle: string;
  icon: string;
  group: LayerGroupType;
  fileName: string;
  urlPath: string;
  fallbackUrlPath?: string;
  defaultVisible: boolean;
  defaultOpacity: number; // 0.10 - 1.00 (10% - 100%)
  minOpacity: number;
  maxOpacity: number;
  weightPercentage?: number;
  legendMode?: LegendModeKey;
  description: string;
  essentialFields: string[];
  legendItems: LayerLegendItem[];
}

export const SPATIAL_LAYERS_CONFIG: SpatialLayerConfig[] = [
  {
    id: "kerawananLongsor",
    checkboxId: "chk-kerawanan-longsor",
    title: "Peta Skoring Kerawanan Longsor (GPKG)",
    shortTitle: "Kerawanan Longsor (GPKG)",
    icon: "⚠️",
    group: "thematic",
    fileName: "clean_kerawanan_longsor.geojson",
    urlPath: "/data/clean_kerawanan_longsor.geojson",
    fallbackUrlPath: "/Data/processed/clean_kerawanan_longsor.geojson",
    defaultVisible: false,
    defaultOpacity: 0.60,
    minOpacity: 0.10,
    maxOpacity: 1.00,
    legendMode: "triase",
    description:
      "Komposit 5 parameter geoteknik (Permen PU No. 22/PRT/M/2007 & SNI 8291:2016): Lereng 30%, Tanah 25%, Batuan 20%, Hujan 15%, Lahan 10%.",
    essentialFields: [
      "kalurahan",
      "kapanewon",
      "kabupaten",
      "lereng_derajat",
      "skor_lereng",
      "skor_tanah",
      "ket_tanah",
      "c_kpa",
      "phi_deg",
      "gamma_sat",
      "z",
      "skor_batuan",
      "ket_batuan",
      "skor_hujan",
      "curah_hujan_mm",
      "rasio_m",
      "skor_lahan",
      "ket_lahan",
      "skor_akhir",
      "status_zona",
      "zona_triase",
      "warna_hex",
    ],
    legendItems: [
      {
        color: "#2E7D32",
        borderColor: "#1B5E20",
        label: "ZONA HIJAU (Skor < 2,20)",
        subLabel: "Datar / Risiko Rendah / Konstruksi Standar",
      },
      {
        color: "#FB8C00",
        borderColor: "#BF360C",
        label: "ZONA KUNING (Skor 2,20 – 3,40)",
        subLabel: "Risiko Sedang / Perlu Mitigasi Drainase, Pondasi Khusus / Talud",
      },
      {
        color: "#D32F2F",
        borderColor: "#B71C1C",
        label: "ZONA MERAH (Skor > 3,40)",
        subLabel: "Risiko Tinggi / Rawan Longsor / Non-Buildable",
      },
    ],
  },
  {
    id: "lerengPoly",
    checkboxId: "chk-lereng-poly",
    title: "Kemiringan Lereng (DEMNAS)",
    shortTitle: "Kemiringan Lereng (β)",
    icon: "⛰️",
    group: "thematic",
    fileName: "clean_kemiringan_lereng_diy.geojson",
    urlPath: "/data/clean_kemiringan_lereng_diy.geojson",
    fallbackUrlPath: "/Data/processed/clean_kemiringan_lereng_diy.geojson",
    defaultVisible: false,
    defaultOpacity: 0.65,
    minOpacity: 0.10,
    maxOpacity: 1.00,
    weightPercentage: 30,
    legendMode: "lereng",
    description:
      "Ekstraksi sudut kemiringan lereng murni (β°) dari DEMNAS resolusi 8,3 m dalam proyeksi metrik UTM Zona 49S (EPSG:32749).",
    essentialFields: ["klasifikasi", "skor", "luas_ha"],
    legendItems: [
      { color: "#1a9850", label: "Skor 1: 0° – 8° (0% – 14,1%)", subLabel: "Datar – Landai (Zona Aman)" },
      { color: "#66bd63", label: "Skor 2: >8° – 15° (14,1% – 26,8%)", subLabel: "Landai – Miring (Transisi)" },
      { color: "#facc15", label: "Skor 3: >15° – 25° (26,8% – 46,6%)", subLabel: "Agak Curam (Kritis Lempung)" },
      { color: "#f97316", label: "Skor 4: >25° – 35° (46,6% – 70,0%)", subLabel: "Curam (Kritis Batupasir Lapuk)" },
      { color: "#ef4444", label: "Skor 5: >35° (>70,0%)", subLabel: "Sangat Terjal (Non-Buildable)" },
    ],
  },
  {
    id: "tanah",
    checkboxId: "chk-tanah",
    title: "Karakteristik Tanah (Pedologi)",
    shortTitle: "Karakteristik Tanah",
    icon: "🌱",
    group: "thematic",
    fileName: "GJS Layer2_JenisTanah_SlemanBantul.geojson",
    urlPath: "/data/GJS Layer2_JenisTanah_SlemanBantul.geojson",
    fallbackUrlPath: "/Data/processed/GJS Layer2_JenisTanah_SlemanBantul.geojson",
    defaultVisible: false,
    defaultOpacity: 0.60,
    minOpacity: 0.10,
    maxOpacity: 1.00,
    weightPercentage: 25,
    legendMode: "tanah",
    description:
      "Parameter mekanika tanah lokal DIY (Dasar.xlsx): Kohesi efektif (c'), sudut geser dalam (φ'), berat isi jenuh (γsat), dan kedalaman bidang gelincir (z).",
    essentialFields: ["jns_tnh", "skor tanah", "ket_tanah", "c_kpa", "phi_deg", "gamma_sat", "z", "is_expansive"],
    legendItems: [
      { color: "#D32F2F", label: "Skor 5: Grumusol", subLabel: "c'=9,0 kPa, φ'=15,0°, γsat=19,0 kN/m³, z=2,0 m" },
      { color: "#FB8C00", label: "Skor 4: Latosol & Mediteran", subLabel: "c'=10–11 kPa, φ'=18°–20°, γsat=18,5 kN/m³, z=2,0–2,5 m" },
      { color: "#FFB300", label: "Skor 3: Regosol", subLabel: "c'=3,5 kPa, φ'=36,0°, γsat=17,5 kN/m³, z=1,0 m" },
      { color: "#66BB6A", label: "Skor 2: Kambisol", subLabel: "c'=8,0 kPa, φ'=30,0°, γsat=18,0 kN/m³, z=2,0 m" },
      { color: "#2E7D32", label: "Skor 1: Aluvial", subLabel: "c'=14,0 kPa, φ'=25,0°, γsat=18,5 kN/m³, z=4,0 m" },
    ],
  },
  {
    id: "geologi",
    checkboxId: "chk-geologi",
    title: "Litologi / Formasi Batuan",
    shortTitle: "Litologi & Formasi",
    icon: "🪨",
    group: "thematic",
    fileName: "GJS Layer3_Geologi_SlemanBantul.geojson",
    urlPath: "/data/GJS Layer3_Geologi_SlemanBantul.geojson",
    fallbackUrlPath: "/Data/processed/GJS Layer3_Geologi_SlemanBantul.geojson",
    defaultVisible: false,
    defaultOpacity: 0.60,
    minOpacity: 0.10,
    maxOpacity: 1.00,
    weightPercentage: 20,
    legendMode: "geologi",
    description:
      "Formasi geologi regional DIY dan potensi pembentukan bidang gelincir kedap air maupun diskontinuitas kekar batuan.",
    essentialFields: ["NAME", "SYMBOLS", "FORMATION", "skor_batuan", "ket_batuan"],
    legendItems: [
      { color: "#D32F2F", label: "Skor 5: Semilir (Tmse), Sambipitu (Tmss), Nanggulan (Teon), na", subLabel: "Batuan lemah 1–5 MPa, bidang gelincir kedap" },
      { color: "#FB8C00", label: "Skor 4: Nglanggran (Tmng), Kebobutak (Tomk)", subLabel: "Kekar rapat, diskontinuitas tinggi (φ'=25°–35°)" },
      { color: "#FFB300", label: "Skor 3: Sentolo (Tmps), Merapi Tua (Qmo)", subLabel: "Batugamping napalan smektit / vulkanik tua" },
      { color: "#66BB6A", label: "Skor 2: Merapi Muda (Qmi, Qvu3)", subLabel: "Pasir bergradasi baik SW (φ'=37°–48°)" },
      { color: "#2E7D32", label: "Skor 1: Wonosari (Tmwl), Aluvial (Qa)", subLabel: "Batugamping terumbu masif / dataran aluvial" },
    ],
  },
  {
    id: "hujanIsohyet",
    checkboxId: "chk-hujan",
    title: "Curah Hujan Tahunan (Isohyet)",
    shortTitle: "Curah Hujan (Isohyet)",
    icon: "🌧️",
    group: "thematic",
    fileName: "clean_curah_hujan_idw.geojson",
    urlPath: "/data/clean_curah_hujan_idw.geojson",
    fallbackUrlPath: "/Data/processed/clean_curah_hujan_idw.geojson",
    defaultVisible: false,
    defaultOpacity: 0.60,
    minOpacity: 0.10,
    maxOpacity: 1.00,
    weightPercentage: 15,
    legendMode: "hujan",
    description:
      "Zona isohyet curah hujan tahunan (mm/tahun) dan korelasi rasio kejenuhan air tanah (m = hw/z) terhadap tekanan air pori.",
    essentialFields: ["curah_hujan_mm", "skor_hujan", "rasio_m", "ket_hujan", "warna_hex"],
    legendItems: [
      { color: "#FF1A00", label: "Skor 5: > 3.000 mm/tahun", subLabel: "Rasio kejenuhan m = 0,90" },
      { color: "#FF8C00", label: "Skor 4: 2.501 – 3.000 mm/tahun", subLabel: "Rasio kejenuhan m = 0,75" },
      { color: "#FFFF00", borderColor: "#94a3b8", label: "Skor 3: 2.001 – 2.500 mm/tahun", subLabel: "Rasio kejenuhan m = 0,60" },
      { color: "#66CC00", label: "Skor 2: 1.500 – 2.000 mm/tahun", subLabel: "Rasio kejenuhan m = 0,45" },
      { color: "#1F7A1F", label: "Skor 1: < 1.500 mm/tahun", subLabel: "Rasio kejenuhan m = 0,30" },
    ],
  },
  {
    id: "tutupan",
    checkboxId: "chk-tutupan",
    title: "Tutupan Lahan (RBI 25K)",
    shortTitle: "Tutupan Lahan",
    icon: "🏡",
    group: "thematic",
    fileName: "clean_tutupan_lahan_diy.geojson",
    urlPath: "/data/clean_tutupan_lahan_diy.geojson",
    fallbackUrlPath: "/Data/processed/clean_tutupan_lahan_diy.geojson",
    defaultVisible: false,
    defaultOpacity: 0.60,
    minOpacity: 0.10,
    maxOpacity: 1.00,
    weightPercentage: 10,
    legendMode: "tutupan",
    description:
      "Peran tutupan lahan terhadap kohesi perakaran vegetasi (cr) dan beban tambahan permukaan/konstruksi (surcharge load q).",
    essentialFields: ["pl", "klasifikasi", "skor_lahan", "ket_lahan", "warna_hex"],
    legendItems: [
      { color: "#D32F2F", label: "Skor 5: Tanah Terbuka / Tegalan / Sawah (>8°)", subLabel: "cr = 0 kPa, q = 0 kPa" },
      { color: "#FB8C00", label: "Skor 4: Semak Belukar / Alang-alang", subLabel: "cr = 0,5 kPa, q = 0 kPa" },
      { color: "#FFB300", label: "Skor 3: Permukiman / Bangunan / Jalan", subLabel: "cr = 0 kPa, beban q = 15 kPa" },
      { color: "#66BB6A", label: "Skor 2: Perkebunan / Kebun Campuran", subLabel: "cr = 3,5 kPa, q = 0 kPa" },
      { color: "#2E7D32", label: "Skor 1: Hutan Lahan Kering / Lindung / Air", subLabel: "cr = 10,0 kPa, q = 0 kPa" },
    ],
  },
  {
    id: "admin",
    checkboxId: "chk-admin",
    title: "Garis Batas Administratif",
    shortTitle: "Batas Administrasi",
    icon: "🗺️",
    group: "reference",
    fileName: "clean_batas_administrasi.geojson",
    urlPath: "/data/clean_batas_administrasi.geojson",
    fallbackUrlPath: "/Data/processed/clean_batas_administrasi.geojson",
    defaultVisible: false,
    defaultOpacity: 0.70,
    minOpacity: 0.10,
    maxOpacity: 1.00,
    description: "Batas administrasi resmi Kalurahan/Kelurahan dan Kapanewon/Kemantren di DIY.",
    essentialFields: ["kabupaten", "kapanewon", "kalurahan", "luas_ha"],
    legendItems: [],
  },
  {
    id: "titikDev",
    checkboxId: "chk-titik-dev",
    title: "Titik Uji Sampel Developer",
    shortTitle: "Titik Sampel Developer",
    icon: "📍",
    group: "reference",
    fileName: "clean_titik_developer.geojson",
    urlPath: "/data/clean_titik_developer.geojson",
    fallbackUrlPath: "/Data/processed/clean_titik_developer.geojson",
    defaultVisible: false,
    defaultOpacity: 0.95,
    minOpacity: 0.10,
    maxOpacity: 1.00,
    description: "Titik observasi sampel pengembangan perumahan di wilayah DIY.",
    essentialFields: ["kode_titik", "kabupaten", "kapanewon", "kalurahan"],
    legendItems: [],
  },
  {
    id: "areaDev",
    checkboxId: "chk-area-dev",
    title: "Radius Jangkauan Uji (500m)",
    shortTitle: "Radius Uji (500m)",
    icon: "⭕",
    group: "reference",
    fileName: "clean_area_jangkauan_titik.geojson",
    urlPath: "/data/clean_area_jangkauan_titik.geojson",
    fallbackUrlPath: "/Data/processed/clean_area_jangkauan_titik.geojson",
    defaultVisible: false,
    defaultOpacity: 0.45,
    minOpacity: 0.10,
    maxOpacity: 1.00,
    description: "Zona buffer evaluasi geoteknik radius 500 meter di sekitar titik uji pengembang.",
    essentialFields: ["kode_titik", "kabupaten", "kapanewon", "kalurahan"],
    legendItems: [],
  },
  {
    id: "posHujan",
    checkboxId: "chk-pos-hujan",
    title: "Pos Pengamatan Hujan BBWS",
    shortTitle: "Pos Hujan BBWS",
    icon: "💧",
    group: "reference",
    fileName: "clean_pos_hujan.geojson",
    urlPath: "/data/clean_pos_hujan.geojson",
    fallbackUrlPath: "/Data/processed/clean_pos_hujan.geojson",
    defaultVisible: false,
    defaultOpacity: 0.95,
    minOpacity: 0.10,
    maxOpacity: 1.00,
    description: "Jaringan 20 stasiun penakar hujan BBWS Serayu Opak & BMKG DIY.",
    essentialFields: ["kode_pos", "nama_pos", "kabupaten", "rerata_ch_tahunan"],
    legendItems: [],
  },
  {
    id: "demnas",
    checkboxId: "chk-demnas",
    title: "Grid Tile DEMNAS UTM",
    shortTitle: "Grid DEMNAS UTM",
    icon: "📐",
    group: "reference",
    fileName: "clean_demnas_diy_utm.geojson",
    urlPath: "/data/clean_demnas_diy_utm.geojson",
    fallbackUrlPath: "/Data/processed/clean_demnas_diy_utm.geojson",
    defaultVisible: false,
    defaultOpacity: 0.25,
    minOpacity: 0.10,
    maxOpacity: 1.00,
    description: "Indeks lembar raster DEMNAS BIG dalam proyeksi UTM Zona 49S (EPSG:32749).",
    essentialFields: ["nama_tile", "elevasi_rerata_mdpl", "lereng_rerata_persen"],
    legendItems: [],
  },
];

export function getLayerConfigById(id: string): SpatialLayerConfig | undefined {
  return SPATIAL_LAYERS_CONFIG.find((l) => l.id === id || l.checkboxId === id);
}
