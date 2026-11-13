const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const Engine = require("../Web/modules/spk-engine.js");

const ROOT = path.join(__dirname, "..");
const kerawanan = JSON.parse(
  fs
    .readFileSync(path.join(ROOT, "public", "data", "clean_kerawanan_longsor.geojson"), "utf8")
    .replace(/^\uFEFF/, "")
);

function scoresFromProps(props) {
  return {
    slope: Number(props.skor_lereng),
    soil: Number(props.skor_tanah),
    geology: Number(props.skor_batuan),
    rainfall: Number(props.skor_hujan),
    landCover: Number(props.skor_lahan),
  };
}

function segment(id, scores, area, extra) {
  return {
    type: "Feature",
    properties: Object.assign(
      {
        segmen_id: id,
        luas_m2: area,
        spk_scores: scores,
        spk_actual: {
          slopeDeg: extra && extra.slopeDeg != null ? extra.slopeDeg : 10,
          soilType: "Latosol",
          geologyUnit: "Formasi Semilir",
          rainfallMm: 2500,
          landCover: "Kebun",
        },
        c_kpa: 10,
        cr_kpa: 0,
        phi_deg: 25,
        gamma_sat: 18,
        z_depth: 2,
        rasio_m: 0.6,
        q_kpa: 0,
        fs: extra && extra.fs != null ? extra.fs : 2,
      },
      extra || {}
    ),
  };
}

test("standard weights sum to one and match the published profile", () => {
  assert.equal(Engine.STANDARD_WEIGHTS.slope, 0.3);
  assert.equal(Engine.STANDARD_WEIGHTS.soil, 0.25);
  assert.equal(Engine.STANDARD_WEIGHTS.geology, 0.2);
  assert.equal(Engine.STANDARD_WEIGHTS.rainfall, 0.15);
  assert.equal(Engine.STANDARD_WEIGHTS.landCover, 0.1);
  assert.equal(
    Object.values(Engine.STANDARD_WEIGHTS).reduce((sum, value) => sum + value, 0),
    1
  );
});

test("custom importance normalizes to exactly one", () => {
  const config = Engine.createConfig("custom", {
    slope: 5,
    soil: 4,
    geology: 3,
    rainfall: 3,
    landCover: 2,
  });
  assert.equal(Object.values(config.weights).reduce((sum, value) => sum + value, 0), 1);
  assert.ok(Math.abs(config.weights.slope - 5 / 17) < 1e-12);
  assert.equal(config.calibrated, false);
});

test("invalid importance and weights are rejected", () => {
  assert.throws(
    () =>
      Engine.createConfig("custom", {
        slope: 6,
        soil: 4,
        geology: 3,
        rainfall: 3,
        landCover: 2,
      }),
    /1 sampai 5/
  );
  assert.throws(
    () =>
      Engine.createConfig("custom", {
        slope: 2.5,
        soil: 4,
        geology: 3,
        rainfall: 3,
        landCover: 2,
      }),
    /bilangan bulat/
  );
  assert.throws(
    () =>
      Engine.validateWeights({
        slope: 0.5,
        soil: 0.5,
        geology: 0.5,
        rainfall: 0.5,
        landCover: 0.5,
      }),
    /Total bobot/
  );
});

test("standard WLC reproduces all stored GPKG scores and zone labels", () => {
  const config = Engine.createConfig("standard");
  let tested = 0;
  kerawanan.features.forEach((feature) => {
    const props = feature.properties || {};
    const scores = scoresFromProps(props);
    if (!Object.values(scores).every((value) => Number.isInteger(value) && value >= 1 && value <= 5)) {
      return;
    }
    const result = Engine.calculateWLC(scores, config.weights);
    const rounded = Math.round((result.score + Number.EPSILON) * 100) / 100;
    assert.equal(rounded, Number(props.skor_akhir), "skor mismatch for " + props.fid);
    assert.equal(
      Engine.classifyStandard(rounded).shortLabel.toLowerCase(),
      String(props.status_zona || "").replace(/Zona\s+/i, "").toLowerCase(),
      "zone mismatch for " + props.fid
    );
    tested += 1;
  });
  assert.equal(tested, kerawanan.features.length);
});

test("thresholds preserve 2.20 and 3.40 boundary behaviour", () => {
  assert.equal(Engine.classifyStandard(2.199).code, "hijau");
  assert.equal(Engine.classifyStandard(2.2).code, "kuning");
  assert.equal(Engine.classifyStandard(3.4).code, "kuning");
  assert.equal(Engine.classifyStandard(3.401).code, "merah");
});

test("custom weights produce a different score and never reuse standard zones", () => {
  const scores = { slope: 5, soil: 1, geology: 1, rainfall: 1, landCover: 1 };
  const standard = Engine.calculateWLC(scores, Engine.STANDARD_WEIGHTS);
  const customConfig = Engine.createConfig("custom", {
    slope: 5,
    soil: 1,
    geology: 1,
    rainfall: 1,
    landCover: 1,
  });
  const custom = Engine.calculateWLC(scores, customConfig.weights);
  assert.notEqual(standard.score, custom.score);
  const assessment = Engine.buildAssessment({
    segments: [segment("A", scores, 100)],
    polygonAreaM2: 100,
    config: customConfig,
    createdAt: "2026-11-12T00:00:00Z",
    assessmentId: "TEST-CUSTOM",
  });
  assert.equal(assessment.active.classification, null);
  assert.equal(assessment.active.classificationStatus, "not_calibrated");
  assert.ok(assessment.standard.classification);
});

test("area-weighted aggregation and coverage warnings are explicit", () => {
  const standard = Engine.createConfig("standard");
  const low = { slope: 1, soil: 1, geology: 1, rainfall: 1, landCover: 1 };
  const high = { slope: 5, soil: 5, geology: 5, rainfall: 5, landCover: 5 };
  const assessment = Engine.buildAssessment({
    segments: [segment("A", low, 100), segment("B", high, 100)],
    polygonAreaM2: 800,
    config: standard,
    createdAt: "2026-11-12T00:00:00Z",
    assessmentId: "TEST-AREA",
  });
  assert.equal(assessment.active.score, 3);
  assert.equal(assessment.standard.score, 3);
  assert.equal(assessment.location.coveredAreaM2, 200);
  assert.ok(Math.abs(assessment.location.coverageRatio - 0.25) < 1e-12);
  assert.equal(assessment.dataCompleteness.status, "complete");
  assert.equal(assessment.dataCompleteness.definitiveEligible, false);
  assert.ok(assessment.dataCompleteness.warnings.some((warning) => /Cakupan data/.test(warning)));
});

test("missing criterion data is never replaced and blocks definitive results", () => {
  const config = Engine.createConfig("standard");
  const incomplete = segment(
    "B",
    { slope: 3, soil: null, geology: 4, rainfall: 3, landCover: 1 },
    100
  );
  incomplete.properties.score_completeness = { soil: false };
  incomplete.properties.data_missing = ["soil"];
  const assessment = Engine.buildAssessment({
    segments: [segment("A", { slope: 3, soil: 3, geology: 3, rainfall: 3, landCover: 3 }, 100), incomplete],
    polygonAreaM2: 200,
    config: config,
    createdAt: "2026-11-12T00:00:00Z",
    assessmentId: "TEST-MISSING",
  });
  assert.equal(assessment.dataCompleteness.status, "incomplete");
  assert.deepEqual(assessment.dataCompleteness.missingCriteria, ["soil"]);
  assert.equal(assessment.dataCompleteness.completeSegments, 1);
  assert.equal(assessment.dataCompleteness.definitiveEligible, false);
  assert.equal(assessment.segments[1].standardScore, null);
  assert.equal(assessment.segments[1].activeScore, null);
  assert.equal(assessment.criteria.find((item) => item.key === "soil").dataStatus, "partial");
});

test("FS is independent from WLC and from custom weighting", () => {
  const segments = [
    segment("A", { slope: 5, soil: 1, geology: 1, rainfall: 1, landCover: 1 }, 100, { fs: 0.95 }),
    segment("B", { slope: 5, soil: 5, geology: 5, rainfall: 5, landCover: 5 }, 100, { fs: 2.5 }),
  ];
  const standard = Engine.buildAssessment({
    segments: segments,
    polygonAreaM2: 200,
    config: Engine.createConfig("standard"),
    createdAt: "2026-11-12T00:00:00Z",
    assessmentId: "TEST-FS-STD",
  });
  const custom = Engine.buildAssessment({
    segments: segments,
    polygonAreaM2: 200,
    config: Engine.createConfig("custom", {
      slope: 5,
      soil: 1,
      geology: 1,
      rainfall: 1,
      landCover: 1,
    }),
    createdAt: "2026-11-12T00:00:00Z",
    assessmentId: "TEST-FS-CUSTOM",
  });
  assert.equal(standard.infiniteSlope.min, custom.infiniteSlope.min);
  assert.equal(standard.infiniteSlope.min, 0.95);
  assert.equal(standard.infiniteSlope.includedInWlc, false);
  assert.notEqual(standard.active.score, custom.active.score);
});
