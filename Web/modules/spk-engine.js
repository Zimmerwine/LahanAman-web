(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.LahanAmanSPK = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = "spk-1.0.0";
  const EPSILON = 1e-9;

  const CRITERIA = Object.freeze([
    Object.freeze({
      key: "slope",
      label: "Kemiringan lereng",
      shortLabel: "Lereng",
      unit: "derajat",
      weight: 0.30,
      defaultImportance: 5,
      scoreField: "skor_lereng",
      source: "DEMNAS / poligon lereng",
    }),
    Object.freeze({
      key: "soil",
      label: "Karakteristik tanah",
      shortLabel: "Tanah",
      unit: "pedologi",
      weight: 0.25,
      defaultImportance: 4,
      scoreField: "skor_tanah",
      source: "Peta tanah DIY",
    }),
    Object.freeze({
      key: "geology",
      label: "Litologi dan geologi",
      shortLabel: "Geologi",
      unit: "formasi",
      weight: 0.20,
      defaultImportance: 3,
      scoreField: "skor_batuan",
      source: "Peta geologi DIY",
    }),
    Object.freeze({
      key: "rainfall",
      label: "Curah hujan tahunan",
      shortLabel: "Hujan",
      unit: "mm/tahun",
      weight: 0.15,
      defaultImportance: 3,
      scoreField: "skor_hujan",
      source: "Data curah hujan",
    }),
    Object.freeze({
      key: "landCover",
      label: "Tutupan lahan",
      shortLabel: "Tutupan",
      unit: "kelas tutupan",
      weight: 0.10,
      defaultImportance: 2,
      scoreField: "skor_lahan",
      source: "Peta tutupan lahan DIY",
    }),
  ]);

  const CRITERION_KEYS = CRITERIA.map(function (c) { return c.key; });

  const STANDARD_WEIGHTS = Object.freeze({
    slope: 0.30,
    soil: 0.25,
    geology: 0.20,
    rainfall: 0.15,
    landCover: 0.10,
  });

  const DEFAULT_IMPORTANCE = Object.freeze({
    slope: 5,
    soil: 4,
    geology: 3,
    rainfall: 3,
    landCover: 2,
  });

  const STANDARD_THRESHOLDS = Object.freeze({
    greenMaxExclusive: 2.20,
    yellowMaxInclusive: 3.40,
  });

  const SCORE_FIELD_MAP = Object.freeze({
    slope: "skor_lereng",
    soil: "skor_tanah",
    geology: "skor_batuan",
    rainfall: "skor_hujan",
    landCover: "skor_lahan",
  });

  const NUMBER_FMT = new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 2,
  });

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function toFiniteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function assertObject(value, name) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError(name + " harus berupa objek.");
    }
  }

  function assertCriteriaKeys(value, name) {
    assertObject(value, name);
    Object.keys(value).forEach(function (key) {
      if (CRITERION_KEYS.indexOf(key) === -1) {
        throw new Error(name + " memiliki kriteria tidak dikenal: " + key + ".");
      }
    });
    CRITERION_KEYS.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        throw new Error(name + " tidak memiliki kriteria: " + key + ".");
      }
    });
  }

  function validateWeights(weights) {
    assertCriteriaKeys(weights, "Bobot");
    let total = 0;
    CRITERION_KEYS.forEach(function (key) {
      const weight = weights[key];
      if (!isFiniteNumber(weight) || weight < 0) {
        throw new TypeError("Bobot " + key + " harus berupa angka non-negatif.");
      }
      total += weight;
    });
    if (Math.abs(total - 1) > EPSILON) {
      throw new Error("Total bobot harus sama dengan 1, bukan " + total + ".");
    }
    return true;
  }

  function normalizeImportance(importance) {
    const source = importance == null ? DEFAULT_IMPORTANCE : importance;
    assertCriteriaKeys(source, "Nilai kepentingan");
    let total = 0;
    const normalized = {};
    CRITERION_KEYS.forEach(function (key) {
      const value = source[key];
      if (!Number.isInteger(value) || value < 1 || value > 5) {
        throw new RangeError("Nilai kepentingan " + key + " harus bilangan bulat 1 sampai 5.");
      }
      total += value;
      normalized[key] = value;
    });
    if (total <= 0) {
      throw new Error("Total nilai kepentingan harus lebih dari 0.");
    }
    const weights = {};
    CRITERION_KEYS.forEach(function (key) {
      weights[key] = normalized[key] / total;
    });
    return {
      importance: normalized,
      weights: weights,
      totalImportance: total,
    };
  }

  function createConfig(profile, importance) {
    const selected = profile == null ? "standard" : String(profile);
    if (selected === "standard") {
      const weights = {};
      CRITERION_KEYS.forEach(function (key) {
        weights[key] = STANDARD_WEIGHTS[key];
      });
      return {
        profile: "standard",
        label: "Profil riset standar",
        weights: weights,
        importance: null,
        calibrated: true,
        classification: "Zona riset standar",
        thresholds: {
          greenMaxExclusive: STANDARD_THRESHOLDS.greenMaxExclusive,
          yellowMaxInclusive: STANDARD_THRESHOLDS.yellowMaxInclusive,
        },
      };
    }
    if (selected !== "custom") {
      throw new Error("Profil bobot tidak dikenal: " + selected + ".");
    }
    const normalized = normalizeImportance(importance == null ? DEFAULT_IMPORTANCE : importance);
    return {
      profile: "custom",
      label: "Profil kustom",
      weights: normalized.weights,
      importance: normalized.importance,
      calibrated: false,
      classification: "Indeks kustom belum terkalibrasi",
      thresholds: null,
    };
  }

  function validateScores(scores) {
    assertCriteriaKeys(scores, "Skor");
    CRITERION_KEYS.forEach(function (key) {
      const score = scores[key];
      if (!isFiniteNumber(score) || score < 1 || score > 5) {
        throw new RangeError("Skor " + key + " harus berada pada rentang 1 sampai 5.");
      }
    });
    return true;
  }

  function calculateWLC(scores, weights) {
    validateScores(scores);
    validateWeights(weights);
    let score = 0;
    const breakdown = {};
    CRITERIA.forEach(function (criterion) {
      const weighted = scores[criterion.key] * weights[criterion.key];
      score += weighted;
      breakdown[criterion.key] = {
        label: criterion.label,
        score: scores[criterion.key],
        weight: weights[criterion.key],
        contribution: weighted,
      };
    });
    return {
      score: score,
      breakdown: breakdown,
      weights: Object.assign({}, weights),
    };
  }

  function classifyStandard(score) {
    const value = Number(score);
    if (!Number.isFinite(value)) {
      throw new TypeError("Skor klasifikasi harus berupa angka.");
    }
    if (value < STANDARD_THRESHOLDS.greenMaxExclusive) {
      return {
        code: "hijau",
        label: "Zona Hijau",
        shortLabel: "Hijau",
        description: "Risiko rendah pada klasifikasi riset standar.",
      };
    }
    if (value <= STANDARD_THRESHOLDS.yellowMaxInclusive) {
      return {
        code: "kuning",
        label: "Zona Kuning",
        shortLabel: "Kuning",
        description: "Risiko sedang pada klasifikasi riset standar.",
      };
    }
    return {
      code: "merah",
      label: "Zona Merah",
      shortLabel: "Merah",
      description: "Risiko tinggi pada klasifikasi riset standar.",
    };
  }

  function getCriterion(key) {
    for (let i = 0; i < CRITERIA.length; i += 1) {
      if (CRITERIA[i].key === key) return CRITERIA[i];
    }
    return null;
  }

  function roundScore(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return Math.round((number + Number.EPSILON) * 100) / 100;
  }

  function formatNumber(value, digits) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "-";
    if (Number.isInteger(digits) && digits >= 0) {
      return number.toLocaleString("id-ID", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
    }
    return NUMBER_FMT.format(number);
  }

  function scoreLevel(score) {
    if (score >= 4.5) return "sangat tinggi";
    if (score >= 3.5) return "tinggi";
    if (score >= 2.5) return "sedang";
    if (score >= 1.5) return "rendah";
    return "sangat rendah";
  }

  function describeScore(key, score) {
    const criterion = getCriterion(key);
    if (!criterion || !Number.isFinite(Number(score))) return "-";
    return (
      criterion.label +
      " skor " +
      formatNumber(score, 2) +
      " (" +
      scoreLevel(Number(score)) +
      "); semakin tinggi skor, semakin besar kontribusi terhadap kerawanan."
    );
  }

  function segmentProperties(segment) {
    if (!segment || typeof segment !== "object") return {};
    if (segment.properties && typeof segment.properties === "object") return segment.properties;
    return segment;
  }

  function readScore(segment, key) {
    const props = segmentProperties(segment);
    if (props.spk_scores && Object.prototype.hasOwnProperty.call(props.spk_scores, key)) {
      const explicit = props.spk_scores[key];
      if (explicit == null) return null;
      const number = Number(explicit);
      return Number.isInteger(number) && number >= 1 && number <= 5 ? number : null;
    }
    if (
      props.score_completeness &&
      Object.prototype.hasOwnProperty.call(props.score_completeness, key) &&
      props.score_completeness[key] === false
    ) {
      return null;
    }
    const raw = props[SCORE_FIELD_MAP[key]];
    if (raw == null) return null;
    const number = Number(raw);
    return Number.isInteger(number) && number >= 1 && number <= 5 ? number : null;
  }

  function readArea(segment) {
    const props = segmentProperties(segment);
    const area = toFiniteNumber(props.luas_m2 != null ? props.luas_m2 : props.areaM2);
    return area != null && area > 0 ? area : 0;
  }

  function readActual(segment) {
    const props = segmentProperties(segment);
    const actual = props.spk_actual && typeof props.spk_actual === "object" ? props.spk_actual : {};
    return {
      slopeDeg: toFiniteNumber(actual.slopeDeg != null ? actual.slopeDeg : props.beta_mean != null ? props.beta_mean : props.lereng_derajat),
      soilType: actual.soilType != null ? actual.soilType : props.ket_tanah != null ? props.ket_tanah : props.jns_tnh,
      geologyUnit: actual.geologyUnit != null ? actual.geologyUnit : props.ket_batuan != null ? props.ket_batuan : props.formasi,
      rainfallMm: toFiniteNumber(actual.rainfallMm != null ? actual.rainfallMm : props.curah_hujan_mm),
      landCover: actual.landCover != null ? actual.landCover : props.ket_lahan != null ? props.ket_lahan : props.tutupan_lahan,
    };
  }

  function readFs(segment) {
    const props = segmentProperties(segment);
    return {
      value: toFiniteNumber(props.fs),
      label: props.fs_label != null ? String(props.fs_label) : null,
    };
  }

  function fsClass(fs) {
    if (!Number.isFinite(fs)) return null;
    if (fs > 1.25) {
      return { code: "stabil", label: "STABIL", description: "FS > 1,25", color: "#10b981" };
    }
    if (fs >= 1.07) {
      return { code: "kritis", label: "KRITIS", description: "1,07 <= FS <= 1,25", color: "#f59e0b" };
    }
    return { code: "labil", label: "LABIL / LONGSOR", description: "FS < 1,07", color: "#ef4444" };
  }

  function summarizeActualValues(key, segments) {
    const actualKeyMap = {
      slope: "slopeDeg",
      soil: "soilType",
      geology: "geologyUnit",
      rainfall: "rainfallMm",
      landCover: "landCover",
    };
    const actualKey = actualKeyMap[key];
    const groups = new Map();
    let numericWeight = 0;
    let numericArea = 0;
    segments.forEach(function (item) {
      const value = item.actual ? item.actual[actualKey] : null;
      if (value == null || value === "") return;
      const area = item.areaM2 || 0;
      if (key === "slope" || key === "rainfall") {
        const numeric = toFiniteNumber(value);
        if (numeric == null) return;
        numericWeight += numeric * area;
        numericArea += area;
        return;
      }
      const text = String(value).trim();
      const current = groups.get(text) || { value: text, areaM2: 0 };
      current.areaM2 += area;
      groups.set(text, current);
    });
    if (key === "slope" || key === "rainfall") {
      if (numericArea <= 0) return null;
      return numericWeight / numericArea;
    }
    const values = Array.from(groups.values()).sort(function (a, b) {
      return b.areaM2 - a.areaM2;
    });
    if (!values.length) return null;
    return values[0].value + (values.length > 1 ? " (+" + (values.length - 1) + " lainnya)" : "");
  }

  function actualValuesForKey(key, segments) {
    const actualKeyMap = {
      slope: "slopeDeg",
      soil: "soilType",
      geology: "geologyUnit",
      rainfall: "rainfallMm",
      landCover: "landCover",
    };
    const actualKey = actualKeyMap[key];
    if (key === "slope" || key === "rainfall") return [];
    const groups = new Map();
    segments.forEach(function (item) {
      const value = item.actual ? item.actual[actualKey] : null;
      if (value == null || value === "") return;
      const text = String(value).trim();
      const current = groups.get(text) || { value: text, areaM2: 0 };
      current.areaM2 += item.areaM2 || 0;
      groups.set(text, current);
    });
    return Array.from(groups.values()).sort(function (a, b) {
      return b.areaM2 - a.areaM2;
    });
  }

  function weightedAverage(items, getter) {
    let weight = 0;
    let total = 0;
    items.forEach(function (item) {
      const value = toFiniteNumber(getter(item));
      const area = item.areaM2 || 0;
      if (value == null || area <= 0) return;
      total += value * area;
      weight += area;
    });
    return weight > 0 ? total / weight : null;
  }

  function buildAssessment(input) {
    assertObject(input, "Input assessment");
    const segments = Array.isArray(input.segments) ? input.segments : [];
    if (!segments.length) {
      throw new Error("Assessment membutuhkan minimal satu segmen poligon.");
    }

    const config =
      input.config && input.config.weights
        ? createConfig(input.config.profile, input.config.importance)
        : createConfig(input.profile || "standard", input.importance);
    validateWeights(config.weights);
    const standardConfig = createConfig("standard");
    const polygonAreaM2 = toFiniteNumber(
      input.polygonAreaM2 != null
        ? input.polygonAreaM2
        : input.summary && input.summary.luas_poligon_m2
    );
    const datasetRefs = Array.isArray(input.datasetRefs)
      ? input.datasetRefs.slice()
      : [
          "public/data/clean_kerawanan_longsor.geojson",
          "public/data/clean_batas_administrasi.geojson",
          "public/data/GJS Layer2_JenisTanah_SlemanBantul.geojson",
          "public/data/GJS Layer3_Geologi_SlemanBantul.geojson",
          "public/data/clean_curah_hujan_idw.geojson",
          "public/data/clean_tutupan_lahan_diy.geojson",
          "public/data/clean_demnas_diy_utm.geojson",
        ];

    let coveredAreaM2 = 0;
    let completeAreaM2 = 0;
    const missingCriteriaSet = new Set();
    const segmentRows = [];

    segments.forEach(function (segment, index) {
      const props = segmentProperties(segment);
      const areaM2 = readArea(segment);
      const actual = readActual(segment);
      const fs = readFs(segment);
      const scores = {};
      const missing = [];
      CRITERIA.forEach(function (criterion) {
        const score = readScore(segment, criterion.key);
        if (score == null) {
          missing.push(criterion.key);
          missingCriteriaSet.add(criterion.key);
        } else {
          scores[criterion.key] = score;
        }
      });
      const complete = missing.length === 0;
      let standardWlc = null;
      let activeWlc = null;
      let standardScore = null;
      let activeScore = null;
      if (complete) {
        standardWlc = calculateWLC(scores, standardConfig.weights);
        activeWlc = calculateWLC(scores, config.weights);
        standardScore = roundScore(standardWlc.score);
        activeScore = config.profile === "standard" ? standardScore : roundScore(activeWlc.score);
      }
      const standardZone = standardScore != null ? classifyStandard(standardScore) : null;
      coveredAreaM2 += areaM2;
      if (complete) completeAreaM2 += areaM2;

      segmentRows.push({
        segmentId: props.segmen_id || props.id || "SEG-" + String(index + 1).padStart(2, "0"),
        index: index,
        areaM2: areaM2,
        complete: complete,
        missing: missing,
        rawScores: scores,
        actual: actual,
        fs: fs.value,
        fsLabel: fs.label || (fs.value != null ? fsClass(fs.value).label : null),
        geotech: {
          cKpa: toFiniteNumber(props.c_kpa),
          crKpa: toFiniteNumber(props.cr_kpa),
          phiDeg: toFiniteNumber(props.phi_deg),
          gammaSat: toFiniteNumber(props.gamma_sat),
          zDepth: toFiniteNumber(props.z_depth != null ? props.z_depth : props.z),
          rasioM: toFiniteNumber(props.rasio_m),
          qKpa: toFiniteNumber(props.q_kpa),
          uKpa: toFiniteNumber(props.u_kpa),
        },
        standardScore: standardScore,
        standardZone: standardZone,
        activeScore: activeScore,
        activeZone: config.profile === "standard" ? standardZone : null,
      });
    });

    const eligibleSegments = segmentRows.filter(function (row) {
      return row.complete;
    });
    const totalAreaM2 = polygonAreaM2 != null && polygonAreaM2 > 0 ? polygonAreaM2 : coveredAreaM2;
    const coverageRatio = totalAreaM2 > 0 ? coveredAreaM2 / totalAreaM2 : null;
    const completeRatio = coveredAreaM2 > 0 ? completeAreaM2 / coveredAreaM2 : null;

    const activeScore = weightedAverage(eligibleSegments, function (row) {
      return row.activeScore;
    });
    const standardScore = weightedAverage(eligibleSegments, function (row) {
      return row.standardScore;
    });

    const activeSorted = eligibleSegments
      .slice()
      .filter(function (row) { return row.activeScore != null; })
      .sort(function (a, b) { return a.activeScore - b.activeScore; });
    const highestSegment = activeSorted.length ? activeSorted[activeSorted.length - 1] : null;
    const lowestSegment = activeSorted.length ? activeSorted[0] : null;
    const activeMin = highestSegment ? lowestSegment.activeScore : null;
    const activeMax = highestSegment ? highestSegment.activeScore : null;

    const zoneAreas = {
      hijau: 0,
      kuning: 0,
      merah: 0,
    };
    eligibleSegments.forEach(function (row) {
      if (row.standardZone) zoneAreas[row.standardZone.code] += row.areaM2;
    });
    const classifiedAreaM2 = zoneAreas.hijau + zoneAreas.kuning + zoneAreas.merah;
    const outsideDataAreaM2 = Math.max(totalAreaM2 - coveredAreaM2, 0);
    const incompleteAreaM2 = Math.max(coveredAreaM2 - classifiedAreaM2, 0);
    const unclassifiedAreaM2 = Math.max(totalAreaM2 - classifiedAreaM2, 0);
    const zoneDistribution = {
      hijau: {
        code: "hijau",
        label: "Zona Hijau",
        areaM2: zoneAreas.hijau,
        percentOfPolygon: totalAreaM2 > 0 ? (zoneAreas.hijau / totalAreaM2) * 100 : null,
        percentOfCovered: coveredAreaM2 > 0 ? (zoneAreas.hijau / coveredAreaM2) * 100 : null,
      },
      kuning: {
        code: "kuning",
        label: "Zona Kuning",
        areaM2: zoneAreas.kuning,
        percentOfPolygon: totalAreaM2 > 0 ? (zoneAreas.kuning / totalAreaM2) * 100 : null,
        percentOfCovered: coveredAreaM2 > 0 ? (zoneAreas.kuning / coveredAreaM2) * 100 : null,
      },
      merah: {
        code: "merah",
        label: "Zona Merah",
        areaM2: zoneAreas.merah,
        percentOfPolygon: totalAreaM2 > 0 ? (zoneAreas.merah / totalAreaM2) * 100 : null,
        percentOfCovered: coveredAreaM2 > 0 ? (zoneAreas.merah / coveredAreaM2) * 100 : null,
      },
      tidak_terklasifikasi: {
        code: "tidak_terklasifikasi",
        label: "Tidak tercakup / tidak terklasifikasi",
        areaM2: unclassifiedAreaM2,
        outsideDataAreaM2: outsideDataAreaM2,
        incompleteAreaM2: incompleteAreaM2,
        percentOfPolygon: totalAreaM2 > 0 ? (unclassifiedAreaM2 / totalAreaM2) * 100 : null,
      },
    };

    const criteria = CRITERIA.map(function (criterion) {
      const dataRows = segmentRows.filter(function (row) {
        return row.rawScores[criterion.key] != null;
      });
      const score = weightedAverage(dataRows, function (row) {
        return row.rawScores[criterion.key];
      });
      const missingSegments = segmentRows.filter(function (row) {
        return row.rawScores[criterion.key] == null;
      });
      const dataStatus =
        missingSegments.length === 0
          ? "complete"
          : dataRows.length === 0
          ? "missing"
          : "partial";
      return {
        key: criterion.key,
        label: criterion.label,
        shortLabel: criterion.shortLabel,
        source: criterion.source,
        score: score,
        weight: config.weights[criterion.key],
        weightPercent: config.weights[criterion.key] * 100,
        importance: config.importance ? config.importance[criterion.key] : null,
        contribution: score != null ? score * config.weights[criterion.key] : null,
        standardWeight: STANDARD_WEIGHTS[criterion.key],
        standardWeightPercent: STANDARD_WEIGHTS[criterion.key] * 100,
        dataStatus: dataStatus,
        missingSegmentCount: missingSegments.length,
        actualSummary: summarizeActualValues(criterion.key, segmentRows),
        actualValues: actualValuesForKey(criterion.key, segmentRows),
        interpretation: score != null ? describeScore(criterion.key, score) : "Data kriteria tidak tersedia.",
      };
    });

    const classifiedSegments = segmentRows.filter(function (row) {
      return row.standardZone != null;
    });
    const fsSegments = segmentRows.filter(function (row) {
      return row.fs != null;
    });
    const fsMean = weightedAverage(fsSegments, function (row) { return row.fs; });
    const fsMinRow = fsSegments.reduce(function (best, row) {
      if (!best || row.fs < best.fs) return row;
      return best;
    }, null);
    const fsMaxRow = fsSegments.reduce(function (best, row) {
      if (!best || row.fs > best.fs) return row;
      return best;
    }, null);
    const fsCounts = { stabil: 0, kritis: 0, labil: 0 };
    fsSegments.forEach(function (row) {
      const cls = fsClass(row.fs);
      if (cls) fsCounts[cls.code] += 1;
    });

    const missingCriteria = Array.from(missingCriteriaSet);
    const incompleteSegments = segmentRows.length - eligibleSegments.length;
    const warnings = [];
    if (missingCriteria.length) {
      warnings.push(
        "Data kriteria tidak lengkap: " + missingCriteria.join(", ") + ". Hasil tidak boleh dianggap definitif."
      );
    }
    if (incompleteSegments > 0) {
      warnings.push(incompleteSegments + " segmen tidak memiliki data lengkap dan tidak diikutkan dalam agregasi.");
    }
    if (coverageRatio == null) {
      warnings.push("Luas poligon tidak tersedia; cakupan data tidak dapat diverifikasi.");
    } else if (coverageRatio < 0.8) {
      warnings.push(
        "Cakupan data hanya " +
          formatNumber(coverageRatio * 100, 1) +
          "% dari luas poligon. Bagian yang tidak tercakup tidak boleh dianggap aman."
      );
    }
    if (config.profile === "custom") {
      warnings.push(
        "Indeks kustom belum dikalibrasi. Ambang zona riset standar tidak digunakan untuk profil kustom."
      );
    }
    const definitiveEligible =
      missingCriteria.length === 0 &&
      incompleteSegments === 0 &&
      coverageRatio != null &&
      coverageRatio >= 0.8;

    const createdAt = input.createdAt || new Date().toISOString();
    const assessmentId =
      input.assessmentId ||
      "SPK-" +
        createdAt.replace(/[-:.TZ]/g, "").slice(0, 14) +
        "-" +
        Math.random().toString(36).slice(2, 6).toUpperCase();

    const activeZone =
      config.profile === "standard" && activeScore != null
        ? classifyStandard(roundScore(activeScore))
        : null;

    const assessment = {
      success: true,
      assessmentId: assessmentId,
      version: VERSION,
      createdAt: createdAt,
      config: config,
      standardConfig: standardConfig,
      location: {
        geometry: input.geometry || null,
        areaM2: totalAreaM2,
        coveredAreaM2: coveredAreaM2,
        completeAreaM2: completeAreaM2,
        coverageRatio: coverageRatio,
        completeRatio: completeRatio,
        segmentCount: segmentRows.length,
        completeSegmentCount: eligibleSegments.length,
      },
      dataCompleteness: {
        status:
          missingCriteria.length === 0
            ? "complete"
            : eligibleSegments.length > 0
            ? "incomplete"
            : "unavailable",
        missingCriteria: missingCriteria,
        incompleteSegments: incompleteSegments,
        completeSegments: eligibleSegments.length,
        totalSegments: segmentRows.length,
        definitiveEligible: definitiveEligible,
        warnings: warnings,
      },
      criteria: criteria,
      landUse: input.landUse || null,
      sensitiveAreas: input.sensitiveAreas || null,
      standard: {
        profile: "standard",
        label: standardConfig.label,
        weights: standardConfig.weights,
        score: standardScore,
        classification: standardScore != null ? classifyStandard(standardScore) : null,
        zoneDistribution: zoneDistribution,
        formula: "0,30 x lereng + 0,25 x tanah + 0,20 x geologi + 0,15 x hujan + 0,10 x tutupan",
        thresholds: {
          greenMaxExclusive: STANDARD_THRESHOLDS.greenMaxExclusive,
          yellowMaxInclusive: STANDARD_THRESHOLDS.yellowMaxInclusive,
        },
      },
      active: {
        profile: config.profile,
        label: config.label,
        weights: config.weights,
        importance: config.importance,
        calibrated: config.calibrated,
        score: activeScore,
        classification: activeZone,
        classificationStatus: config.profile === "standard" ? "calibrated" : "not_calibrated",
        min: activeMin,
        max: activeMax,
        highestSegment: highestSegment
          ? {
              segmentId: highestSegment.segmentId,
              score: highestSegment.activeScore,
              areaM2: highestSegment.areaM2,
            }
          : null,
        lowestSegment: lowestSegment
          ? {
              segmentId: lowestSegment.segmentId,
              score: lowestSegment.activeScore,
              areaM2: lowestSegment.areaM2,
            }
          : null,
      },
      infiniteSlope: {
        includedInWlc: false,
        mean: fsMean,
        min: fsMinRow ? fsMinRow.fs : null,
        max: fsMaxRow ? fsMaxRow.fs : null,
        worstSegment: fsMinRow
          ? {
              segmentId: fsMinRow.segmentId,
              fs: fsMinRow.fs,
              label: fsMinRow.fsLabel,
              areaM2: fsMinRow.areaM2,
            }
          : null,
        bestSegment: fsMaxRow
          ? {
              segmentId: fsMaxRow.segmentId,
              fs: fsMaxRow.fs,
              label: fsMaxRow.fsLabel,
              areaM2: fsMaxRow.areaM2,
            }
          : null,
        counts: fsCounts,
        classification: fsMinRow ? fsClass(fsMinRow.fs) : null,
        thresholds: { stableAbove: 1.25, criticalMin: 1.07 },
      },
      segments: segmentRows,
      metadata: {
        version: VERSION,
        formula:
          "WLC = jumlah (skor kriteria x bobot ternormalisasi); skor kriteria 1-5, semakin tinggi semakin rawan.",
        standardWeights: Object.assign({}, STANDARD_WEIGHTS),
        defaultCustomImportance: Object.assign({}, DEFAULT_IMPORTANCE),
        scoreDirection: "higher_is_more_susceptible",
        datasetRefs: datasetRefs,
        limitations: [
          "Bobot kustom belum dikalibrasi dan bukan ambang zona resmi.",
          "Zona kerawanan adalah model spasial, bukan penetapan hukum.",
          "Keputusan akhir memerlukan verifikasi lapangan dan penilaian ahli.",
          "Data pembatas RTRW, kawasan lindung, dan sempadan belum tersedia.",
          "Kelas guna lahan dan objek sensitif bersifat informatif, bukan penetapan status atau batas resmi.",
        ],
      },
      constraints: null,
      recommendations: null,
      humanDecision: null,
    };

    return assessment;
  }

  return {
    VERSION: VERSION,
    CRITERIA: CRITERIA,
    CRITERION_KEYS: CRITERION_KEYS,
    STANDARD_WEIGHTS: STANDARD_WEIGHTS,
    DEFAULT_IMPORTANCE: DEFAULT_IMPORTANCE,
    STANDARD_THRESHOLDS: STANDARD_THRESHOLDS,
    createConfig: createConfig,
    normalizeImportance: normalizeImportance,
    validateWeights: validateWeights,
    validateScores: validateScores,
    calculateWLC: calculateWLC,
    classifyStandard: classifyStandard,
    describeScore: describeScore,
    fsClass: fsClass,
    buildAssessment: buildAssessment,
    formatNumber: formatNumber,
  };
});
