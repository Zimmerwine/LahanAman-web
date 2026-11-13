const test = require("node:test");
const assert = require("node:assert/strict");

const Interpretation = require("../Web/modules/spk-interpretation.js");

function assessment(overrides) {
  return Object.assign(
    {
      assessmentId: "SPK-INTERPRETATION",
      config: { profile: "standard", label: "Profil riset standar", calibrated: true },
      active: { profile: "standard", score: 2.4, label: "Profil riset standar", classification: { label: "Zona Kuning" } },
      location: { areaM2: 1000, coveredAreaM2: 1000, coverageRatio: 1, segmentCount: 2, completeSegmentCount: 2 },
      dataCompleteness: { status: "complete", definitiveEligible: true, missingCriteria: [], incompleteSegments: 0, completeSegments: 2, totalSegments: 2, warnings: [] },
      criteria: [
        { key: "slope", label: "Kemiringan", score: 4, weight: 0.3, weightPercent: 30, contribution: 1.2, dataStatus: "complete", actualSummary: 20, interpretation: "Skor tinggi menambah kontribusi kerawanan." },
        { key: "soil", label: "Tanah", score: 3, weight: 0.25, weightPercent: 25, contribution: 0.75, dataStatus: "complete", actualSummary: "Latosol", interpretation: "Skor sedang." },
        { key: "geology", label: "Batuan", score: 2, weight: 0.2, weightPercent: 20, contribution: 0.4, dataStatus: "complete", actualSummary: "Formasi A", interpretation: "Skor rendah." },
        { key: "rainfall", label: "Curah hujan", score: 2, weight: 0.15, weightPercent: 15, contribution: 0.3, dataStatus: "complete", actualSummary: 1200, interpretation: "Skor rendah." },
        { key: "landCover", label: "Penggunaan lahan", score: 2, weight: 0.1, weightPercent: 10, contribution: 0.2, dataStatus: "complete", actualSummary: "Kebun", interpretation: "Skor rendah." },
      ],
      standard: { score: 2.4, classification: { code: "kuning", label: "Zona Kuning" }, zoneDistribution: { merah: { areaM2: 0, percentOfPolygon: 0 } } },
      infiniteSlope: { min: 1.5, mean: 1.8, max: 2.1, counts: { stabil: 2, kritis: 0, labil: 0 } },
      segments: [
        { segmentId: "SEG-01", fs: 1.5, fsLabel: "STABIL", standardZone: { code: "kuning", label: "Zona Kuning" } },
        { segmentId: "SEG-02", fs: 2.1, fsLabel: "STABIL", standardZone: { code: "kuning", label: "Zona Kuning" } },
      ],
      landUse: { available: true, coverageRatio: 0.99, coveragePercent: 99, uncoveredAreaM2: 10, polygonAreaM2: 1000 },
      recommendations: { preferredForStudy: { id: "contour_adaptive", label: "Menyesuaikan tapak" }, scenarios: [{ id: "contour_adaptive", status: "dapat_dikaji" }] },
    },
    overrides || {}
  );
}

test("insufficient SPK data blocks positive status but retains detected WLC and FS risks", () => {
  const result = Interpretation.build(assessment({
    dataCompleteness: { status: "incomplete", definitiveEligible: false, missingCriteria: ["soil"], incompleteSegments: 1, completeSegments: 1, totalSegments: 2, warnings: [] },
    standard: { score: 3.6, classification: { code: "merah", label: "Zona Merah" }, zoneDistribution: { merah: { areaM2: 400, percentOfPolygon: 40 } } },
    infiniteSlope: { min: 1.0, mean: 1.6, max: 2.1, counts: { stabil: 1, kritis: 0, labil: 1 } },
    segments: [
      { segmentId: "SEG-01", fs: 1.0, fsLabel: "LABIL / LONGSOR", standardZone: { code: "merah", label: "Zona Merah" } },
      { segmentId: "SEG-02", fs: 2.1, fsLabel: "STABIL", standardZone: null },
    ],
    recommendations: { preferredForStudy: null, scenarios: [{ id: "contour_adaptive", status: "belum_dapat_dievaluasi" }] },
  }));

  assert.equal(result.status.code, "belum_dapat_disimpulkan");
  assert.ok(result.reasons.some((reason) => /Zona Merah/.test(reason)));
  assert.ok(result.reasons.some((reason) => /FS|Factor of Safety|faktor keamanan/i.test(reason)));
  assert.ok(result.actions.some((action) => action.id === "complete-data"));
  assert.ok(result.actions.some((action) => action.id === "inspect-wlc-risk"));
  assert.ok(result.actions.some((action) => action.id === "inspect-fs-risk"));
  assert.ok(result.factors.length <= 3);
});

test("custom WLC uses standard classification for status and never classifies its own index", () => {
  const result = Interpretation.build(assessment({
    config: { profile: "custom", label: "Profil kustom", calibrated: false },
    active: { profile: "custom", score: 3.02, label: "Profil kustom", classification: null, classificationStatus: "not_calibrated" },
    standard: { score: 2.1, classification: { code: "hijau", label: "Zona Hijau" }, zoneDistribution: { merah: { areaM2: 0, percentOfPolygon: 0 } } },
    segments: [
      { segmentId: "SEG-01", fs: 1.5, fsLabel: "STABIL", standardZone: { code: "hijau", label: "Zona Hijau" } },
      { segmentId: "SEG-02", fs: 2.1, fsLabel: "STABIL", standardZone: { code: "hijau", label: "Zona Hijau" } },
    ],
  }));

  assert.equal(result.status.code, "dapat_dipertimbangkan");
  assert.equal(result.standardResult.classification, "Zona Hijau");
  assert.equal(result.customResult.classification, null);
  assert.ok(result.limitations.some((item) => /bobot kustom belum terkalibrasi/i.test(item)));
});

test("a standard red-zone result requires further examination when data is sufficient", () => {
  const result = Interpretation.build(assessment({
    standard: { score: 3.6, classification: { code: "merah", label: "Zona Merah" }, zoneDistribution: { merah: { areaM2: 500, percentOfPolygon: 50 } } },
    segments: [
      { segmentId: "SEG-01", fs: 1.5, fsLabel: "STABIL", standardZone: { code: "merah", label: "Zona Merah" } },
      { segmentId: "SEG-02", fs: 2.1, fsLabel: "STABIL", standardZone: { code: "kuning", label: "Zona Kuning" } },
    ],
  }));

  assert.equal(result.status.code, "perlu_pemeriksaan_lanjutan");
  assert.ok(result.actions.some((action) => action.id === "inspect-wlc-risk" && /SEG-01/.test(action.basis)));
});

test("missing FS by any segment prevents a positive conclusion", () => {
  const result = Interpretation.build(assessment({
    segments: [
      { segmentId: "SEG-01", fs: 1.5, fsLabel: "STABIL", standardZone: { code: "kuning", label: "Zona Kuning" } },
      { segmentId: "SEG-02", fs: null, fsLabel: null, standardZone: { code: "kuning", label: "Zona Kuning" } },
    ],
  }));

  assert.notEqual(result.status.code, "dapat_dipertimbangkan");
  assert.ok(result.limitations.some((item) => /FS.*belum tersedia/i.test(item)));
});

test("follow-up actions are ordered, traceable, and never marked completed", () => {
  const result = Interpretation.build(assessment({
    dataCompleteness: { status: "incomplete", definitiveEligible: false, missingCriteria: ["geology", "soil"], incompleteSegments: 1, completeSegments: 1, totalSegments: 2, warnings: [] },
    landUse: null,
    recommendations: { preferredForStudy: null, scenarios: [{ id: "contour_adaptive", status: "belum_dapat_dievaluasi" }, { id: "terraced", status: "belum_dapat_dievaluasi" }] },
  }));

  assert.equal(result.actions[0].id, "complete-data");
  assert.ok(result.actions.some((action) => /jenis dan kondisi tanah/i.test(action.reason)));
  assert.ok(result.actions.some((action) => /batuan|geologi/i.test(action.reason)));
  assert.ok(result.actions.every((action) => action.status === "disarankan"));
  assert.ok(result.alternatives.unprioritizedCount === 2);
});

test("unavailable factors are identified instead of silently omitted", () => {
  const base = assessment();
  base.criteria = [base.criteria[0], base.criteria[2],
    { key: "soil", label: "Tanah", score: null, contribution: null, dataStatus: "missing", actualSummary: null },
  ];
  const result = Interpretation.build(base);
  const missingFactor = result.factors.find((factor) => factor.key === "soil");
  assert.equal(missingFactor.score, null);
  assert.equal(missingFactor.dataStatus, "missing");
  assert.match(missingFactor.explanation, /belum tersedia/i);
});

test("all six unevaluated alternatives receive a shared auditable explanation", () => {
  const result = Interpretation.build(assessment({
    dataCompleteness: { status: "incomplete", definitiveEligible: false, missingCriteria: [], incompleteSegments: 1, completeSegments: 1, totalSegments: 2, warnings: [] },
    recommendations: {
      preferredForStudy: null,
      scenarios: ["contour_adaptive", "terraced", "controlled_cut", "controlled_fill", "cut_and_fill", "no_development"].map((id) => ({
        id,
        status: "belum_dapat_dievaluasi",
        statusLabel: "Belum dapat dievaluasi",
        verification: ["Pemeriksaan geoteknik.", "Validasi RTRW."],
      })),
    },
  }));
  assert.equal(result.alternatives.totalCount, 6);
  assert.equal(result.alternatives.unprioritizedCount, 6);
  assert.equal(result.alternatives.items.length, 6);
  assert.ok(result.alternatives.items.every((item) => item.why && item.neededParameters.length));
  assert.ok(result.alternatives.items.every((item) => item.verification.length === 1));
});

test("an existing yellow WLC zone is not promoted to a positive status", () => {
  const result = Interpretation.build(assessment({
    standard: { score: 2.8, classification: { code: "kuning", label: "Zona Kuning" }, zoneDistribution: { merah: { areaM2: 0, percentOfPolygon: 0 } } },
  }));
  assert.equal(result.status.code, "perlu_pemeriksaan_lanjutan");
});

test("segment completeness stays distinct from low polygon area coverage", () => {
  const result = Interpretation.build(assessment({
    location: { areaM2: 1000, coveredAreaM2: 262, coverageRatio: 0.262, segmentCount: 3, completeSegmentCount: 3 },
    dataCompleteness: { status: "complete", definitiveEligible: false, missingCriteria: [], incompleteSegments: 0, completeSegments: 3, totalSegments: 3, warnings: [] },
  }));

  assert.equal(result.dataCoverage.completeSegments, 3);
  assert.equal(result.dataCoverage.totalSegments, 3);
  assert.ok(Math.abs(result.dataCoverage.coveragePercent - 26.2) < 1e-9);
  assert.equal(result.dataCoverage.uncoveredAreaM2, 738);
  assert.equal(result.status.code, "belum_dapat_disimpulkan");
  assert.ok(result.reasons.some((reason) => /tidak berarti seluruh luas polygon telah tercakup/i.test(reason)));
  assert.ok(result.reasons.some((reason) => /26,2% dari seluruh area/i.test(reason)));
  assert.match(result.summary, /3 dari 3 segmen.*26,2%|26,2%.*3 dari 3 segmen/i);
  assert.ok(result.limitations.some((item) => /738,0 m².*belum tercakup|belum tercakup.*738,0 m²/i.test(item)));
});

test("factor ranking separates contribution leader from highest criterion score", () => {
  const result = Interpretation.build(assessment({
    criteria: [
      { key: "slope", label: "Kemiringan", score: 2.08, weightPercent: 55.56, contribution: 1.156, dataStatus: "complete", actualSummary: 10.168543209876544 },
      { key: "soil", label: "Tanah", score: 4, weightPercent: 11.11, contribution: 0.444, dataStatus: "complete", actualSummary: "Latosol" },
      { key: "geology", label: "Batuan", score: 5, weightPercent: 11.11, contribution: 0.556, dataStatus: "complete", actualSummary: "Formasi A" },
    ],
  }));

  assert.equal(result.factorRanking.contributionLeader.key, "slope");
  assert.equal(result.factorRanking.highestScore.key, "geology");
  assert.equal(result.factorRanking.contributionLeader.actual, 10.168543209876544);
  assert.equal(result.profile.label, "Profil riset standar");
});

test("action presentation order is sequential while priority levels can repeat", () => {
  const result = Interpretation.build(assessment({
    dataCompleteness: { status: "incomplete", definitiveEligible: false, missingCriteria: [], incompleteSegments: 1, completeSegments: 1, totalSegments: 2, warnings: [] },
    landUse: null,
    standard: { score: 3.6, classification: { code: "merah", label: "Zona Merah" }, zoneDistribution: { merah: { areaM2: 10, percentOfPolygon: 50 } } },
    recommendations: { preferredForStudy: null, scenarios: [{ id: "x", status: "belum_dapat_dievaluasi" }] },
  }));

  assert.deepEqual(result.actions.map((action) => action.presentation.order), result.actions.map((_action, index) => index + 1));
  assert.equal(result.actions.filter((action) => action.priority === 1).length, 2);
  assert.ok(result.actions.filter((action) => action.priority === 1).every((action) => action.presentation.priorityLabel === "Prioritas utama"));
});

test("alternative summary distinguishes studyable conservative option from prioritized development", () => {
  const scenarios = ["contour_adaptive", "terraced", "controlled_cut", "controlled_fill", "cut_and_fill"].map((id) => ({ id, status: "belum_dapat_dievaluasi", statusLabel: "Belum dapat dievaluasi" }));
  scenarios.push({ id: "no_development", label: "Tidak membangun / investigasi lanjutan", status: "dapat_dikaji", statusLabel: "Dapat dipertimbangkan untuk kajian" });
  const result = Interpretation.build(assessment({
    dataCompleteness: { status: "incomplete", definitiveEligible: false, missingCriteria: [], incompleteSegments: 1, completeSegments: 1, totalSegments: 2, warnings: [] },
    recommendations: { preferredForStudy: null, scenarios },
  }));

  assert.equal(result.alternatives.statusCounts.belumDapatDievaluasi, 5);
  assert.equal(result.alternatives.statusCounts.dapatDikaji, 1);
  assert.equal(result.alternatives.statusCounts.diprioritaskan, 0);
  assert.match(result.alternatives.reason, /Belum ada alternatif pembangunan yang dapat diprioritaskan/i);
  assert.match(result.alternatives.reason, /langkah konservatif/i);

  const prioritized = Interpretation.build(assessment({
    recommendations: {
      preferredForStudy: { id: "contour_adaptive", label: "Menyesuaikan tapak", note: "Prioritas kajian awal." },
      scenarios: [
        { id: "contour_adaptive", status: "dapat_dikaji", isPreferredForStudy: true },
        { id: "no_development", status: "dapat_dikaji", isPreferredForStudy: false },
      ],
    },
  }));
  assert.equal(prioritized.alternatives.statusCounts.dapatDikaji, 2);
  assert.equal(prioritized.alternatives.statusCounts.diprioritaskan, 1);
  assert.match(prioritized.alternatives.reason, /Prioritas kajian awal/);
});
