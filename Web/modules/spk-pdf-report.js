(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./spk-engine.js"),
      require("./land-use-information.js"),
      require("./spk-store.js"),
      require("./spk-interpretation.js")
    );
  } else {
    root.LahanAmanSPKPDF = factory(
      root.LahanAmanSPK,
      root.LahanAmanLandUse,
      root.LahanAmanSPKStore,
      root.LahanAmanSPKInterpretation
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  Engine,
  LandUse,
  Store,
  Interpretation
) {
  "use strict";

  const PAGE_W = 595.28; // A4 width in pt
  const PAGE_H = 841.89; // A4 height in pt
  const MARGIN_X = 36;
  const MARGIN_TOP = 40;
  const MARGIN_BOTTOM = 44;
  const CONTENT_W = PAGE_W - MARGIN_X * 2;

  const ZONE_COLORS = {
    hijau: { hex: "#10b981", rgb: [0.063, 0.725, 0.506], fillRgb: [0.88, 0.98, 0.93], label: "Zona Hijau" },
    kuning: { hex: "#f59e0b", rgb: [0.961, 0.62, 0.043], fillRgb: [0.99, 0.95, 0.85], label: "Zona Kuning" },
    merah: { hex: "#ef4444", rgb: [0.937, 0.267, 0.267], fillRgb: [0.99, 0.89, 0.89], label: "Zona Merah" },
    unknown: { hex: "#64748b", rgb: [0.392, 0.455, 0.545], fillRgb: [0.93, 0.95, 0.97], label: "Tidak Terklasifikasi" },
  };

  const CRITERION_LABELS = {
    slope: "Kemiringan Tanah (Lereng)",
    soil: "Jenis & Kondisi Tanah (Pedologi)",
    geology: "Jenis Batuan & Formasi Geologi",
    rainfall: "Curah Hujan Tahunan (Isohyet)",
    landCover: "Penggunaan / Tutupan Lahan",
  };

  function toFinite(val) {
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  }

  function fmtNum(val, digits) {
    const n = toFinite(val);
    if (n == null) return "-";
    const d = digits != null ? digits : 2;
    return n.toLocaleString("id-ID", {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }

  function fmtArea(val) {
    const n = toFinite(val);
    if (n == null) return "-";
    return fmtNum(n, 1) + " m2";
  }

  function fmtPct(val, digits) {
    const n = toFinite(val);
    if (n == null) return "-";
    return fmtNum(n, digits != null ? digits : 1) + "%";
  }

  function sanitizePdfText(input) {
    if (input == null) return "-";
    const str = String(input)
      .replace(/[\u2013\u2014\u2212]/g, "-")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u2022/g, "*")
      .replace(/\u00B2/g, "2")
      .replace(/\u00B3/g, "3")
      .replace(/\u03B2/g, "beta")
      .replace(/\u03C6/g, "phi")
      .replace(/\u03B3/g, "gamma")
      .replace(/\u2264/g, "<=")
      .replace(/\u2265/g, ">=")
      .replace(/\s+/g, " ")
      .trim();
    let out = "";
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code >= 32 && code <= 255) {
        out += str[i];
      } else {
        out += " ";
      }
    }
    return out || "-";
  }

  function pdfEscape(str) {
    const clean = sanitizePdfText(str);
    return clean
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)");
  }

  function estimateTextWidth(text, fontSize, isBold) {
    const s = sanitizePdfText(text);
    const factor = isBold ? 0.535 : 0.495;
    return s.length * fontSize * factor;
  }

  function wrapText(text, maxWidth, fontSize, isBold) {
    const clean = sanitizePdfText(text);
    if (!clean || clean === "-") return ["-"];
    const words = clean.split(" ");
    const lines = [];
    let current = "";
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const candidate = current ? current + " " + word : word;
      if (estimateTextWidth(candidate, fontSize, isBold) <= maxWidth || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : ["-"];
  }

  function hexToRgbNorm(hex, fallback) {
    const clean = String(hex || "").trim();
    const m = clean.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return fallback || [0.2, 0.25, 0.33];
    return [
      parseInt(m[1], 16) / 255,
      parseInt(m[2], 16) / 255,
      parseInt(m[3], 16) / 255,
    ];
  }

  function collectGeometryRings(geom) {
    const rings = [];
    if (!geom || typeof geom !== "object") return rings;
    if (geom.type === "Polygon" && Array.isArray(geom.coordinates)) {
      geom.coordinates.forEach(function (ring) {
        if (Array.isArray(ring) && ring.length >= 3) rings.push(ring);
      });
    } else if (geom.type === "MultiPolygon" && Array.isArray(geom.coordinates)) {
      geom.coordinates.forEach(function (poly) {
        if (Array.isArray(poly)) {
          poly.forEach(function (ring) {
            if (Array.isArray(ring) && ring.length >= 3) rings.push(ring);
          });
        }
      });
    } else if (geom.type === "GeometryCollection" && Array.isArray(geom.geometries)) {
      geom.geometries.forEach(function (sub) {
        collectGeometryRings(sub).forEach(function (r) {
          rings.push(r);
        });
      });
    }
    return rings;
  }

  function computeGeometryBBox(geometries) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    geometries.forEach(function (geom) {
      const rings = collectGeometryRings(geom);
      rings.forEach(function (ring) {
        ring.forEach(function (pt) {
          const x = Number(pt && pt[0]);
          const y = Number(pt && pt[1]);
          if (Number.isFinite(x) && Number.isFinite(y)) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        });
      });
    });
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
      return { minX: 110.37, minY: -7.8, maxX: 110.38, maxY: -7.79 };
    }
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  function computeRingCentroid(ring) {
    if (!Array.isArray(ring) || !ring.length) return null;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let i = 0; i < ring.length; i++) {
      const x = Number(ring[i][0]);
      const y = Number(ring[i][1]);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        sx += x;
        sy += y;
        n++;
      }
    }
    return n > 0 ? [sx / n, sy / n] : null;
  }

  function renderKavlingMapCanvas(assessment, contextData) {
    if (typeof document === "undefined" || typeof document.createElement !== "function") {
      return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 560;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const polyGeom =
      (contextData && contextData.geometry) ||
      (assessment && assessment.location && assessment.location.geometry) ||
      null;
    const rawSegments = (contextData && Array.isArray(contextData.segments) && contextData.segments) || [];
    const landUseNorm = LandUse
      ? LandUse.normalize((assessment && assessment.landUse) || (contextData && contextData.landUse))
      : { classes: [], features: [] };

    const allGeoms = [];
    if (polyGeom) allGeoms.push(polyGeom);
    rawSegments.forEach(function (seg) {
      if (seg && seg.geometry) allGeoms.push(seg.geometry);
    });
    landUseNorm.features.forEach(function (f) {
      if (f && f.geometry) allGeoms.push(f.geometry);
    });
    const bbox = computeGeometryBBox(allGeoms);

    // Background card
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);

    // Top title bar of visual figure
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, canvas.width, 44);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 15px Arial, sans-serif";
    ctx.fillText(
      "VISUALISASI SPASIAL POLIGON KAVLING, ZONASI SEGMEN SPK & PENGGUNAAN LAHAN (RBI 25K)",
      18,
      27
    );
    ctx.fillStyle = "#94a3b8";
    ctx.font = "12px Arial, sans-serif";
    const centerLng = ((bbox.minX + bbox.maxX) / 2).toFixed(5);
    const centerLat = ((bbox.minY + bbox.maxY) / 2).toFixed(5);
    ctx.fillText(
      "Pusat Kavling: " + centerLat + " LS, " + centerLng + " BT (WGS 84)",
      canvas.width - 365,
      27
    );

    function drawMapViewport(vpX, vpY, vpW, vpH, title, mode) {
      // Frame
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(vpX, vpY, vpW, vpH);
      ctx.strokeStyle = "#94a3b8";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(vpX, vpY, vpW, vpH);

      // Sub-header
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(vpX, vpY, vpW, 30);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 13px Arial, sans-serif";
      ctx.fillText(title, vpX + 12, vpY + 20);

      const mapX = vpX + 42;
      const mapY = vpY + 38;
      const mapW = vpW - 54;
      const mapH = vpH - 110;

      // Map plot background
      ctx.fillStyle = "#f1f5f9";
      ctx.fillRect(mapX, mapY, mapW, mapH);

      const spanX = Math.max(bbox.maxX - bbox.minX, 0.0008);
      const spanY = Math.max(bbox.maxY - bbox.minY, 0.0008);
      const padX = spanX * 0.18;
      const padY = spanY * 0.18;
      const worldMinX = bbox.minX - padX;
      const worldMaxX = bbox.maxX + padX;
      const worldMinY = bbox.minY - padY;
      const worldMaxY = bbox.maxY + padY;
      const worldW = worldMaxX - worldMinX;
      const worldH = worldMaxY - worldMinY;

      const scale = Math.min(mapW / worldW, mapH / worldH);
      const drawW = worldW * scale;
      const drawH = worldH * scale;
      const offsetX = mapX + (mapW - drawW) / 2;
      const offsetY = mapY + (mapH - drawH) / 2;

      function project(pt) {
        const x = offsetX + (Number(pt[0]) - worldMinX) * scale;
        const y = offsetY + (worldMaxY - Number(pt[1])) * scale;
        return [x, y];
      }

      // Coordinate Grid Lines
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1;
      ctx.fillStyle = "#475569";
      ctx.font = "10px Arial, sans-serif";
      const gridCols = 4;
      const gridRows = 4;
      for (let c = 0; c <= gridCols; c++) {
        const gx = mapX + (mapW * c) / gridCols;
        ctx.beginPath();
        ctx.moveTo(gx, mapY);
        ctx.lineTo(gx, mapY + mapH);
        ctx.stroke();
        const lonVal = worldMinX + ((gx - offsetX) / Math.max(drawW, 1)) * worldW;
        ctx.fillText(lonVal.toFixed(4) + "°", gx - 18, mapY + mapH + 13);
      }
      for (let r = 0; r <= gridRows; r++) {
        const gy = mapY + (mapH * r) / gridRows;
        ctx.beginPath();
        ctx.moveTo(mapX, gy);
        ctx.lineTo(mapX + mapW, gy);
        ctx.stroke();
        const latVal = worldMaxY - ((gy - offsetY) / Math.max(drawH, 1)) * worldH;
        ctx.fillText(latVal.toFixed(4) + "°", vpX + 4, gy + 3);
      }

      function traceGeometry(geom) {
        const rings = collectGeometryRings(geom);
        if (!rings.length) return false;
        ctx.beginPath();
        rings.forEach(function (ring) {
          ring.forEach(function (pt, idx) {
            const p = project(pt);
            if (idx === 0) ctx.moveTo(p[0], p[1]);
            else ctx.lineTo(p[0], p[1]);
          });
          ctx.closePath();
        });
        return true;
      }

      // Draw base kavling footprint (light tint for uncovered areas)
      if (polyGeom && traceGeometry(polyGeom)) {
        ctx.fillStyle = "rgba(148, 163, 184, 0.22)";
        ctx.fill();
      }

      if (mode === "segments") {
        const assessmentSegMap = {};
        if (assessment && Array.isArray(assessment.segments)) {
          assessment.segments.forEach(function (s) {
            assessmentSegMap[s.segmentId] = s;
          });
        }

        rawSegments.forEach(function (feat, idx) {
          if (!feat || !feat.geometry) return;
          const props = feat.properties || {};
          const segId = props.segmen_id || feat.id || "SEG-" + String(idx + 1).padStart(2, "0");
          const aSeg = assessmentSegMap[segId];
          let fillHex = props.warna_hex || "#10b981";
          let strokeHex = props.border_hex || "#0f172a";
          if (aSeg && aSeg.standardZone) {
            const zc = ZONE_COLORS[aSeg.standardZone.code];
            if (zc) fillHex = zc.hex;
          }
          if (traceGeometry(feat.geometry)) {
            ctx.fillStyle = fillHex + "CC";
            ctx.fill();
            ctx.strokeStyle = strokeHex;
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        });

        // Segment labels
        rawSegments.forEach(function (feat, idx) {
          if (!feat || !feat.geometry) return;
          const rings = collectGeometryRings(feat.geometry);
          if (!rings.length) return;
          const c = computeRingCentroid(rings[0]);
          if (!c) return;
          const pt = project(c);
          const props = feat.properties || {};
          const segId = props.segmen_id || feat.id || "SEG-" + String(idx + 1).padStart(2, "0");
          const aSeg = assessmentSegMap[segId];
          const scoreTxt =
            aSeg && aSeg.activeScore != null
              ? fmtNum(aSeg.activeScore, 2)
              : props.skor_akhir != null
              ? fmtNum(props.skor_akhir, 2)
              : "-";
          const label = segId + " (" + scoreTxt + ")";
          ctx.font = "bold 11px Arial, sans-serif";
          const tw = ctx.measureText(label).width;
          ctx.fillStyle = "rgba(15, 23, 42, 0.86)";
          ctx.fillRect(pt[0] - tw / 2 - 5, pt[1] - 9, tw + 10, 18);
          ctx.fillStyle = "#ffffff";
          ctx.fillText(label, pt[0] - tw / 2, pt[1] + 4);
        });
      } else {
        // Land Use polygons
        landUseNorm.features.forEach(function (feat) {
          if (!feat || !feat.geometry) return;
          if (traceGeometry(feat.geometry)) {
            ctx.fillStyle = (feat.color || "#66BB6A") + "CC";
            ctx.fill();
            ctx.strokeStyle = "#1e293b";
            ctx.lineWidth = 1.2;
            ctx.stroke();
          }
        });
      }

      // Draw Kavling Boundary Outline on top
      if (polyGeom && traceGeometry(polyGeom)) {
        ctx.save();
        ctx.strokeStyle = "#0f172a";
        ctx.lineWidth = 2.8;
        ctx.setLineDash([8, 5]);
        ctx.stroke();
        ctx.restore();

        const outerRings = collectGeometryRings(polyGeom);
        if (outerRings.length) {
          outerRings[0].forEach(function (vertex, vIdx) {
            if (vIdx === outerRings[0].length - 1) return;
            const vp = project(vertex);
            ctx.beginPath();
            ctx.arc(vp[0], vp[1], 3.5, 0, Math.PI * 2);
            ctx.fillStyle = "#0f172a";
            ctx.fill();
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1.2;
            ctx.stroke();
          });
        }
      }

      // North Arrow inside map top-right
      const naX = mapX + mapW - 26;
      const naY = mapY + 28;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(naX, naY, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#334155";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 10px Arial, sans-serif";
      ctx.fillText("U", naX - 3.5, naY - 6);
      ctx.beginPath();
      ctx.moveTo(naX, naY - 4);
      ctx.lineTo(naX - 5, naY + 10);
      ctx.lineTo(naX, naY + 6);
      ctx.lineTo(naX + 5, naY + 10);
      ctx.closePath();
      ctx.fillStyle = "#dc2626";
      ctx.fill();

      // Scale bar inside map bottom-left
      const metersPerDeg = 111320 * Math.cos((-7.8 * Math.PI) / 180);
      const barMeters = Math.max(25, Math.round((worldW * metersPerDeg * 0.22) / 25) * 25);
      const barPx = Math.min(130, Math.max(40, (barMeters / metersPerDeg) * scale));
      const sbX = mapX + 12;
      const sbY = mapY + mapH - 14;
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.fillRect(sbX - 4, sbY - 15, barPx + 45, 20);
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sbX, sbY - 5);
      ctx.lineTo(sbX, sbY);
      ctx.lineTo(sbX + barPx, sbY);
      ctx.lineTo(sbX + barPx, sbY - 5);
      ctx.stroke();
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 10px Arial, sans-serif";
      ctx.fillText(barMeters + " m", sbX + barPx + 5, sbY);

      // Legend box below map
      const legY = mapY + mapH + 22;
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(vpX + 10, legY, vpW - 20, 42);
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1;
      ctx.strokeRect(vpX + 10, legY, vpW - 20, 42);

      ctx.font = "bold 11px Arial, sans-serif";
      let lx = vpX + 18;
      const ly = legY + 25;
      if (mode === "segments") {
        const items = [
          { color: "#10b981", label: "Zona Hijau (<2,20)" },
          { color: "#f59e0b", label: "Zona Kuning (2,20-3,40)" },
          { color: "#ef4444", label: "Zona Merah (>3,40)" },
          { color: "#cbd5e1", label: "Area Belum Tercakup" },
        ];
        items.forEach(function (it) {
          ctx.fillStyle = it.color;
          ctx.fillRect(lx, ly - 10, 13, 13);
          ctx.strokeStyle = "#1e293b";
          ctx.strokeRect(lx, ly - 10, 13, 13);
          ctx.fillStyle = "#1e293b";
          ctx.font = "11px Arial, sans-serif";
          ctx.fillText(it.label, lx + 17, ly);
          lx += ctx.measureText(it.label).width + 32;
        });
      } else {
        const classes = landUseNorm.classes.slice(0, 4);
        if (!classes.length) {
          ctx.fillStyle = "#475569";
          ctx.font = "11px Arial, sans-serif";
          ctx.fillText("Tidak ada kelas penggunaan lahan terdeteksi pada area kavling.", lx, ly);
        } else {
          classes.forEach(function (cls) {
            ctx.fillStyle = cls.color || "#66BB6A";
            ctx.fillRect(lx, ly - 10, 13, 13);
            ctx.strokeStyle = "#1e293b";
            ctx.strokeRect(lx, ly - 10, 13, 13);
            const txt = cls.className + " (" + fmtPct(cls.percentOfPolygon, 1) + ")";
            ctx.fillStyle = "#1e293b";
            ctx.font = "11px Arial, sans-serif";
            ctx.fillText(txt, lx + 17, ly);
            lx += ctx.measureText(txt).width + 28;
          });
        }
      }
    }

    drawMapViewport(
      14,
      54,
      578,
      492,
      "A. Peta Zonasi Segmen Kerawanan Longsor & Kavling (SPK)",
      "segments"
    );
    drawMapViewport(
      608,
      54,
      578,
      492,
      "B. Peta Irisan Penggunaan Lahan (RBI 25K) Area Kavling",
      "landuse"
    );

    return canvas;
  }

  function dataUrlToUint8Array(dataUrl) {
    if (!dataUrl || typeof dataUrl !== "string") return null;
    const parts = dataUrl.split(",");
    if (parts.length < 2) return null;
    const b64 = parts[1];
    if (typeof atob === "function") {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
      return bytes;
    }
    if (typeof Buffer !== "undefined") {
      return new Uint8Array(Buffer.from(b64, "base64"));
    }
    return null;
  }

  function captureKavlingJpeg(assessment, contextData) {
    try {
      const canvas = renderKavlingMapCanvas(assessment, contextData);
      if (!canvas || typeof canvas.toDataURL !== "function") return null;
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      const bytes = dataUrlToUint8Array(dataUrl);
      if (!bytes || bytes.length < 64) return null;
      return {
        bytes: bytes,
        width: canvas.width,
        height: canvas.height,
        dataUrl: dataUrl,
      };
    } catch (_err) {
      return null;
    }
  }

  function createPdfDocumentBuilder(docMeta, mapImage) {
    const pages = [];
    let currentOps = [];
    let cursorY = PAGE_H - MARGIN_TOP;

    function pushOp(cmd) {
      currentOps.push(cmd);
    }

    function drawRunningHeader() {
      const topY = PAGE_H - 26;
      pushOp("q");
      pushOp("0.059 0.090 0.165 rg");
      pushOp(MARGIN_X + " " + (topY - 6) + " " + CONTENT_W + " 18 re f");
      pushOp("1 1 1 rg");
      pushOp("BT /F2 8 Tf " + (MARGIN_X + 8) + " " + (topY - 0.5) + " Td (" + pdfEscape("LAHANAMAN GEOANALYTICS DIY - LAPORAN ANALISIS SPK & GEOTEKNIK KAVLING") + ") Tj ET");
      const rightLabel = pdfEscape("ID: " + (docMeta.assessmentId || "-"));
      const rw = estimateTextWidth(rightLabel, 8, false);
      pushOp("BT /F1 8 Tf " + (PAGE_W - MARGIN_X - rw - 8) + " " + (topY - 0.5) + " Td (" + rightLabel + ") Tj ET");
      pushOp("Q");
      cursorY = topY - 18;
    }

    function startNewPage(isFirstPage) {
      if (currentOps.length > 0) {
        pages.push(currentOps.join("\n"));
      }
      currentOps = [];
      if (!isFirstPage) {
        drawRunningHeader();
      } else {
        cursorY = PAGE_H - MARGIN_TOP;
      }
    }

    function ensureSpace(heightNeeded) {
      if (cursorY - heightNeeded < MARGIN_BOTTOM) {
        startNewPage(false);
        return true;
      }
      return false;
    }

    function drawRect(x, yBottom, w, h, fillRgb, strokeRgb, lineWidth) {
      pushOp("q");
      if (lineWidth != null) {
        pushOp(lineWidth.toFixed(2) + " w");
      }
      if (fillRgb && strokeRgb) {
        pushOp(fillRgb[0].toFixed(3) + " " + fillRgb[1].toFixed(3) + " " + fillRgb[2].toFixed(3) + " rg");
        pushOp(strokeRgb[0].toFixed(3) + " " + strokeRgb[1].toFixed(3) + " " + strokeRgb[2].toFixed(3) + " RG");
        pushOp(x.toFixed(2) + " " + yBottom.toFixed(2) + " " + w.toFixed(2) + " " + h.toFixed(2) + " re B");
      } else if (fillRgb) {
        pushOp(fillRgb[0].toFixed(3) + " " + fillRgb[1].toFixed(3) + " " + fillRgb[2].toFixed(3) + " rg");
        pushOp(x.toFixed(2) + " " + yBottom.toFixed(2) + " " + w.toFixed(2) + " " + h.toFixed(2) + " re f");
      } else if (strokeRgb) {
        pushOp(strokeRgb[0].toFixed(3) + " " + strokeRgb[1].toFixed(3) + " " + strokeRgb[2].toFixed(3) + " RG");
        pushOp(x.toFixed(2) + " " + yBottom.toFixed(2) + " " + w.toFixed(2) + " " + h.toFixed(2) + " re S");
      }
      pushOp("Q");
    }

    function drawTextLine(text, x, y, fontSize, isBold, colorRgb, align, boxWidth) {
      const rgb = colorRgb || [0.059, 0.09, 0.165];
      const font = isBold ? "/F2" : "/F1";
      let tx = x;
      if (align === "right" && boxWidth != null) {
        const w = estimateTextWidth(text, fontSize, isBold);
        tx = x + Math.max(0, boxWidth - w);
      } else if (align === "center" && boxWidth != null) {
        const w = estimateTextWidth(text, fontSize, isBold);
        tx = x + Math.max(0, (boxWidth - w) / 2);
      }
      pushOp("q");
      pushOp(rgb[0].toFixed(3) + " " + rgb[1].toFixed(3) + " " + rgb[2].toFixed(3) + " rg");
      pushOp("BT " + font + " " + fontSize.toFixed(1) + " Tf " + tx.toFixed(2) + " " + y.toFixed(2) + " Td (" + pdfEscape(text) + ") Tj ET");
      pushOp("Q");
    }

    function drawSectionHeading(numberLabel, title, subtitle) {
      const needed = subtitle ? 36 : 24;
      ensureSpace(needed + 28);
      cursorY -= 6;
      const boxH = subtitle ? 28 : 20;
      const yBottom = cursorY - boxH;
      drawRect(MARGIN_X, yBottom, CONTENT_W, boxH, [0.945, 0.961, 0.976], [0.796, 0.835, 0.882], 0.8);
      drawRect(MARGIN_X, yBottom, 4.5, boxH, [0.059, 0.09, 0.165], null, 0);
      drawTextLine(
        numberLabel + ". " + title,
        MARGIN_X + 11,
        cursorY - 13,
        10,
        true,
        [0.059, 0.09, 0.165]
      );
      if (subtitle) {
        drawTextLine(subtitle, MARGIN_X + 11, cursorY - 23.5, 7.8, false, [0.278, 0.333, 0.412]);
      }
      cursorY = yBottom - 6;
    }

    function drawTable(columns, rows, options) {
      const opts = options || {};
      const fontSize = opts.fontSize || 8.0;
      const headerFontSize = opts.headerFontSize || 8.2;
      const lineH = fontSize + 3.2;
      const padX = opts.padX || 5;
      const padY = opts.padY || 4.5;

      const totalWeight = columns.reduce(function (acc, c) {
        return acc + (c.width || 1);
      }, 0);
      const colWidths = columns.map(function (c) {
        return ((c.width || 1) / totalWeight) * CONTENT_W;
      });

      function renderHeaderRow() {
        const headerLinesPerCol = columns.map(function (col, idx) {
          return wrapText(col.label, colWidths[idx] - padX * 2, headerFontSize, true);
        });
        const maxHeaderLines = Math.max.apply(
          null,
          headerLinesPerCol.map(function (l) {
            return l.length;
          })
        );
        const headerH = maxHeaderLines * (headerFontSize + 3) + padY * 2;
        const yBottom = cursorY - headerH;
        drawRect(MARGIN_X, yBottom, CONTENT_W, headerH, [0.118, 0.161, 0.231], [0.118, 0.161, 0.231], 0.7);
        let cx = MARGIN_X;
        columns.forEach(function (col, idx) {
          const w = colWidths[idx];
          if (idx > 0) {
            drawRect(cx, yBottom, 0.5, headerH, [0.278, 0.333, 0.412], null, 0);
          }
          const lines = headerLinesPerCol[idx];
          lines.forEach(function (line, lIdx) {
            const ly = cursorY - padY - headerFontSize - lIdx * (headerFontSize + 2.6) + 1.5;
            drawTextLine(line, cx + padX, ly, headerFontSize, true, [1, 1, 1], col.align || "left", w - padX * 2);
          });
          cx += w;
        });
        cursorY = yBottom;
      }

      ensureSpace(42);
      renderHeaderRow();

      rows.forEach(function (row, rIdx) {
        const cells = columns.map(function (col, cIdx) {
          const raw = row[col.key];
          const text = raw == null || raw === "" ? "-" : String(raw);
          const isBold = Boolean(col.bold || (row._boldKeys && row._boldKeys[col.key]));
          const lines = wrapText(text, colWidths[cIdx] - padX * 2, fontSize, isBold);
          return { lines: lines, isBold: isBold };
        });
        const maxLines = Math.max.apply(
          null,
          cells.map(function (c) {
            return c.lines.length;
          })
        );
        const rowH = maxLines * lineH + padY * 2;
        if (cursorY - rowH < MARGIN_BOTTOM) {
          startNewPage(false);
          renderHeaderRow();
        }
        const yBottom = cursorY - rowH;
        const bgRgb = row._rowFillRgb
          ? row._rowFillRgb
          : rIdx % 2 === 1
          ? [0.973, 0.98, 0.988]
          : [1, 1, 1];
        drawRect(MARGIN_X, yBottom, CONTENT_W, rowH, bgRgb, [0.804, 0.835, 0.882], 0.55);

        let cx = MARGIN_X;
        columns.forEach(function (col, cIdx) {
          const w = colWidths[cIdx];
          if (cIdx > 0) {
            drawRect(cx, yBottom, 0.45, rowH, [0.85, 0.88, 0.92], null, 0);
          }
          const cellFill = row._cellFill && row._cellFill[col.key];
          if (cellFill) {
            drawRect(cx + 0.5, yBottom + 0.5, w - 1, rowH - 1, cellFill, null, 0);
          }
          const cellColor =
            (row._cellTextColor && row._cellTextColor[col.key]) || [0.059, 0.09, 0.165];
          const cell = cells[cIdx];
          cell.lines.forEach(function (line, lIdx) {
            const ly = cursorY - padY - fontSize - lIdx * lineH + 1.5;
            drawTextLine(
              line,
              cx + padX,
              ly,
              fontSize,
              cell.isBold,
              cellColor,
              col.align || "left",
              w - padX * 2
            );
          });
          cx += w;
        });

        cursorY = yBottom;
      });
      cursorY -= 6;
    }

    function drawEmbeddedMapImage(captionText) {
      const boxH = 248;
      ensureSpace(boxH + 22);
      const yBottom = cursorY - boxH;
      drawRect(MARGIN_X, yBottom, CONTENT_W, boxH, [0.973, 0.98, 0.988], [0.796, 0.835, 0.882], 0.8);
      if (mapImage && mapImage.bytes) {
        const imgAspect = mapImage.width / mapImage.height;
        let drawW = CONTENT_W - 8;
        let drawH = drawW / imgAspect;
        if (drawH > boxH - 8) {
          drawH = boxH - 8;
          drawW = drawH * imgAspect;
        }
        const imgX = MARGIN_X + (CONTENT_W - drawW) / 2;
        const imgY = yBottom + (boxH - drawH) / 2;
        pushOp("q");
        pushOp(drawW.toFixed(2) + " 0 0 " + drawH.toFixed(2) + " " + imgX.toFixed(2) + " " + imgY.toFixed(2) + " cm");
        pushOp("/ImKavling Do");
        pushOp("Q");
      } else {
        drawTextLine(
          "Visual peta kavling dirender dari geometri poligon aktif (" + (docMeta.coordSummary || "EPSG:4326") + ").",
          MARGIN_X + 16,
          yBottom + boxH / 2,
          9,
          true,
          [0.278, 0.333, 0.412]
        );
      }
      cursorY = yBottom - 3;
      if (captionText) {
        drawTextLine(captionText, MARGIN_X + 2, cursorY - 8, 7.6, false, [0.278, 0.333, 0.412]);
        cursorY -= 14;
      }
    }

    function compilePdfBytes() {
      if (currentOps.length > 0) {
        pages.push(currentOps.join("\n"));
        currentOps = [];
      }
      const totalPages = pages.length;

      // Append footer with page numbers to every page
      const finalizedStreams = pages.map(function (streamContent, idx) {
        const footerY = 20;
        const footerLeft = pdfEscape(
          "Laporan Resmi SPK LahanAman DIY | Dicetak: " + (docMeta.printedAt || "-")
        );
        const footerRight = pdfEscape("Halaman " + (idx + 1) + " dari " + totalPages);
        const rw = estimateTextWidth(footerRight, 7.8, true);
        const footerOps = [
          "q",
          "0.804 0.835 0.882 RG 0.6 w",
          MARGIN_X + " " + (footerY + 10) + " m " + (PAGE_W - MARGIN_X) + " " + (footerY + 10) + " l S",
          "0.392 0.455 0.545 rg",
          "BT /F1 7.6 Tf " + MARGIN_X + " " + footerY + " Td (" + footerLeft + ") Tj ET",
          "BT /F2 7.8 Tf " + (PAGE_W - MARGIN_X - rw) + " " + footerY + " Td (" + footerRight + ") Tj ET",
          "Q",
        ].join("\n");
        return streamContent + "\n" + footerOps;
      });

      // PDF Object Allocation:
      // 1: Catalog
      // 2: Pages
      // 3: Font Regular (/F1 Helvetica)
      // 4: Font Bold (/F2 Helvetica-Bold)
      // 5: Image XObject (/ImKavling) if mapImage exists
      const hasImg = Boolean(mapImage && mapImage.bytes && mapImage.bytes.length > 0);
      const firstPageObjId = hasImg ? 6 : 5;
      const pageObjIds = [];
      const contentObjIds = [];
      for (let i = 0; i < totalPages; i++) {
        pageObjIds.push(firstPageObjId + i * 2);
        contentObjIds.push(firstPageObjId + i * 2 + 1);
      }
      const maxObjId = firstPageObjId + totalPages * 2 - 1;

      const chunks = [];
      let byteLength = 0;
      const offsets = new Array(maxObjId + 1).fill(0);

      function writeAscii(str) {
        const arr = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i++) {
          arr[i] = str.charCodeAt(i) & 0xff;
        }
        chunks.push(arr);
        byteLength += arr.length;
      }

      function writeBytes(uint8) {
        chunks.push(uint8);
        byteLength += uint8.length;
      }

      writeAscii("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

      // Obj 1: Catalog
      offsets[1] = byteLength;
      writeAscii("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

      // Obj 2: Pages
      offsets[2] = byteLength;
      const kidsStr = pageObjIds.map(function (id) { return id + " 0 R"; }).join(" ");
      writeAscii("2 0 obj\n<< /Type /Pages /Kids [ " + kidsStr + " ] /Count " + totalPages + " >>\nendobj\n");

      // Obj 3: Font /F1
      offsets[3] = byteLength;
      writeAscii("3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n");

      // Obj 4: Font /F2
      offsets[4] = byteLength;
      writeAscii("4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n");

      // Obj 5: Image XObject if present
      if (hasImg) {
        offsets[5] = byteLength;
        writeAscii(
          "5 0 obj\n<< /Type /XObject /Subtype /Image /Width " +
            mapImage.width +
            " /Height " +
            mapImage.height +
            " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " +
            mapImage.bytes.length +
            " >>\nstream\n"
        );
        writeBytes(mapImage.bytes);
        writeAscii("\nendstream\nendobj\n");
      }

      const xObjRef = hasImg ? " /XObject << /ImKavling 5 0 R >>" : "";
      for (let i = 0; i < totalPages; i++) {
        const pId = pageObjIds[i];
        const cId = contentObjIds[i];
        const streamStr = finalizedStreams[i];

        offsets[pId] = byteLength;
        writeAscii(
          pId +
            " 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " +
            PAGE_W.toFixed(2) +
            " " +
            PAGE_H.toFixed(2) +
            "] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>" +
            xObjRef +
            " >> /Contents " +
            cId +
            " 0 R >>\nendobj\n"
        );

        offsets[cId] = byteLength;
        writeAscii(
          cId +
            " 0 obj\n<< /Length " +
            streamStr.length +
            " >>\nstream\n" +
            streamStr +
            "\nendstream\nendobj\n"
        );
      }

      const xrefOffset = byteLength;
      writeAscii("xref\n0 " + (maxObjId + 1) + "\n");
      writeAscii("0000000000 65535 f \n");
      for (let id = 1; id <= maxObjId; id++) {
        const offStr = String(offsets[id]).padStart(10, "0");
        writeAscii(offStr + " 00000 n \n");
      }
      writeAscii(
        "trailer\n<< /Size " +
          (maxObjId + 1) +
          " /Root 1 0 R >>\nstartxref\n" +
          xrefOffset +
          "\n%%EOF\n"
      );

      const finalBytes = new Uint8Array(byteLength);
      let pos = 0;
      for (let i = 0; i < chunks.length; i++) {
        finalBytes.set(chunks[i], pos);
        pos += chunks[i].length;
      }
      return finalBytes;
    }

    return {
      startNewPage: startNewPage,
      ensureSpace: ensureSpace,
      drawRect: drawRect,
      drawTextLine: drawTextLine,
      drawSectionHeading: drawSectionHeading,
      drawTable: drawTable,
      drawEmbeddedMapImage: drawEmbeddedMapImage,
      compilePdfBytes: compilePdfBytes,
      getCursorY: function () { return cursorY; },
      setCursorY: function (y) { cursorY = y; },
    };
  }

  function decisionStatusLabel(statusValue) {
    if (!statusValue) return "Belum diputuskan";
    if (Store && Array.isArray(Store.DECISION_STATUSES)) {
      const found = Store.DECISION_STATUSES.find(function (s) {
        return s.value === statusValue;
      });
      if (found) return found.label;
    }
    const map = {
      pending: "Belum diputuskan",
      accepted: "Disetujui untuk kajian lanjut",
      accepted_with_conditions: "Disetujui dengan syarat mitigasi",
      deferred: "Ditunda untuk verifikasi lapangan",
      rejected: "Tidak direkomendasikan",
    };
    return map[statusValue] || String(statusValue);
  }

  function buildReportModel(options) {
    const opts = options || {};
    const record = opts.record || null;
    const assessment = opts.assessment || (record && record.assessment) || null;
    if (!assessment) {
      throw new Error("Data evaluasi SPK belum tersedia untuk pembuatan laporan PDF.");
    }
    const contextData = opts.context || {};
    const formDraft = opts.formDraft || {};
    const decision =
      (record && record.humanDecision) ||
      assessment.humanDecision ||
      formDraft || {
        reviewer: "-",
        decidedAt: new Date().toISOString().slice(0, 10),
        status: "pending",
        rationale: "-",
        notes: "-",
      };

    const interp =
      assessment.interpretation ||
      (record && record.systemInterpretation) ||
      (Interpretation ? Interpretation.build(assessment) : null);

    const landUse = LandUse
      ? LandUse.normalize(assessment.landUse || contextData.landUse)
      : { available: false, classes: [], features: [], coveragePercent: null };

    const polyGeom =
      contextData.geometry ||
      (assessment.location && assessment.location.geometry) ||
      null;
    const bbox = computeGeometryBBox(polyGeom ? [polyGeom] : []);
    const coordSummary =
      fmtNum((bbox.minY + bbox.maxY) / 2, 5) +
      " LS, " +
      fmtNum((bbox.minX + bbox.maxX) / 2, 5) +
      " BT";

    return {
      assessment: assessment,
      record: record,
      contextData: contextData,
      decision: decision,
      interpretation: interp,
      landUse: landUse,
      bbox: bbox,
      coordSummary: coordSummary,
      printedAt: new Date().toLocaleString("id-ID"),
    };
  }

  function generatePdfBytes(options) {
    const model = buildReportModel(options);
    const assessment = model.assessment;
    const decision = model.decision;
    const interp = model.interpretation;
    const landUse = model.landUse;
    const active = assessment.active || {};
    const standard = assessment.standard || {};
    const loc = assessment.location || {};
    const slope = assessment.infiniteSlope || {};

    const mapImage =
      options && options.mapImage !== undefined
        ? options.mapImage
        : captureKavlingJpeg(assessment, model.contextData);

    const builder = createPdfDocumentBuilder(
      {
        assessmentId: assessment.assessmentId,
        coordSummary: model.coordSummary,
        printedAt: model.printedAt,
      },
      mapImage
    );

    builder.startNewPage(true);

    // 1. KOP LAPORAN RESMI
    const topY = PAGE_H - MARGIN_TOP;
    const headerH = 54;
    builder.drawRect(MARGIN_X, topY - headerH, CONTENT_W, headerH, [0.059, 0.09, 0.165], [0.059, 0.09, 0.165], 1);
    builder.drawRect(MARGIN_X, topY - headerH, 6, headerH, [0.063, 0.725, 0.506], null, 0);
    builder.drawTextLine(
      "LAPORAN ANALISIS SISTEM PENDUKUNG KEPUTUSAN (SPK) KELAYAKAN & GEOTEKNIK KAVLING",
      MARGIN_X + 14,
      topY - 18,
      11.2,
      true,
      [1, 1, 1]
    );
    builder.drawTextLine(
      "LahanAman GeoAnalytics DIY | Metode Weighted Linear Combination (Permen PU 22/2007) & Infinite Slope FS",
      MARGIN_X + 14,
      topY - 32,
      8.2,
      false,
      [0.804, 0.835, 0.882]
    );
    builder.drawTextLine(
      "ID Evaluasi: " +
        (assessment.assessmentId || "-") +
        (model.record && model.record.reviewId ? " | ID Review: " + model.record.reviewId : "") +
        " | Tanggal Evaluasi: " +
        new Date(assessment.createdAt || Date.now()).toLocaleString("id-ID") +
        " | Koordinat Pusat: " +
        model.coordSummary,
      MARGIN_X + 14,
      topY - 45,
      7.8,
      false,
      [0.58, 0.64, 0.72]
    );
    builder.setCursorY(topY - headerH - 6);

    // 2. VISUALISASI PETA KAVLING & PENGGUNAAN LAHAN
    builder.drawSectionHeading(
      "1",
      "Visualisasi Peta Poligon Kavling, Segmen SPK & Penggunaan Lahan",
      "Gambar poligon kavling yang telah dibuat beserta pemotongan segmen kerawanan longsor (kiri) dan tutupan lahan RBI 25K (kanan)."
    );
    builder.drawEmbeddedMapImage(
      "Gambar 1. Peta batas kavling uji (" +
        fmtArea(loc.areaM2) +
        ", " +
        (loc.segmentCount || 0) +
        " segmen SPK, " +
        (landUse.classes ? landUse.classes.length : 0) +
        " kelas penggunaan lahan) pada sistem koordinat WGS 84 (EPSG:4326)."
    );

    // 3. TABEL 1: RINGKASAN EKSEKUTIF & METRIK SPASIAL KAVLING
    builder.drawSectionHeading(
      "2",
      "Tabel Ringkasan Eksekutif & Distribusi Zona Kerawanan Kavling",
      "Rekapitulasi luas kavling, cakupan data penilaian, skor WLC aktif vs standar penelitian, dan kestabilan lereng (FS)."
    );

    const activeClassLabel = active.classification
      ? active.classification.label
      : active.profile === "custom"
      ? "Indeks Kustom (Belum Terkalibrasi)"
      : "Tidak Terklasifikasi";
    const stdClassLabel = standard.classification ? standard.classification.label : "-";
    const fsClassLabel = slope.classification ? slope.classification.label : "-";
    const zd = standard.zoneDistribution || {};
    const zHijau = zd.hijau || { areaM2: 0, percentOfPolygon: 0 };
    const zKuning = zd.kuning || { areaM2: 0, percentOfPolygon: 0 };
    const zMerah = zd.merah || { areaM2: 0, percentOfPolygon: 0 };
    const zGap = zd.tidak_terklasifikasi || {
      areaM2: Math.max(0, (loc.areaM2 || 0) - (loc.coveredAreaM2 || 0)),
      percentOfPolygon:
        loc.coverageRatio != null ? Math.max(0, 100 - loc.coverageRatio * 100) : null,
    };

    builder.drawTable(
      [
        { key: "metric1", label: "Parameter Evaluasi", width: 1.35, bold: true },
        { key: "val1", label: "Nilai / Hasil", width: 1.65 },
        { key: "metric2", label: "Parameter Spasial & Zonasi", width: 1.35, bold: true },
        { key: "val2", label: "Luas & Proporsi", width: 1.65 },
      ],
      [
        {
          metric1: "Profil Pembobotan Aktif",
          val1: (active.label || "Standar Penelitian") + (active.profile === "custom" ? " (Kustom)" : " (Standar)"),
          metric2: "Luas Total Poligon Kavling",
          val2: fmtArea(loc.areaM2) + " (" + fmtNum((loc.areaM2 || 0) / 10000, 3) + " ha)",
        },
        {
          metric1: "Nilai WLC Profil Aktif",
          val1: fmtNum(active.score, 2) + " / 5,00 (" + activeClassLabel + ")",
          metric2: "Luas Tercakup Data SPK",
          val2: fmtArea(loc.coveredAreaM2) + " (" + fmtPct(loc.coverageRatio != null ? loc.coverageRatio * 100 : null) + ")",
        },
        {
          metric1: "Nilai WLC Standar Penelitian",
          val1: fmtNum(standard.score, 2) + " / 5,00 (" + stdClassLabel + ")",
          metric2: "Zona Hijau (Skor < 2,20)",
          val2: fmtArea(zHijau.areaM2) + " (" + fmtPct(zHijau.percentOfPolygon) + " poligon)",
          _cellFill: { val2: ZONE_COLORS.hijau.fillRgb },
        },
        {
          metric1: "Faktor Keamanan Lereng (FS)",
          val1:
            "Min " +
            fmtNum(slope.min, 2) +
            " | Rerata " +
            fmtNum(slope.mean, 2) +
            " | Maks " +
            fmtNum(slope.max, 2) +
            " (Syarat Aman SNI 8460:2017: FS >= 1,50)",
          metric2: "Zona Kuning (Skor 2,20 - 3,40)",
          val2: fmtArea(zKuning.areaM2) + " (" + fmtPct(zKuning.percentOfPolygon) + " poligon)",
          _cellFill: { val2: ZONE_COLORS.kuning.fillRgb },
        },
        {
          metric1: "Jumlah & Kelengkapan Segmen",
          val1: (loc.completeSegmentCount || 0) + " dari " + (loc.segmentCount || 0) + " segmen lengkap",
          metric2: "Zona Merah (Skor > 3,40)",
          val2: fmtArea(zMerah.areaM2) + " (" + fmtPct(zMerah.percentOfPolygon) + " poligon)",
          _cellFill: { val2: ZONE_COLORS.merah.fillRgb },
        },
        {
          metric1: "Status Kesimpulan Sistem",
          val1: interp && interp.status ? interp.status.label : "Perlu Pemeriksaan Lanjutan",
          metric2: "Area Tidak Tercakup / Gap",
          val2: fmtArea(zGap.areaM2) + " (" + fmtPct(zGap.percentOfPolygon) + " poligon)",
        },
      ]
    );

    // 4. TABEL 2: ANALISIS 5 KRITERIA PEMBOBOTAN WLC
    builder.drawSectionHeading(
      "3",
      "Tabel Analisis Kriteria & Pembobotan WLC (5 Faktor Penilaian)",
      "Perbandingan bobot aktif, bobot standar penelitian, skor rerata tertimbang luas, kontribusi nilai, dan kondisi aktual."
    );

    const criteriaRows = (assessment.criteria || []).map(function (c, idx) {
      let actualText = "-";
      if (c.actualSummary != null) {
        if (c.key === "slope") actualText = fmtNum(c.actualSummary, 2) + " derajat";
        else if (c.key === "rainfall") actualText = fmtNum(c.actualSummary, 0) + " mm/tahun";
        else actualText = String(c.actualSummary);
      }
      const statusMap = {
        complete: "Lengkap",
        partial: "Sebagian",
        missing: "Belum Tersedia",
      };
      return {
        no: String(idx + 1),
        criterion: CRITERION_LABELS[c.key] || c.label || c.key,
        activeWeight: fmtPct(c.weightPercent, 2),
        stdWeight: fmtPct(c.standardWeightPercent, 2),
        score: c.score != null ? fmtNum(c.score, 2) + " / 5" : "-",
        contrib: c.contribution != null ? fmtNum(c.contribution, 3) : "-",
        actual: actualText,
        status: statusMap[c.dataStatus] || c.dataStatus || "-",
      };
    });

    builder.drawTable(
      [
        { key: "no", label: "No", width: 0.35, align: "center" },
        { key: "criterion", label: "Faktor / Kriteria Penilaian", width: 1.75, bold: true },
        { key: "activeWeight", label: "Bobot Aktif", width: 0.72, align: "right" },
        { key: "stdWeight", label: "Bobot Standar", width: 0.78, align: "right" },
        { key: "score", label: "Skor Rerata", width: 0.75, align: "right", bold: true },
        { key: "contrib", label: "Kontribusi", width: 0.72, align: "right" },
        { key: "actual", label: "Kondisi Aktual Lapangan (Data)", width: 2.15 },
        { key: "status", label: "Status Data", width: 0.78, align: "center" },
      ],
      criteriaRows
    );

    // 5. TABEL 3: MATRIKS RINCIAN SEGMEN KAVLING & PARAMETER GEOTEKNIK (INFINITE SLOPE FS)
    builder.drawSectionHeading(
      "4",
      "Tabel Matriks Rincian Segmen Kavling & Geoteknik (Syarat Aman SNI 8460:2017: FS >= 1,50)",
      "Rincian skor 5 kriteria (L=Lereng, T=Tanah, B=Batuan, H=Hujan, PL=Penggunaan Lahan), parameter mekanika tanah, FS_awal, FS_pasca & Koridor SPK."
    );

    const totalPolyArea = loc.areaM2 || 1;
    const segmentRows = (assessment.segments || []).map(function (seg) {
      const rs = seg.rawScores || {};
      const g = seg.geotech || {};
      const zCode = seg.standardZone ? seg.standardZone.code : "unknown";
      const zInfo = ZONE_COLORS[zCode] || ZONE_COLORS.unknown;
      const pctPoly = totalPolyArea > 0 ? ((seg.areaM2 || 0) / totalPolyArea) * 100 : null;
      return {
        segId: seg.segmentId || "-",
        zone: seg.standardZone ? seg.standardZone.label : "Data Kurang",
        area: fmtNum(seg.areaM2, 1) + " m2 (" + fmtPct(pctPoly, 1) + ")",
        slopeDeg: seg.actual && seg.actual.slopeDeg != null ? fmtNum(seg.actual.slopeDeg, 2) + "°" : "-",
        scores5:
          (rs.slope ?? "-") +
          " / " +
          (rs.soil ?? "-") +
          " / " +
          (rs.geology ?? "-") +
          " / " +
          (rs.rainfall ?? "-") +
          " / " +
          (rs.landCover ?? "-"),
        wlcScore:
          (seg.activeScore != null ? fmtNum(seg.activeScore, 2) : "-") +
          (active.profile === "custom" && seg.standardScore != null
            ? " (Std " + fmtNum(seg.standardScore, 2) + ")"
            : ""),
        geotechParams:
          "c'=" +
          fmtNum(g.cKpa, 1) +
          ", cr=" +
          fmtNum(g.crKpa, 1) +
          " kPa | phi'=" +
          fmtNum(g.phiDeg, 1) +
          "° | gamma=" +
          fmtNum(g.gammaSat, 1) +
          " | z=" +
          fmtNum(g.zDepth, 1) +
          "m | m=" +
          fmtNum(g.rasioM, 2) +
          " | q=" +
          fmtNum(g.qKpa, 1),
        fsVal:
          (seg.fs != null ? fmtNum(seg.fs, 2) : "-") +
          (seg.fsPasca != null ? " -> " + fmtNum(seg.fsPasca, 2) : "") +
          (seg.fsLabel ? " (" + seg.fsLabel + ")" : " (Syarat Aman SNI 8460:2017: FS >= 1,50)"),
        _cellFill: { zone: zInfo.fillRgb },
      };
    });

    builder.drawTable(
      [
        { key: "segId", label: "Segmen", width: 0.65, bold: true, align: "center" },
        { key: "zone", label: "Zona Standar", width: 0.92, bold: true, align: "center" },
        { key: "area", label: "Luas (Porsi)", width: 1.05, align: "right" },
        { key: "slopeDeg", label: "Lereng", width: 0.58, align: "right" },
        { key: "scores5", label: "Skor (L/T/B/H/PL)", width: 1.08, align: "center" },
        { key: "wlcScore", label: "Skor WLC", width: 0.78, align: "right", bold: true },
        { key: "geotechParams", label: "Parameter Geoteknik (c', cr, phi', gamma, z, m, q)", width: 2.15 },
        { key: "fsVal", label: "Nilai FS & Status", width: 0.95, align: "right", bold: true },
      ],
      segmentRows.length
        ? segmentRows
        : [
            {
              segId: "-",
              zone: "-",
              area: "-",
              slopeDeg: "-",
              scores5: "-",
              wlcScore: "-",
              geotechParams: "Tidak ada segmen kerawanan yang beririsan.",
              fsVal: "-",
            },
          ],
      { fontSize: 7.6, headerFontSize: 7.8 }
    );

    // 6. TABEL 4: DISTRIBUSI PENGGUNAAN LAHAN (RBI 25K) DI AREA KAVLING
    builder.drawSectionHeading(
      "5",
      "Tabel Distribusi Penggunaan Lahan (RBI 25K) di Area Kavling",
      "Rincian kelas penggunaan lahan hasil irisan spasial poligon kavling terhadap layer Tutupan Lahan RBI 25K DIY."
    );

    const landUseRows = (landUse.classes || []).map(function (cls, idx) {
      return {
        no: String(idx + 1),
        className: cls.className || "-",
        groupLabel: cls.groupLabel || "-",
        featureCount: String(cls.featureCount || 0) + " poligon",
        areaM2: fmtArea(cls.areaM2),
        pctPoly: fmtPct(cls.percentOfPolygon, 1),
      };
    });

    if (landUseRows.length) {
      landUseRows.push({
        no: "-",
        className: "Total Cakupan Data Penggunaan Lahan",
        groupLabel:
          "Tidak tercakup: " + fmtArea(landUse.uncoveredAreaM2),
        featureCount: String((landUse.features || []).length) + " fitur irisan",
        areaM2: fmtArea(landUse.coveredAreaM2),
        pctPoly: fmtPct(landUse.coveragePercent, 1),
        _rowFillRgb: [0.941, 0.961, 0.98],
        _boldKeys: { className: true, areaM2: true, pctPoly: true },
      });
    } else {
      landUseRows.push({
        no: "-",
        className: "Belum ada kelas penggunaan lahan yang beririsan pada area kavling ini",
        groupLabel: "-",
        featureCount: "0",
        areaM2: "0,0 m2",
        pctPoly: "0,0%",
      });
    }

    builder.drawTable(
      [
        { key: "no", label: "No", width: 0.4, align: "center" },
        { key: "className", label: "Jenis Penggunaan / Tutupan Lahan", width: 2.2, bold: true },
        { key: "groupLabel", label: "Kelompok Klasifikasi", width: 1.8 },
        { key: "featureCount", label: "Jumlah Fitur", width: 1.0, align: "center" },
        { key: "areaM2", label: "Luas Irisan", width: 1.2, align: "right" },
        { key: "pctPoly", label: "Proporsi Kavling", width: 1.0, align: "right", bold: true },
      ],
      landUseRows
    );

    // 7. TABEL 5: KESIMPULAN SISTEM, ALTERNATIF PENGEMBANGAN & ARAHAN TINDAK LANJUT
    builder.drawSectionHeading(
      "6",
      "Tabel Kesimpulan Sistem, Arahan Tindak Lanjut & Alternatif Pengembangan",
      "Sintesis hasil evaluasi sistem beserta urutan tindak lanjut verifikasi teknis yang disarankan."
    );

    const followupRows =
      interp && Array.isArray(interp.actions) && interp.actions.length
        ? interp.actions.map(function (act) {
            return {
              order: String(act.presentation ? act.presentation.order : "-"),
              priority: act.presentation ? act.presentation.priorityLabel : "Prioritas",
              title: act.title || "-",
              reason: act.reason || "-",
              basis: act.basis || "-",
            };
          })
        : [
            {
              order: "1",
              priority: "Prioritas",
              title: "Pemeriksaan geoteknik & drainase lapangan",
              reason: interp ? interp.summary : "Verifikasi kondisi lapangan sebelum pengambilan keputusan teknis.",
              basis: "Standar SPK",
            },
          ];

    builder.drawTable(
      [
        { key: "order", label: "No", width: 0.38, align: "center", bold: true },
        { key: "priority", label: "Prioritas", width: 0.85, align: "center", bold: true },
        { key: "title", label: "Arahan Tindak Lanjut", width: 1.85, bold: true },
        { key: "reason", label: "Uraian & Pertimbangan Teknis", width: 2.95 },
        { key: "basis", label: "Dasar Temuan", width: 1.35 },
      ],
      followupRows
    );

    // 8. TABEL 6: KEPUTUSAN PEMERIKSA (HUMAN DECISION)
    builder.drawSectionHeading(
      "7",
      "Tabel Keputusan Pemeriksa & Catatan Verifikasi (Human-in-the-Loop)",
      "Dokumentasi keputusan pengguna/peninjau terhadap hasil analisis Sistem Pendukung Keputusan (SPK)."
    );

    builder.drawTable(
      [
        { key: "field1", label: "Atribut Pemeriksaan", width: 1.3, bold: true },
        { key: "val1", label: "Data Peninjau", width: 2.2 },
        { key: "field2", label: "Atribut Keputusan", width: 1.3, bold: true },
        { key: "val2", label: "Rincian Keputusan", width: 2.8 },
      ],
      [
        {
          field1: "Nama Peninjau / Pemeriksa",
          val1: decision.reviewer || "(Belum diisi)",
          field2: "Status Keputusan Akhir",
          val2: decisionStatusLabel(decision.status),
          _boldKeys: { val1: true, val2: true },
        },
        {
          field1: "Tanggal Pemeriksaan",
          val1: decision.decidedAt || new Date().toISOString().slice(0, 10),
          field2: "Alasan / Pertimbangan",
          val2: decision.rationale || "(Belum ada alasan keputusan yang dicatat)",
        },
        {
          field1: "Status Kesimpulan Sistem",
          val1:
            (interp && interp.status ? interp.status.label : "-") +
            " - " +
            (interp && interp.summary ? interp.summary : ""),
          field2: "Catatan Tambahan / Syarat",
          val2: decision.notes || "-",
        },
      ]
    );

    return builder.compilePdfBytes();
  }

  function suggestedPdfFilename(assessment, record) {
    const id =
      (record && record.reviewId) ||
      (assessment && assessment.assessmentId) ||
      "SPK-" + new Date().toISOString().slice(0, 10);
    const cleanId = String(id).replace(/[^a-zA-Z0-9_-]/g, "_");
    return "Laporan_SPK_LahanAman_" + cleanId + ".pdf";
  }

  async function downloadPdfReport(options) {
    const opts = options || {};
    const pdfBytes = generatePdfBytes(opts);
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    const filename =
      opts.filename || suggestedPdfFilename(opts.assessment, opts.record);

    // 1. Gunakan File System Access API (showSaveFilePicker) agar user dapat memilih tempat penyimpanan laporan
    if (
      typeof window !== "undefined" &&
      typeof window.showSaveFilePicker === "function" &&
      !opts.skipFilePicker
    ) {
      try {
        const fileHandle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [
            {
              description: "Dokumen PDF Laporan SPK (.pdf)",
              accept: { "application/pdf": [".pdf"] },
            },
          ],
        });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        return {
          ok: true,
          method: "file-picker",
          filename: fileHandle.name || filename,
          byteLength: pdfBytes.length,
          blob: blob,
        };
      } catch (err) {
        if (err && err.name === "AbortError") {
          return {
            ok: false,
            cancelled: true,
            filename: filename,
            message: "Penyimpanan laporan PDF dibatalkan oleh pengguna.",
          };
        }
        // Jika showSaveFilePicker gagal karena izin konteks/browser, lanjutkan ke fallback anchor download
      }
    }

    // 2. Fallback unduh Blob PDF standar melalui elemen <a download>
    if (
      typeof document !== "undefined" &&
      typeof URL !== "undefined" &&
      typeof URL.createObjectURL === "function"
    ) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1500);
      return {
        ok: true,
        method: "anchor-download",
        filename: filename,
        byteLength: pdfBytes.length,
        blob: blob,
      };
    }

    return {
      ok: true,
      method: "memory-only",
      filename: filename,
      byteLength: pdfBytes.length,
      blob: blob,
      bytes: pdfBytes,
    };
  }

  return {
    renderKavlingMapCanvas: renderKavlingMapCanvas,
    captureKavlingJpeg: captureKavlingJpeg,
    buildReportModel: buildReportModel,
    generatePdfBytes: generatePdfBytes,
    suggestedPdfFilename: suggestedPdfFilename,
    downloadPdfReport: downloadPdfReport,
  };
});
