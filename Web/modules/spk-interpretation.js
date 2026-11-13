(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.LahanAmanSPKInterpretation = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CRITERION_LABELS = Object.freeze({
    slope: "Kemiringan tanah",
    soil: "Jenis dan kondisi tanah",
    geology: "Jenis batuan",
    rainfall: "Curah hujan",
    landCover: "Penggunaan lahan",
  });

  const LEGAL_TEXT = /RTRW|RDTR|sempadan|legal|pembatas|status hukum|kawasan lindung|instansi berwenang/i;

  function finite(value) {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function format(value, digits) {
    const number = finite(value);
    if (number == null) return "-";
    return number.toLocaleString("id-ID", {
      minimumFractionDigits: digits == null ? 1 : digits,
      maximumFractionDigits: digits == null ? 1 : digits,
    });
  }

  function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  function missingCriteria(assessment) {
    const completeness = assessment.dataCompleteness || {};
    const keys = Array.isArray(completeness.missingCriteria) ? completeness.missingCriteria.slice() : [];
    (assessment.criteria || []).forEach(function (criterion) {
      if (criterion.dataStatus === "missing" && keys.indexOf(criterion.key) < 0) keys.push(criterion.key);
    });
    return keys;
  }

  function fsRiskSegments(segments) {
    return segments.filter(function (segment) {
      return /KRITIS|LABIL/i.test(String(segment.fsLabel || ""));
    });
  }

  function buildFactors(assessment) {
    const criteria = Array.isArray(assessment.criteria) ? assessment.criteria : [];
    const scored = criteria
      .filter(function (criterion) { return finite(criterion.score) != null; })
      .sort(function (a, b) { return (finite(b.contribution) || 0) - (finite(a.contribution) || 0); })
      .slice(0, 3)
      .map(function (criterion) {
        return {
          key: criterion.key,
          label: CRITERION_LABELS[criterion.key] || criterion.label || criterion.key,
          score: finite(criterion.score),
          weightPercent: finite(criterion.weightPercent),
          contribution: finite(criterion.contribution),
          dataStatus: criterion.dataStatus || "unknown",
          actual: criterion.actualSummary == null ? null : criterion.actualSummary,
          explanation: criterion.interpretation ||
            "Skor ini berkontribusi pada nilai WLC sesuai bobot yang sedang digunakan.",
        };
      });
    if (scored.length < 3) {
      criteria.filter(function (criterion) { return finite(criterion.score) == null; })
        .slice(0, 3 - scored.length)
        .forEach(function (criterion) {
          scored.push({
            key: criterion.key,
            label: CRITERION_LABELS[criterion.key] || criterion.label || criterion.key,
            score: null,
            weightPercent: finite(criterion.weightPercent),
            contribution: null,
            dataStatus: criterion.dataStatus || "missing",
            actual: criterion.actualSummary == null ? null : criterion.actualSummary,
            explanation: "Data untuk faktor ini belum tersedia sehingga skornya belum dapat dihitung.",
          });
        });
    }
    return scored;
  }

  function build(assessment) {
    if (!assessment || typeof assessment !== "object") {
      throw new TypeError("Assessment diperlukan untuk membentuk interpretasi SPK.");
    }
    const location = assessment.location || {};
    const completeness = assessment.dataCompleteness || {};
    const criteria = Array.isArray(assessment.criteria) ? assessment.criteria : [];
    const completeSegments = finite(completeness.completeSegments) != null
      ? Number(completeness.completeSegments)
      : Number(location.completeSegmentCount) || 0;
    const totalSegments = finite(completeness.totalSegments) != null
      ? Number(completeness.totalSegments)
      : Number(location.segmentCount) || 0;
    const coverageRatio = finite(location.coverageRatio);
    const areaM2 = finite(location.areaM2);
    const coveredAreaM2 = finite(location.coveredAreaM2);
    const uncoveredAreaM2 = areaM2 != null && coveredAreaM2 != null
      ? Math.max(0, areaM2 - coveredAreaM2)
      : null;
    const segments = Array.isArray(assessment.segments) ? assessment.segments : [];
    const missingKeys = missingCriteria(assessment);
    const missingLabels = missingKeys.map(function (key) { return CRITERION_LABELS[key] || key; });
    const standard = assessment.standard || {};
    const standardClass = standard.classification || null;
    const standardScore = finite(standard.score);
    const slope = assessment.infiniteSlope || {};
    const fsCounts = slope.counts || { stabil: 0, kritis: 0, labil: 0 };
    const fsAvailableCount = segments.filter(function (segment) { return finite(segment.fs) != null; }).length;
    const fsMissingCount = Math.max(segments.length - fsAvailableCount, 0);
    const fsRiskRows = fsRiskSegments(segments);
    const hasFsRisk = Number(fsCounts.kritis || 0) > 0 || Number(fsCounts.labil || 0) > 0 || fsRiskRows.length > 0;
    const fsComplete = segments.length > 0 && fsMissingCount === 0 && fsAvailableCount === segments.length;
    const landUse = assessment.landUse || null;
    const landUseCoverage = landUse ? finite(landUse.coverageRatio) : null;
    const recommendations = assessment.recommendations || null;
    const scenarios = recommendations && Array.isArray(recommendations.scenarios) ? recommendations.scenarios : [];
    const preferred = recommendations && recommendations.preferredForStudy ? recommendations.preferredForStudy : null;
    const dataComplete = completeness.definitiveEligible === true;
    const standardAvailable = standardScore != null && Boolean(standardClass);
    const hasUnknownRequiredData = !dataComplete || !standardAvailable || !fsComplete || !recommendations;
    const wlcRiskRows = segments.filter(function (segment) {
      return segment.standardZone && (segment.standardZone.code === "merah" || segment.standardZone.code === "kuning");
    });
    const wlcNeedsReview = Boolean(standardClass && standardClass.code !== "hijau") || wlcRiskRows.length > 0;
    const allAlternativesUnprioritized = scenarios.length > 0 && scenarios.every(function (scenario) {
      return scenario.status === "belum_dapat_dievaluasi";
    });
    const noAlternativePriority = !preferred;
    let status;

    if (hasUnknownRequiredData) {
      status = { code: "belum_dapat_disimpulkan", label: "Belum Dapat Disimpulkan", tone: "unknown" };
    } else if (wlcNeedsReview || hasFsRisk || noAlternativePriority) {
      status = { code: "perlu_pemeriksaan_lanjutan", label: "Perlu Pemeriksaan Lanjutan", tone: "caution" };
    } else {
      status = { code: "dapat_dipertimbangkan", label: "Dapat Dipertimbangkan", tone: "positive" };
    }

    const reasons = [];
    if (!dataComplete) {
      if (totalSegments > 0 && completeSegments === totalSegments) {
        reasons.push("Semua segmen yang tersedia memiliki parameter lengkap, tetapi hal itu tidak berarti seluruh luas polygon telah tercakup.");
      } else {
        reasons.push("Kelengkapan data pada segmen yang dianalisis belum memenuhi syarat untuk menyimpulkan keseluruhan area.");
      }
    }
    if (coverageRatio != null) {
      reasons.push(coverageRatio >= 1
        ? "Data penilaian SPK mencakup seluruh area menurut perhitungan cakupan; kelengkapan parameter tetap diperiksa secara terpisah."
        : "Cakupan penilaian SPK " + format(coverageRatio * 100, 1) + "% dari seluruh area; bagian yang belum tercakup belum dapat dinilai.");
    } else {
      reasons.push("Cakupan penilaian SPK terhadap seluruh area belum dapat diverifikasi.");
    }
    if (standardAvailable) {
      reasons.push("WLC standar menghasilkan " + standardClass.label + " dengan nilai " + format(standardScore, 2) + ".");
    } else {
      reasons.push("Nilai atau klasifikasi WLC standar belum tersedia untuk area ini.");
    }
    if (assessment.config && assessment.config.profile === "custom") {
      reasons.push("Nilai bobot kustom ditampilkan sebagai pembanding dan tidak diberi klasifikasi zona standar.");
    }
    if (segments.length && fsAvailableCount) {
      reasons.push(
        "Pemeriksaan FS per segmen: " + Number(fsCounts.stabil || 0) + " stabil, " +
        Number(fsCounts.kritis || 0) + " kritis, dan " + Number(fsCounts.labil || 0) + " labil."
      );
    } else {
      reasons.push("Hasil FS belum tersedia pada segmen yang diperiksa.");
    }
    if (hasFsRisk) {
      reasons.push("Terdapat segmen dengan hasil FS kritis atau labil yang perlu diperiksa lebih lanjut.");
    }
    if (wlcNeedsReview) {
      reasons.push("Klasifikasi WLC standar " + (standardClass ? standardClass.label : "") + " atau zona per segmen menunjukkan area yang perlu ditinjau lebih lanjut.");
    }
    if (noAlternativePriority) {
      reasons.push("Belum ada alternatif pengembangan yang ditetapkan sebagai prioritas kajian.");
    }

    const limitations = [];
    if (!dataComplete) {
      if (missingLabels.length) limitations.push("Data belum tersedia secara lengkap untuk: " + missingLabels.join(", ") + ".");
      if (Number(completeness.incompleteSegments || 0) > 0) {
        limitations.push(Number(completeness.incompleteSegments) + " segmen tidak memiliki seluruh data penilaian.");
      }
    }
    if (coverageRatio != null && coverageRatio < 1) {
      limitations.push(
        "Cakupan penilaian SPK " + format(coverageRatio * 100, 1) + "% dari seluruh area" +
        (uncoveredAreaM2 != null ? "; sekitar " + format(uncoveredAreaM2, 1) + " m² belum tercakup dan belum dapat dinilai." : "; bagian di luar cakupan belum dapat dinilai.")
      );
    } else if (coverageRatio == null) {
      limitations.push("Cakupan penilaian SPK terhadap seluruh area belum dapat diverifikasi.");
    }
    if (fsMissingCount > 0) {
      limitations.push("Nilai FS belum tersedia untuk " + fsMissingCount + " dari " + segments.length + " segmen.");
    }
    if (assessment.config && assessment.config.profile === "custom") {
      limitations.push("Bobot kustom belum terkalibrasi; klasifikasi zona pada kesimpulan memakai hasil WLC standar.");
    }
    if (landUseCoverage != null && landUseCoverage < 1) {
      limitations.push("Cakupan penggunaan lahan " + format(landUseCoverage * 100, 1) + "%; bagian tanpa informasi penggunaan lahan belum dapat dinilai.");
    } else if (!landUse || landUse.available !== true) {
      limitations.push("Data penggunaan lahan belum tersedia untuk area ini.");
    }
    if (noAlternativePriority) {
      limitations.push("Belum ada alternatif yang dapat diprioritaskan berdasarkan evaluasi yang tersedia.");
    }
    if (!limitations.length) {
      limitations.push("Hasil merupakan bahan pemeriksaan awal dan tetap memerlukan tinjauan lapangan sesuai kebutuhan.");
    }

    const actions = [];
    function addAction(id, priority, title, reason, basis) {
      if (actions.some(function (action) { return action.id === id; })) return;
      actions.push({ id: id, priority: priority, title: title, reason: reason, basis: basis, status: "disarankan" });
    }

    if (!dataComplete) {
      const missingReason = missingLabels.length
        ? "Data " + missingLabels.join(", ") + " masih belum lengkap."
        : "Kriteria kelengkapan data internal aplikasi belum terpenuhi.";
      const coverageInstruction = coverageRatio != null && coverageRatio < 1
        ? " Area yang belum tercakup harus diperiksa sebelum hasil digunakan untuk menyimpulkan seluruh lokasi."
        : " Lengkapi parameter yang belum tersedia pada segmen terkait sebelum hasil digunakan untuk menyimpulkan seluruh lokasi.";
      addAction("complete-data", 1, "Lengkapi data penilaian SPK", missingReason + coverageInstruction, "Kelengkapan segmen dan cakupan penilaian SPK.");
    }
    if (fsMissingCount > 0) {
      addAction("complete-fs-data", 1, "Lengkapi hasil pemeriksaan FS", "Nilai FS belum tersedia pada seluruh segmen, sehingga kondisi lereng belum dapat diringkas untuk seluruh area.", "Jumlah segmen dengan nilai FS yang tersedia.");
    }
    if (wlcNeedsReview) {
      const reviewIds = wlcRiskRows.map(function (segment) { return segment.segmentId; });
      addAction("inspect-wlc-risk", 2, "Periksa area dengan hasil WLC yang perlu perhatian", "Tinjau kembali kondisi dan data pada area dengan klasifikasi WLC standar yang memerlukan perhatian.", reviewIds.length ? "Segmen: " + reviewIds.join(", ") + "." : "Klasifikasi WLC standar: " + (standardClass ? standardClass.label : "belum tersedia") + ".");
    }
    if (hasFsRisk) {
      const fsIds = fsRiskRows.map(function (segment) { return segment.segmentId; });
      addAction("inspect-fs-risk", 2, "Periksa segmen dengan hasil FS yang perlu perhatian", "Lakukan pemeriksaan geoteknik lanjutan pada segmen yang berstatus kritis atau labil menurut hasil FS.", fsIds.length ? "Segmen: " + fsIds.join(", ") + "." : "Ringkasan FS mencatat segmen kritis atau labil.");
    }
    if (landUseCoverage == null || landUseCoverage < 1) {
      addAction("verify-land-use", 1, "Verifikasi informasi penggunaan lahan", landUseCoverage == null
        ? "Data penggunaan lahan belum tersedia atau cakupannya belum dapat diverifikasi."
        : "Sebagian area belum memiliki informasi penggunaan lahan.", landUseCoverage == null ? "Status data penggunaan lahan." : "Cakupan penggunaan lahan " + format(landUseCoverage * 100, 1) + "%.");
    }
    if (noAlternativePriority) {
      addAction("review-alternatives", 4, "Evaluasi kembali alternatif pengembangan", dataComplete
        ? "Belum ada alternatif yang diprioritaskan. Tinjau persyaratan dan hasil pemeriksaan teknis sebelum membandingkan alternatif kembali."
        : "Lengkapi data dan pemeriksaan yang diperlukan sebelum membandingkan alternatif pengembangan.", allAlternativesUnprioritized
        ? "Seluruh alternatif berstatus belum dapat dievaluasi."
        : "Belum ada alternatif yang ditandai sebagai prioritas kajian.");
    }
    if (status.code !== "dapat_dipertimbangkan" && (wlcNeedsReview || hasFsRisk)) {
      addAction("technical-review", 3, "Lakukan kajian teknis lanjutan", "Minta pemeriksa kompeten meninjau temuan WLC dan/atau FS pada segmen terkait. Arahan ini bukan desain atau instruksi pembangunan.", "Hasil WLC standar dan status FS per segmen.");
    }
    if (!actions.length) {
      addAction("continue-review", 3, "Lanjutkan pemeriksaan sesuai kewenangan", "Data memenuhi kriteria evaluasi aplikasi dan tersedia alternatif untuk kajian berikutnya. Tetap lakukan verifikasi lapangan sebelum keputusan.", "Kelengkapan data, WLC standar, FS per segmen, dan status alternatif.");
    }
    actions.sort(function (a, b) { return a.priority - b.priority; });
    actions.forEach(function (action, index) {
      action.presentation = {
        order: index + 1,
        priorityLabel: action.priority === 1
          ? "Prioritas utama"
          : action.priority === 2
          ? "Prioritas berikutnya"
          : "Tindak lanjut",
      };
    });

    const factorSource = buildFactors(assessment);
    const factors = factorSource.map(function (factor) {
      return Object.assign({}, factor, {
        explanation: factor.explanation + " Nilai kontribusi terbesar menunjukkan pengaruh terbesar pada indeks berbobot yang digunakan, bukan berarti faktor ini sendiri menentukan tingkat bahaya seluruh lokasi.",
      });
    });

    const alternativeItems = scenarios.map(function (scenario) {
      const verification = (Array.isArray(scenario.verification) ? scenario.verification : [])
        .filter(function (item) { return !LEGAL_TEXT.test(String(item || "")); });
      const needed = missingLabels.slice();
      if (!dataComplete && !needed.length) needed.push("Data penilaian pada bagian area yang belum tercakup");
      if (fsMissingCount > 0) needed.push("Nilai FS pada seluruh segmen");
      return {
        id: scenario.id,
        code: scenario.code,
        label: scenario.label,
        status: scenario.status,
        statusLabel: scenario.statusLabel,
        why: scenario.status === "belum_dapat_dievaluasi"
          ? "Data penilaian dan pemeriksaan yang tersedia belum memenuhi syarat evaluasi alternatif ini."
          : scenario.summary,
        neededParameters: unique(needed),
        verification: verification,
      };
    });

    const summaryParts = [];
    if (areaM2 != null) summaryParts.push("Area yang diperiksa seluas sekitar " + format(areaM2, 1) + " m²");
    if (standardAvailable) summaryParts.push("WLC standar menghasilkan skor " + format(standardScore, 2) + " yang termasuk " + standardClass.label);
    else summaryParts.push("hasil WLC standar belum tersedia untuk disimpulkan");
    if (assessment.config && assessment.config.profile === "custom") {
      summaryParts.push("indeks profil kustom " + format(assessment.active && assessment.active.score, 2) + " ditampilkan sebagai pembanding tanpa klasifikasi zona standar");
    }
    if (fsAvailableCount > 0 && finite(slope.min) != null && finite(slope.max) != null) {
      summaryParts.push("pemeriksaan FS pada " + fsAvailableCount + " dari " + segments.length + " segmen yang memiliki data berkisar " + format(slope.min, 2) + "–" + format(slope.max, 2) + (finite(slope.mean) != null ? " dengan rerata " + format(slope.mean, 2) : ""));
    } else {
      summaryParts.push("hasil FS belum tersedia pada segmen yang diperiksa");
    }
    if (coverageRatio != null) {
      summaryParts.push("cakupan penilaian SPK mencapai " + format(coverageRatio * 100, 1) + "% dari seluruh area" +
        (uncoveredAreaM2 != null ? " (sekitar " + format(uncoveredAreaM2, 1) + " m² atau " + format(Math.max(0, 1 - coverageRatio) * 100, 1) + "% belum tercakup)" : ""));
    } else {
      summaryParts.push("cakupan data terhadap seluruh area belum dapat diverifikasi");
    }
    if (totalSegments > 0) {
      summaryParts.push("kelengkapan pada segmen yang dianalisis adalah " + completeSegments + " dari " + totalSegments + " segmen");
    }
    if (!dataComplete) {
      summaryParts.push("karena cakupan atau kelengkapan internal belum memenuhi syarat, hasil ini belum cukup untuk menyimpulkan kondisi seluruh area");
    } else if (status.code === "belum_dapat_disimpulkan") {
      summaryParts.push("karena sebagian hasil WLC, FS, atau evaluasi alternatif belum tersedia, kesimpulan keseluruhan belum dapat ditetapkan");
    } else if (status.code === "perlu_pemeriksaan_lanjutan") {
      summaryParts.push("temuan risiko atau kebutuhan kajian masih perlu ditinjau sebelum keputusan berikutnya");
    } else {
      summaryParts.push("hasil ini merupakan bahan pertimbangan untuk tahap berikutnya, bukan persetujuan pembangunan");
    }

    const contributionLeader = criteriaLeader(assessment.criteria, "contribution");
    const highestScoreFactor = criteriaLeader(assessment.criteria, "score");
    const preferredIds = new Set([
      preferred && preferred.id,
      ...scenarios.filter(function (scenario) { return scenario.isPreferredForStudy; }).map(function (scenario) { return scenario.id; }),
    ].filter(Boolean));
    const alternativeStatusCounts = {
      belumDapatDievaluasi: scenarios.filter(function (scenario) { return scenario.status === "belum_dapat_dievaluasi"; }).length,
      dapatDikaji: scenarios.filter(function (scenario) { return scenario.status === "dapat_dikaji"; }).length,
      diprioritaskan: scenarios.filter(function (scenario) { return preferredIds.has(scenario.id); }).length,
    };
    const studyableConservativeOption = scenarios.find(function (scenario) {
      return scenario.id === "no_development" && scenario.status === "dapat_dikaji";
    });
    const alternativeReason = noAlternativePriority
      ? "Belum ada alternatif pembangunan yang dapat diprioritaskan." +
        (studyableConservativeOption
          ? " Opsi tidak membangun dan melakukan investigasi lanjutan tetap dapat dipertimbangkan untuk kajian sebagai langkah konservatif sambil melengkapi data."
          : allAlternativesUnprioritized
          ? " Semua alternatif belum dapat dievaluasi karena data atau pemeriksaan belum mencukupi."
          : " Status setiap alternatif tetap mengikuti hasil evaluasi yang tersedia.")
      : preferred.note || "Alternatif tersedia untuk kajian awal, bukan persetujuan pembangunan.";

    return {
      schema: "lahanaman.spk.interpretation/v1",
      status: status,
      reasons: unique(reasons),
      summary: summaryParts.join(". ") + (summaryParts.length ? "." : "Hasil analisis belum tersedia."),
      profile: {
        id: assessment.active && assessment.active.profile || (assessment.config && assessment.config.profile) || null,
        label: assessment.active && assessment.active.label || (assessment.config && assessment.config.label) || null,
        calibrated: assessment.active && assessment.active.calibrated != null ? assessment.active.calibrated : !(assessment.config && assessment.config.profile === "custom"),
      },
      standardResult: { score: standardScore, classification: standardClass ? standardClass.label : null },
      customResult: assessment.config && assessment.config.profile === "custom"
        ? { score: finite(assessment.active && assessment.active.score), classification: null, calibrated: false }
        : null,
      fsSummary: {
        min: finite(slope.min),
        mean: finite(slope.mean),
        max: finite(slope.max),
        counts: { stabil: Number(fsCounts.stabil || 0), kritis: Number(fsCounts.kritis || 0), labil: Number(fsCounts.labil || 0) },
        segmentCount: segments.length,
        availableSegmentCount: fsAvailableCount,
      },
      coverage: {
        assessmentRatio: coverageRatio,
        landUseRatio: landUseCoverage,
      },
      dataCoverage: {
        segmentStatus: completeness.status || "unknown",
        completeSegments: completeSegments,
        totalSegments: totalSegments,
        completeRatio: totalSegments > 0 ? completeSegments / totalSegments : null,
        coverageRatio: coverageRatio,
        coveragePercent: coverageRatio == null ? null : coverageRatio * 100,
        uncoveredPercent: coverageRatio == null ? null : Math.max(0, (1 - coverageRatio) * 100),
        areaM2: areaM2,
        coveredAreaM2: coveredAreaM2,
        uncoveredAreaM2: uncoveredAreaM2,
        definitiveEligible: dataComplete,
      },
      factors: factors,
      factorRanking: {
        contributionLeader: contributionLeader,
        highestScore: highestScoreFactor,
        weightProfile: assessment.active && assessment.active.label || (assessment.config && assessment.config.label) || null,
      },
      limitations: unique(limitations),
      actions: actions,
      alternatives: {
        preferred: preferred ? { id: preferred.id, label: preferred.label } : null,
        totalCount: scenarios.length,
        unprioritizedCount: scenarios.filter(function (scenario) { return scenario.status === "belum_dapat_dievaluasi"; }).length,
        statusCounts: alternativeStatusCounts,
        allUnprioritized: allAlternativesUnprioritized,
        reason: alternativeReason,
        items: alternativeItems,
      },
      decisionNote: "Kesimpulan sistem merupakan bahan pertimbangan berdasarkan data yang tersedia. Keputusan akhir tetap berada pada pihak yang berwenang.",
      finalNote: "Catatan pemeriksaan ini bukan izin pembangunan atau sertifikat keamanan lahan.",
    };
  }

  function criteriaLeader(criteria, field) {
    const rows = Array.isArray(criteria) ? criteria : [];
    const sorted = rows.filter(function (criterion) { return finite(criterion[field]) != null; })
      .slice().sort(function (a, b) { return finite(b[field]) - finite(a[field]); });
    const criterion = sorted[0];
    if (!criterion) return null;
    return {
      key: criterion.key,
      label: CRITERION_LABELS[criterion.key] || criterion.label || criterion.key,
      score: finite(criterion.score),
      weightPercent: finite(criterion.weightPercent),
      contribution: finite(criterion.contribution),
      actual: criterion.actualSummary == null ? null : criterion.actualSummary,
    };
  }

  return { build: build, CRITERION_LABELS: CRITERION_LABELS };
});
