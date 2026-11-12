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
export const MAX_FS_CAP = 5.0;
export const FLAT_SLOPE_THRESHOLD_DEG = 2.0;

export const GPKG_WEIGHTS = {
  lereng: 0.30,
  tanah: 0.25,
  batuan: 0.20,
  hujan: 0.15,
  lahan: 0.10,
};

// Database Karakteristik Tanah dari Dasar.xlsx
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
    alasan: "Solum lempung tebal (>2m) di atas batuan kedap air Semilir/Nglanggran. Beban massa tanah berat saat jenuh memicu longsoran rotasi.",
  },
  mediteran: {
    nama: "Mediteran",
    skor: 4,
    c_kpa: 11.0,
    phi_deg: 20.0,
    gamma_sat: 18.5,
    z: 2.5,
    is_expansive: false,
    ket: "Mediteran (Lempung Karbonat/Tuf - Rawan)",
    alasan: "Tanah lempung pelapukan karbonat/tuf tebal (>2m) berplastisitas sedang–tinggi di lereng perbukitan.",
  },
  regosol: {
    nama: "Regosol",
    skor: 3,
    c_kpa: 3.5,
    phi_deg: 36.0,
    gamma_sat: 17.5,
    z: 1.0,
    is_expansive: false,
    ket: "Regosol (Pasir Vulkanik Lepas - Sedang)",
    alasan: "Pasir vulkanik lepas dengan drainase baik (φ'=36°), namun ikatan kohesi lemah (c'=3.5 kPa) sehingga rentan tergerus pada tebing terjal.",
  },
  kambisol: {
    nama: "Kambisol",
    skor: 2,
    c_kpa: 8.0,
    phi_deg: 30.0,
    gamma_sat: 18.0,
    z: 2.0,
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
    z: 4.0,
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
 * 6. Hitung Faktor Keamanan Lereng Tak Terhingga (Infinite Slope FS)
 */
export function computeInfiniteSlopeFS(
  betaDeg,
  cPrime,
  cr,
  phiDeg,
  gammaSat,
  zDepth,
  rasioM,
  qSurcharge
) {
  const u = Number((rasioM * GAMMA_WATER_KN_M3 * zDepth).toFixed(2));

  if (betaDeg <= FLAT_SLOPE_THRESHOLD_DEG) {
    return {
      fs: MAX_FS_CAP,
      fsStatus: "STABIL",
      fsBadgeColor: "emerald",
      fsKeterangan: "Lereng datar (β ≤ 2.0°); gaya gravitasi bekerja murni vertikal mengikat massa tanah.",
      uKpa: u,
      isFlatLocked: true,
    };
  }

  const betaRad = (betaDeg * Math.PI) / 180;
  const phiRad = (phiDeg * Math.PI) / 180;
  const cosB = Math.cos(betaRad);
  const sinB = Math.sin(betaRad);

  const denom = (gammaSat * zDepth + qSurcharge) * sinB * cosB;
  if (denom <= 1e-6) {
    return {
      fs: MAX_FS_CAP,
      fsStatus: "STABIL",
      fsBadgeColor: "emerald",
      fsKeterangan: "Gaya pendorong lereng mendekati nol.",
      uKpa: u,
      isFlatLocked: true,
    };
  }

  const normalEff = (gammaSat * zDepth - u + qSurcharge) * Math.pow(cosB, 2);
  const num = cPrime + cr + normalEff * Math.tan(phiRad);
  const fsRaw = num / denom;
  const fsCapped = Number(Math.min(MAX_FS_CAP, Math.max(0.10, fsRaw)).toFixed(2));

  let fsStatus = "STABIL";
  let fsBadgeColor = "emerald";
  let fsKeterangan = "Lereng stabil aman (FS > 1.25); cocok untuk permukiman dengan pondasi standar.";

  if (fsCapped < 1.07) {
    fsStatus = "LABIL / LONGSOR";
    fsBadgeColor = "red";
    fsKeterangan = "Lereng labil rawan longsor (FS < 1.07); melampaui kapasitas geser tanah penutup!";
  } else if (fsCapped <= 1.25) {
    fsStatus = "KRITIS";
    fsBadgeColor = "amber";
    fsKeterangan = "Kondisi lereng kritis (1.07 ≤ FS ≤ 1.25); memerlukan rekayasa lereng / perkuatan dinding penahan.";
  }

  return {
    fs: fsCapped,
    fsStatus,
    fsBadgeColor,
    fsKeterangan,
    uKpa: u,
    isFlatLocked: false,
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
    pLahan.bebanTambahanQKpa
  );

  return {
    skorAkhir,
    zonaKode: zone.zonaKode,
    zonaLabel: zone.zonaLabel,
    zonaDeskripsi: zone.zonaDeskripsi,
    warnaHex: zone.warnaHex,
    borderHex: zone.borderHex,
    fs: fsResult.fs,
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
    },
  };
}
