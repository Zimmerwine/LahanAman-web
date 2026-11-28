/**
 * utils/geotechCalculator.js
 * ============================================================================
 * ENGINE KALKULATOR & VERIFIKASI GEOTEKNIK LERENG DIY (100% PURE JAVASCRIPT)
 * LahanAman GeoAnalytics DIY
 *
 * Acuan Standar & Parameter Empiris:
 * - Dasar.xlsx (Sheet: Internal, Eksternal, Komparasi)
 * - SNI 8291:2016 & Permen PU No. 22/PRT/M/2007 (Bobot 5 Parameter GPKG)
 * - Metode Limit Equilibrium Lereng Tak Terhingga (Infinite Slope Method)
 * ============================================================================
 */

export const GAMMA_WATER_KN_M3 = 9.81;
export const MAX_FS_CAP = 9.99;
export const FLAT_SLOPE_THRESHOLD_DEG = 0.5;
export const SNI_FS_SAFE_THRESHOLD = 1.50;
export const SNI_FS_TARGET_LABEL = "Syarat Aman SNI 8460:2017: FS \u2265 1,50";

export const GPKG_WEIGHTS = {
  lereng: 0.30,
  tanah: 0.25,
  batuan: 0.20,
  hujan: 0.15,
  lahan: 0.10,
};

// 1. Tabel Lookup Parameter Tanah Terkunci (Layer 2)
export const SOIL_DATABASE = {
  grumusol: {
    nama: "Grumusol",
    skor: 5,
    c_kpa: 9.0,
    phi_deg: 15.0,
    gamma_sat: 19.0,
    z: 2.0,
    is_expansive: true,
    ket: "Grumusol (Lempung Ekspansif - Rawan Tinggi)",
    alasan: "Memiliki sudut geser dalam paling rendah (φ'=15°) dan sifat kembang-kerut tinggi (smektit). Rawan longsor & meretakkan fondasi.",
  },
  grumosol: {
    nama: "Grumusol",
    skor: 5,
    c_kpa: 9.0,
    phi_deg: 15.0,
    gamma_sat: 19.0,
    z: 2.0,
    is_expansive: true,
    ket: "Grumusol (Lempung Ekspansif - Rawan Tinggi)",
    alasan: "Memiliki sudut geser dalam paling rendah (φ'=15°) dan sifat kembang-kerut tinggi (smektit). Rawan longsor & meretakkan fondasi.",
  },
  latosol: {
    nama: "Latosol",
    skor: 4,
    c_kpa: 10.0,
    phi_deg: 18.0,
    gamma_sat: 18.5,
    z: 2.0,
    is_expansive: false,
    ket: "Latosol (Lempung Pelapukan Tebal - Rawan)",
    alasan: "Solum lempung tebal (2,0 m) di atas batuan kedap air Semilir/Nglanggran. Beban massa tanah berat saat jenuh memicu longsoran.",
  },
  mediteran: {
    nama: "Mediteran",
    skor: 4,
    c_kpa: 11.0,
    phi_deg: 20.0,
    gamma_sat: 18.5,
    z: 2.0,
    is_expansive: false,
    ket: "Mediteran (Lempung Karbonat/Tuf - Rawan)",
    alasan: "Tanah lempung pelapukan karbonat/tuf (2,0 m) berplastisitas sedang–tinggi di lereng perbukitan.",
  },
  regosol: {
    nama: "Regosol",
    skor: 3,
    c_kpa: 3.5,
    phi_deg: 36.0,
    gamma_sat: 17.5,
    z: 1.5,
    is_expansive: false,
    ket: "Regosol (Pasir Vulkanik Lepas - Sedang)",
    alasan: "Pasir vulkanik lepas dengan drainase baik (φ'=36°), namun ikatan kohesi lemah (c'=3,5 kPa) sehingga rentan tergerus pada tebing terjal.",
  },
  kambisol: {
    nama: "Kambisol",
    skor: 2,
    c_kpa: 8.0,
    phi_deg: 30.0,
    gamma_sat: 18.0,
    z: 1.5,
    is_expansive: false,
    ket: "Kambisol (Lempung Berpasir Drainase Baik - Rendah)",
    alasan: "Struktur agregat tanah lebih mantap, drainase sedang–baik, tidak ekspansif ekstrem.",
  },
  aluvial: {
    nama: "Aluvial",
    skor: 1,
    c_kpa: 14.0,
    phi_deg: 25.0,
    gamma_sat: 18.5,
    z: 2.0,
    is_expansive: false,
    ket: "Aluvial (Endapan Dataran - Aman Longsor Lereng)",
    alasan: "Endapan muda dataran banjir sungai rata (<4°), sangat aman dari ancaman kelongsoran lereng.",
  },
};

// Database Formasi Geologi dari Dasar.xlsx
export const GEOLOGY_DATABASE = {
  tmse: { skor: 5, nama: "Formasi Semilir", ket: "Formasi Semilir (Tuf/Lapili Lemah - Bidang Gelincir Utama)" },
  tms3: { skor: 5, nama: "Formasi Semilir", ket: "Formasi Semilir (Tuf/Lapili Lemah - Bidang Gelincir Utama)" },
  semilir: { skor: 5, nama: "Formasi Semilir", ket: "Formasi Semilir (Tuf/Lapili Lemah - Bidang Gelincir Utama)" },
  tmss: { skor: 5, nama: "Formasi Sambipitu", ket: "Formasi Sambipitu (Serpih/Batulanau Kedap Air - Rawan Tinggi)" },
  sambipitu: { skor: 5, nama: "Formasi Sambipitu", ket: "Formasi Sambipitu (Serpih/Batulanau Kedap Air - Rawan Tinggi)" },
  teon: { skor: 5, nama: "Formasi Nanggulan", ket: "Formasi Nanggulan (Batulempung/Napal Lapuk - Rawan Tinggi)" },
  nanggulan: { skor: 5, nama: "Formasi Nanggulan", ket: "Formasi Nanggulan (Batulempung/Napal Lapuk - Rawan Tinggi)" },
  na: { skor: 5, nama: "Endapan Longsoran", ket: "Endapan Longsoran Gunungapi (Rombakan Lereng Puncak Merapi)" },
  avalanche: { skor: 5, nama: "Endapan Longsoran", ket: "Endapan Longsoran Gunungapi (Rombakan Lereng Puncak Merapi)" },

  tmng: { skor: 4, nama: "Formasi Nglanggran", ket: "Formasi Nglanggran (Breksi Vulkanik Kekar Rapat - Rawan)" },
  nglanggran: { skor: 4, nama: "Formasi Nglanggran", ket: "Formasi Nglanggran (Breksi Vulkanik Kekar Rapat - Rawan)" },
  tomk: { skor: 4, nama: "Formasi Kebobutak", ket: "Formasi Kebobutak & Intrusi Diorit Godean (Breksi/Andesit Lapuk)" },
  kebobutak: { skor: 4, nama: "Formasi Kebobutak", ket: "Formasi Kebobutak & Intrusi Diorit Godean (Breksi/Andesit Lapuk)" },

  tmps: { skor: 3, nama: "Formasi Sentolo", ket: "Formasi Sentolo (Batugamping Napalan/Lempung - Sedang)" },
  sentolo: { skor: 3, nama: "Formasi Sentolo", ket: "Formasi Sentolo (Batugamping Napalan/Lempung - Sedang)" },
  qmo: { skor: 3, nama: "Endapan Merapi Tua", ket: "Endapan Merapi Tua (Breksi/Lava Bukit Turgo-Plawangan)" },
  "merapi tua": { skor: 3, nama: "Endapan Merapi Tua", ket: "Endapan Merapi Tua (Breksi/Lava Bukit Turgo-Plawangan)" },

  qmi: { skor: 2, nama: "Endapan Merapi Muda", ket: "Endapan Merapi Muda (Pasir-Kerikil Permeabel - Stabil Dataran)" },
  qvu3: { skor: 2, nama: "Batuan Merapi Muda", ket: "Batuan Merapi Muda (Pasir Bergradasi Baik SW)" },
  "merapi muda": { skor: 2, nama: "Endapan Merapi Muda", ket: "Endapan Merapi Muda (Pasir-Kerikil Permeabel - Stabil Dataran)" },

  tmwl: { skor: 1, nama: "Formasi Wonosari", ket: "Formasi Wonosari (Batugamping Terumbu Masif - Stabil)" },
  wonosari: { skor: 1, nama: "Formasi Wonosari", ket: "Formasi Wonosari (Batugamping Terumbu Masif - Stabil)" },
  qa: { skor: 1, nama: "Endapan Aluvial", ket: "Endapan Aluvial (Dataran Sungai/Pantai - Aman Longsor Lereng)" },
  aluvial: { skor: 1, nama: "Endapan Aluvial", ket: "Endapan Aluvial (Dataran Sungai/Pantai - Aman Longsor Lereng)" },
};

/**
 * 1. Evaluasi Kemiringan Lereng (β) - Bobot 30%
 */
export function evaluateSlope(betaDegInput, slopePercentInput, skorPolyInput, ketLerengInput) {
  let betaDeg = Number(betaDegInput);
  let slopePct = Number(slopePercentInput);

  if (!Number.isFinite(betaDeg) && Number.isFinite(slopePct) && slopePct >= 0) {
    betaDeg = (Math.atan(slopePct / 100) * 180) / Math.PI;
  }

  if (!Number.isFinite(betaDeg) && ketLerengInput) {
    const s = String(ketLerengInput);
    if (s.includes("35")) betaDeg = s.includes("25") ? 30.0 : 38.0;
    else if (s.includes("25")) betaDeg = 20.0;
    else if (s.includes("15")) betaDeg = 11.5;
    else if (s.includes("8")) betaDeg = 3.5;
  }

  if (!Number.isFinite(betaDeg)) {
    const sPoly = Number(skorPolyInput);
    const midMap = { 1: 3.5, 2: 11.5, 3: 20.0, 4: 30.0, 5: 38.0 };
    betaDeg = midMap[Math.round(sPoly)] ?? 3.5;
  }

  betaDeg = Math.max(0, Number(betaDeg.toFixed(2)));
  if (!Number.isFinite(slopePct) || slopePct < 0) {
    slopePct = Number((Math.tan((betaDeg * Math.PI) / 180) * 100).toFixed(2));
  } else {
    slopePct = Number(slopePct.toFixed(2));
  }

  let skor = 1;
  let rentangLabel = "0° – 8° (0% – 14.1%)";
  let keteranganGeoteknik = "FS > 1.80 seluruh jenis tanah di DIY; gaya gravitasi vertikal mengikat massa tanah (Van Zuidam / PSBA UGM).";

  if (betaDeg > 35.0 || slopePct > 70.0) {
    skor = 5;
    rentangLabel = ">35° (>70.0%)";
    keteranganGeoteknik = "Zona Merah Ekstrem (Non-Buildable); melampaui batas kestabilan lereng alami tanah dan batuan lapuk (SNI 8291:2016).";
  } else if (betaDeg > 25.0 || slopePct > 46.6) {
    skor = 4;
    rentangLabel = ">25° – 35° (46.6% – 70.0%)";
    keteranganGeoteknik = "Berimpit sudut geser batupasir & breksi lapuk (φ'=25°–35°). Kritis pada lereng tanpa perkuatan talud.";
  } else if (betaDeg > 15.0 || slopePct > 26.8) {
    skor = 3;
    rentangLabel = ">15° – 25° (26.8% – 46.6%)";
    keteranganGeoteknik = "Berimpit sudut geser dalam efektif tuf & lempung Semilir (φ'=15°–25°). Rawan longsor pada tanah solum tebal.";
  } else if (betaDeg > 8.0 || slopePct > 14.1) {
    skor = 2;
    rentangLabel = ">8° – 15° (14.1% – 26.8%)";
    keteranganGeoteknik = "Zona transisi miring; tanah lempung tebal mulai berpotensi rayapan (creep) saat musim hujan.";
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
 * 2. Evaluasi Karakteristik Tanah (Pedologi) - Bobot 25%
 */
export function evaluateSoil(jenisTanahRaw, overrides = {}) {
  const low = String(jenisTanahRaw || "Regosol").toLowerCase();
  let baseInfo = SOIL_DATABASE.regosol;

  for (const [key, info] of Object.entries(SOIL_DATABASE)) {
    if (low.includes(key)) {
      baseInfo = info;
      break;
    }
  }

  const skor = overrides.skorTanah ? Math.round(Number(overrides.skorTanah)) : baseInfo.skor;
  const cPrimeKpa = Number(overrides.cPrime ?? baseInfo.c_kpa);
  const phiPrimeDeg = Number(overrides.phiPrime ?? baseInfo.phi_deg);
  const gammaSatKnM3 = Number(overrides.gammaSat ?? baseInfo.gamma_sat);
  const zDepthM = Number(overrides.zDepth ?? baseInfo.z);
  const isExpansive = Boolean(overrides.isExpansive ?? baseInfo.is_expansive);

  return {
    jenisTanah: baseInfo.nama,
    skor,
    bobot: GPKG_WEIGHTS.tanah,
    skorTertimbang: Number((skor * GPKG_WEIGHTS.tanah).toFixed(3)),
    cPrimeKpa,
    phiPrimeDeg,
    gammaSatKnM3,
    zDepthM,
    isExpansive,
    keteranganGeoteknik: `${baseInfo.ket}: c'=${cPrimeKpa.toFixed(1)} kPa, φ'=${phiPrimeDeg.toFixed(1)}°, γsat=${gammaSatKnM3.toFixed(1)} kN/m³, z=${zDepthM.toFixed(1)} m. ${baseInfo.alasan}`,
  };
}

/**
 * 3. Evaluasi Formasi Geologi / Litologi - Bobot 20%
 */
export function evaluateLithology(formasiRaw, simbolRaw, skorOverride) {
  const text = `${formasiRaw || ""} ${simbolRaw || ""}`.toLowerCase();
  let baseInfo = { skor: 2, nama: "Endapan Merapi Muda", ket: "Endapan Merapi Muda (Pasir-Kerikil Permeabel - Stabil Dataran)" };

  for (const [key, info] of Object.entries(GEOLOGY_DATABASE)) {
    if (text.includes(key)) {
      baseInfo = info;
      break;
    }
  }

  const skor = skorOverride ? Math.round(Number(skorOverride)) : baseInfo.skor;

  return {
    formasiBatuan: baseInfo.nama,
    simbolFormasi: simbolRaw || "",
    skor,
    bobot: GPKG_WEIGHTS.batuan,
    skorTertimbang: Number((skor * GPKG_WEIGHTS.batuan).toFixed(3)),
    keteranganGeoteknik: baseInfo.ket,
  };
}

/**
 * 4. Evaluasi Curah Hujan Tahunan (Isohyet) - Bobot 15%
 */
export function evaluateRainfall(curahHujanMmInput, skorOverride, rasioMOverride) {
  let chMm = Number(curahHujanMmInput);
  if (!Number.isFinite(chMm) || chMm <= 0) {
    const sOvr = Number(skorOverride);
    const chMap = { 5: 3200, 4: 2750, 3: 2250, 2: 1750, 1: 1350 };
    chMm = chMap[sOvr] ?? 2250;
  }

  let skor = 3;
  let rasioM = 0.60;
  let rentangLabel = "2.001 – 2.500 mm/tahun (Sedang)";
  let keteranganGeoteknik = "Rezim curah hujan dominan DIY; memicu tekanan air pori kritis jika tanah lempung jenuh di atas formasi kedap air.";

  if (chMm > 3000) {
    skor = 5;
    rasioM = 0.90;
    rentangLabel = "> 3.000 mm/tahun (Sangat Tinggi)";
    keteranganGeoteknik = "Infiltrasi air hujan masif (m=0.90); muka air tanah bertengger memangkas kuat geser efektif secara ekstrem.";
  } else if (chMm >= 2501) {
    skor = 4;
    rasioM = 0.75;
    rentangLabel = "2.501 – 3.000 mm/tahun (Tinggi)";
    keteranganGeoteknik = "Akumulasi hujan tinggi (m=0.75); lapisan tanah penutup cepat mencapai kondisi jenuh dan menambah beban massa tanah.";
  } else if (chMm >= 2001) {
    skor = 3;
    rasioM = 0.60;
    rentangLabel = "2.001 – 2.500 mm/tahun (Sedang)";
    keteranganGeoteknik = "Rezim hujan sedang (m=0.60); stabil pada tanah sarang (Regosol), namun perlu waspada pada lempung tebal.";
  } else if (chMm >= 1500) {
    skor = 2;
    rasioM = 0.45;
    rentangLabel = "1.500 – 2.000 mm/tahun (Rendah)";
    keteranganGeoteknik = "Suplai infiltrasi hujan lebih rendah (m=0.45); kenaikan air pori moderat.";
  } else {
    skor = 1;
    rasioM = 0.30;
    rentangLabel = "< 1.500 mm/tahun (Sangat Rendah)";
    keteranganGeoteknik = "Tekanan air pori minimal (m=0.30); kohesi dan gesekan antarbutir bekerja optimal.";
  }

  if (skorOverride && Number(skorOverride) >= 1 && Number(skorOverride) <= 5) {
    skor = Math.round(Number(skorOverride));
  }
  if (rasioMOverride && Number(rasioMOverride) > 0 && Number(rasioMOverride) <= 1.0) {
    rasioM = Number(Number(rasioMOverride).toFixed(2));
  }

  return {
    curahHujanMm: Math.round(chMm),
    skor,
    bobot: GPKG_WEIGHTS.hujan,
    skorTertimbang: Number((skor * GPKG_WEIGHTS.hujan).toFixed(3)),
    rasioKejenuhanM: rasioM,
    rentangLabel,
    keteranganGeoteknik,
  };
}

/**
 * 5. Evaluasi Tutupan Lahan - Bobot 10%
 */
export function evaluateLandUse(tutupanRaw, betaDeg = 0, skorOverride) {
  const low = String(tutupanRaw || "Permukiman").toLowerCase();

  let skor = 3;
  let cr = 0.0;
  let q = 15.0;
  let ket = "Permukiman / Bangunan / Kawasan Terbangun (Beban Tambahan Surcharge 15.0 kPa)";

  if (
    low.includes("terbuka") ||
    low.includes("tambang") ||
    low.includes("tegalan") ||
    low.includes("ladang") ||
    (low.includes("sawah") && betaDeg > 8.0)
  ) {
    skor = 5;
    cr = 0.0;
    q = 0.0;
    ket = "Tanah Terbuka / Tambang / Tegalan / Sawah Lereng (>8°): Tanpa perkuatan akar dalam (cr=0) & infiltrasi tinggi.";
  } else if (
    low.includes("semak") ||
    low.includes("belukar") ||
    low.includes("alang") ||
    low.includes("rumput") ||
    low.includes("tanah kosong")
  ) {
    skor = 4;
    cr = 0.5;
    q = 0.0;
    ket = "Semak Belukar / Alang-alang: Perakaran serabut dangkal (cr=0.5 kPa) tidak mengikat bidang gelincir dalam.";
  } else if (low.includes("kebun") || low.includes("perkebunan") || low.includes("campur")) {
    skor = 2;
    cr = 3.5;
    q = 0.0;
    ket = "Perkebunan / Kebun Campuran: Vegetasi pohon tahunan memberi kohesi perakaran (cr=3.5 kPa) dan menahan erosi.";
  } else if (
    low.includes("hutan") ||
    low.includes("lindung") ||
    low.includes("rimba") ||
    low.includes("sungai") ||
    low.includes("danau") ||
    low.includes("air")
  ) {
    skor = 1;
    cr = 10.0;
    q = 0.0;
    ket = "Hutan Lindung / Kawasan Konservasi: Perakaran pohon dalam sangat kuat (cr=10.0 kPa) mengikat kestabilan lereng.";
  }

  if (skorOverride && Number(skorOverride) >= 1 && Number(skorOverride) <= 5) {
    skor = Math.round(Number(skorOverride));
  }

  return {
    tutupanLahan: tutupanRaw || "Permukiman",
    skor,
    bobot: GPKG_WEIGHTS.lahan,
    skorTertimbang: Number((skor * GPKG_WEIGHTS.lahan).toFixed(3)),
    kohesiAkarCrKpa: cr,
    bebanTambahanQKpa: q,
    keteranganGeoteknik: ket,
  };
}

/**
 * Validasi rasio_m berada di rentang [0.0, 1.0] (jangan sampai terisi skor_hujan atau curah hujan mm)
 */
export function sanitizeRasioM(rasioMInput, fallback = 0.60) {
  const n = Number(rasioMInput);
  if (!Number.isFinite(n)) return fallback;
  if (n >= 0.0 && n <= 1.0) return n;
  const sMap = { 1: 0.45, 2: 0.45, 3: 0.60, 4: 0.75, 5: 0.90 };
  if (Number.isInteger(Math.round(n)) && Math.round(n) >= 1 && Math.round(n) <= 5) {
    return sMap[Math.round(n)] || fallback;
  }
  if (n > 3000) return 0.90;
  if (n >= 2501) return 0.75;
  if (n >= 2001) return 0.60;
  if (n >= 1500) return 0.45;
  return fallback;
}

/**
 * 6. Hitung Faktor Keamanan Lereng Tak Terhingga (Infinite Slope with Seepage)
 *    dan Penentuan FS_pasca sesuai Koridor SPK (Target SNI 8460:2017 >= 1.50)
 */
export function computeRawInfiniteSlopeFS(betaDeg, cPrime, phiDeg, gammaSat, zDepth, rasioM) {
  const beta = Math.max(0.0, Number(betaDeg) || 0.0);
  const c = Number(cPrime) || 3.5;
  const phi = Number(phiDeg) || 30.0;
  const gamma = Number(gammaSat) || 18.0;
  const z = Number(zDepth) || 2.0;
  const m = sanitizeRasioM(rasioM, 0.60);

  const sigmaV = gamma * z;
  const uRaw = m * GAMMA_WATER_KN_M3 * z;

  if (beta <= FLAT_SLOPE_THRESHOLD_DEG) {
    return {
      fsRaw: 9.99,
      fs: 9.99,
      sigmaV: Number(sigmaV.toFixed(2)),
      uKpa: Number(uRaw.toFixed(2)),
      sigmaNPrime: Number((sigmaV - uRaw).toFixed(2)),
      tauF: Number((c + (sigmaV - uRaw) * Math.tan((phi * Math.PI) / 180)).toFixed(4)),
      tauD: 0.0,
      isFlatLocked: true,
    };
  }

  const betaRad = (beta * Math.PI) / 180;
  const phiRad = (phi * Math.PI) / 180;
  const cosB = Math.cos(betaRad);
  const sinB = Math.sin(betaRad);

  const tauD = sigmaV * sinB * cosB;
  if (tauD <= 1e-6) {
    return {
      fsRaw: 9.99,
      fs: 9.99,
      sigmaV: Number(sigmaV.toFixed(2)),
      uKpa: Number(uRaw.toFixed(2)),
      sigmaNPrime: Number(((sigmaV - uRaw) * cosB * cosB).toFixed(2)),
      tauF: Number((c + (sigmaV - uRaw) * cosB * cosB * Math.tan(phiRad)).toFixed(4)),
      tauD: 0.0,
      isFlatLocked: true,
    };
  }

  const sigmaNPrime = (sigmaV - uRaw) * Math.pow(cosB, 2);
  const tauF = c + sigmaNPrime * Math.tan(phiRad);
  const fsRaw = Math.min(MAX_FS_CAP, Math.max(0.05, tauF / tauD));
  const fs = Number(fsRaw.toFixed(2));

  return {
    fsRaw: Number(fsRaw.toFixed(4)),
    fs,
    sigmaV: Number(sigmaV.toFixed(2)),
    uKpa: Number(uRaw.toFixed(2)),
    sigmaNPrime: Number(sigmaNPrime.toFixed(4)),
    tauF: Number(tauF.toFixed(4)),
    tauD: Number(tauD.toFixed(4)),
    isFlatLocked: false,
  };
}

export function evaluateSpkCorridor(
  betaDeg,
  fsAwalRaw,
  cPrime,
  phiDeg,
  gammaSat,
  zDepth,
  options = {}
) {
  const betaAwal = Math.max(0.0, Number(betaDeg) || 0.0);
  const soilStr = String(options.jenisTanah || "").toLowerCase();
  const isExpansive =
    Boolean(options.isExpansive) ||
    soilStr.includes("grumusol") ||
    soilStr.includes("grumosol") ||
    soilStr.includes("vertisol");
  const rockStr = String(options.formasiBatuan || options.simbolFormasi || "").toLowerCase();
  const isLandslideDeposit =
    /\bna\b/.test(rockStr) ||
    rockStr.includes("(na)") ||
    rockStr.includes("endapan longsoran") ||
    rockStr.includes("avalanche");

  let koridor = "KOR-01";
  let betaPasca = betaAwal;
  let mPasca = 0.45;
  let fsPascaRaw = null;
  let fsPasca = null;
  let rekomendasiKoridor = "";

  if (betaAwal > 35.0 || isLandslideDeposit) {
    koridor = "KOR-06";
    betaPasca = null;
    mPasca = null;
    rekomendasiKoridor =
      "KOR-06 (\u03B2 > 35\u00B0 atau endapan longsoran na): Tidak direkomendasikan untuk bangunan (status Zona Konservasi).";
  } else if (betaAwal > 25.0 || fsAwalRaw < 1.25) {
    koridor = "KOR-05";
    betaPasca = Math.min(betaAwal, 14.0);
    mPasca = 0.45;
    let calc = computeRawInfiniteSlopeFS(betaPasca, cPrime, phiDeg, gammaSat, zDepth, mPasca);
    while (calc.fsRaw < 1.50 && betaPasca > 0.5) {
      betaPasca = Number(Math.max(0.5, betaPasca - 0.5).toFixed(2));
      calc = computeRawInfiniteSlopeFS(betaPasca, cPrime, phiDeg, gammaSat, zDepth, mPasca);
    }
    fsPascaRaw = calc.fsRaw;
    fsPasca = calc.fs;
    rekomendasiKoridor =
      "KOR-05 (25\u00B0 < \u03B2 \u2264 35\u00B0 atau FS_awal < 1,25): Terasering + Dinding Penahan Tanah (DPT) dengan lereng antar-teras memenuhi FS_pasca \u2265 1,50 dan desain DPT memenuhi FK_geser \u2265 1,50 serta FK_guling \u2265 2,00 (SNI 8460:2017).";
  } else if (betaAwal > 15.0 || fsAwalRaw < 1.50) {
    koridor = "KOR-04";
    betaPasca = Math.min(betaAwal, 14.0);
    mPasca = 0.45;
    let calc = computeRawInfiniteSlopeFS(betaPasca, cPrime, phiDeg, gammaSat, zDepth, mPasca);
    while (calc.fsRaw < 1.50 && betaPasca > 0.5) {
      betaPasca = Number(Math.max(0.5, betaPasca - 0.5).toFixed(2));
      calc = computeRawInfiniteSlopeFS(betaPasca, cPrime, phiDeg, gammaSat, zDepth, mPasca);
    }
    fsPascaRaw = calc.fsRaw;
    fsPasca = calc.fs;
    rekomendasiKoridor =
      "KOR-04 (15\u00B0 < \u03B2 \u2264 25\u00B0 atau 1,25 \u2264 FS_awal < 1,50): Cut & fill terasering ke \u03B2_pasca = 14\u00B0 (atau diturunkan bertahap hingga FS_pasca \u2265 1,50) + sub-drain (m_pasca = 0,45).";
  } else if (betaAwal > 8.0) {
    koridor = "KOR-03";
    betaPasca = Math.min(betaAwal, 10.0);
    mPasca = 0.45;
    const calc = computeRawInfiniteSlopeFS(betaPasca, cPrime, phiDeg, gammaSat, zDepth, mPasca);
    fsPascaRaw = calc.fsRaw;
    fsPasca = calc.fs;
    rekomendasiKoridor =
      "KOR-03 (8\u00B0 < \u03B2 \u2264 15\u00B0): Pelandaian ringan ke \u03B2_pasca = min(\u03B2_awal, 10\u00B0) + drainase (m_pasca = 0,45).";
  } else {
    koridor = isExpansive ? "KOR-02" : "KOR-01";
    betaPasca = betaAwal;
    mPasca = 0.45;
    const calc = computeRawInfiniteSlopeFS(betaPasca, cPrime, phiDeg, gammaSat, zDepth, mPasca);
    fsPascaRaw = calc.fsRaw;
    fsPasca = calc.fs;
    rekomendasiKoridor = isExpansive
      ? "KOR-02 (\u03B2 \u2264 8\u00B0, Grumusol Ekspansif): \u03B2_pasca = \u03B2_awal, drainase keliling menurunkan kejenuhan ke m_pasca = 0,45 + perbaikan tanah ekspansif."
      : "KOR-01 (\u03B2 \u2264 8\u00B0): \u03B2_pasca = \u03B2_awal, drainase keliling menurunkan kejenuhan ke m_pasca = 0,45.";
  }

  return {
    koridor,
    betaPasca,
    mPasca,
    fsPascaRaw,
    fsPasca,
    rekomendasiKoridor,
  };
}

export function computeInfiniteSlopeFS(
  betaDeg,
  cPrime,
  cr,
  phiDeg,
  gammaSat,
  zDepth,
  rasioM,
  qSurcharge,
  options = {}
) {
  const mClean = sanitizeRasioM(rasioM, 0.60);
  const raw = computeRawInfiniteSlopeFS(betaDeg, cPrime, phiDeg, gammaSat, zDepth, mClean);
  const kor = evaluateSpkCorridor(betaDeg, raw.fsRaw, cPrime, phiDeg, gammaSat, zDepth, options);

  let fsStatus = `Aman \u2014 ${kor.koridor}`;
  let fsBadgeColor = "emerald";
  let fsKeterangan = `${SNI_FS_TARGET_LABEL}. ${kor.rekomendasiKoridor}`;

  if (kor.koridor === "KOR-06") {
    fsStatus = "Zona Konservasi \u2014 KOR-06";
    fsBadgeColor = "red";
  } else if (raw.fsRaw < 1.25) {
    fsStatus = `Kritis \u2014 ${kor.koridor}`;
    fsBadgeColor = "red";
  } else if (raw.fsRaw < SNI_FS_SAFE_THRESHOLD) {
    fsStatus = `Tidak Aman \u2014 ${kor.koridor}`;
    fsBadgeColor = "amber";
  }

  if (raw.isFlatLocked) {
    fsKeterangan = `Lereng datar (\u03B2 \u2264 0,5\u00B0); FS_awal = 9,99 (stabil gravitasi). ${kor.rekomendasiKoridor}`;
  }

  return {
    fs: raw.fs,
    fsRaw: raw.fsRaw,
    fsAwal: raw.fs,
    fsAwalRaw: raw.fsRaw,
    fsPasca: kor.fsPasca,
    fsPascaRaw: kor.fsPascaRaw,
    koridor: kor.koridor,
    betaPasca: kor.betaPasca,
    mPasca: kor.mPasca,
    fsStatus,
    fsBadgeColor,
    fsKeterangan,
    sniLabel: SNI_FS_TARGET_LABEL,
    uKpa: raw.uKpa,
    sigmaVKpa: raw.sigmaV,
    sigmaNPrimeKpa: raw.sigmaNPrime,
    tauFKpa: raw.tauF,
    tauDKpa: raw.tauD,
    isFlatLocked: raw.isFlatLocked,
  };
}

/**
 * 7. Klasifikasi Zona Kelayakan GPKG
 */
export function classifyZone(skorAkhir) {
  if (skorAkhir < 2.20) {
    return {
      zonaKode: "HIJAU",
      zonaLabel: "ZONA HIJAU",
      zonaDeskripsi: "Datar / Risiko Rendah / Konstruksi Standar",
      warnaHex: "#10b981",
      borderHex: "#059669",
    };
  } else if (skorAkhir <= 3.40) {
    return {
      zonaKode: "KUNING",
      zonaLabel: "ZONA KUNING",
      zonaDeskripsi: "Risiko Sedang / Perlu Mitigasi Drainase & Talud",
      warnaHex: "#f59e0b",
      borderHex: "#d97706",
    };
  } else {
    return {
      zonaKode: "MERAH",
      zonaLabel: "ZONA MERAH",
      zonaDeskripsi: "Risiko Tinggi / Rawan Longsor / Non-Buildable",
      warnaHex: "#ef4444",
      borderHex: "#dc2626",
    };
  }
}

/**
 * 8. Analisis Menyeluruh Titik / Poligon Geoteknik
 */
export function analyzeGeotechPoint(payload = {}) {
  const pLereng = evaluateSlope(
    payload.betaDeg,
    payload.slopePercent,
    payload.skorLerengPoly,
    payload.ketLerengPoly
  );

  const pTanah = evaluateSoil(payload.jenisTanah, {
    cPrime: payload.cPrimeOverride,
    phiPrime: payload.phiPrimeOverride,
    gammaSat: payload.gammaSatOverride,
    zDepth: payload.zDepthOverride,
    skorTanah: payload.skorTanahOverride,
    isExpansive: payload.isExpansiveOverride,
  });

  const pBatuan = evaluateLithology(
    payload.formasiBatuan,
    payload.simbolFormasi,
    payload.skorBatuanOverride
  );

  const pHujan = evaluateRainfall(
    payload.curahHujanMm,
    payload.skorHujanOverride,
    payload.rasioMOverride
  );

  const pLahan = evaluateLandUse(
    payload.tutupanLahan,
    pLereng.betaDeg,
    payload.skorLahanOverride
  );

  const skorAkhir = Number(
    (
      pLereng.skorTertimbang +
      pTanah.skorTertimbang +
      pBatuan.skorTertimbang +
      pHujan.skorTertimbang +
      pLahan.skorTertimbang
    ).toFixed(2)
  );

  const zone = classifyZone(skorAkhir);

  const fsResult = computeInfiniteSlopeFS(
    pLereng.betaDeg,
    pTanah.cPrimeKpa,
    pLahan.kohesiAkarCrKpa,
    pTanah.phiPrimeDeg,
    pTanah.gammaSatKnM3,
    pTanah.zDepthM,
    pHujan.rasioKejenuhanM,
    pLahan.bebanTambahanQKpa,
    {
      jenisTanah: pTanah.jenisTanah,
      isExpansive: pTanah.isExpansive,
      formasiBatuan: pBatuan.formasiBatuan,
      simbolFormasi: pBatuan.simbolFormasi,
    }
  );

  return {
    skorAkhir,
    zonaKode: zone.zonaKode,
    zonaLabel: zone.zonaLabel,
    zonaDeskripsi: zone.zonaDeskripsi,
    warnaHex: zone.warnaHex,
    borderHex: zone.borderHex,
    fs: fsResult.fs,
    fsRaw: fsResult.fsRaw,
    fsAwal: fsResult.fsAwal,
    fsAwalRaw: fsResult.fsAwalRaw,
    fsPasca: fsResult.fsPasca,
    fsPascaRaw: fsResult.fsPascaRaw,
    koridor: fsResult.koridor,
    betaPasca: fsResult.betaPasca,
    mPasca: fsResult.mPasca,
    sniLabel: fsResult.sniLabel,
    fsStatus: fsResult.fsStatus,
    fsBadgeColor: fsResult.fsBadgeColor,
    fsKeterangan: fsResult.fsKeterangan,
    parameters: {
      lereng: pLereng,
      tanah: pTanah,
      batuan: pBatuan,
      hujan: pHujan,
      lahan: pLahan,
    },
    auditTrail: {
      betaDeg: pLereng.betaDeg,
      cPrimeKpa: pTanah.cPrimeKpa,
      crKpa: pLahan.kohesiAkarCrKpa,
      phiPrimeDeg: pTanah.phiPrimeDeg,
      gammaSatKnM3: pTanah.gammaSatKnM3,
      zDepthM: pTanah.zDepthM,
      rasioKejenuhanM: pHujan.rasioKejenuhanM,
      poreWaterPressureUKpa: fsResult.uKpa,
      surchargeLoadQKpa: pLahan.bebanTambahanQKpa,
      fsAwal: fsResult.fsAwal,
      fsPasca: fsResult.fsPasca,
      koridor: fsResult.koridor,
      betaPasca: fsResult.betaPasca,
      mPasca: fsResult.mPasca,
    },
  };
}
