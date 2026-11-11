/**
 * utils/geotechEngine.ts
 * ============================================================================
 * MODUL 2: LOGIKA ANALISIS & KALKULASI GEOTEKNIK TERPADU
 * LahanAman GeoAnalytics DIY
 *
 * Acuan Standar & Referensi Empiris ('Dasar.xlsx'):
 * - Permen PU No. 22/PRT/M/2007 & SNI 8291:2016 (Pembobotan 5 Parameter GPKG)
 * - Wicaksono & Khafid (2022), Karnawati (2005 UGM), Kristanto (2018 ITNY)
 * - Metode Kesetimbangan Batas Lereng Tak Terhingga (Infinite Slope Limit Equilibrium)
 * ============================================================================
 */

export const GAMMA_WATER_KN_M3 = 9.81;
export const MAX_FS_CAP = 5.0;
export const FLAT_SLOPE_THRESHOLD_DEG = 2.0;

export const GPKG_WEIGHTS = {
  lereng: 0.30,
  tanah: 0.25,
  batuan: 0.20,
  hujan: 0.15,
  lahan: 0.10,
} as const;

export type StabilityStatus = "STABIL" | "KRITIS" | "LABIL / LONGSOR";
export type ZonaKelayakanKode = "HIJAU" | "KUNING" | "MERAH";

export interface SlopeParameterResult {
  betaDeg: number;
  slopePercent: number;
  skor: 1 | 2 | 3 | 4 | 5;
  bobot: number;
  skorTertimbang: number;
  rentangLabel: string;
  keteranganGeoteknik: string;
}

export interface SoilParameterResult {
  jenisTanah: string;
  skor: 1 | 2 | 3 | 4 | 5;
  bobot: number;
  skorTertimbang: number;
  cPrimeKpa: number;
  phiPrimeDeg: number;
  gammaSatKnM3: number;
  zDepthM: number;
  isExpansive: boolean;
  keteranganGeoteknik: string;
}

export interface LithologyParameterResult {
  formasiBatuan: string;
  simbolFormasi: string;
  skor: 1 | 2 | 3 | 4 | 5;
  bobot: number;
  skorTertimbang: number;
  keteranganGeoteknik: string;
}

export interface RainfallParameterResult {
  curahHujanMm: number;
  skor: 1 | 2 | 3 | 4 | 5;
  bobot: number;
  skorTertimbang: number;
  rasioKejenuhanM: number;
  rentangLabel: string;
  keteranganGeoteknik: string;
}

export interface LandUseParameterResult {
  tutupanLahan: string;
  skor: 1 | 2 | 3 | 4 | 5;
  bobot: number;
  skorTertimbang: number;
  kohesiAkarCrKpa: number;
  bebanTambahanQKpa: number;
  keteranganGeoteknik: string;
}

export interface InfiniteSlopeAuditTrail {
  betaDeg: number;
  cPrimeKpa: number;
  crKpa: number;
  totalCohesionKpa: number;
  phiPrimeDeg: number;
  gammaSatKnM3: number;
  gammaWaterKnM3: number;
  zDepthM: number;
  rasioKejenuhanM: number;
  poreWaterPressureUKpa: number;
  surchargeLoadQKpa: number;
  effectiveNormalStressKpa: number;
  resistingShearStressKpa: number;
  drivingShearStressKpa: number;
  fsRaw: number;
  fsCapped: number;
  isFlatLocked: boolean;
}

export interface GeotechAnalysisResult {
  skorAkhir: number;
  zonaKode: ZonaKelayakanKode;
  zonaLabel: string;
  zonaDeskripsi: string;
  warnaHex: string;
  fs: number;
  fsStatus: StabilityStatus;
  fsBadgeColor: "emerald" | "amber" | "red";
  fsKeterangan: string;
  parameters: {
    lereng: SlopeParameterResult;
    tanah: SoilParameterResult;
    batuan: LithologyParameterResult;
    hujan: RainfallParameterResult;
    lahan: LandUseParameterResult;
  };
  auditTrail: InfiniteSlopeAuditTrail;
}

export interface GeotechInputPayload {
  betaDeg?: number | null;
  slopePercent?: number | null;
  skorLerengPoly?: number | null;
  ketLerengPoly?: string | null;
  jenisTanah?: string | null;
  cPrimeOverride?: number | null;
  phiPrimeOverride?: number | null;
  gammaSatOverride?: number | null;
  zDepthOverride?: number | null;
  formasiBatuan?: string | null;
  simbolFormasi?: string | null;
  skorBatuanOverride?: number | null;
  curahHujanMm?: number | null;
  skorHujanOverride?: number | null;
  rasioMOverride?: number | null;
  tutupanLahan?: string | null;
  skorLahanOverride?: number | null;
}

/**
 * Representasi sudut lereng tengah (midpoint) berdasarkan kelas lereng DEMNAS
 * apabila titik hanya memiliki atribut kelas/skor poligon lereng tanpa piksel raster langsung.
 * TIDAK menggunakan nilai fiktif statis 4.5°.
 */
const SLOPE_CLASS_REPRESENTATIVE_DEG: Record<number, number> = {
  1: 3.5,  // 0° - 8°
  2: 11.5, // >8° - 15°
  3: 20.0, // >15° - 25°
  4: 30.0, // >25° - 35°
  5: 38.0, // >35°
};

/**
 * A. Evaluasi Kemiringan Lereng (β) - Bobot 30%
 * Berdasarkan 'Dasar.xlsx' Sheet Internal & Komparasi (Karnawati 2005, Kristanto 2018, SNI 8291:2016)
 */
export function evaluateSlopeParameter(
  betaDegInput?: number | null,
  slopePercentInput?: number | null,
  skorPolyInput?: number | null,
  ketLerengInput?: string | null
): SlopeParameterResult {
  let betaDeg = Number(betaDegInput);
  let slopePct = Number(slopePercentInput);

  if (!Number.isFinite(betaDeg) && Number.isFinite(slopePct) && slopePct >= 0) {
    betaDeg = (Math.atan(slopePct / 100) * 180) / Math.PI;
  }

  // Ekstraksi dari label rentang derajat poligon lereng jika angka langsung belum tersedia
  if (!Number.isFinite(betaDeg) && ketLerengInput) {
    const s = String(ketLerengInput);
    if (s.includes("35")) betaDeg = s.includes("25") ? 30.0 : 38.0;
    else if (s.includes("25")) betaDeg = 20.0;
    else if (s.includes("15")) betaDeg = 11.5;
    else if (s.includes("8")) betaDeg = 3.5;
  }

  // Fallback ke representatif kelas lereng poligon DEMNAS (1..5)
  if (!Number.isFinite(betaDeg)) {
    const sPoly = Number(skorPolyInput);
    if (Number.isFinite(sPoly) && sPoly >= 1 && sPoly <= 5) {
      betaDeg = SLOPE_CLASS_REPRESENTATIVE_DEG[Math.round(sPoly)];
    } else {
      betaDeg = 2.0;
    }
  }

  betaDeg = Math.max(0, Number(betaDeg.toFixed(2)));
  if (!Number.isFinite(slopePct) || slopePct < 0) {
    slopePct = Number((Math.tan((betaDeg * Math.PI) / 180) * 100).toFixed(2));
  } else {
    slopePct = Number(slopePct.toFixed(2));
  }

  let skor: 1 | 2 | 3 | 4 | 5 = 1;
  let rentangLabel = "0° – 8° (0% – 14,1%)";
  let keteranganGeoteknik =
    "Gaya gravitasi vertikal mengikat massa tanah; zona aman lereng (Van Zuidam / PSBA UGM).";

  if (betaDeg > 35.0 || slopePct > 70.0) {
    skor = 5;
    rentangLabel = ">35° (>70,0%)";
    keteranganGeoteknik =
      "Ekstrem / Non-buildable; melampaui batas kestabilan lereng alami tanah & batuan lapuk (SNI 8291:2016).";
  } else if (betaDeg > 25.0 || slopePct > 46.6) {
    skor = 4;
    rentangLabel = ">25° – 35° (46,6% – 70,0%)";
    keteranganGeoteknik =
      "Curam; berimpit sudut geser dalam batupasir & breksi lapuk (φ' = 25°–35°).";
  } else if (betaDeg > 15.0 || slopePct > 26.8) {
    skor = 3;
    rentangLabel = ">15° – 25° (26,8% – 46,6%)";
    keteranganGeoteknik =
      "Kritis; berimpit sudut geser efektif tuf & lempung Formasi Semilir (φ' = 15°–25°).";
  } else if (betaDeg > 8.0 || slopePct > 14.1) {
    skor = 2;
    rentangLabel = ">8° – 15° (14,1% – 26,8%)";
    keteranganGeoteknik =
      "Zona transisi miring; potensi rayapan tanah (soil creep) pada lempung solum tebal saat jenuh.";
  }

  return {
    betaDeg,
    slopePercent: slopePct,
    skor,
    bobot: GPKG_WEIGHTS.lereng,
    skorTertimbang: Number((skor * GPKG_WEIGHTS.lereng).toFixed(3)),
    rentangLabel,
    keteranganGeoteknik,
  };
}

/**
 * B. Evaluasi Karakteristik Tanah (Pedologi) - Bobot 25%
 * Berdasarkan 'Dasar.xlsx' Sheet Internal:
 * - Grumusol : Skor 5 (c' = 9.0 kPa,  φ' = 15.0°, γsat = 19.0 kN/m³, z = 2.0 m)
 * - Latosol  : Skor 4 (c' = 10.0 kPa, φ' = 18.0°, γsat = 18.5 kN/m³, z = 2.0 m)
 * - Mediteran: Skor 4 (c' = 11.0 kPa, φ' = 20.0°, γsat = 18.5 kN/m³, z = 2.5 m)
 * - Regosol  : Skor 3 (c' = 3.5 kPa,  φ' = 36.0°, γsat = 17.5 kN/m³, z = 1.0 m)
 * - Kambisol : Skor 2 (c' = 8.0 kPa,  φ' = 30.0°, γsat = 18.0 kN/m³, z = 2.0 m)
 * - Aluvial  : Skor 1 (c' = 14.0 kPa, φ' = 25.0°, γsat = 18.5 kN/m³, z = 4.0 m)
 */
export function evaluateSoilParameter(
  jenisTanahRaw?: string | null,
  overrides?: {
    cPrime?: number | null;
    phiPrime?: number | null;
    gammaSat?: number | null;
    zDepth?: number | null;
  }
): SoilParameterResult {
  const raw = String(jenisTanahRaw || "Regosol").trim();
  const low = raw.toLowerCase();

  let nama = "Regosol";
  let skor: 1 | 2 | 3 | 4 | 5 = 3;
  let cPrimeKpa = 3.5;
  let phiPrimeDeg = 36.0;
  let gammaSatKnM3 = 17.5;
  let zDepthM = 1.0;
  let isExpansive = false;
  let keteranganGeoteknik =
    "Pasir vulkanik lepas berkohesi rendah (c'=3,5 kPa, φ'=36°); permeabilitas tinggi namun peka erosi/gerusan.";

  if (
    low.includes("grumusol") ||
    low.includes("grumosol") ||
    low.includes("vertisol") ||
    low.includes("ekspansif")
  ) {
    nama = "Grumusol";
    skor = 5;
    cPrimeKpa = 9.0;
    phiPrimeDeg = 15.0;
    gammaSatKnM3 = 19.0;
    zDepthM = 2.0;
    isExpansive = true;
    keteranganGeoteknik =
      "Lempung hitam montmorilonit/smektit ekspansif tinggi (c'=9,0 kPa, φ'=15°); kembang-kerut ekstrem & sudut geser rendah.";
  } else if (low.includes("mediteran")) {
    nama = "Mediteran";
    skor = 4;
    cPrimeKpa = 11.0;
    phiPrimeDeg = 20.0;
    gammaSatKnM3 = 18.5;
    zDepthM = 2.5;
    isExpansive = false;
    keteranganGeoteknik =
      "Tanah pelapukan batu gamping/tuf solum tebal (z=2,5 m, c'=11,0 kPa, φ'=20°); plastisitas sedang-tinggi.";
  } else if (low.includes("latosol") || low.includes("andosol") || low.includes("litosol")) {
    nama = "Latosol";
    skor = 4;
    cPrimeKpa = 10.0;
    phiPrimeDeg = 18.0;
    gammaSatKnM3 = 18.5;
    zDepthM = 2.0;
    isExpansive = false;
    keteranganGeoteknik =
      "Lempung pelapukan vulkanik lanjut (z=2,0 m, c'=10,0 kPa, φ'=18°); rentan jenuh air pada lereng miring.";
  } else if (low.includes("kambisol") || low.includes("inceptisol") || low.includes("brown forest")) {
    nama = "Kambisol";
    skor = 2;
    cPrimeKpa = 8.0;
    phiPrimeDeg = 30.0;
    gammaSatKnM3 = 18.0;
    zDepthM = 2.0;
    isExpansive = false;
    keteranganGeoteknik =
      "Tanah perkembangan muda berdrainase cukup baik (c'=8,0 kPa, φ'=30°, z=2,0 m); daya dukung relatif stabil.";
  } else if (low.includes("aluvial") && !low.includes("regosol")) {
    nama = "Aluvial";
    skor = 1;
    cPrimeKpa = 14.0;
    phiPrimeDeg = 25.0;
    gammaSatKnM3 = 18.5;
    zDepthM = 4.0;
    isExpansive = false;
    keteranganGeoteknik =
      "Endapan dataran aluvial berlapis halus pada morfologi rata (c'=14,0 kPa, φ'=25°, z=4,0 m); bahaya longsor rendah.";
  }

  if (overrides) {
    if (Number.isFinite(Number(overrides.cPrime)) && Number(overrides.cPrime) > 0) {
      cPrimeKpa = Number(overrides.cPrime);
    }
    if (Number.isFinite(Number(overrides.phiPrime)) && Number(overrides.phiPrime) > 0) {
      phiPrimeDeg = Number(overrides.phiPrime);
    }
    if (Number.isFinite(Number(overrides.gammaSat)) && Number(overrides.gammaSat) > 0) {
      gammaSatKnM3 = Number(overrides.gammaSat);
    }
    if (Number.isFinite(Number(overrides.zDepth)) && Number(overrides.zDepth) > 0) {
      zDepthM = Number(overrides.zDepth);
    }
  }

  return {
    jenisTanah: nama,
    skor,
    bobot: GPKG_WEIGHTS.tanah,
    skorTertimbang: Number((skor * GPKG_WEIGHTS.tanah).toFixed(3)),
    cPrimeKpa,
    phiPrimeDeg,
    gammaSatKnM3,
    zDepthM,
    isExpansive,
    keteranganGeoteknik,
  };
}

/**
 * C. Evaluasi Litologi & Formasi Geologi - Bobot 20%
 * Berdasarkan 'Dasar.xlsx' Sheet Internal:
 * - Tmse, Tms3 (Semilir), Tmss (Sambipitu), Teon (Nanggulan), na (Avalanche): Skor 5
 * - Tmng (Nglanggran), Tomk (Kebobutak): Skor 4
 * - Tmps (Sentolo), Qmo (Merapi Tua): Skor 3
 * - Qmi, Qvu3 (Merapi Muda): Skor 2
 * - Tmwl (Wonosari), Qa (Aluvial): Skor 1
 */
export function evaluateLithologyParameter(
  formasiRaw?: string | null,
  simbolRaw?: string | null,
  skorOverride?: number | null
): LithologyParameterResult {
  const fullText = `${formasiRaw || ""} ${simbolRaw || ""}`.trim();
  const low = fullText.toLowerCase();

  let formasiBatuan = "Formasi Gunungapi Merapi Muda (Qmi)";
  let simbolFormasi = "Qmi";
  let skor: 1 | 2 | 3 | 4 | 5 = 2;
  let keteranganGeoteknik =
    "Pasir bergradasi baik (SW), permeabilitas tinggi, sudut geser dalam tinggi (φ' = 37°–48°).";

  if (
    low.includes("semilir") ||
    low.includes("tmse") ||
    low.includes("tms3") ||
    low.includes("sambipitu") ||
    low.includes("tmss") ||
    low.includes("nanggulan") ||
    low.includes("teon") ||
    low.includes("avalanche") ||
    low.includes("koluvial") ||
    /\bna\b/.test(low)
  ) {
    skor = 5;
    if (low.includes("sambipitu") || low.includes("tmss")) {
      formasiBatuan = "Formasi Sambipitu (Tmss)";
      simbolFormasi = "Tmss";
    } else if (low.includes("nanggulan") || low.includes("teon")) {
      formasiBatuan = "Formasi Nanggulan (Teon)";
      simbolFormasi = "Teon";
    } else if (low.includes("avalanche") || low.includes("koluvial") || /\bna\b/.test(low)) {
      formasiBatuan = "Endapan Guguran / Avalanche (na)";
      simbolFormasi = "na";
    } else {
      formasiBatuan = "Formasi Semilir (Tmse / Tms3)";
      simbolFormasi = "Tmse";
    }
    keteranganGeoteknik =
      "Batuan lemah (UCS 1–5 MPa, φ' = 15°–25°); serpih/tuf lapuk bertindak sebagai bidang gelincir kedap air.";
  } else if (
    low.includes("nglanggran") ||
    low.includes("tmng") ||
    low.includes("tmn") ||
    low.includes("kebobutak") ||
    low.includes("tomk")
  ) {
    skor = 4;
    if (low.includes("kebobutak") || low.includes("tomk")) {
      formasiBatuan = "Formasi Kebobutak (Tomk)";
      simbolFormasi = "Tomk";
    } else {
      formasiBatuan = "Formasi Nglanggran (Tmng)";
      simbolFormasi = "Tmng";
    }
    keteranganGeoteknik =
      "Breksi gunungapi & batupasir berkekar rapat; diskontinuitas tinggi (φ' = 25°–35°), rawan longsor baji/bidang.";
  } else if (
    low.includes("sentolo") ||
    low.includes("tmps") ||
    low.includes("merapi tua") ||
    low.includes("qmo")
  ) {
    skor = 3;
    if (low.includes("merapi tua") || low.includes("qmo")) {
      formasiBatuan = "Formasi Gunungapi Merapi Tua (Qmo)";
      simbolFormasi = "Qmo";
    } else {
      formasiBatuan = "Formasi Sentolo (Tmps)";
      simbolFormasi = "Tmps";
    }
    keteranganGeoteknik =
      "Batugamping napalan mengandung mineral lempung smektit / breksi vulkanik tua terlapuk sedang.";
  } else if (
    low.includes("wonosari") ||
    low.includes("tmwl") ||
    low.includes("tmw") ||
    low.includes("aluvial") ||
    /\bqa\b/.test(low)
  ) {
    skor = 1;
    if (low.includes("wonosari") || low.includes("tmwl") || low.includes("tmw")) {
      formasiBatuan = "Formasi Wonosari (Tmwl)";
      simbolFormasi = "Tmwl";
    } else {
      formasiBatuan = "Endapan Aluvial Kuarter (Qa)";
      simbolFormasi = "Qa";
    }
    keteranganGeoteknik =
      "Batugamping terumbu masif stabil atau endapan aluvial dataran banjir berlereng rata.";
  } else if (low.includes("qvu3") || low.includes("qmi") || low.includes("merapi muda")) {
    skor = 2;
    formasiBatuan = "Formasi Gunungapi Merapi Muda (Qmi / Qvu3)";
    simbolFormasi = "Qmi";
  }

  const sOvr = Number(skorOverride);
  if (Number.isFinite(sOvr) && sOvr >= 1 && sOvr <= 5) {
    skor = Math.round(sOvr) as 1 | 2 | 3 | 4 | 5;
  }

  return {
    formasiBatuan,
    simbolFormasi,
    skor,
    bobot: GPKG_WEIGHTS.batuan,
    skorTertimbang: Number((skor * GPKG_WEIGHTS.batuan).toFixed(3)),
    keteranganGeoteknik,
  };
}

/**
 * D. Evaluasi Curah Hujan Tahunan (Isohyet) - Bobot 15%
 * Berdasarkan 'Dasar.xlsx' Sheet Eksternal:
 * - >3.000 mm/tahun       -> Skor 5 (Rasio kejenuhan m = hw/z = 0.90)
 * - 2.501 - 3.000 mm/tahun -> Skor 4 (Rasio m = 0.75)
 * - 2.001 - 2.500 mm/tahun -> Skor 3 (Rasio m = 0.60)
 * - 1.500 - 2.000 mm/tahun -> Skor 2 (Rasio m = 0.45)
 * - <1.500 mm/tahun       -> Skor 1 (Rasio m = 0.30)
 */
export function evaluateRainfallParameter(
  curahHujanMmInput?: number | null,
  skorOverride?: number | null,
  rasioMOverride?: number | null
): RainfallParameterResult {
  const chMm = Number.isFinite(Number(curahHujanMmInput)) && Number(curahHujanMmInput) > 0
    ? Number(curahHujanMmInput)
    : 2250;

  let skor: 1 | 2 | 3 | 4 | 5 = 3;
  if (chMm > 3000) skor = 5;
  else if (chMm >= 2501) skor = 4;
  else if (chMm >= 2001) skor = 3;
  else if (chMm >= 1500) skor = 2;
  else skor = 1;

  const sOvr = Number(skorOverride);
  if (Number.isFinite(sOvr) && sOvr >= 1 && sOvr <= 5) {
    skor = Math.round(sOvr) as 1 | 2 | 3 | 4 | 5;
  }

  const mBySkor: Record<number, number> = {
    1: 0.30,
    2: 0.45,
    3: 0.60,
    4: 0.75,
    5: 0.90,
  };

  const labelBySkor: Record<number, string> = {
    1: "< 1.500 mm/tahun (Sangat Rendah)",
    2: "1.500 – 2.000 mm/tahun (Rendah)",
    3: "2.001 – 2.500 mm/tahun (Sedang)",
    4: "2.501 – 3.000 mm/tahun (Tinggi)",
    5: "> 3.000 mm/tahun (Sangat Tinggi)",
  };

  const descBySkor: Record<number, string> = {
    1: "Infiltrasi tahunan rendah (m = 0,30); tekanan air pori minimal sehingga tahanan geser bekerja optimal.",
    2: "Infiltrasi tahunan rendah–sedang (m = 0,45); kenaikan muka air pori masih terkendali.",
    3: "Rezim curah hujan sedang DIY (m = 0,60); memicu tekanan pori kritis pada lempung di atas tuf kedap.",
    4: "Akumulasi hujan tinggi (m = 0,75); cepat menjenuhkan solum tanah dan menambah beban berat isi jenuh.",
    5: "Infiltrasi masif (m = 0,90); muka air tanah bertengger mendekati permukaan & memicu tegangan pori maksimum.",
  };

  const mOvr = Number(rasioMOverride);
  const rasioKejenuhanM =
    Number.isFinite(mOvr) && mOvr > 0 && mOvr <= 1.0 ? Number(mOvr.toFixed(2)) : mBySkor[skor];

  return {
    curahHujanMm: Math.round(chMm),
    skor,
    bobot: GPKG_WEIGHTS.hujan,
    skorTertimbang: Number((skor * GPKG_WEIGHTS.hujan).toFixed(3)),
    rasioKejenuhanM,
    rentangLabel: labelBySkor[skor],
    keteranganGeoteknik: descBySkor[skor],
  };
}

/**
 * E. Evaluasi Tutupan Lahan - Bobot 10%
 * Berdasarkan 'Dasar.xlsx' Sheet Eksternal:
 * - Tanah Terbuka / Tambang / Tegalan / Sawah lereng >8° : Skor 5 (cr = 0 kPa, q = 0 kPa)
 * - Semak Belukar / Alang-alang                          : Skor 4 (cr = 0.5 kPa, q = 0 kPa)
 * - Permukiman / Bangunan / Jalan                        : Skor 3 (cr = 0 kPa, q = 15 kPa)
 * - Perkebunan / Kebun Campuran                          : Skor 2 (cr = 3.5 kPa, q = 0 kPa)
 * - Hutan Lahan Kering / Lindung / Tubuh Air             : Skor 1 (cr = 10.0 kPa, q = 0 kPa)
 */
export function evaluateLandUseParameter(
  tutupanRaw?: string | null,
  betaDeg: number = 0,
  skorOverride?: number | null
): LandUseParameterResult {
  const raw = String(tutupanRaw || "Permukiman").trim();
  const low = raw.toLowerCase();

  let skor: 1 | 2 | 3 | 4 | 5 = 3;
  let crKpa = 0.0;
  let qKpa = 15.0;
  let keteranganGeoteknik =
    "Permukiman / Bangunan / Jalan (cr = 0 kPa, beban tambahan pondasi/bangunan q = 15 kPa).";

  if (
    low.includes("terbuka") ||
    low.includes("tambang") ||
    low.includes("tegalan") ||
    low.includes("ladang") ||
    low.includes("sawah")
  ) {
    skor = 5;
    crKpa = 0.0;
    qKpa = 0.0;
    keteranganGeoteknik =
      betaDeg > 8.0
        ? "Tanah terbuka / tegalan / sawah pada lereng >8° (cr = 0 kPa, q = 0 kPa); infiltrasi tinggi tanpa pengikat akar dalam."
        : "Lahan pertanian basah / tegalan tanpa perkuatan akar pohon dalam (cr = 0 kPa, q = 0 kPa); infiltrasi permukaan tinggi.";
  } else if (
    low.includes("semak") ||
    low.includes("belukar") ||
    low.includes("alang") ||
    low.includes("rumput") ||
    low.includes("tanah kosong")
  ) {
    skor = 4;
    crKpa = 0.5;
    qKpa = 0.0;
    keteranganGeoteknik =
      "Semak belukar / alang-alang berakar serabut dangkal <0,3 m (cr = 0,5 kPa, q = 0 kPa); kurang mengikat bidang gelincir.";
  } else if (low.includes("kebun") || low.includes("perkebunan") || low.includes("campur")) {
    skor = 2;
    crKpa = 3.5;
    qKpa = 0.0;
    keteranganGeoteknik =
      "Perkebunan / kebun campuran pohon tahunan memberikan kohesi akar sedang (cr = 3,5 kPa, q = 0 kPa).";
  } else if (
    low.includes("hutan") ||
    low.includes("lindung") ||
    low.includes("konservasi") ||
    low.includes("sungai") ||
    low.includes("danau") ||
    low.includes("waduk") ||
    low.includes("air") ||
    low.includes("kolam") ||
    low.includes("tambak")
  ) {
    skor = 1;
    crKpa = 10.0;
    qKpa = 0.0;
    keteranganGeoteknik =
      "Hutan lahan kering / lindung / tubuh air dengan perakaran dalam mencengkeram lereng (cr = 10,0 kPa, q = 0 kPa).";
  }

  const sOvr = Number(skorOverride);
  if (Number.isFinite(sOvr) && sOvr >= 1 && sOvr <= 5) {
    skor = Math.round(sOvr) as 1 | 2 | 3 | 4 | 5;
    if (skor === 5) {
      crKpa = 0.0;
      qKpa = 0.0;
    } else if (skor === 4) {
      crKpa = 0.5;
      qKpa = 0.0;
    } else if (skor === 3) {
      crKpa = 0.0;
      qKpa = 15.0;
    } else if (skor === 2) {
      crKpa = 3.5;
      qKpa = 0.0;
    } else if (skor === 1) {
      crKpa = 10.0;
      qKpa = 0.0;
    }
  }

  return {
    tutupanLahan: raw,
    skor,
    bobot: GPKG_WEIGHTS.lahan,
    skorTertimbang: Number((skor * GPKG_WEIGHTS.lahan).toFixed(3)),
    kohesiAkarCrKpa: crKpa,
    bebanTambahanQKpa: qKpa,
    keteranganGeoteknik,
  };
}

/**
 * 3. Formula Analitis Faktor Keamanan (FS) Lereng Tak Terhingga (Infinite Slope):
 * FS = [ (c' + cr) + ((γsat * z - m * γw * z) + q) * (cos β)^2 * tan φ' ] / [ (γsat * z + q) * sin β * cos β ]
 *
 * Ketentuan:
 * - γw = 9.81 kN/m³
 * - Jika β <= 2.0°, kunci FS = 5.00 karena topografi datar murni
 * - Batasi nilai FS maksimal di angka 5.00 (menghindari bug nilai ekstrem tak berhingga)
 */
export function calculateInfiniteSlopeFS(params: {
  betaDeg: number;
  cPrimeKpa: number;
  crKpa: number;
  phiPrimeDeg: number;
  gammaSatKnM3: number;
  zDepthM: number;
  rasioKejenuhanM: number;
  surchargeLoadQKpa: number;
}): InfiniteSlopeAuditTrail {
  const betaDeg = Math.max(0, Number(params.betaDeg) || 0);
  const cPrimeKpa = Math.max(0, Number(params.cPrimeKpa) || 0);
  const crKpa = Math.max(0, Number(params.crKpa) || 0);
  const phiPrimeDeg = Math.max(1, Number(params.phiPrimeDeg) || 25);
  const gammaSatKnM3 = Math.max(10, Number(params.gammaSatKnM3) || 18);
  const zDepthM = Math.max(0.5, Number(params.zDepthM) || 2.0);
  const rasioKejenuhanM = Math.min(1.0, Math.max(0.0, Number(params.rasioKejenuhanM) || 0.6));
  const surchargeLoadQKpa = Math.max(0, Number(params.surchargeLoadQKpa) || 0);

  const totalCohesionKpa = Number((cPrimeKpa + crKpa).toFixed(2));
  const poreWaterPressureUKpa = Number((rasioKejenuhanM * GAMMA_WATER_KN_M3 * zDepthM).toFixed(2));

  const betaRad = (betaDeg * Math.PI) / 180;
  const phiRad = (phiPrimeDeg * Math.PI) / 180;
  const cosB = Math.cos(betaRad);
  const sinB = Math.sin(betaRad);
  const cos2B = cosB * cosB;

  const effectiveWeightTerm = gammaSatKnM3 * zDepthM - poreWaterPressureUKpa + surchargeLoadQKpa;
  const effectiveNormalStressKpa = Number((effectiveWeightTerm * cos2B).toFixed(2));
  const resistingShearStressKpa = Number(
    (totalCohesionKpa + effectiveNormalStressKpa * Math.tan(phiRad)).toFixed(2)
  );
  const drivingShearStressKpa = Number(
    ((gammaSatKnM3 * zDepthM + surchargeLoadQKpa) * sinB * cosB).toFixed(2)
  );

  if (betaDeg <= FLAT_SLOPE_THRESHOLD_DEG || drivingShearStressKpa <= 1e-6) {
    return {
      betaDeg,
      cPrimeKpa,
      crKpa,
      totalCohesionKpa,
      phiPrimeDeg,
      gammaSatKnM3,
      gammaWaterKnM3: GAMMA_WATER_KN_M3,
      zDepthM,
      rasioKejenuhanM,
      poreWaterPressureUKpa,
      surchargeLoadQKpa,
      effectiveNormalStressKpa,
      resistingShearStressKpa,
      drivingShearStressKpa,
      fsRaw: MAX_FS_CAP,
      fsCapped: MAX_FS_CAP,
      isFlatLocked: true,
    };
  }

  const fsRaw = Number((resistingShearStressKpa / drivingShearStressKpa).toFixed(2));
  const fsCapped = Number(Math.min(MAX_FS_CAP, Math.max(0.1, fsRaw)).toFixed(2));

  return {
    betaDeg,
    cPrimeKpa,
    crKpa,
    totalCohesionKpa,
    phiPrimeDeg,
    gammaSatKnM3,
    gammaWaterKnM3: GAMMA_WATER_KN_M3,
    zDepthM,
    rasioKejenuhanM,
    poreWaterPressureUKpa,
    surchargeLoadQKpa,
    effectiveNormalStressKpa,
    resistingShearStressKpa,
    drivingShearStressKpa,
    fsRaw,
    fsCapped,
    isFlatLocked: false,
  };
}

/**
 * Klasifikasi Kestabilan FS (Wicaksono & Khafid, 2022 & SNI 8291:2016):
 * - FS > 1.25         -> STABIL (Badge Hijau)
 * - 1.07 <= FS <= 1.25 -> KRITIS (Badge Kuning)
 * - FS < 1.07         -> LABIL / LONGSOR (Badge Merah)
 */
export function classifyStabilityFS(
  fsValue: number,
  isFlatLocked: boolean = false
): {
  status: StabilityStatus;
  badgeColor: "emerald" | "amber" | "red";
  keterangan: string;
} {
  if (isFlatLocked) {
    return {
      status: "STABIL",
      badgeColor: "emerald",
      keterangan:
        "Topografi datar murni (β ≤ 2,0°); gaya gravitasi bekerja vertikal mengikat massa tanah (FS dikunci 5,00).",
    };
  }

  if (fsValue > 1.25) {
    return {
      status: "STABIL",
      badgeColor: "emerald",
      keterangan:
        "FS > 1,25 (Stabil — Wicaksono & Khafid, 2022 & SNI): Tahanan geser efektif tanah melampaui tegangan geser penggerak lereng.",
    };
  }

  if (fsValue >= 1.07) {
    return {
      status: "KRITIS",
      badgeColor: "amber",
      keterangan:
        "1,07 ≤ FS ≤ 1,25 (Kritis — Wicaksono & Khafid, 2022 & SNI): Kestabilan lereng marjinal saat tanah jenuh air; wajib drainase lereng & perkuatan talud.",
    };
  }

  return {
    status: "LABIL / LONGSOR",
    badgeColor: "red",
    keterangan:
      "FS < 1,07 (Labil / Longsor — Wicaksono & Khafid, 2022 & SNI): Tegangan geser penggerak melampaui kuat geser tanah; bahaya kelongsoran aktif.",
  };
}

/**
 * Penentuan Kategori Zona Kelayakan GPKG (Permen PU No. 22/PRT/M/2007 & SNI 8291:2016):
 * - Skor Akhir < 2.20   -> ZONA HIJAU (Datar / Risiko Rendah / Konstruksi Standar)
 * - Skor Akhir 2.20-3.40 -> ZONA KUNING (Risiko Sedang / Perlu Mitigasi Drainase, Pondasi Khusus / Talud)
 * - Skor Akhir > 3.40   -> ZONA MERAH (Risiko Tinggi / Rawan Longsor / Non-Buildable)
 */
export function classifyGpkgZone(skorAkhir: number): {
  zonaKode: ZonaKelayakanKode;
  zonaLabel: string;
  zonaDeskripsi: string;
  warnaHex: string;
} {
  if (skorAkhir < 2.20) {
    return {
      zonaKode: "HIJAU",
      zonaLabel: "ZONA HIJAU",
      zonaDeskripsi: "Datar / Risiko Rendah / Konstruksi Standar",
      warnaHex: "#2E7D32",
    };
  }

  if (skorAkhir <= 3.40) {
    return {
      zonaKode: "KUNING",
      zonaLabel: "ZONA KUNING",
      zonaDeskripsi: "Risiko Sedang / Perlu Mitigasi Drainase, Pondasi Khusus / Talud",
      warnaHex: "#FB8C00",
    };
  }

  return {
    zonaKode: "MERAH",
    zonaLabel: "ZONA MERAH",
    zonaDeskripsi: "Risiko Tinggi / Rawan Longsor / Non-Buildable",
    warnaHex: "#D32F2F",
  };
}

/**
 * Fungsi Utama Kalkulasi Geoteknik Terpadu (Data-Driven dari 5 Parameter Lapangan)
 */
export function analyzeGeotechPoint(input: GeotechInputPayload): GeotechAnalysisResult {
  const lereng = evaluateSlopeParameter(
    input.betaDeg,
    input.slopePercent,
    input.skorLerengPoly,
    input.ketLerengPoly
  );

  const tanah = evaluateSoilParameter(input.jenisTanah, {
    cPrime: input.cPrimeOverride,
    phiPrime: input.phiPrimeOverride,
    gammaSat: input.gammaSatOverride,
    zDepth: input.zDepthOverride,
  });

  const batuan = evaluateLithologyParameter(
    input.formasiBatuan,
    input.simbolFormasi,
    input.skorBatuanOverride
  );

  const hujan = evaluateRainfallParameter(
    input.curahHujanMm,
    input.skorHujanOverride,
    input.rasioMOverride
  );

  const lahan = evaluateLandUseParameter(
    input.tutupanLahan,
    lereng.betaDeg,
    input.skorLahanOverride
  );

  const skorAkhir = Number(
    (
      lereng.skor * GPKG_WEIGHTS.lereng +
      tanah.skor * GPKG_WEIGHTS.tanah +
      batuan.skor * GPKG_WEIGHTS.batuan +
      hujan.skor * GPKG_WEIGHTS.hujan +
      lahan.skor * GPKG_WEIGHTS.lahan
    ).toFixed(2)
  );

  const zoneInfo = classifyGpkgZone(skorAkhir);

  const auditTrail = calculateInfiniteSlopeFS({
    betaDeg: lereng.betaDeg,
    cPrimeKpa: tanah.cPrimeKpa,
    crKpa: lahan.kohesiAkarCrKpa,
    phiPrimeDeg: tanah.phiPrimeDeg,
    gammaSatKnM3: tanah.gammaSatKnM3,
    zDepthM: tanah.zDepthM,
    rasioKejenuhanM: hujan.rasioKejenuhanM,
    surchargeLoadQKpa: lahan.bebanTambahanQKpa,
  });

  const fsClassification = classifyStabilityFS(auditTrail.fsCapped, auditTrail.isFlatLocked);

  return {
    skorAkhir,
    zonaKode: zoneInfo.zonaKode,
    zonaLabel: zoneInfo.zonaLabel,
    zonaDeskripsi: zoneInfo.zonaDeskripsi,
    warnaHex: zoneInfo.warnaHex,
    fs: auditTrail.fsCapped,
    fsStatus: fsClassification.status,
    fsBadgeColor: fsClassification.badgeColor,
    fsKeterangan: fsClassification.keterangan,
    parameters: {
      lereng,
      tanah,
      batuan,
      hujan,
      lahan,
    },
    auditTrail,
  };
}
