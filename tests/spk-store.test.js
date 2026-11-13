const test = require("node:test");
const assert = require("node:assert/strict");

const Engine = require("../Web/modules/spk-engine.js");
const Store = require("../Web/modules/spk-store.js");

function memoryStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

globalThis.localStorage = memoryStorage();

function makeAssessment(id) {
  return Engine.buildAssessment({
    segments: [
      {
        type: "Feature",
        properties: {
          segmen_id: "SEG-01",
          luas_m2: 100,
          spk_scores: { slope: 3, soil: 4, geology: 5, rainfall: 4, landCover: 2 },
          spk_actual: {
            slopeDeg: 22.6,
            soilType: "Latosol",
            geologyUnit: "Formasi Semilir",
            rainfallMm: 2541,
            landCover: "Kebun",
          },
          fs: 1.5,
        },
      },
    ],
    geometry: { type: "Polygon", coordinates: [] },
    polygonAreaM2: 100,
    config: Engine.createConfig("standard"),
    createdAt: "2026-11-12T00:00:00Z",
    assessmentId: id,
  });
}

test("review records preserve decision, assessment snapshot and audit fields", () => {
  Store.clearReviews();
  const assessment = makeAssessment("SPK-STORE-1");
  assessment.constraints = {
    items: [],
    summary: { hasUnknownBindingConstraints: true, note: "legal belum tersedia" },
  };
  assessment.recommendations = {
    summary: { title: "Belum ada skenario yang dapat diutamakan" },
  };

  const result = Store.saveReview(assessment, {
    status: "accepted_with_conditions",
    reviewer: "  Reviewer Uji  ",
    rationale: "  Syarat drainase dan kajian geoteknik  ",
    notes: "Catatan",
  });
  assert.equal(result.ok, true);
  assert.equal(result.total, 1);
  assert.match(result.record.reviewId, /^REV-/);
  assert.equal(result.record.humanDecision.status, "accepted_with_conditions");
  assert.equal(result.record.humanDecision.reviewer, "Reviewer Uji");
  assert.equal(result.record.humanDecision.rationale, "Syarat drainase dan kajian geoteknik");
  assert.equal(result.record.assessmentId, "SPK-STORE-1");
  assert.equal(result.record.assessment.active.profile, "standard");
  assert.equal(result.record.constraintsSummary.hasUnknownBindingConstraints, true);
  assert.match(result.record.storageNote, /Bukan basis data terpusat/);

  const listed = Store.listReviews();
  assert.equal(listed.length, 1);
  assert.equal(Store.findReview(result.record.reviewId).assessmentId, "SPK-STORE-1");
  assert.match(Store.serializeReview(result.record), /SPK-STORE-1/);
});

test("invalid decision status and missing assessment are rejected", () => {
  const assessment = makeAssessment("SPK-STORE-2");
  assert.throws(
    () => Store.createReviewRecord(assessment, { status: "unknown", reviewer: "A" }),
    /Status keputusan/
  );
  assert.throws(
    () => Store.createReviewRecord({}, { status: "accepted" }),
    /assessmentId/
  );
  const result = Store.saveReview(assessment, { status: "unknown" });
  assert.equal(result.ok, false);
  assert.match(result.error, /Status keputusan/);
});

test("decisions are capped and can be deleted or cleared", () => {
  Store.clearReviews();
  for (let index = 0; index < Store.DECISION_STATUSES.length + 2; index += 1) {
    const result = Store.saveReview(makeAssessment("SPK-STORE-" + index), {
      status: "pending",
      reviewer: "Reviewer " + index,
    });
    assert.equal(result.ok, true);
  }
  const reviews = Store.listReviews();
  assert.ok(reviews.length > 1);
  assert.ok(reviews.length <= 50);
  const target = reviews[0];
  assert.equal(Store.deleteReview(target.reviewId), true);
  assert.equal(Store.findReview(target.reviewId), null);
  assert.equal(Store.clearReviews(), true);
  assert.deepEqual(Store.listReviews(), []);
});

test("draft save, load, and clear round trip", () => {
  Store.clearDraft();
  const assessment = makeAssessment("SPK-DRAFT-1");
  const result = Store.saveDraft(assessment, {
    status: "needs_more_review",
    reviewer: "Draft Reviewer",
    rationale: "Draf",
  });
  assert.equal(result.ok, true);
  const draft = Store.loadDraft();
  assert.equal(draft.assessmentId, "SPK-DRAFT-1");
  assert.equal(draft.form.reviewer, "Draft Reviewer");
  assert.equal(draft.assessment.active.profile, "standard");
  assert.equal(Store.clearDraft(), true);
  assert.equal(Store.loadDraft(), null);
});

test("download is a no-op in a Node environment without document/Blob/URL", () => {
  const record = Store.createReviewRecord(makeAssessment("SPK-DOWNLOAD"), {
    status: "accepted",
    reviewer: "A",
  });
  assert.equal(Store.downloadReview(record), false);
  assert.equal(Store.downloadReview(null), false);
});
