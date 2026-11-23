const test = require("node:test");
const assert = require("node:assert/strict");

const Engine = require("../Web/modules/spk-engine.js");
const LandUse = require("../Web/modules/land-use-information.js");
const Store = require("../Web/modules/spk-store.js");
const Interpretation = require("../Web/modules/spk-interpretation.js");
const PdfReport = require("../Web/modules/spk-pdf-report.js");

function sampleContext() {
  const geometry = {
    type: "Polygon",
    coordinates: [
      [
        [110.427, -7.832],
        [110.431, -7.832],
        [110.431, -7.835],
        [110.427, -7.835],
        [110.427, -7.832],
      ],
    ],
  };
  const segments = [
    {
      type: "Feature",
      id: "SEG-01",
      properties: {
        segmen_id: "SEG-01",
        luas_m2: 12000,
        warna_hex: "#ef4444",
        border_hex: "#dc2626",
        spk_scores: { slope: 4, soil: 4, geology: 5, rainfall: 3, landCover: 5 },
        spk_actual: {
          slopeDeg: 14.5,
          soilType: "Latosol",
          geologyUnit: "Formasi Semilir",
          rainfallMm: 2350,
          landCover: "Tegalan/Ladang",
        },
        c_kpa: 10,
        cr_kpa: 0,
        phi_deg: 18,
        gamma_sat: 18.5,
        z_depth: 2.0,
        rasio_m: 0.6,
        q_kpa: 0,
        fs: 1.42,
        fs_label: "STABIL",
      },
      geometry: geometry,
    },
    {
      type: "Feature",
      id: "SEG-02",
      properties: {
        segmen_id: "SEG-02",
        luas_m2: 11814,
        warna_hex: "#f59e0b",
        border_hex: "#d97706",
        spk_scores: { slope: 2, soil: 3, geology: 3, rainfall: 3, landCover: 2 },
        spk_actual: {
          slopeDeg: 5.8,
          soilType: "Regosol",
          geologyUnit: "Formasi Sentolo",
          rainfallMm: 2350,
          landCover: "Kebun",
        },
        c_kpa: 8,
        cr_kpa: 3.5,
        phi_deg: 28,
        gamma_sat: 18.0,
        z_depth: 2.0,
        rasio_m: 0.6,
        q_kpa: 0,
        fs: 2.35,
        fs_label: "STABIL",
      },
      geometry: geometry,
    },
  ];
  const landUse = {
    available: true,
    status: "evaluated",
    polygonAreaM2: 90833.2,
    coveredAreaM2: 90455.2,
    uncoveredAreaM2: 378.0,
    coverageRatio: 0.9958,
    overlapAreaM2: 0,
    classes: [
      {
        className: "Tegalan/Ladang",
        group: "pertanian",
        groupLabel: "Pertanian dan perkebunan",
        featureCount: 3,
        areaM2: 52500.0,
        percentOfPolygon: 57.8,
      },
      {
        className: "Kebun",
        group: "pertanian",
        groupLabel: "Pertanian dan perkebunan",
        featureCount: 4,
        areaM2: 22800.0,
        percentOfPolygon: 25.1,
      },
      {
        className: "Permukiman",
        group: "terbangun",
        groupLabel: "Permukiman dan infrastruktur",
        featureCount: 2,
        areaM2: 15155.2,
        percentOfPolygon: 16.7,
      },
    ],
    features: [
      {
        landUseId: "LU-0001",
        className: "Tegalan/Ladang",
        group: "pertanian",
        areaM2: 52500.0,
        percentOfPolygon: 57.8,
        sourceProperties: { warna_hex: "#D32F2F" },
        geometry: geometry,
      },
      {
        landUseId: "LU-0002",
        className: "Kebun",
        group: "pertanian",
        areaM2: 22800.0,
        percentOfPolygon: 25.1,
        sourceProperties: { warna_hex: "#66BB6A" },
        geometry: geometry,
      },
    ],
    warnings: [],
  };
  return { geometry: geometry, segments: segments, polygonAreaM2: 90833.2, landUse: landUse };
}

test("land-use classes inherit distinct feature colors and enrich SPK landCover criterion", () => {
  const ctx = sampleContext();
  const normalizedLu = LandUse.normalize(ctx.landUse);
  const tegalan = normalizedLu.classes.find((c) => c.className === "Tegalan/Ladang");
  const kebun = normalizedLu.classes.find((c) => c.className === "Kebun");
  const permukiman = normalizedLu.classes.find((c) => c.className === "Permukiman");
  assert.equal(tegalan.color, "#D32F2F");
  assert.equal(kebun.color, "#66BB6A");
  assert.equal(permukiman.color, "#FFB300");

  const assessment = Engine.buildAssessment({
    segments: ctx.segments,
    geometry: ctx.geometry,
    polygonAreaM2: ctx.polygonAreaM2,
    config: Engine.createConfig("standard"),
    landUse: ctx.landUse,
  });
  const landCriterion = assessment.criteria.find((c) => c.key === "landCover");
  assert.ok(landCriterion);
  assert.match(landCriterion.actualSummary, /Tegalan\/Ladang/);
  assert.match(landCriterion.actualSummary, /Kebun/);
  assert.match(landCriterion.actualSummary, /Permukiman/);
  assert.equal(landCriterion.actualValues.length, 3);
});

test("generatePdfBytes produces valid multi-section PDF with tables and embedded kavling map", () => {
  const ctx = sampleContext();
  const assessment = Engine.buildAssessment({
    segments: ctx.segments,
    geometry: ctx.geometry,
    polygonAreaM2: ctx.polygonAreaM2,
    config: Engine.createConfig("standard"),
    landUse: ctx.landUse,
    assessmentId: "SPK-TEST-PDF-01",
  });
  assessment.interpretation = Interpretation.build(assessment);
  const record = Store.createReviewRecord(assessment, {
    reviewer: "Ir. Budi Santoso",
    decidedAt: "2026-11-23",
    status: "accepted_with_conditions",
    rationale: "Perlu perkuatan drainase dan verifikasi lapangan pada segmen lereng.",
    notes: "Cek sempadan dan daya dukung tanah.",
  });

  // Mock JPEG bytes for headless node test
  const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
  const pdfBytes = PdfReport.generatePdfBytes({
    assessment: assessment,
    record: record,
    context: ctx,
    mapImage: { bytes: fakeJpeg, width: 1200, height: 560 },
  });

  assert.ok(pdfBytes instanceof Uint8Array);
  assert.ok(pdfBytes.length > 2500);

  const pdfText = Buffer.from(pdfBytes).toString("latin1");
  assert.ok(pdfText.startsWith("%PDF-1.4"));
  assert.ok(pdfText.trimEnd().endsWith("%%EOF"));
  assert.match(pdfText, /\/Subtype \/Image/);
  assert.match(pdfText, /\/ImKavling Do/);
  assert.match(pdfText, /LAPORAN ANALISIS SISTEM PENDUKUNG KEPUTUSAN \\\(SPK\\\)/);
  assert.match(pdfText, /SPK-TEST-PDF-01/);
  assert.match(pdfText, /SEG-01/);
  assert.match(pdfText, /SEG-02/);
  assert.match(pdfText, /Tegalan\/Ladang/);
  assert.match(pdfText, /Kebun/);
  assert.match(pdfText, /Permukiman/);
  assert.match(pdfText, /Ir\. Budi Santoso/);
});

test("downloadPdfReport uses showSaveFilePicker when available so user can choose save location", async () => {
  const ctx = sampleContext();
  const assessment = Engine.buildAssessment({
    segments: ctx.segments,
    geometry: ctx.geometry,
    polygonAreaM2: ctx.polygonAreaM2,
    config: Engine.createConfig("standard"),
    landUse: ctx.landUse,
    assessmentId: "SPK-PICKER-01",
  });

  let pickerOptions = null;
  let writtenBlob = null;
  let closed = false;

  const prevWindow = global.window;
  global.window = {
    showSaveFilePicker: async function (opts) {
      pickerOptions = opts;
      return {
        name: "Laporan_Kustom_User.pdf",
        createWritable: async function () {
          return {
            write: async function (blob) {
              writtenBlob = blob;
            },
            close: async function () {
              closed = true;
            },
          };
        },
      };
    },
  };

  try {
    const result = await PdfReport.downloadPdfReport({
      assessment: assessment,
      context: ctx,
    });
    assert.equal(result.ok, true);
    assert.equal(result.method, "file-picker");
    assert.equal(result.filename, "Laporan_Kustom_User.pdf");
    assert.ok(pickerOptions);
    assert.match(pickerOptions.suggestedName, /\.pdf$/);
    assert.ok(writtenBlob);
    assert.equal(writtenBlob.type, "application/pdf");
    assert.equal(closed, true);
  } finally {
    global.window = prevWindow;
  }
});
