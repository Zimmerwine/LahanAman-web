(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.LahanAmanLandUse = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STATUS_LABELS = Object.freeze({
    evaluated: "Tersedia",
    not_evaluated: "Belum dievaluasi",
  });

  const GROUP_COLORS = Object.freeze({
    hutan: "#2E7D32",
    pertanian: "#EF4444",
    terbangun: "#D97706",
    badan_air: "#0284C7",
    lainnya: "#7C3AED",
  });

  const CLASS_COLORS = Object.freeze({
    "Hutan Lindung": "#1B5E20",
    "Hutan Konservasi": "#1B5E20",
    "Hutan Produksi": "#2E7D32",
    "Kebun": "#66BB6A",
    "Permukiman": "#FFB300",
    "Sawah Irigasi": "#FB8C00",
    "Semak/Belukar": "#FB8C00",
    "Tegalan/Ladang": "#D32F2F",
    "Sawah Tadah Hujan": "#D32F2F",
    "Sungai": "#0284C7",
    "Danau/Waduk": "#0369A1",
    "Makam": "#8D6E63",
    "Candi Prambanan": "#7C3AED",
  });

  const GROUP_FALLBACK_LABELS = Object.freeze({
    hutan: "Tutupan hutan",
    pertanian: "Pertanian dan perkebunan",
    terbangun: "Permukiman dan infrastruktur",
    badan_air: "Badan air",
    lainnya: "Kelas lain",
  });

  function numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function percent(value) {
    const number = numberOrNull(value);
    return number == null ? null : number;
  }

  function formatPercent(value) {
    const number = percent(value);
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

  function sourceHexForFeature(feature) {
    const props = (feature && feature.sourceProperties) || {};
    const candidate = String(props.warna_hex || "").trim();
    return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : null;
  }

  function classColor(className, group, sourceHex) {
    if (sourceHex && /^#[0-9a-f]{6}$/i.test(String(sourceHex).trim())) {
      return String(sourceHex).trim();
    }
    if (className && CLASS_COLORS[className]) {
      return CLASS_COLORS[className];
    }
    return GROUP_COLORS[group] || GROUP_COLORS.lainnya;
  }

  function normalizeClass(item, featureColorByClass) {
    const group = item.group || "lainnya";
    const className = String(item.className || "Tidak diketahui");
    const fallbackFeatureHex =
      featureColorByClass && featureColorByClass[className]
        ? featureColorByClass[className]
        : null;
    return {
      className: className,
      group: group,
      groupLabel: item.groupLabel || GROUP_FALLBACK_LABELS[group] || "Kelas lain",
      featureCount: numberOrNull(item.featureCount) || 0,
      areaM2: numberOrNull(item.areaM2),
      percentOfPolygon: percent(item.percentOfPolygon),
      color: classColor(className, group, item.color || fallbackFeatureHex),
    };
  }

  function normalizeFeature(feature, index) {
    const group = feature.group || "lainnya";
    return {
      landUseId: feature.landUseId || "LU-" + String(index + 1).padStart(4, "0"),
      className: String(feature.className || "Tidak diketahui"),
      group: group,
      groupLabel: feature.groupLabel || GROUP_FALLBACK_LABELS[group] || "Kelas lain",
      areaM2: numberOrNull(feature.areaM2),
      percentOfPolygon: percent(feature.percentOfPolygon),
      sourceProperties: feature.sourceProperties || {},
      color: classColor(feature.className, group, sourceHexForFeature(feature)),
      geometry: feature.geometry || null,
    };
  }

  function summarize(report, classes) {
    if (!report || !report.available) {
      return "Data guna lahan tidak tersedia; penggunaan lahan di area ini belum dievaluasi.";
    }
    if (!classes.length) {
      return "Tidak ada kelas guna lahan yang beririsan pada dataset tersedia. Ini bukan bukti bahwa area tidak memiliki penggunaan lahan.";
    }
    const coverage = formatPercent(report.coveragePercent);
    const top = classes.slice(0, 2).map(function (item) {
      return item.className + " " + formatPercent(item.percentOfPolygon);
    });
    return (
      classes.length +
      " kelas guna lahan terdeteksi pada " +
      coverage +
      " area analisis. Kelas terluas: " +
      top.join(", ") +
      "."
    );
  }

  function normalize(report) {
    const source = report && typeof report === "object" ? report : {};
    const rawClasses = Array.isArray(source.classes) ? source.classes : [];
    const rawFeatures = Array.isArray(source.features) ? source.features : [];
    const features = rawFeatures.map(normalizeFeature);
    const featureColorByClass = {};
    features.forEach(function (feat) {
      if (feat.className && feat.color && !featureColorByClass[feat.className]) {
        featureColorByClass[feat.className] = feat.color;
      }
    });
    const classes = rawClasses.map(function (item) {
      return normalizeClass(item, featureColorByClass);
    });
    const available = Boolean(source.available);
    const coverageRatio = numberOrNull(source.coverageRatio);
    const normalized = {
      available: available,
      status: available ? "evaluated" : "not_evaluated",
      statusLabel: STATUS_LABELS[available ? "evaluated" : "not_evaluated"],
      dataset: source.dataset || null,
      polygonAreaM2: numberOrNull(source.polygonAreaM2),
      coveredAreaM2: numberOrNull(source.coveredAreaM2),
      uncoveredAreaM2: numberOrNull(source.uncoveredAreaM2),
      overlapAreaM2: numberOrNull(source.overlapAreaM2),
      coverageRatio: coverageRatio,
      coveragePercent: coverageRatio == null ? null : coverageRatio * 100,
      classes: classes,
      features: features,
      warnings: Array.isArray(source.warnings) ? source.warnings.slice() : [],
      note: source.note || "",
      legalDesignationVerified: false,
      summaryText: "",
    };
    normalized.summaryText = summarize(normalized, classes);
    if (coverageRatio != null && coverageRatio < 0.8) {
      normalized.warnings.push(
        "Cakupan guna lahan " +
          formatPercent(normalized.coveragePercent) +
          " dari area analisis. Area yang tidak tercakup tidak boleh dianggap tanpa penggunaan lahan."
      );
    }
    return normalized;
  }

  function styleForFeature(feature, opacity) {
    return {
      color: "#1e293b",
      weight: 0.8,
      opacity: 0.75,
      fillColor: feature && feature.color ? feature.color : GROUP_COLORS.lainnya,
      fillOpacity: opacity == null ? 0.35 : opacity,
    };
  }

  return {
    STATUS_LABELS: STATUS_LABELS,
    GROUP_COLORS: GROUP_COLORS,
    normalize: normalize,
    styleForFeature: styleForFeature,
    classColor: classColor,
    formatArea: formatArea,
    formatPercent: formatPercent,
  };
});
