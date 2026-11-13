const test = require("node:test");
const assert = require("node:assert/strict");

const Engine = require("../Web/modules/spk-engine.js");
const Constraints = require("../Web/modules/spatial-constraints.js");
const Recommendation = require("../Web/modules/development-recommendation.js");

function segment(id, options) {
  const opts = options || {};
  const scores = opts.scores || { slope: 3, soil: 3, geology: 3, rainfall: 3, landCover: 3 };
  return {
    type: "Feature",
    properties: {
      segmen_id: id,
      luas_m2: opts.area == null ? 100 : opts.area,
      spk_scores: scores,
      spk_actual: {
        slopeDeg: opts.slopeDeg == null ? 10 : opts.slopeDeg,
        soilType: opts.soilType || "Latosol",
        geologyUnit: opts.geologyUnit || "Formasi Semilir",
        rainfallMm: 2500,
        landCover: opts.landCover || "Kebun",
      },
      c_kpa: 10,
      cr_kpa: 0,
      phi_deg: 25,
      gamma_sat: 18,
      z_depth: 2,
      rasio_m: 0.6,
      q_kpa: 0,
      fs: opts.fs == null ? 2 : opts.fs,
    },
  };
}

function assessment(segments, polygonAreaM2, profile) {
  return Engine.buildAssessment({
    segments: segments,
    polygonAreaM2: polygonAreaM2,
    config:
      profile === "custom"
        ? Engine.createConfig("custom", { slope: 5, soil: 1, geology: 1, rainfall: 1, landCover: 1 })
        : Engine.createConfig("standard"),
    createdAt: "2026-11-12T00:00:00Z",
    assessmentId: "TEST-CR",
  });
}

test("spatial constraints distinguish missing legal data from no restriction", () => {
  const result = assessment(
    [
      segment("SEG-01", {
        scores: { slope: 5, soil: 5, geology: 5, rainfall: 5, landCover: 5 },
        slopeDeg: 30,
        landCover: "Sungai (Badan Air)",
        soilType: "Grumusol",
        fs: 0.95,
      }),
      segment("SEG-02", { area: 100, slopeDeg: 5, fs: 2.2 }),
    ],
    400
  );
  const constraints = Constraints.evaluateConstraints(result);
  const byId = Object.fromEntries(constraints.items.map((item) => [item.id, item]));
  assert.equal(byId.rtrw.status, "not_evaluated");
  assert.equal(byId.rtrw.binding, true);
  assert.equal(byId.protected_area.status, "not_evaluated");
  assert.equal(byId.river_buffer.status, "not_evaluated");
  assert.equal(byId.water_body.detected, true);
  assert.equal(byId.steep_terrain.detected, true);
  assert.equal(byId.modeled_susceptibility.status, "indication_detected");
  assert.equal(byId.water_body.status, "indication_detected");
  assert.equal(byId.steep_terrain.status, "indication_detected");
  assert.equal(constraints.summary.hasBindingRestriction, false);
  assert.equal(constraints.summary.hasUnknownBindingConstraints, true);
  assert.equal(constraints.summary.canConcludeLegalFeasibility, false);
  assert.match(constraints.summary.note, /bukan berarti tidak ada batasan|tidak adanya batasan/i);
});

test("recommendations avoid a preferred scenario while legal data is unavailable", () => {
  const result = assessment(
    [
      segment("SEG-01", {
        scores: { slope: 1, soil: 1, geology: 1, rainfall: 1, landCover: 1 },
        slopeDeg: 5,
        fs: 2.2,
      }),
      segment("SEG-02", {
        scores: { slope: 1, soil: 1, geology: 1, rainfall: 1, landCover: 1 },
        slopeDeg: 6,
        fs: 2.4,
      }),
    ],
    200
  );
  result.constraints = Constraints.evaluateConstraints(result);
  const rec = Recommendation.evaluateRecommendations(result, result.constraints);
  assert.equal(rec.preferredForStudy, null);
  assert.equal(rec.scenarios.length, 6);
  assert.equal(rec.summary.recommendedForConstruction, false);
  assert.equal(rec.summary.requiresProfessionalReview, true);
  assert.ok(rec.scenarios.every((scenario) => scenario.professionalReviewRequired));
  assert.ok(rec.scenarios.every((scenario) => scenario.designQuantities === null));
});

test("severe FS blocks development scenarios even when coverage is partial", () => {
  const result = assessment(
    [
      segment("SEG-01", {
        scores: { slope: 5, soil: 5, geology: 5, rainfall: 5, landCover: 5 },
        fs: 0.9,
        slopeDeg: 30,
      }),
      segment("SEG-02", {
        scores: { slope: 5, soil: 5, geology: 5, rainfall: 5, landCover: 5 },
        fs: 0.95,
        slopeDeg: 28,
      }),
    ],
    500
  );
  result.constraints = Constraints.evaluateConstraints(result);
  const rec = Recommendation.evaluateRecommendations(result, result.constraints);
  const development = rec.scenarios.filter((scenario) => scenario.id !== "no_development");
  assert.ok(development.every((scenario) => scenario.status === "tidak_direkomendasikan"));
  const noBuild = rec.scenarios.find((scenario) => scenario.id === "no_development");
  assert.equal(noBuild.status, "dapat_dikaji");
  assert.equal(rec.preferredForStudy, null);
});

test("sufficient criteria evidence can mark a study priority when legal data is complete", () => {
  const result = assessment(
    [
      segment("SEG-01", {
        scores: { slope: 1, soil: 1, geology: 1, rainfall: 1, landCover: 1 },
        slopeDeg: 6,
        fs: 2.2,
      }),
      segment("SEG-02", {
        scores: { slope: 1, soil: 1, geology: 1, rainfall: 1, landCover: 1 },
        slopeDeg: 7,
        fs: 2.5,
      }),
    ],
    200
  );
  const constraints = {
    items: [],
    summary: {
      hasBindingRestriction: false,
      hasUnknownBindingConstraints: false,
      canConcludeLegalFeasibility: true,
    },
  };
  const rec = Recommendation.evaluateRecommendations(result, constraints);
  assert.ok(rec.preferredForStudy);
  const preferred = rec.scenarios.find((scenario) => scenario.id === rec.preferredForStudy.id);
  assert.equal(preferred.isPreferredForStudy, true);
  assert.equal(rec.summary.recommendedForConstruction, false);
});

test("custom weighting does not alter FS or make recommendations calibrated", () => {
  const segments = [
    segment("SEG-01", {
      scores: { slope: 5, soil: 1, geology: 1, rainfall: 1, landCover: 1 },
      fs: 1.5,
      slopeDeg: 20,
    }),
    segment("SEG-02", {
      scores: { slope: 1, soil: 5, geology: 5, rainfall: 5, landCover: 5 },
      fs: 2.2,
      slopeDeg: 12,
    }),
  ];
  const standard = assessment(segments, 200, "standard");
  const custom = assessment(segments, 200, "custom");
  standard.constraints = Constraints.evaluateConstraints(standard);
  custom.constraints = Constraints.evaluateConstraints(custom);
  const standardRec = Recommendation.evaluateRecommendations(standard, standard.constraints);
  const customRec = Recommendation.evaluateRecommendations(custom, custom.constraints);
  assert.equal(standard.infiniteSlope.min, custom.infiniteSlope.min);
  assert.equal(custom.active.calibrated, false);
  assert.equal(custom.active.classification, null);
  assert.equal(standardRec.summary.recommendedForConstruction, false);
  assert.equal(customRec.summary.recommendedForConstruction, false);
});
