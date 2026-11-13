(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root);
  } else {
    root.LahanAmanSPKStore = factory(root);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const STORAGE_KEY = "lahanaman.spk.reviews.v1";
  const DRAFT_KEY = "lahanaman.spk.draft.v1";
  const MAX_RECORDS = 50;

  const DECISION_STATUSES = Object.freeze([
    { value: "pending", label: "Belum diputuskan" },
    { value: "accepted", label: "Disetujui" },
    { value: "accepted_with_conditions", label: "Disetujui dengan syarat" },
    { value: "rejected", label: "Ditolak" },
    { value: "needs_more_review", label: "Perlu kajian tambahan" },
  ]);

  function getStorage() {
    try {
      return root.localStorage || null;
    } catch (_error) {
      return null;
    }
  }

  function safeParse(value, fallback) {
    if (!value) return fallback;
    try {
      const parsed = JSON.parse(value);
      return parsed == null ? fallback : parsed;
    } catch (_error) {
      return fallback;
    }
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function compactReport(report) {
    if (!report) return null;
    const copy = clone(report);
    if (Array.isArray(copy.features)) {
      copy.features = copy.features.map(function (feature) {
        const item = Object.assign({}, feature);
        delete item.geometry;
        return item;
      });
    }
    return copy;
  }

  function compactAssessment(assessment) {
    if (!assessment) return null;
    const copy = clone(assessment);
    copy.landUse = compactReport(assessment.landUse);
    copy.sensitiveAreas = compactReport(assessment.sensitiveAreas);
    return copy;
  }

  function landUseSummary(report) {
    if (!report) return null;
    return {
      status: report.status || null,
      available: report.available === true,
      coverageRatio: report.coverageRatio == null ? null : report.coverageRatio,
      coveredAreaM2: report.coveredAreaM2 == null ? null : report.coveredAreaM2,
      polygonAreaM2: report.polygonAreaM2 == null ? null : report.polygonAreaM2,
      classes: Array.isArray(report.classes) ? report.classes.slice(0, 25) : [],
      warnings: Array.isArray(report.warnings) ? report.warnings.slice() : [],
      dataset: report.dataset || null,
    };
  }

  function sensitiveAreaSummary(report) {
    if (!report) return null;
    return {
      available: report.available === true,
      summary: report.summary ? clone(report.summary) : null,
      items: Array.isArray(report.items) ? report.items.slice(0, 25) : [],
      dataset: report.dataset || null,
    };
  }

  function makeId(prefix) {
    return (
      prefix +
      "-" +
      new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14) +
      "-" +
      Math.random().toString(36).slice(2, 6).toUpperCase()
    );
  }

  function listReviews() {
    const storage = getStorage();
    if (!storage) return [];
    const records = safeParse(storage.getItem(STORAGE_KEY), []);
    if (!Array.isArray(records)) return [];
    return records.slice().sort(function (a, b) {
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });
  }

  function createReviewRecord(assessment, decision) {
    if (!assessment || !assessment.assessmentId) {
      throw new TypeError("Assessment dengan assessmentId diperlukan.");
    }
    if (!decision || typeof decision !== "object") {
      throw new TypeError("Keputusan pengguna diperlukan.");
    }
    const allowed = DECISION_STATUSES.some(function (item) {
      return item.value === decision.status;
    });
    if (!allowed) {
      throw new Error("Status keputusan tidak dikenal.");
    }
    const createdAt = new Date().toISOString();
    return {
      schema: "lahanaman.spk.review/v1",
      formatVersion: 2,
      reviewId: makeId("REV"),
      createdAt: createdAt,
      updatedAt: createdAt,
      assessmentId: assessment.assessmentId,
      location: {
        areaM2: assessment.location ? assessment.location.areaM2 : null,
        coveredAreaM2: assessment.location ? assessment.location.coveredAreaM2 : null,
        coverageRatio: assessment.location ? assessment.location.coverageRatio : null,
        segmentCount: assessment.location ? assessment.location.segmentCount : null,
        geometry: assessment.location ? assessment.location.geometry : null,
      },
      config: assessment.config ? clone(assessment.config) : null,
      active: assessment.active
        ? {
            profile: assessment.active.profile,
            label: assessment.active.label,
            score: assessment.active.score,
            calibrated: assessment.active.calibrated,
            classification: assessment.active.classification,
            classificationStatus: assessment.active.classificationStatus,
          }
        : null,
      standard: assessment.standard
        ? {
            score: assessment.standard.score,
            classification: assessment.standard.classification,
          }
        : null,
      infiniteSlope: assessment.infiniteSlope ? clone(assessment.infiniteSlope) : null,
      dataCompleteness: assessment.dataCompleteness ? clone(assessment.dataCompleteness) : null,
      constraintsSummary: assessment.constraints ? clone(assessment.constraints.summary) : null,
      landUseSummary: landUseSummary(assessment.landUse),
      sensitiveAreaSummary: sensitiveAreaSummary(assessment.sensitiveAreas),
      recommendationsSummary: assessment.recommendations
        ? clone(assessment.recommendations.summary)
        : null,
      systemInterpretation: assessment.interpretation ? clone(assessment.interpretation) : null,
      humanDecision: {
        status: decision.status,
        reviewer: String(decision.reviewer || "").trim(),
        rationale: String(decision.rationale || "").trim(),
        notes: String(decision.notes || "").trim(),
        decidedAt: decision.decidedAt || createdAt,
        systemRecommendation:
          assessment.recommendations && assessment.recommendations.summary
            ? assessment.recommendations.summary.title
            : null,
      },
      assessment: compactAssessment(assessment),
      storageNote:
        "Catatan disimpan secara lokal di browser perangkat ini, bukan basis data terpusat; bukan izin pembangunan atau sertifikat keamanan lahan.",
    };
  }

  function saveReview(assessment, decision) {
    const storage = getStorage();
    if (!storage) {
      return { ok: false, error: "Penyimpanan lokal tidak tersedia di browser ini." };
    }
    try {
      const record = createReviewRecord(assessment, decision);
      const records = listReviews();
      records.unshift(record);
      const limited = records.slice(0, MAX_RECORDS);
      storage.setItem(STORAGE_KEY, JSON.stringify(limited));
      return { ok: true, record: record, total: limited.length };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  function findReview(reviewId) {
    return listReviews().find(function (record) {
      return record.reviewId === reviewId;
    }) || null;
  }

  function deleteReview(reviewId) {
    const storage = getStorage();
    if (!storage) return false;
    const records = listReviews().filter(function (record) {
      return record.reviewId !== reviewId;
    });
    storage.setItem(STORAGE_KEY, JSON.stringify(records));
    return true;
  }

  function clearReviews() {
    const storage = getStorage();
    if (!storage) return false;
    storage.removeItem(STORAGE_KEY);
    return true;
  }

  function saveDraft(assessment, formValue) {
    const storage = getStorage();
    if (!storage) {
      return { ok: false, error: "Penyimpanan lokal tidak tersedia di browser ini." };
    }
    try {
      const payload = {
        schema: "lahanaman.spk.draft/v1",
        savedAt: new Date().toISOString(),
        assessmentId: assessment ? assessment.assessmentId : null,
        form: formValue || {},
        assessment: assessment ? compactAssessment(assessment) : null,
        note: "Draf lokal browser, bukan keputusan resmi.",
      };
      storage.setItem(DRAFT_KEY, JSON.stringify(payload));
      return { ok: true, draft: payload };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  function loadDraft() {
    const storage = getStorage();
    if (!storage) return null;
    return safeParse(storage.getItem(DRAFT_KEY), null);
  }

  function clearDraft() {
    const storage = getStorage();
    if (!storage) return false;
    storage.removeItem(DRAFT_KEY);
    return true;
  }

  function serializeReview(record) {
    return JSON.stringify(record, null, 2);
  }

  function downloadReview(record) {
    if (!record) return false;
    if (!root.document || !root.Blob || !root.URL) return false;
    const blob = new root.Blob([serializeReview(record)], {
      type: "application/json;charset=utf-8",
    });
    const url = root.URL.createObjectURL(blob);
    const anchor = root.document.createElement("a");
    anchor.href = url;
    anchor.download = record.assessmentId + "_" + record.reviewId + ".json";
    root.document.body.appendChild(anchor);
    anchor.click();
    root.document.body.removeChild(anchor);
    root.URL.revokeObjectURL(url);
    return true;
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    DRAFT_KEY: DRAFT_KEY,
    DECISION_STATUSES: DECISION_STATUSES,
    listReviews: listReviews,
    createReviewRecord: createReviewRecord,
    saveReview: saveReview,
    findReview: findReview,
    deleteReview: deleteReview,
    clearReviews: clearReviews,
    saveDraft: saveDraft,
    loadDraft: loadDraft,
    clearDraft: clearDraft,
    serializeReview: serializeReview,
    downloadReview: downloadReview,
  };
});
