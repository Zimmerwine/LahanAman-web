(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.LahanAmanSensitiveAreas = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STATUS_LABELS = Object.freeze({
    indication_detected: "Indikasi terdeteksi",
    not_detected: "Tidak terdeteksi pada data tersedia",
    not_evaluated: "Belum dievaluasi",
  });

  const STATUS_TONES = Object.freeze({
    indication_detected: "caution",
    not_detected: "unknown",
    not_evaluated: "unknown",
  });

  const CATEGORY_COLORS = Object.freeze({
    forest_cover: "#166534",
    cultural_object: "#A21CAF",
    cultural_land_use: "#7E22CE",
    water_body: "#0369A1",
  });

  function numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function formatPercent(value) {
    const number = numberOrNull(value);
    if (number == null) return "-";
    return number.toLocaleString("id-ID", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }) + "%";
  }

  function formatArea(value) {
    const number = numberOrNull(value);
    if (number == null) return "-";
    return number.toLocaleString("id-ID", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }) + " m²";
  }

  function normalizeItem(item) {
    const category = item.category || "other";
    return {
      id: item.id || "sensitive-unknown",
      label: String(item.label || "Objek/kawasan"),
      category: category,
      categoryLabel: item.categoryLabel || "Objek/kawasan",
      severity: item.severity || "low",
      status: "indication_detected",
      statusLabel: STATUS_LABELS.indication_detected,
      tone: STATUS_TONES.indication_detected,
      detected: true,
      binding: false,
      authoritative: false,
      legalDesignationVerified: false,
      geometryAvailable: Boolean(item.geometryAvailable),
      sourceClass: item.sourceClass || null,
      featureCount: numberOrNull(item.featureCount) || 0,
      areaM2: numberOrNull(item.areaM2),
      percentOfPolygon: numberOrNull(item.percentOfPolygon),
      message: item.message || "",
      dataset: item.dataset || null,
      verification: item.verification || "Batas/status resmi belum tersedia.",
      color: CATEGORY_COLORS[category] || "#475569",
    };
  }

  function normalizeFeature(feature) {
    const category = feature.category || "other";
    return {
      sensitivityId: feature.sensitivityId || "sensitive-unknown",
      label: feature.label || "Objek/kawasan",
      category: category,
      severity: feature.severity || "low",
      sourceClass: feature.sourceClass || null,
      landUseId: feature.landUseId || null,
      areaM2: numberOrNull(feature.areaM2),
      percentOfPolygon: numberOrNull(feature.percentOfPolygon),
      color: CATEGORY_COLORS[category] || "#475569",
      geometry: feature.geometry || null,
    };
  }

  function normalizeSummary(summary, items, available) {
    const source = summary && typeof summary === "object" ? summary : {};
    let status = "not_evaluated";
    if (available) {
      if (source.status === "not_evaluated") status = "not_evaluated";
      else if (source.status === "indication_detected" || items.length) status = "indication_detected";
      else status = "not_detected";
    }
    return {
      status: status,
      statusLabel: STATUS_LABELS[status],
      tone: STATUS_TONES[status],
      detected: Boolean(items.length),
      itemCount: items.length,
      featureCount: numberOrNull(source.featureCount) || 0,
      categories: Array.isArray(source.categories) ? source.categories.slice() : [],
      totalClassAreaM2: numberOrNull(source.totalClassAreaM2),
      uniqueAreaM2: numberOrNull(source.uniqueAreaM2),
      percentOfPolygon: numberOrNull(source.percentOfPolygon),
      legalDesignationVerified: false,
      officialBoundaryAvailable: false,
      note: source.note || "",
    };
  }

  function summarize(report, summary, items) {
    if (!report.available || summary.status === "not_evaluated") {
      return "Objek dan kawasan sensitif belum dapat dievaluasi karena data guna lahan tidak tersedia. Ini bukan bukti bahwa lokasi bebas objek atau kawasan sensitif.";
    }
    if (!items.length) {
      return "Tidak ada kelas sensitif yang teridentifikasi pada data guna lahan yang tersedia. Ini bukan verifikasi bahwa lokasi bebas objek atau kawasan sensitif.";
    }
    const labels = items.slice(0, 3).map(function (item) {
      return item.label;
    });
    return (
      items.length +
      " kelas sensitif terindikasi pada data guna lahan" +
      (summary.percentOfPolygon != null
        ? " (sekitar " + formatPercent(summary.percentOfPolygon) + " area analisis)"
        : "") +
      ": " +
      labels.join(", ") +
      ". Status dan batas resmi belum diverifikasi."
    );
  }

  function normalize(report) {
    const source = report && typeof report === "object" ? report : {};
    const available = Boolean(source.available);
    const items = (Array.isArray(source.items) ? source.items : []).map(normalizeItem);
    const features = (Array.isArray(source.features) ? source.features : []).map(normalizeFeature);
    const summary = normalizeSummary(source.summary, items, available);
    const normalized = {
      available: available,
      dataset: source.dataset || null,
      items: items,
      features: features,
      summary: summary,
      summaryText: "",
      verificationText:
        "Objek/kawasan pada bagian ini adalah indikasi dari kelas guna lahan dan bukan status hukum. Batas resmi dan zona perlindungan belum diverifikasi.",
    };
    normalized.summaryText = summarize(normalized, summary, items);
    return normalized;
  }

  function styleForFeature(feature, opacity) {
    return {
      color: feature && feature.color ? feature.color : "#475569",
      weight: 2.2,
      opacity: 0.95,
      dashArray: "5 4",
      fillColor: feature && feature.color ? feature.color : "#475569",
      fillOpacity: opacity == null ? 0.18 : opacity,
    };
  }

  return {
    STATUS_LABELS: STATUS_LABELS,
    CATEGORY_COLORS: CATEGORY_COLORS,
    normalize: normalize,
    styleForFeature: styleForFeature,
    formatArea: formatArea,
    formatPercent: formatPercent,
  };
});
