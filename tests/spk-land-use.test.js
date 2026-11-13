const test = require("node:test");
const assert = require("node:assert/strict");

const LandUse = require("../Web/modules/land-use-information.js");
const SensitiveAreas = require("../Web/modules/sensitive-areas.js");
const Store = require("../Web/modules/spk-store.js");

function landUseReport() {
  return {
    status: "evaluated",
    available: true,
    dataset: {
      localFile: "public/data/clean_tutupan_lahan_diy.geojson",
      verificationStatus: "source_metadata_incomplete",
      legalDesignationVerified: false,
    },
    polygonAreaM2: 10000,
    coveredAreaM2: 9500,
    uncoveredAreaM2: 500,
    overlapAreaM2: 0,
    coverageRatio: 0.95,
    classes: [
      {
        className: "Tegalan/Ladang",
        group: "pertanian",
        groupLabel: "Pertanian dan perkebunan",
        featureCount: 2,
        areaM2: 6000,
        percentOfPolygon: 60,
      },
      {
        className: "Permukiman",
        group: "terbangun",
        groupLabel: "Permukiman dan infrastruktur",
        featureCount: 1,
        areaM2: 3500,
        percentOfPolygon: 35,
      },
    ],
    features: [
      {
        landUseId: "LU-0001",
        className: "Tegalan/Ladang",
        group: "pertanian",
        areaM2: 6000,
        percentOfPolygon: 60,
        sourceProperties: { warna_hex: "#EF4444" },
        geometry: { type: "Polygon", coordinates: [] },
      },
    ],
    warnings: [],
    note: "Sebaran guna lahan dihitung dari irisan poligon sumber.",
  };
}

function sensitiveReport() {
  return {
    available: true,
    dataset: { legalDesignationVerified: false },
    items: [
      {
        id: "cultural_candi_prambanan",
        label: "Objek budaya Candi Prambanan",
        category: "cultural_object",
        categoryLabel: "Objek budaya",
        severity: "high",
        status: "indication_detected",
        detected: true,
        binding: false,
        authoritative: false,
        legalDesignationVerified: false,
        geometryAvailable: true,
        sourceClass: "Candi Prambanan",
        featureCount: 1,
        areaM2: 2000,
        percentOfPolygon: 20,
        message: "Zona perlindungan resmi belum tersedia.",
        verification: "Batas/status resmi belum tersedia.",
      },
    ],
    features: [
      {
        sensitivityId: "cultural_candi_prambanan",
        label: "Objek budaya Candi Prambanan",
        category: "cultural_object",
        severity: "high",
        sourceClass: "Candi Prambanan",
        landUseId: "LU-0001",
        areaM2: 2000,
        percentOfPolygon: 20,
        geometry: { type: "Polygon", coordinates: [] },
      },
    ],
    summary: {
      status: "indication_detected",
      detected: true,
      itemCount: 1,
      featureCount: 1,
      categories: ["Objek budaya"],
      totalClassAreaM2: 2000,
      uniqueAreaM2: 2000,
      percentOfPolygon: 20,
      legalDesignationVerified: false,
      officialBoundaryAvailable: false,
      note: "",
    },
  };
}

test("land-use normalization preserves source classes and reports coverage", () => {
  const result = LandUse.normalize(landUseReport());
  assert.equal(result.available, true);
  assert.equal(result.status, "evaluated");
  assert.equal(result.classes.length, 2);
  assert.equal(result.classes[0].className, "Tegalan/Ladang");
  assert.equal(result.classes[0].groupLabel, "Pertanian dan perkebunan");
  assert.equal(result.coveragePercent, 95);
  assert.match(result.summaryText, /2 kelas guna lahan/);
  assert.match(result.summaryText, /95,0%/);
  assert.equal(result.features[0].color, "#EF4444");
  assert.equal(result.legalDesignationVerified, false);
  assert.deepEqual(result.warnings, []);
});

test("land-use normalization flags low coverage without declaring uncovered area safe", () => {
  const report = landUseReport();
  report.coverageRatio = 0.5;
  report.coveragePercent = 50;
  const result = LandUse.normalize(report);
  assert.equal(result.coveragePercent, 50);
  assert.ok(result.warnings.some((warning) => /tidak tercakup/.test(warning)));
  assert.doesNotMatch(result.summaryText, /aman/i);
});

test("missing land-use dataset remains not evaluated", () => {
  const result = LandUse.normalize({ available: false, status: "not_evaluated" });
  assert.equal(result.available, false);
  assert.equal(result.status, "not_evaluated");
  assert.match(result.summaryText, /belum dievaluasi/i);
  assert.doesNotMatch(result.summaryText, /tidak ada penggunaan lahan/i);
});

test("sensitive normalization keeps detected objects non-binding and non-authoritative", () => {
  const result = SensitiveAreas.normalize(sensitiveReport());
  assert.equal(result.available, true);
  assert.equal(result.summary.status, "indication_detected");
  assert.equal(result.items.length, 1);
  const item = result.items[0];
  assert.equal(item.status, "indication_detected");
  assert.equal(item.statusLabel, "Indikasi terdeteksi");
  assert.equal(item.binding, false);
  assert.equal(item.authoritative, false);
  assert.equal(item.legalDesignationVerified, false);
  assert.equal(item.sourceClass, "Candi Prambanan");
  assert.match(result.summaryText, /belum diverifikasi/);
  assert.match(result.verificationText, /bukan status hukum/i);
});

test("no sensitive detection is not verification that the site is free", () => {
  const result = SensitiveAreas.normalize({
    available: true,
    summary: {
      status: "not_detected",
      itemCount: 0,
      featureCount: 0,
      officialBoundaryAvailable: false,
      legalDesignationVerified: false,
    },
    items: [],
    features: [],
  });
  assert.equal(result.summary.status, "not_detected");
  assert.equal(result.summary.statusLabel, "Tidak terdeteksi pada data tersedia");
  assert.match(result.summaryText, /bukan verifikasi/i);
  assert.doesNotMatch(result.summaryText, /aman/i);
});

test("unavailable sensitive dataset is not evaluated", () => {
  const result = SensitiveAreas.normalize({ available: false });
  assert.equal(result.summary.status, "not_evaluated");
  assert.equal(result.summary.statusLabel, "Belum dievaluasi");
  assert.match(result.summaryText, /bukan bukti/i);
});

test("review export preserves land-use and sensitive summaries without feature geometry", () => {
  const assessment = {
    assessmentId: "SPK-EXPORT-1",
    location: { areaM2: 10000, coveredAreaM2: 9500, coverageRatio: 0.95, segmentCount: 2 },
    active: { profile: "standard", label: "Profil riset standar", score: 3.2 },
    standard: { score: 3.2 },
    constraints: { summary: { hasUnknownBindingConstraints: true } },
    recommendations: { summary: { title: "Perlu kajian" } },
    landUse: landUseReport(),
    sensitiveAreas: sensitiveReport(),
  };
  const record = Store.createReviewRecord(assessment, {
    status: "needs_more_review",
    reviewer: "Reviewer Uji",
    rationale: "Perlu verifikasi.",
  });
  assert.equal(record.landUseSummary.available, true);
  assert.equal(record.landUseSummary.classes[0].className, "Tegalan/Ladang");
  assert.equal(record.sensitiveAreaSummary.summary.status, "indication_detected");
  assert.equal(record.sensitiveAreaSummary.items[0].legalDesignationVerified, false);
  assert.equal(record.assessment.landUse.features[0].geometry, undefined);
  assert.equal(record.assessment.sensitiveAreas.features[0].geometry, undefined);
  assert.equal(record.assessment.landUse.classes.length, 2);
});
