(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.LahanAmanSPKConstraints = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MISSING_LEGAL_NOTE =
    "Data resmi belum tersedia untuk diperiksa. Tidak adanya data dalam sistem bukan berarti lokasi bebas dari pembatasan. Status belum dievaluasi bukan berarti tidak ada batasan. Verifikasi tetap diperlukan melalui instansi yang berwenang.";

  const WATER_PATTERN = /(sungai|danau|waduk|embung|badan air|perairan|tambak|rawa)/i;

  function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function percent(value, total) {
    const denominator = Number(total);
    if (!Number.isFinite(denominator) || denominator <= 0) return null;
    return (Number(value) / denominator) * 100;
  }

  function makeNotAvailable(id, label, description) {
    return {
      id: id,
      label: label,
      category: "legal",
      status: "not_evaluated",
      detected: null,
      binding: true,
      authoritative: true,
      severity: "unknown",
      message: MISSING_LEGAL_NOTE,
      detail: description,
      evidence: [],
      areaM2: null,
      percentOfPolygon: null,
      dataset: null,
      verification: "Perlu validasi instansi berwenang.",
    };
  }

  function summarizeSegments(segments, predicate) {
    const selected = segments.filter(predicate);
    return {
      areaM2: selected.reduce(function (total, segment) {
        return total + numberOrZero(segment.areaM2);
      }, 0),
      segments: selected.map(function (segment) {
        return segment.segmentId;
      }),
    };
  }

  function evaluateConstraints(assessment) {
    if (!assessment || !Array.isArray(assessment.segments)) {
      throw new TypeError("Constraint engine membutuhkan assessment dengan daftar segmen.");
    }
    const segments = assessment.segments;
    const polygonArea = numberOrZero(
      assessment.location && assessment.location.areaM2
    );
    const items = [
      makeNotAvailable(
        "rtrw",
        "RTRW / RDTR",
        "Zonasi pemanfaatan ruang resmi belum tersedia di aplikasi."
      ),
      makeNotAvailable(
        "protected_area",
        "Kawasan lindung",
        "Batas kawasan lindung resmi belum tersedia di aplikasi."
      ),
      makeNotAvailable(
        "river_buffer",
        "Sempadan sungai / badan air",
        "Garis sempadan resmi dan lebar buffer belum tersedia; badan air yang terdeteksi bukan penetapan sempadan."
      ),
      makeNotAvailable(
        "official_landslide_zone",
        "Zona rawan longsor resmi",
        "Layer kerawanan aplikasi adalah model spasial, bukan penetapan zona resmi."
      ),
    ];

    const zoneDistribution = assessment.standard && assessment.standard.zoneDistribution;
    if (zoneDistribution) {
      const redArea = numberOrZero(zoneDistribution.merah && zoneDistribution.merah.areaM2);
      const yellowArea = numberOrZero(zoneDistribution.kuning && zoneDistribution.kuning.areaM2);
      const greenArea = numberOrZero(zoneDistribution.hijau && zoneDistribution.hijau.areaM2);
      const redPercent = zoneDistribution.merah ? zoneDistribution.merah.percentOfPolygon : null;
      const detected = redArea > 0 || yellowArea > 0;
      let severity = "low";
      if (redArea > 0 && (redPercent == null || redPercent >= 20)) severity = "high";
      else if (redArea > 0) severity = "medium";
      else if (yellowArea > 0) severity = "medium";
      items.push({
        id: "modeled_susceptibility",
        label: "Kerawanan longsor (model)",
        category: "model",
        status: detected ? "indication_detected" : "not_detected",
        detected: detected,
        binding: false,
        authoritative: false,
        severity: severity,
        message:
          "Model kerawanan longsor menunjukkan sebaran kelas pada poligon. Hasil ini informatif dan tidak menggantikan penetapan zona resmi.",
        detail:
          "Hijau " +
          (zoneDistribution.hijau ? zoneDistribution.hijau.areaM2 : 0) +
          " m2, Kuning " +
          (zoneDistribution.kuning ? zoneDistribution.kuning.areaM2 : 0) +
          " m2, Merah " +
          (zoneDistribution.merah ? zoneDistribution.merah.areaM2 : 0) +
          " m2.",
        evidence: [
          { label: "Luas zona hijau", valueM2: greenArea },
          { label: "Luas zona kuning", valueM2: yellowArea },
          { label: "Luas zona merah", valueM2: redArea },
        ],
        areaM2: redArea + yellowArea + greenArea,
        percentOfPolygon:
          polygonArea > 0 ? percent(redArea + yellowArea + greenArea, polygonArea) : null,
        dataset: "public/data/clean_kerawanan_longsor.geojson",
        verification: "Validasi lapangan dan kajian geoteknik tetap diperlukan.",
      });
    }

    const water = summarizeSegments(segments, function (segment) {
      return segment.actual && WATER_PATTERN.test(String(segment.actual.landCover || ""));
    });
    items.push({
      id: "water_body",
      label: "Tubuh air terdeteksi",
      category: "environment",
      status: water.areaM2 > 0 ? "indication_detected" : "not_detected",
      detected: water.areaM2 > 0,
      binding: false,
      authoritative: false,
      severity: water.areaM2 > 0 ? "medium" : "low",
      message:
        water.areaM2 > 0
          ? "Tutupan lahan pada sebagian segmen terindikasi badan air. Sempadan resmi belum dievaluasi."
          : "Tidak ada kelas tutupan air yang terdeteksi pada segmen; ini bukan verifikasi sempadan.",
      detail:
        water.areaM2 > 0
          ? "Terindikasi pada " + water.segments.join(", ") + "."
          : "Tidak terindikasi dari atribut tutupan lahan segmen.",
      evidence: water.areaM2 > 0 ? [{ label: "Luas terindikasi", valueM2: water.areaM2 }] : [],
      areaM2: water.areaM2,
      percentOfPolygon: polygonArea > 0 ? percent(water.areaM2, polygonArea) : null,
      dataset: "public/data/clean_kerawanan_longsor.geojson",
      verification: "Perlu delineasi badan air dan sempadan oleh instansi berwenang.",
    });

    const steep = summarizeSegments(segments, function (segment) {
      const slope = segment.actual ? Number(segment.actual.slopeDeg) : NaN;
      return Number.isFinite(slope) && slope > 25;
    });
    items.push({
      id: "steep_terrain",
      label: "Kendala terrain > 25 derajat",
      category: "engineering",
      status: steep.areaM2 > 0 ? "indication_detected" : "not_detected",
      detected: steep.areaM2 > 0,
      binding: false,
      authoritative: false,
      severity: steep.areaM2 > 0 ? "high" : "low",
      message:
        steep.areaM2 > 0
          ? "Sebagian segmen memiliki kemiringan di atas 25 derajat; perlu kajian stabilitas lereng."
          : "Tidak ada segmen dengan kemiringan di atas 25 derajat.",
      detail:
        steep.areaM2 > 0
          ? "Segmen: " + steep.segments.join(", ") + "."
          : "Berdasarkan rerata kemiringan per segmen.",
      evidence: steep.areaM2 > 0 ? [{ label: "Luas terrain curam", valueM2: steep.areaM2 }] : [],
      areaM2: steep.areaM2,
      percentOfPolygon: polygonArea > 0 ? percent(steep.areaM2, polygonArea) : null,
      dataset: "public/data/clean_kerawanan_longsor.geojson",
      verification: "Perlu survei topografi dan analisis stabilitas lereng.",
    });

    const hasBindingRestriction = items.some(function (item) {
      return item.binding && (item.status === "restricted_verified" || item.status === "restricted");
    });
    const hasUnknownBindingConstraints = items.some(function (item) {
      return item.binding && item.status === "not_evaluated";
    });

    return {
      items: items,
      summary: {
        evaluated: items.filter(function (item) {
          return item.status === "indication_detected" || item.status === "not_detected";
        }).length,
        restrictedVerified: items.filter(function (item) {
          return item.status === "restricted_verified" || item.status === "restricted";
        }).length,
        indicationDetected: items.filter(function (item) {
          return item.status === "indication_detected";
        }).length,
        notDetected: items.filter(function (item) { return item.status === "not_detected"; }).length,
        notAvailable: items.filter(function (item) { return item.status === "not_evaluated"; }).length,
        notEvaluated: items.filter(function (item) { return item.status === "not_evaluated"; }).length,
        detected: items.filter(function (item) { return item.detected === true; }).length,
        hasBindingRestriction: hasBindingRestriction,
        hasUnknownBindingConstraints: hasUnknownBindingConstraints,
        canConcludeLegalFeasibility: false,
        note:
          MISSING_LEGAL_NOTE +
          " Tidak ada dataset pembatas legal yang dapat diverifikasi. Hasil WLC yang baik tidak boleh dianggap sebagai izin atau bukti tidak adanya batasan.",
      },
    };
  }

  return {
    MISSING_LEGAL_NOTE: MISSING_LEGAL_NOTE,
    evaluateConstraints: evaluateConstraints,
    STATUS_LABELS: Object.freeze({
      restricted_verified: "RESTRICTED / VERIFIED",
      restricted: "RESTRICTED / VERIFIED",
      indication_detected: "INDICATION DETECTED",
      not_detected: "NOT DETECTED IN AVAILABLE DATA",
      not_evaluated: "NOT EVALUATED",
      evaluated: "INDICATION DETECTED",
    }),
  };
});
