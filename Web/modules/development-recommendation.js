(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.LahanAmanSPKRecommendation = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STATUS_LABELS = Object.freeze({
    dapat_dikaji: "Dapat dipertimbangkan untuk kajian",
    perlu_investigasi: "Perlu investigasi",
    tidak_direkomendasikan: "Tidak direkomendasikan",
    belum_dapat_dievaluasi: "Belum dapat dievaluasi",
  });

  const STATUS_TONES = Object.freeze({
    dapat_dikaji: "positive",
    perlu_investigasi: "caution",
    tidak_direkomendasikan: "negative",
    belum_dapat_dievaluasi: "unknown",
  });

  const EXPANSIVE_PATTERN = /(grumusol|vertisol|expansive|mengembang)/i;
  const WEAK_GEOLOGY_PATTERN = /(semilir|tuf|lapili|breksi|lempung|napal)/i;

  function numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function format(value, digits) {
    if (value == null || !Number.isFinite(Number(value))) return "-";
    return Number(value).toLocaleString("id-ID", {
      minimumFractionDigits: digits == null ? 2 : digits,
      maximumFractionDigits: digits == null ? 2 : digits,
    });
  }

  function weightedSlope(segments) {
    let total = 0;
    let area = 0;
    let min = null;
    let max = null;
    segments.forEach(function (segment) {
      const slope = segment.actual ? numberOrNull(segment.actual.slopeDeg) : null;
      const weight = Number(segment.areaM2) || 0;
      if (slope == null || weight <= 0) return;
      total += slope * weight;
      area += weight;
      if (min == null || slope < min) min = slope;
      if (max == null || slope > max) max = slope;
    });
    return {
      mean: area > 0 ? total / area : null,
      min: min,
      max: max,
    };
  }

  function findConstraint(constraints, id) {
    if (!constraints || !Array.isArray(constraints.items)) return null;
    return constraints.items.find(function (item) {
      return item.id === id;
    }) || null;
  }

  function hasText(segments, key, pattern) {
    return segments.some(function (segment) {
      const value = segment.actual ? segment.actual[key] : null;
      return value != null && pattern.test(String(value));
    });
  }

  function scenario(id, code, label, status, summary, evidence, risks, verification, confidence) {
    return {
      id: id,
      code: code,
      label: label,
      status: status,
      statusLabel: STATUS_LABELS[status],
      tone: STATUS_TONES[status],
      summary: summary,
      evidence: evidence,
      risks: risks,
      verification: verification,
      confidence: confidence,
      professionalReviewRequired: true,
      designQuantities: null,
      isPreferredForStudy: false,
    };
  }

  function evaluateRecommendations(assessment, constraints) {
    if (!assessment || !Array.isArray(assessment.segments)) {
      throw new TypeError("Recommendation engine membutuhkan assessment dengan daftar segmen.");
    }
    const constraintResult = constraints || assessment.constraints;
    const summaryConstraints = constraintResult && constraintResult.summary ? constraintResult.summary : {};
    const location = assessment.location || {};
    const polygonArea = Number(location.areaM2) || 0;
    const segments = assessment.segments;
    const slope = weightedSlope(segments);
    const fsMin = assessment.infiniteSlope ? assessment.infiniteSlope.min : null;
    const fsMean = assessment.infiniteSlope ? assessment.infiniteSlope.mean : null;
    const zoneDistribution = assessment.standard && assessment.standard.zoneDistribution;
    const redArea = zoneDistribution && zoneDistribution.merah ? Number(zoneDistribution.merah.areaM2) || 0 : 0;
    const redPercent =
      zoneDistribution && zoneDistribution.merah ? zoneDistribution.merah.percentOfPolygon : null;
    const steepItem = findConstraint(constraintResult, "steep_terrain");
    const waterItem = findConstraint(constraintResult, "water_body");
    const steepArea = steepItem ? Number(steepItem.areaM2) || 0 : 0;
    const waterArea = waterItem ? Number(waterItem.areaM2) || 0 : 0;
    const expansiveSoil = hasText(segments, "soilType", EXPANSIVE_PATTERN);
    const weakGeology = hasText(segments, "geologyUnit", WEAK_GEOLOGY_PATTERN);
    const complete = Boolean(
      assessment.dataCompleteness && assessment.dataCompleteness.definitiveEligible
    );
    const coverage = numberOrNull(location.coverageRatio);
    const binding = Boolean(summaryConstraints.hasBindingRestriction);
    const legalUnknown = Boolean(summaryConstraints.hasUnknownBindingConstraints);
    const severe = fsMin != null && fsMin < 1.07;
    const critical = fsMin != null && fsMin <= 1.25;
    const highSusceptibility = redPercent != null && redPercent >= 20;
    const isFlat = slope.mean != null && slope.mean <= 8;
    const isSteep = slope.max != null && slope.max > 25;
    const canEvaluate = complete && coverage != null && coverage >= 0.8;
    const confidence = canEvaluate ? "sedang" : "rendah";
    const footing = "Bukan desain teknis. Volume cut/fill, dimensi saluran, dan detail fondasi belum dihitung.";

    const evidenceCommon = [
      "Rerata kemiringan segmen: " + (slope.mean != null ? format(slope.mean) + " derajat" : "tidak tersedia") + ".",
      "Rentang kemiringan: " +
        (slope.min != null ? format(slope.min) + " - " + format(slope.max) + " derajat" : "tidak tersedia") +
        ".",
      "FS minimum: " + (fsMin != null ? format(fsMin) + " (" + (fsMin > 1.25 ? "stabil" : fsMin >= 1.07 ? "kritis" : "labil") + ")" : "tidak tersedia") + ".",
      "Luas zona merah standar: " + (redPercent != null ? format(redPercent, 1) + "% dari poligon" : "tidak tersedia") + ".",
    ];

    function developmentStatus(normal, caution, block) {
      if (binding || block || severe) return "tidak_direkomendasikan";
      if (!canEvaluate) return "belum_dapat_dievaluasi";
      if (caution) return "perlu_investigasi";
      return normal;
    }

    const adaptiveStatus = developmentStatus(
      "dapat_dikaji",
      isSteep || critical || expansiveSoil || highSusceptibility
    );
    const terraceStatus = developmentStatus(
      "dapat_dikaji",
      isFlat || isSteep || critical || expansiveSoil || highSusceptibility
    );
    const cutStatus = developmentStatus("perlu_investigasi", true, false);
    const fillStatus = developmentStatus("perlu_investigasi", true, false);
    const cutFillStatus = developmentStatus("perlu_investigasi", true, false);
    const noBuildStatus =
      binding || severe || highSusceptibility || !canEvaluate || legalUnknown
        ? "dapat_dikaji"
        : "perlu_investigasi";

    const adaptive = scenario(
      "contour_adaptive",
      "A",
      "Penyesuaian kontur / footprint mengikuti kontur",
      adaptiveStatus,
      isFlat
        ? "Tapak relatif datar; penyesuaian kontur masih relevan untuk drainase dan elevasi lokal."
        : "Mengikuti kontur dapat mengurangi perubahan lereng besar, tetapi tetap memerlukan desain drainase dan verifikasi stabilitas.",
      evidenceCommon,
      [
        "Perubahan aliran permukaan dan konsentrasi air.",
        "Perubahan elevasi lokal di tepi tapak.",
      ],
      [
        "Survei topografi detail.",
        "Analisis drainase dan erosi.",
        "Pemeriksaan geoteknik.",
        "Validasi RTRW dan sempadan.",
      ],
      confidence
    );

    const terrace = scenario(
      "terraced",
      "B",
      "Terassering terkendali",
      terraceStatus,
      isFlat
        ? "Terassering kurang relevan pada tapak datar; opsi ini bukan prioritas awal."
        : "Terassering dapat membagi panjang lereng, tetapi mengubah geometri dan beban lereng.",
      evidenceCommon.concat([
        "Tutupan lereng > 25 derajat: " + (steepArea > 0 ? format(steepArea, 1) + " m2" : "tidak terdeteksi") + ".",
      ]),
      [
        "Terassering dapat menambah beban dan mengubah jalur rembesan.",
        "Erosi permukaan dan kegagalan lokal pada dinding teras.",
      ],
      [
        "Analisis stabilitas lereng per teras.",
        "Desain drainase dan bangunan penahan.",
        "Kajian erosi dan sedimentasi.",
        "Validasi kawasan lindung.",
      ],
      confidence
    );

    const cut = scenario(
      "controlled_cut",
      "C",
      "Pemotongan terkendali",
      cutStatus,
      "Pemotongan hanya dapat dipertimbangkan setelah analisis stabilitas lereng galian dan pengaruh terhadap area sekitar.",
      evidenceCommon.concat([
        "Formasi rentan: " + (weakGeology ? "terindikasi" : "tidak terindikasi dari atribut") + ".",
        "Zona merah: " + (redPercent != null ? format(redPercent, 1) + "%" : "tidak tersedia") + ".",
      ]),
      [
        "Pemotongan kaki lereng dapat menurunkan FS.",
        "Munculnya bidang gelincir baru pada tanah/ batuan lemah.",
      ],
      [
        "Investigasi geoteknik (bor/sondir).",
        "Analisis stabilitas galian dan bangunan penahan.",
        "Monitoring deformasi dan air tanah.",
        "Persetujuan teknis ahli.",
      ],
      confidence
    );

    const fill = scenario(
      "controlled_fill",
      "D",
      "Penimbunan terkendali",
      fillStatus,
      "Penimbunan memerlukan verifikasi daya dukung, penurunan, stabilitas timbunan, dan pengendalian air.",
      evidenceCommon.concat([
        "Tutupan air terindikasi: " + (waterArea > 0 ? format(waterArea, 1) + " m2" : "tidak terdeteksi") + ".",
        "Tanah ekspansif: " + (expansiveSoil ? "terindikasi" : "tidak terindikasi dari atribut") + ".",
      ]),
      [
        "Beban timbunan meningkatkan tegangan pada tanah dasar.",
        "Penurunan dan ketidakstabilan timbunan di area basah.",
      ],
      [
        "Uji daya dukung dan penurunan.",
        "Analisis stabilitas timbunan.",
        "Drainase dan perbaikan tanah bila diperlukan.",
        "Verifikasi sempadan air.",
      ],
      confidence
    );

    const cutFill = scenario(
      "cut_and_fill",
      "E",
      "Cut and fill terkendali",
      cutFillStatus,
      "Cut and fill memerlukan neraca massa, desain lereng galian/timbunan, dan kajian stabilitas menyeluruh.",
      evidenceCommon.concat([
        "Kemiringan maksimum: " + (slope.max != null ? format(slope.max) + " derajat" : "tidak tersedia") + ".",
        "Data legal pembatas: " + (legalUnknown ? "belum tersedia" : "tersedia") + ".",
      ]),
      [
        "Kombinasi galian dan timbunan dapat memperburuk stabilitas global.",
        "Perubahan drainase dan erosi selama konstruksi.",
      ],
      [
        "Neraca massa dan rencana kerja tanah.",
        "Analisis stabilitas global dan lokal.",
        "Rencana drainase sementara/permanen.",
        "Validasi RTRW, kawasan lindung, dan sempadan.",
      ],
      confidence
    );

    const noBuild = scenario(
      "no_development",
      "F",
      "Tidak membangun / investigasi lanjutan",
      noBuildStatus,
      severe || highSusceptibility || binding
        ? "Opsi konservatif: tunda pembangunan dan lakukan investigasi mendalam sebelum keputusan."
        : "Opsi konservatif tetap tersedia, terutama jika pembatas legal dan geoteknik belum terverifikasi.",
      evidenceCommon.concat([
        "Status legal: " + (legalUnknown ? "belum dapat diverifikasi" : "tidak ada pembatas legal terverifikasi") + ".",
        "Kelengkapan data: " + (complete ? "lengkap secara kriteria" : "belum lengkap") + ".",
      ]),
      [
        "Tidak menghilangkan kebutuhan verifikasi legal dan geoteknik.",
        "Biaya peluang dan kebutuhan kajian lanjutan.",
      ],
      [
        "Validasi RTRW/kawasan lindung/sempadan.",
        "Investigasi geoteknik dan hidrologi.",
        "Kajian alternatif lokasi.",
        "Dokumentasi keputusan.",
      ],
      "sedang"
    );

    const scenarios = [adaptive, terrace, cut, fill, cutFill, noBuild];
    if (footing) {
      scenarios.forEach(function (item) {
        item.summary = item.summary + " " + footing;
      });
    }

    let preferred = null;
    if (!binding && !severe && !legalUnknown && canEvaluate) {
      const candidate =
        scenarios.find(function (item) {
          return item.id === "contour_adaptive" && item.status === "dapat_dikaji";
        }) ||
        scenarios.find(function (item) {
          return item.id === "terraced" && item.status === "dapat_dikaji";
        }) ||
        scenarios.find(function (item) {
          return item.id === "no_development" && item.status === "dapat_dikaji";
        });
      if (candidate) {
        candidate.isPreferredForStudy = true;
        preferred = {
          id: candidate.id,
          code: candidate.code,
          label: candidate.label,
          note: "Prioritas kajian awal, bukan persetujuan pembangunan.",
        };
      }
    }

    let nextStep;
    if (binding) {
      nextStep = "Hentikan rencana pembangunan pada area terdampak dan validasi pembatas legal.";
    } else if (severe) {
      nextStep = "Lakukan investigasi stabilitas lereng; jangan memilih skenario pembangunan sebelum FS terverifikasi.";
    } else if (!canEvaluate) {
      nextStep = "Lengkapi cakupan data dan kriteria, lalu ulangi evaluasi sebelum memilih skenario.";
    } else if (legalUnknown) {
      nextStep = "Validasi RTRW, kawasan lindung, dan sempadan; lanjutkan dengan investigasi geoteknik.";
    } else {
      nextStep = "Lakukan kajian geoteknik, hidrologi, dan legal sebelum memilih skenario.";
    }

    return {
      preferredForStudy: preferred,
      scenarios: scenarios,
      summary: {
        status:
          binding || severe
            ? "perlu_perhatian_tinggi"
            : canEvaluate
            ? "dapat_dilanjutkan_dengan_kajian"
            : "data_belum_memadai",
        title:
          preferred != null
            ? "Skenario prioritas kajian: " + preferred.label
            : "Belum ada skenario yang dapat diutamakan",
        note:
          preferred != null
            ? "Prioritas ini hanya berlaku untuk kajian awal dan tetap memerlukan verifikasi lapangan."
            : "Alternatif ditampilkan tanpa peringkat karena data legal/pembatas atau bukti geoteknik belum mencukupi. " +
              (legalUnknown
                ? "Dataset RTRW, kawasan lindung, dan sempadan belum tersedia."
                : "Lengkapi data sebelum menentukan pilihan."),
        nextStep: nextStep,
        recommendedForConstruction: false,
        requiresProfessionalReview: true,
        confidence: confidence,
        limitations: [
          "Tidak ada volume cut/fill, dimensi fondasi, atau desain teknis yang dihitung.",
          "Rekomendasi tidak menggantikan penilaian ahli geoteknik dan instansi berwenang.",
          "WLC bukan penentu tunggal; FS dan pembatas legal/spasial ditampilkan terpisah.",
        ],
      },
    };
  }

  return {
    STATUS_LABELS: STATUS_LABELS,
    STATUS_TONES: STATUS_TONES,
    evaluateRecommendations: evaluateRecommendations,
  };
});
