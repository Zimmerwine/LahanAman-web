(function (root) {
  "use strict";

  const Engine = root.LahanAmanSPK;
  const Constraints = root.LahanAmanSPKConstraints;
  const Recommendation = root.LahanAmanSPKRecommendation;
  const Store = root.LahanAmanSPKStore;
  const LandUse = root.LahanAmanLandUse;
  const SensitiveAreas = root.LahanAmanSensitiveAreas;

  const TABS = [
    { id: "summary", label: "Ringkasan SPK" },
    { id: "criteria", label: "Analisis Kriteria" },
    { id: "slope", label: "Stabilitas Lereng" },
    { id: "development", label: "Alternatif Pengembangan" },
    { id: "constraints", label: "Pembatas Spasial" },
    { id: "decision", label: "Keputusan Pengguna" },
  ];

  const state = {
    open: false,
    view: "config",
    profile: "standard",
    importance: Object.assign({}, Engine ? Engine.DEFAULT_IMPORTANCE : {}),
    assessment: null,
    appliedConfig: null,
    activeTab: "summary",
    selectedSegmentId: null,
    formDraft: null,
    savedRecord: null,
    error: null,
    lastFocus: null,
  };

  let els = {};
  let initialized = false;

  function bridge() {
    return root.LahanAmanSPKBridge || null;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmt(value, digits) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "-";
    return number.toLocaleString("id-ID", {
      minimumFractionDigits: digits == null ? 2 : digits,
      maximumFractionDigits: digits == null ? 2 : digits,
    });
  }

  function fmtArea(value) {
    if (!Number.isFinite(Number(value))) return "-";
    return fmt(value, 1) + " m²";
  }

  function fmtPercent(value, digits) {
    if (!Number.isFinite(Number(value))) return "-";
    return fmt(value, digits == null ? 1 : digits) + "%";
  }

  function pctWidth(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(100, number));
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function configFromState() {
    return Engine.createConfig(
      state.profile,
      state.profile === "custom" ? state.importance : null
    );
  }

  function sameConfig(a, b) {
    if (!a || !b || a.profile !== b.profile) return false;
    if (a.profile !== "custom") return true;
    return Engine.CRITERION_KEYS.every(function (key) {
      return Number(a.importance[key]) === Number(b.importance[key]);
    });
  }

  function context() {
    const api = bridge();
    if (!api || typeof api.getContext !== "function") return null;
    const ctx = api.getContext();
    if (!ctx || !Array.isArray(ctx.segments) || !ctx.segments.length) return null;
    return ctx;
  }

  function init() {
    if (initialized) return;
    if (!root.document) return;
    if (!Engine || !Constraints || !Recommendation || !Store || !LandUse || !SensitiveAreas) {
      console.error("[SPK] Modul SPK tidak lengkap.");
      return;
    }
    els = {
      overlay: document.getElementById("spk-overlay"),
      drawer: document.getElementById("spk-drawer"),
      body: document.getElementById("spk-body"),
      progress: document.getElementById("spk-progress"),
      subtitle: document.getElementById("spk-subtitle"),
      close: document.getElementById("btn-close-spk"),
      backdrop: document.getElementById("spk-backdrop"),
      open: document.getElementById("btn-open-spk"),
    };
    if (!els.overlay || !els.drawer || !els.body) return;
    initialized = true;

    if (els.close) els.close.addEventListener("click", close);
    if (els.backdrop) els.backdrop.addEventListener("click", close);
    if (els.open) {
      els.open.addEventListener("click", function (event) {
        event.preventDefault();
        open({ source: "header" });
      });
    }
    document.addEventListener("keydown", onGlobalKeydown);
  }

  function onGlobalKeydown(event) {
    if (!state.open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab" || !els.drawer) return;
    const focusable = els.drawer.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function open(options) {
    const opts = options || {};
    if (!initialized) init();
    if (!els.overlay) return;
    state.lastFocus = document.activeElement;
    if (opts.source === "polygon" && state.assessment) state.view = "results";
    else if (opts.source === "polygon") state.view = "config";
    if (opts.tab) {
      state.activeTab = opts.tab;
      state.view = "results";
    }
    els.overlay.hidden = false;
    document.body.classList.add("spk-open");
    state.open = true;
    render();
    requestAnimationFrame(function () {
      if (els.close) els.close.focus();
    });
  }

  function close() {
    if (!els.overlay) return;
    els.overlay.hidden = true;
    document.body.classList.remove("spk-open");
    state.open = false;
    if (state.lastFocus && typeof state.lastFocus.focus === "function") {
      state.lastFocus.focus();
    }
  }

  function notifyPolygonUpdated() {
    state.assessment = null;
    state.appliedConfig = null;
    state.selectedSegmentId = null;
    state.formDraft = null;
    state.savedRecord = null;
    state.error = null;
    state.activeTab = "summary";
    state.view = "config";
    const api = bridge();
    if (api && typeof api.clearAssessment === "function") api.clearAssessment();
    if (state.open) render();
  }

  function handlePolygonCleared() {
    state.assessment = null;
    state.appliedConfig = null;
    state.selectedSegmentId = null;
    state.formDraft = null;
    state.savedRecord = null;
    state.error = null;
    state.activeTab = "summary";
    state.view = "config";
    if (state.open) render();
  }

  function render() {
    if (!state.open) return;
    renderProgress();
    if (state.view === "results" && state.assessment) renderResults();
    else renderConfig();
  }

  function renderProgress() {
    if (!els.progress) return;
    const results = state.view === "results" && state.assessment;
    const decision = results && state.activeTab === "decision";
    const steps = [
      { label: "Parameter", status: "done" },
      {
        label: "Evaluasi",
        status: results ? (decision ? "done" : "active") : "active",
      },
      {
        label: "Keputusan",
        status: decision ? "active" : results ? "pending" : "pending",
      },
    ];
    els.progress.innerHTML = steps
      .map(function (step, index) {
        return (
          '<span class="spk-progress-step ' +
          (step.status === "active" ? "is-active " : "") +
          (step.status === "done" ? "is-done" : "") +
          '"><b>' +
          (step.status === "done" ? "✓" : String(index + 1)) +
          "</b>" +
          escapeHtml(step.label) +
          "</span>"
        );
      })
      .join("");
  }

  function updateSubtitle() {
    if (!els.subtitle) return;
    if (state.assessment) {
      const area =
        state.assessment.location && state.assessment.location.areaM2 != null
          ? fmtArea(state.assessment.location.areaM2)
          : "luas tidak tersedia";
      els.subtitle.textContent =
        state.assessment.assessmentId +
        " • " +
        state.assessment.active.label +
        " • " +
        area;
    } else {
      els.subtitle.textContent =
        "WLC, stabilitas lereng, pembatas spasial, dan keputusan pengguna.";
    }
  }

  function renderConfig() {
    updateSubtitle();
    const ctx = context();
    state.view = "config";
    if (!ctx) {
      els.body.innerHTML =
        renderError() +
        '<section class="spk-section"><div class="spk-empty">' +
        '<div class="spk-empty-icon"><svg class="icon" aria-hidden="true"><use href="#icon-polygon"></use></svg></div>' +
        "<h3>Poligon kavling belum tersedia</h3>" +
        "<p>SPK mengevaluasi poligon yang sudah dianalisis. Gambar poligon kavling terlebih dahulu, lalu buka kembali analisis SPK.</p>" +
        '<div class="spk-empty-actions">' +
        '<button type="button" class="btn btn-primary" id="spk-empty-draw">Gambar poligon</button>' +
        '<button type="button" class="btn btn-secondary" id="spk-empty-sample">Gunakan sampel</button>' +
        "</div></div></section>";
      bindEmptyActions();
      return;
    }

    const summary = ctx.summary || {};
    const area = ctx.polygonAreaM2;
    const coverage = summary.persen_cakupan;
    const config = configFromState();
    const custom = config.profile === "custom";
    const active = state.assessment;
    const activeLabel = active ? active.active.label : "Belum ada evaluasi";

    const coverageWarning =
      Number(coverage) < 80
        ? '<div class="spk-alert spk-alert--warn"><span class="spk-alert-title">Cakupan data terbatas</span><span class="spk-alert-text">Hanya ' +
          fmtPercent(coverage) +
          " luas poligon yang tercakup layer kerawanan. Bagian yang tidak tercakup tidak boleh dianggap aman.</span></div>"
        : "";

    const activeWarning = active
      ? '<div class="spk-alert spk-alert--info"><span class="spk-alert-title">Evaluasi aktif: ' +
        escapeHtml(active.active.label) +
        "</span><span class=\"spk-alert-text\">" +
        escapeHtml(active.assessmentId) +
        ". Mengubah parameter akan meminta konfirmasi sebelum mengganti evaluasi ini.</span></div>"
      : "";

    const weightsHtml = custom
      ? renderWeights(config)
      : '<div class="spk-alert spk-alert--info"><span class="spk-alert-title">Bobot riset standar</span><span class="spk-alert-text">Lereng 30%, tanah 25%, geologi 20%, curah hujan 15%, tutupan lahan 10%. Profil ini mereproduksi skor GPKG yang sudah ada.</span></div>';

    els.body.innerHTML =
      renderError() +
      '<section class="spk-section">' +
      '<div class="spk-location-card">' +
      '<div class="spk-section-head"><div><p class="panel-eyebrow">Lokasi evaluasi</p><h3>Poligon kavling</h3>' +
      '<p>' +
      escapeHtml(activeLabel) +
      " • " +
      escapeHtml(String((ctx.segments || []).length)) +
      " segmen</p></div>" +
      '<span class="spk-tag">' +
      escapeHtml(ctx.crs || "EPSG:4326") +
      "</span></div>" +
      '<div class="spk-location-grid">' +
      metric("Luas poligon", fmtArea(area), "Batas poligon yang dievaluasi") +
      metric("Cakupan data", coverage != null ? fmtPercent(coverage) : "-", fmtArea(summary.total_luas_m2) + " terklasifikasi") +
      metric("Segmen", String((ctx.segments || []).length), "Hasil overlay kerawanan") +
      "</div></div></section>" +
      coverageWarning +
      activeWarning +
      '<section class="spk-section">' +
      '<div class="spk-section-head"><div><h3>Pilih profil bobot</h3><p>Nilai kepentingan 1–5 berbeda dari skor kriteria 1–5. Bobot dinormalisasi sampai total 100%.</p></div></div>' +
      '<div class="spk-profile-grid">' +
      renderProfileCard("standard", "Profil riset standar", "30/25/20/15/10", "Terdefinisi dan terkalibrasi pada skor GPKG. Gunakan untuk mereproduksi hasil riset.", !custom) +
      renderProfileCard("custom", "Profil kustom", "5/4/3/3/2", "Bobot dinamis sesuai preferensi pengguna. Belum dikalibrasi; ambang zona standar tidak dipakai.", custom) +
      "</div>" +
      weightsHtml +
      "</section>" +
      '<section class="spk-section">' +
      '<div class="spk-actions">' +
      '<button type="button" class="btn btn-primary" id="spk-run">Jalankan evaluasi</button>' +
      (active ? '<button type="button" class="btn btn-secondary" id="spk-view-last">Lihat hasil terakhir</button>' : "") +
      '<button type="button" class="btn btn-secondary" id="spk-config-cancel">Tutup</button>' +
      "</div>" +
      '<p class="spk-inline-note">Evaluasi memakai skor kriteria mentah, bukan skor akhir GPKG. FS dihitung terpisah. Data pembatas legal yang tidak tersedia akan ditandai belum dievaluasi.</p>' +
      "</section>";

    bindConfigEvents();
  }

  function renderError() {
    if (!state.error) return "";
    return (
      '<div class="spk-alert spk-alert--error"><span class="spk-alert-title">Evaluasi gagal</span><span class="spk-alert-text">' +
      escapeHtml(state.error) +
      "</span></div>"
    );
  }

  function metric(label, value, sub) {
    return (
      '<div class="spk-metric"><span class="spk-metric-label">' +
      escapeHtml(label) +
      '</span><span class="spk-metric-value">' +
      escapeHtml(value) +
      "</span>" +
      (sub ? '<span class="spk-metric-sub">' + escapeHtml(sub) + "</span>" : "") +
      "</div>"
    );
  }

  function renderProfileCard(profile, title, weights, note, selected) {
    return (
      '<label class="spk-profile-card ' +
      (selected ? "is-selected" : "") +
      '" data-profile="' +
      profile +
      '">' +
      '<input type="radio" name="spk-profile" value="' +
      profile +
      '"' +
      (selected ? " checked" : "") +
      ">" +
      '<span class="spk-profile-head"><span class="spk-profile-title">' +
      escapeHtml(title) +
      '</span><span class="spk-profile-radio" aria-hidden="true"></span></span>' +
      '<span class="spk-profile-weights">' +
      escapeHtml(weights) +
      "</span>" +
      '<span class="spk-profile-note">' +
      escapeHtml(note) +
      "</span></label>"
    );
  }

  function renderWeights(config) {
    const total = Engine.CRITERION_KEYS.reduce(function (sum, key) {
      return sum + Number(state.importance[key] || 0);
    }, 0);
    return (
      '<div class="spk-weight-list" id="spk-weight-list">' +
      Engine.CRITERIA.map(function (criterion) {
        const importance = Number(state.importance[criterion.key] || 0);
        const weight = total > 0 ? (importance / total) * 100 : 0;
        return (
          '<div class="spk-weight-row" data-weight-key="' +
          criterion.key +
          '">' +
          '<span class="spk-weight-label"><b>' +
          escapeHtml(criterion.label) +
          "</b><span>" +
          escapeHtml(criterion.source) +
          "</span></span>" +
          '<input class="spk-weight-track" type="range" min="1" max="5" step="1" value="' +
          importance +
          '" data-importance-key="' +
          criterion.key +
          '" aria-label="Kepentingan ' +
          escapeHtml(criterion.label) +
          '">' +
          '<span class="spk-weight-value" data-weight-value="' +
          criterion.key +
          '">' +
          fmtPercent(weight) +
          "</span></div>"
        );
      }).join("") +
      '<div class="spk-weight-total"><span>Total kepentingan</span><span><b id="spk-weight-total-value">' +
      total +
      '</b> • bobot dinormalisasi 100% <button type="button" class="text-button" id="spk-reset-weights">Reset 5/4/3/3/2</button></span></div>' +
      "</div>"
    );
  }

  function bindEmptyActions() {
    const draw = document.getElementById("spk-empty-draw");
    if (draw) {
      draw.addEventListener("click", function () {
        const api = bridge();
        close();
        if (api && typeof api.startDrawing === "function") api.startDrawing();
      });
    }
    const sample = document.getElementById("spk-empty-sample");
    if (sample) {
      sample.addEventListener("click", function () {
        const api = bridge();
        close();
        if (api && typeof api.loadSample === "function") api.loadSample();
      });
    }
  }

  function bindConfigEvents() {
    const profileCards = els.body.querySelectorAll("[data-profile]");
    profileCards.forEach(function (card) {
      card.addEventListener("click", function (event) {
        event.preventDefault();
        state.profile = card.getAttribute("data-profile");
        state.error = null;
        renderConfig();
      });
    });

    els.body.querySelectorAll("[data-importance-key]").forEach(function (input) {
      input.addEventListener("input", function () {
        const key = input.getAttribute("data-importance-key");
        const value = Number(input.value);
        if (!Number.isInteger(value) || value < 1 || value > 5) return;
        state.importance[key] = value;
        updateWeightPreview();
      });
    });

    const resetWeights = document.getElementById("spk-reset-weights");
    if (resetWeights) {
      resetWeights.addEventListener("click", function () {
        state.importance = Object.assign({}, Engine.DEFAULT_IMPORTANCE);
        renderConfig();
      });
    }

    const run = document.getElementById("spk-run");
    if (run) run.addEventListener("click", runEvaluation);
    const viewLast = document.getElementById("spk-view-last");
    if (viewLast) {
      viewLast.addEventListener("click", function () {
        state.view = "results";
        state.error = null;
        render();
      });
    }
    const cancel = document.getElementById("spk-config-cancel");
    if (cancel) cancel.addEventListener("click", close);
  }

  function updateWeightPreview() {
    const total = Engine.CRITERION_KEYS.reduce(function (sum, key) {
      return sum + Number(state.importance[key] || 0);
    }, 0);
    Engine.CRITERION_KEYS.forEach(function (key) {
      const el = els.body.querySelector('[data-weight-value="' + key + '"]');
      if (el) {
        const value = total > 0 ? (Number(state.importance[key]) / total) * 100 : 0;
        el.textContent = fmtPercent(value);
      }
    });
    const totalEl = document.getElementById("spk-weight-total-value");
    if (totalEl) totalEl.textContent = String(total);
  }

  function runEvaluation() {
    const ctx = context();
    if (!ctx) {
      state.error = "Poligon kavling belum tersedia.";
      renderConfig();
      return;
    }
    let config;
    try {
      config = configFromState();
    } catch (error) {
      state.error = error.message;
      renderConfig();
      return;
    }
    if (state.assessment && !sameConfig(state.assessment.config, config)) {
      const approved = root.confirm(
        "Konfigurasi baru akan mengganti evaluasi aktif " +
          state.assessment.assessmentId +
          ". Lanjutkan?"
      );
      if (!approved) return;
    }
    try {
      const assessment = Engine.buildAssessment({
        segments: ctx.segments,
        geometry: ctx.geometry || null,
        polygonAreaM2: ctx.polygonAreaM2,
        summary: ctx.summary,
        config: config,
        landUse: ctx.landUse || null,
        sensitiveAreas: ctx.sensitiveAreas || null,
      });
      const constraintResult = Constraints.evaluateConstraints(assessment);
      assessment.constraints = constraintResult;
      assessment.recommendations = Recommendation.evaluateRecommendations(assessment, constraintResult);
      state.assessment = assessment;
      state.appliedConfig = clone(assessment.config);
      state.profile = assessment.config.profile;
      if (assessment.config.importance) {
        state.importance = Object.assign({}, assessment.config.importance);
      }
      state.selectedSegmentId = null;
      state.formDraft = null;
      state.savedRecord = null;
      state.error = null;
      state.view = "results";
      state.activeTab = "summary";
      if (bridge() && typeof bridge().applyAssessment === "function") {
        bridge().applyAssessment(assessment);
      }
      render();
      if (els.body) els.body.scrollTop = 0;
    } catch (error) {
      state.error = error.message;
      renderConfig();
    }
  }

  function renderResults() {
    const assessment = state.assessment;
    if (!assessment) {
      renderConfig();
      return;
    }
    updateSubtitle();
    const evalError = renderError();
    const head = renderResultHead(assessment);
    const tabs = renderTabs();
    const panel = renderActiveTab(assessment);
    els.body.innerHTML = evalError + head + tabs + panel;
    bindResultEvents();
    if (state.selectedSegmentId) {
      const row = els.body.querySelector('[data-segment-id="' + state.selectedSegmentId + '"]');
      if (row) row.classList.add("is-selected");
    }
  }

  function renderResultHead(assessment) {
    const active = assessment.active;
    const coverage = assessment.location.coverageRatio;
    const fsMin = assessment.infiniteSlope ? assessment.infiniteSlope.min : null;
    const custom = active.profile === "custom";
    const activeClass = active.classification ? active.classification.label : "Tidak diklasifikasikan";
    const standardClass = assessment.standard.classification
      ? assessment.standard.classification.label
      : "Tidak tersedia";
    const warnings = assessment.dataCompleteness.warnings || [];
    const legalUnknown =
      assessment.constraints &&
      assessment.constraints.summary &&
      assessment.constraints.summary.hasUnknownBindingConstraints;
    const alerts = [];
    if (custom) {
      alerts.push(
        '<div class="spk-alert spk-alert--warn"><span class="spk-alert-title">Indeks kustom belum terkalibrasi</span><span class="spk-alert-text">Nilai ini bukan zona resmi dan tidak memakai ambang 2,20/3,40. Gunakan skor riset standar sebagai pembanding.</span></div>'
      );
    }
    warnings.slice(0, 2).forEach(function (warning) {
      alerts.push(
        '<div class="spk-alert spk-alert--warn"><span class="spk-alert-title">Perhatian data</span><span class="spk-alert-text">' +
          escapeHtml(warning) +
          "</span></div>"
      );
    });
    if (legalUnknown) {
      alerts.push(
        '<div class="spk-alert spk-alert--error"><span class="spk-alert-title">Pembatas legal belum tersedia</span><span class="spk-alert-text">RTRW, kawasan lindung, dan sempadan belum dapat diverifikasi. Hasil WLC bukan izin dan tidak membuktikan tidak adanya batasan.</span></div>'
      );
    }

    return (
      '<section class="spk-section"><div class="spk-result-head">' +
      '<div class="spk-result-title-row"><div><p class="panel-eyebrow">Hasil evaluasi</p><h3>' +
      escapeHtml(assessment.assessmentId) +
      "</h3><p>" +
      escapeHtml(active.label) +
      " • " +
      escapeHtml(new Date(assessment.createdAt).toLocaleString("id-ID")) +
      "</p></div>" +
      '<div style="display:flex;align-items:center;gap:4px;flex-shrink:0;"><span class="spk-tag">' +
      escapeHtml(active.calibrated ? "TERKALIBRASI" : "BELUM TERKALIBRASI") +
      '</span><button type="button" class="btn btn-secondary" id="spk-edit-config" style="height:26px;padding:0 8px;font-size:9px;">Ubah parameter</button></div></div>' +
      '<div class="spk-score-grid">' +
      scoreCard(custom ? "Indeks kustom" : "Skor WLC", fmt(active.score, 2), activeClass, true) +
      scoreCard("Skor riset standar", fmt(assessment.standard.score, 2), standardClass, false) +
      scoreCard("FS minimum", fsMin != null ? fmt(fsMin, 2) : "-", "Terpisah dari WLC", false) +
      scoreCard("Cakupan data", coverage != null ? fmtPercent(coverage * 100) : "-", fmtArea(assessment.location.coveredAreaM2), false) +
      "</div>" +
      alerts.join("") +
      "</div></section>"
    );
  }

  function scoreCard(label, value, sub, primary) {
    return (
      '<div class="spk-score-card ' +
      (primary ? "is-primary" : "") +
      '"><span class="spk-score-label">' +
      escapeHtml(label) +
      '</span><span class="spk-score-value">' +
      escapeHtml(value) +
      '</span><span class="spk-score-sub">' +
      escapeHtml(sub) +
      "</span></div>"
    );
  }

  function renderTabs() {
    return (
      '<div class="spk-tabs" role="tablist" aria-label="Bagian hasil SPK">' +
      TABS.map(function (tab) {
        return (
          '<button type="button" class="spk-tab ' +
          (state.activeTab === tab.id ? "is-active" : "") +
          '" role="tab" aria-selected="' +
          String(state.activeTab === tab.id) +
          '" data-spk-tab="' +
          tab.id +
          '">' +
          escapeHtml(tab.label) +
          "</button>"
        );
      }).join("") +
      "</div>"
    );
  }

  function renderActiveTab(assessment) {
    switch (state.activeTab) {
      case "criteria":
        return renderCriteriaTab(assessment);
      case "slope":
        return renderSlopeTab(assessment);
      case "development":
        return renderDevelopmentTab(assessment);
      case "constraints":
        return renderConstraintsTab(assessment);
      case "decision":
        return renderDecisionTab(assessment);
      default:
        return renderSummaryTab(assessment);
    }
  }

  function renderSummaryTab(assessment) {
    const z = assessment.standard.zoneDistribution;
    const total = assessment.location.areaM2;
    const classArea = z.hijau.areaM2 + z.kuning.areaM2 + z.merah.areaM2;
    const gapPct = total > 0 ? Math.max(0, 100 - (classArea / total) * 100) : 0;
    const active = assessment.active;
    const highest = active.highestSegment;
    const lowest = active.lowestSegment;
    const custom = active.profile === "custom";

    return (
      '<div class="spk-section">' +
      '<div class="spk-alert spk-alert--info"><span class="spk-alert-title">' +
      escapeHtml(custom ? "Indeks kustom sebagai pembanding" : "Skor WLC standar") +
      '</span><span class="spk-alert-text">' +
      escapeHtml(
        custom
          ? "Zona di bawah adalah klasifikasi riset standar untuk konteks, bukan klasifikasi indeks kustom."
          : "Skor WLC berasal dari lima skor kriteria mentah dan bobot riset. Infinite Slope FS ditampilkan terpisah."
      ) +
      "</span></div>" +
      '<div class="spk-kpi-grid">' +
      kpi("Segmen", String(assessment.location.segmentCount), assessment.location.completeSegmentCount + " segmen lengkap") +
      kpi("Luas poligon", fmtArea(total), assessment.location.coveredAreaM2 + " m² tercakup") +
      kpi("Skor WLC aktif", fmt(active.score, 2), active.label) +
      kpi("FS minimum", assessment.infiniteSlope.min != null ? fmt(assessment.infiniteSlope.min, 2) : "-", assessment.infiniteSlope.classification ? assessment.infiniteSlope.classification.label : "tidak tersedia") +
      "</div>" +
      '<div class="spk-stack"><div class="spk-section-head"><div><h3>Distribusi zona riset standar</h3><p>Persentase dihitung terhadap luas poligon; area yang tidak tercakup tetap terlihat.</p></div></div>' +
      '<div class="spk-stack-bar" role="img" aria-label="Distribusi zona">' +
      '<span class="spk-stack-seg hijau" style="width:' + pctWidth(z.hijau.percentOfPolygon) + '%"></span>' +
      '<span class="spk-stack-seg kuning" style="width:' + pctWidth(z.kuning.percentOfPolygon) + '%"></span>' +
      '<span class="spk-stack-seg merah" style="width:' + pctWidth(z.merah.percentOfPolygon) + '%"></span>' +
      '<span class="spk-stack-seg gap" style="width:' + pctWidth(gapPct) + '%"></span>' +
      "</div>" +
      '<div class="spk-stack-legend">' +
      legend("hijau", "Hijau", z.hijau.percentOfPolygon) +
      legend("kuning", "Kuning", z.kuning.percentOfPolygon) +
      legend("merah", "Merah", z.merah.percentOfPolygon) +
      legend("gap", "Tidak tercakup", gapPct) +
      "</div></div>" +
      '<div class="spk-kpi-grid" style="margin-top:8px;">' +
      kpi(
        active.profile === "custom" ? "Segmen indeks tertinggi" : "Segmen skor tertinggi",
        highest ? escapeHtml(highest.segmentId) : "-",
        highest ? fmt(highest.score, 2) + " • " + fmtArea(highest.areaM2) : "tidak tersedia"
      ) +
      kpi(
        active.profile === "custom" ? "Segmen indeks terendah" : "Segmen skor terendah",
        lowest ? escapeHtml(lowest.segmentId) : "-",
        lowest ? fmt(lowest.score, 2) + " • " + fmtArea(lowest.areaM2) : "tidak tersedia"
      ) +
      "</div>" +
      '<div class="spk-alert spk-alert--info"><span class="spk-alert-title">Cara membaca hasil</span><span class="spk-alert-text">Skor WLC menunjukkan kerawanan relatif dari lima kriteria. FS menunjukkan kestabilan lereng dan tidak boleh digabungkan ke WLC. Keduanya harus dibaca bersama pembatas legal dan verifikasi lapangan.</span></div>' +
      '<details class="spk-section"><summary class="spk-section-desc" style="cursor:pointer;color:var(--blue);font-weight:600;">Metode, sumber data, dan batasan</summary>' +
      '<div class="spk-source-list">' +
      assessment.metadata.datasetRefs.map(function (source) { return "<code>" + escapeHtml(source) + "</code>"; }).join("") +
      "</div>" +
      '<div class="spk-disclaimer"><b>Batasan:</b> ' +
      escapeHtml(assessment.metadata.limitations.join(" ")) +
      "</div></details></div>"
    );
  }

  function kpi(label, value, sub) {
    return (
      '<div class="spk-kpi"><span class="spk-kpi-label">' +
      escapeHtml(label) +
      '</span><span class="spk-kpi-value">' +
      escapeHtml(value) +
      '</span><span class="spk-kpi-sub">' +
      escapeHtml(sub) +
      "</span></div>"
    );
  }

  function legend(tone, label, percent) {
    return (
      '<span><span class="spk-dot ' +
      tone +
      '"></span>' +
      escapeHtml(label) +
      " <b>" +
      fmtPercent(percent) +
      "</b></span>"
    );
  }

  function renderCriteriaTab(assessment) {
    const custom = assessment.active.profile === "custom";
    const criteria = assessment.criteria;
    const rows = assessment.segments
      .map(function (segment) {
        const scores = Engine.CRITERION_KEYS.map(function (key) {
          return segment.rawScores[key] != null ? String(segment.rawScores[key]) : "–";
        });
        const hasMissing = segment.missing && segment.missing.length;
        return (
          '<tr data-segment-id="' +
          escapeHtml(segment.segmentId) +
          '" class="' +
          (state.selectedSegmentId === segment.segmentId ? "is-selected" : "") +
          '">' +
          '<td><span class="seg-name">' +
          escapeHtml(segment.segmentId) +
          "</span>" +
          (hasMissing ? ' <span class="seg-missing">data kurang</span>' : "") +
          "</td>" +
          scores.map(function (score) { return "<td>" + score + "</td>"; }).join("") +
          "<td><b>" + (segment.activeScore != null ? fmt(segment.activeScore, 2) : "–") + "</b></td>" +
          "<td>" + (segment.fs != null ? fmt(segment.fs, 2) : "–") + "</td>" +
          "</tr>"
        );
      })
      .join("");

    return (
      '<div class="spk-section">' +
      '<div class="spk-section-head"><div><h3>Skor kriteria dan bobot</h3><p>Skor 1 = kontribusi rendah, 5 = kontribusi tinggi terhadap kerawanan. Bobot kustom berasal dari nilai kepentingan 1–5 yang dinormalisasi.</p></div>' +
      '<span class="spk-tag">' +
      escapeHtml(custom ? "KUSTOM" : "STANDAR") +
      "</span></div>" +
      '<div class="spk-criteria-list">' +
      criteria
        .map(function (criterion) {
          const score = criterion.score;
          const bar = score != null ? pctWidth((score / 5) * 100) : 0;
          const standardNote = custom
            ? "Riset " + fmtPercent(criterion.standardWeightPercent) + "."
            : "Bobot " + fmtPercent(criterion.standardWeightPercent) + ".";
          return (
            '<div class="spk-criterion">' +
            '<div class="spk-criterion-head"><div><div class="spk-criterion-title">' +
            escapeHtml(criterion.label) +
            '</div><div class="spk-criterion-meta"><span>Skor <b>' +
            (score != null ? fmt(score, 2) : "–") +
            "</b></span><span>" +
            (custom ? "Kepentingan <b>" + criterion.importance + "</b>" : "Bobot <b>" + fmtPercent(criterion.weightPercent) + "</b>") +
            "</span><span>Kontribusi <b>" +
            (criterion.contribution != null ? fmt(criterion.contribution, 3) : "–") +
            "</b></span><span>" +
            escapeHtml(criterion.dataStatus === "complete" ? "lengkap" : criterion.dataStatus === "partial" ? "sebagian" : "tidak tersedia") +
            "</span></div></div>" +
            '<span class="spk-criterion-score">' +
            (score != null ? fmt(score, 1) : "–") +
            "</span></div>" +
            '<div class="spk-criterion-bar"><span style="width:' + bar + '%"></span></div>' +
            '<div class="spk-criterion-actual">' +
            escapeHtml(criterion.actualSummary != null ? formatActual(criterion.key, criterion.actualSummary) : "Nilai aktual tidak tersedia.") +
            " " +
            escapeHtml(standardNote) +
            "</div></div>"
          );
        })
        .join("") +
      "</div></div>" +
      '<div class="spk-section"><div class="spk-section-head"><div><h3>Matriks segmen</h3><p>Klik baris atau segmen di peta untuk menyorot dan memeriksa segmen.</p></div></div>' +
      '<div class="spk-table-wrap"><table class="spk-table"><thead><tr><th>Segmen</th><th>Lereng</th><th>Tanah</th><th>Geologi</th><th>Hujan</th><th>Lahan</th><th>WLC</th><th>FS</th></tr></thead><tbody>' +
      rows +
      "</tbody></table></div>" +
      '<p class="spk-inline-note">Tanda “data kurang” berarti skor kriteria tidak lengkap. Segmen tersebut tidak diikutkan dalam agregasi WLC.</p></div>'
    );
  }

  function formatActual(key, value) {
    if (value == null) return "-";
    if (key === "slope") return "Kemiringan aktual: " + fmt(value, 2) + " derajat.";
    if (key === "rainfall") return "Curah hujan aktual: " + fmt(value, 0) + " mm/tahun.";
    return "Nilai dominan: " + String(value) + ".";
  }

  function renderSlopeTab(assessment) {
    const slope = assessment.infiniteSlope;
    const worst = slope.worstSegment;
    const worstSegment = worst
      ? assessment.segments.find(function (segment) { return segment.segmentId === worst.segmentId; })
      : null;
    const geo = worstSegment ? worstSegment.geotech : null;
    const counts = slope.counts || { stabil: 0, kritis: 0, labil: 0 };
    return (
      '<div class="spk-section">' +
      '<div class="spk-alert spk-alert--warn"><span class="spk-alert-title">FS tidak digabungkan ke WLC</span><span class="spk-alert-text">Infinite Slope FS dihitung terpisah dari skor kerawanan. Jangan menambahkan atau mengalikan FS ke WLC. FS minimum adalah indikator kestabilan yang harus diperiksa bersama WLC.</span></div>' +
      '<div class="spk-fs-grid">' +
      kpi("FS minimum", slope.min != null ? fmt(slope.min, 2) : "-", slope.classification ? slope.classification.label : "tidak tersedia") +
      kpi("FS rerata", slope.mean != null ? fmt(slope.mean, 2) : "-", "Berbobot luas segmen") +
      kpi("FS maksimum", slope.max != null ? fmt(slope.max, 2) : "-", "Segmen paling stabil") +
      "</div>" +
      '<div class="spk-kpi-grid" style="margin-top:8px;">' +
      kpi("FS > 1,25", String(counts.stabil || 0), "Segmen stabil") +
      kpi("FS 1,07–1,25", String(counts.kritis || 0), "Segmen kritis") +
      kpi("FS < 1,07", String(counts.labil || 0), "Segmen labil") +
      kpi("Segmen kritis", worst ? escapeHtml(worst.segmentId) : "-", worst ? fmtArea(worst.areaM2) : "tidak tersedia") +
      "</div>" +
      (geo
        ? '<div class="spk-section" style="margin-top:12px;"><div class="spk-section-head"><div><h3>Parameter segmen terlemah</h3><p>' +
          escapeHtml(worst.segmentId) +
          " • " +
          escapeHtml(worst.label || "FS tidak berlabel") +
          "</p></div></div>" +
          '<div class="spk-geotech">' +
          metric("c'", geo.cKpa != null ? fmt(geo.cKpa, 1) + " kPa" : "-", "Kohesi") +
          metric("φ'", geo.phiDeg != null ? fmt(geo.phiDeg, 1) + "°" : "-", "Sudut geser") +
          metric("γsat", geo.gammaSat != null ? fmt(geo.gammaSat, 1) : "-", "kN/m³") +
          metric("z", geo.zDepth != null ? fmt(geo.zDepth, 2) + " m" : "-", "Kedalaman bidang") +
          metric("m", geo.rasioM != null ? fmt(geo.rasioM, 2) : "-", "Rasio muka air") +
          metric("q", geo.qKpa != null ? fmt(geo.qKpa, 1) + " kPa" : "-", "Beban permukaan") +
          "</div></div>"
        : "") +
      '<div class="spk-disclaimer"><b>Ambang FS:</b> stabil &gt; 1,25; kritis 1,07–1,25; labil &lt; 1,07. Ambang ini terpisah dari ambang zona WLC.</div>' +
      '<p class="spk-inline-note">FS minimum lebih penting daripada rerata untuk peringatan awal. Segmen dengan FS rendah harus diperiksa secara individual.</p></div>'
    );
  }

  function renderDevelopmentTab(assessment) {
    const rec = assessment.recommendations;
    if (!rec) return '<div class="spk-alert spk-alert--warn">Rekomendasi belum tersedia.</div>';
    const summary = rec.summary;
    const tone = summary.status === "perlu_perhatian_tinggi" ? "error" : "info";
    return (
      '<div class="spk-section">' +
      '<div class="spk-alert spk-alert--' +
      tone +
      '"><span class="spk-alert-title">' +
      escapeHtml(summary.title) +
      '</span><span class="spk-alert-text">' +
      escapeHtml(summary.note) +
      " <b>Langkah berikutnya:</b> " +
      escapeHtml(summary.nextStep) +
      "</span></div>" +
      '<div class="spk-alert spk-alert--warn"><span class="spk-alert-title">Bukan desain teknis</span><span class="spk-alert-text">Tidak ada volume cut/fill, dimensi fondasi, atau desain teknis yang dihitung. Semua opsi memerlukan penilaian ahli dan verifikasi lapangan.</span></div>' +
      '<div class="spk-scenario-list">' +
      rec.scenarios
        .map(function (scenario) {
          return (
            '<details class="spk-scenario ' +
            (scenario.isPreferredForStudy ? "is-preferred" : "") +
            '">' +
            '<summary class="spk-scenario-head"><span class="spk-scenario-code">' +
            escapeHtml(scenario.code) +
            '</span><span class="spk-scenario-title"><b>' +
            escapeHtml(scenario.label) +
            "</b><span>" +
            escapeHtml(scenario.summary) +
            '</span></span><span class="spk-status spk-status--' +
            scenario.tone +
            '">' +
            escapeHtml(scenario.statusLabel) +
            "</span></summary>" +
            '<div class="spk-scenario-body">' +
            '<span class="spk-label">Bukti</span><ul class="spk-list">' +
            scenario.evidence.map(function (item) { return "<li>" + escapeHtml(item) + "</li>"; }).join("") +
            "</ul>" +
            '<span class="spk-label">Risiko</span><ul class="spk-list spk-list--risk">' +
            scenario.risks.map(function (item) { return "<li>" + escapeHtml(item) + "</li>"; }).join("") +
            "</ul>" +
            '<span class="spk-label">Verifikasi yang diperlukan</span><ul class="spk-list spk-list--verify">' +
            scenario.verification.map(function (item) { return "<li>" + escapeHtml(item) + "</li>"; }).join("") +
            "</ul>" +
            '<div class="spk-criterion-meta" style="margin-top:8px;"><span>Kepercayaan <b>' +
            escapeHtml(scenario.confidence) +
            "</b></span><span>Wajib tinjauan ahli <b>ya</b></span></div>" +
            "</div></details>"
          );
        })
        .join("") +
      "</div>" +
      '<div class="spk-disclaimer"><b>Catatan:</b> ' +
      escapeHtml(summary.limitations.join(" ")) +
      "</div></div>"
    );
  }

  function constraintPresentation(item) {
    if (!item) return { label: "NOT EVALUATED", tone: "unknown" };
    if (item.status === "restricted_verified" || item.status === "restricted") {
      return { label: "RESTRICTED / VERIFIED", tone: "negative" };
    }
    if (item.status === "indication_detected") {
      return {
        label: "INDICATION DETECTED",
        tone: item.severity === "high" ? "negative" : "caution",
      };
    }
    if (item.status === "not_detected") {
      return { label: "NOT DETECTED IN AVAILABLE DATA", tone: "unknown" };
    }
    if (item.status === "not_evaluated") {
      return { label: "NOT EVALUATED", tone: "unknown" };
    }
    if (item.status === "evaluated") {
      return item.detected
        ? {
            label: "INDICATION DETECTED",
            tone: item.severity === "high" ? "negative" : "caution",
          }
        : { label: "NOT DETECTED IN AVAILABLE DATA", tone: "unknown" };
    }
    return { label: "NOT EVALUATED", tone: "unknown" };
  }

  function renderLandUseSection(assessment) {
    const report = LandUse.normalize(assessment.landUse);
    const rows = report.classes
      .map(function (item) {
        return (
          '<div class="spk-data-row">' +
          '<span class="spk-data-cell spk-data-cell--primary"><span class="spk-color-dot" style="background:' +
          escapeHtml(item.color) +
          '"></span>' +
          escapeHtml(item.className) +
          "</span>" +
          '<span class="spk-data-cell">' +
          escapeHtml(item.groupLabel) +
          "</span>" +
          '<span class="spk-data-cell spk-data-cell--num">' +
          escapeHtml(LandUse.formatPercent(item.percentOfPolygon)) +
          "</span>" +
          '<span class="spk-data-cell spk-data-cell--num">' +
          escapeHtml(LandUse.formatArea(item.areaM2)) +
          "</span>" +
          "</div>"
        );
      })
      .join("");
    return (
      '<section class="spk-section spk-spatial-section">' +
      '<div class="spk-section-head"><div><p class="panel-eyebrow">Informasi penggunaan lahan</p><h3>Penggunaan Lahan di Area yang Dianalisis</h3><p>' +
      escapeHtml(report.summaryText) +
      "</p></div></div>" +
      '<div class="spk-spatial-meta">' +
      '<span>Cakupan: <b>' +
      escapeHtml(LandUse.formatPercent(report.coveragePercent)) +
      "</b></span>" +
      '<span>Luas terpetakan: <b>' +
      escapeHtml(LandUse.formatArea(report.coveredAreaM2)) +
      "</b></span>" +
      '<span>Luas poligon: <b>' +
      escapeHtml(LandUse.formatArea(report.polygonAreaM2)) +
      "</b></span>" +
      "</div>" +
      (rows
        ? '<div class="spk-data-table"><div class="spk-data-row spk-data-row--head"><span class="spk-data-cell">Kelas sumber</span><span class="spk-data-cell">Kelompok</span><span class="spk-data-cell spk-data-cell--num">% poligon</span><span class="spk-data-cell spk-data-cell--num">Luas</span></div>' +
          rows +
          "</div>"
        : '<div class="spk-inline-empty">Tidak ada kelas guna lahan pada area yang tercakup. Ini bukan bukti bahwa area tidak memiliki penggunaan lahan.</div>') +
      (report.warnings.length
        ? '<div class="spk-warning-list">' +
          report.warnings
            .map(function (warning) {
              return "<span>" + escapeHtml(warning) + "</span>";
            })
            .join("") +
          "</div>"
        : "") +
      '<div class="spk-disclaimer"><b>Status data:</b> ' +
      escapeHtml(
        report.dataset && report.dataset.verificationStatus === "source_metadata_incomplete"
          ? "Metadata sumber belum lengkap. Kelas guna lahan bukan penetapan status hukum."
          : "Kelas guna lahan bersifat informatif dan bukan penetapan status hukum."
      ) +
      (report.dataset && report.dataset.localFile
        ? ' Sumber lokal: <span class="mono">' + escapeHtml(report.dataset.localFile) + "</span>."
        : "") +
      "</div></section>"
    );
  }

  function renderSensitiveSection(assessment) {
    const report = SensitiveAreas.normalize(assessment.sensitiveAreas);
    const summary = report.summary;
    const cards = report.items
      .map(function (item) {
        return (
          '<div class="spk-sensitive-card spk-sensitive-card--' +
          escapeHtml(item.severity) +
          '">' +
          '<div class="spk-constraint-head"><div><div class="spk-constraint-title">' +
          escapeHtml(item.label) +
          '</div><div class="spk-criterion-meta"><span>' +
          escapeHtml(item.categoryLabel) +
          "</span><span>Kelas sumber: " +
          escapeHtml(item.sourceClass || "-") +
          '</span></div></div><span class="spk-status spk-status--caution">' +
          escapeHtml(item.statusLabel) +
          "</span></div>" +
          '<div class="spk-constraint-meta">' +
          escapeHtml(item.message) +
          "</div>" +
          '<div class="spk-spatial-meta"><span>Luas irisan: <b>' +
          escapeHtml(SensitiveAreas.formatArea(item.areaM2)) +
          "</b></span><span>Persentase poligon: <b>" +
          escapeHtml(SensitiveAreas.formatPercent(item.percentOfPolygon)) +
          "</b></span></div>" +
          '<div class="spk-criterion-actual">' +
          escapeHtml(item.verification) +
          "</div></div>"
        );
      })
      .join("");
    return (
      '<section class="spk-section spk-spatial-section">' +
      '<div class="spk-section-head"><div><p class="panel-eyebrow">Informasi objek dan kawasan</p><h3>Objek dan Kawasan yang Perlu Diperhatikan</h3><p>' +
      escapeHtml(report.summaryText) +
      "</p></div><span class=\"spk-status spk-status--" +
      summary.tone +
      '">' +
      escapeHtml(summary.statusLabel) +
      "</span></div>" +
      (cards ||
        '<div class="spk-inline-empty">' +
          escapeHtml(summary.note || "Objek dan kawasan sensitif belum teridentifikasi.") +
          "</div>") +
      '<div class="spk-disclaimer"><b>Bukan status hukum:</b> ' +
      escapeHtml(report.verificationText) +
      "</div></section>"
    );
  }

  function renderConstraintCard(item) {
    const presentation = constraintPresentation(item);
    return (
      '<div class="spk-constraint ' +
      (item.status === "not_evaluated" ? "is-unknown" : "") +
      '"><div class="spk-constraint-head"><div><div class="spk-constraint-title">' +
      escapeHtml(item.label) +
      '</div><div class="spk-criterion-meta"><span>' +
      escapeHtml(item.binding ? "Pembatas legal" : "Informatif / teknis") +
      "</span><span>" +
      escapeHtml(
        item.status === "not_evaluated"
          ? "Belum terverifikasi"
          : item.authoritative
          ? "Sumber berwenang"
          : "Bukan penetapan resmi"
      ) +
      "</span></div></div><span class=\"spk-status spk-status--" +
      presentation.tone +
      '">' +
      escapeHtml(presentation.label) +
      "</span></div>" +
      '<div class="spk-constraint-meta">' +
      escapeHtml(item.message) +
      "</div>" +
      (item.detail ? '<div class="spk-constraint-meta">' + escapeHtml(item.detail) + "</div>" : "") +
      (item.evidence && item.evidence.length
        ? '<div class="spk-constraint-evidence">' +
          item.evidence
            .map(function (evidence) {
              return (
                "<span>" +
                escapeHtml(evidence.label) +
                ": " +
                escapeHtml(fmtArea(evidence.valueM2)) +
                "</span>"
              );
            })
            .join("") +
          "</div>"
        : "") +
      (item.dataset
        ? '<div class="spk-criterion-actual">Sumber: <span class="mono">' +
          escapeHtml(item.dataset) +
          "</span></div>"
        : '<div class="spk-criterion-actual">Sumber: dataset resmi belum tersedia.</div>') +
      (item.verification
        ? '<div class="spk-criterion-actual">' + escapeHtml(item.verification) + "</div>"
        : "") +
      "</div>"
    );
  }

  function renderConstraintsTab(assessment) {
    const constraints = assessment.constraints;
    if (!constraints) return '<div class="spk-alert spk-alert--warn">Pembatas spasial belum dievaluasi.</div>';
    const summary = constraints.summary;
    const landUse = LandUse.normalize(assessment.landUse);
    const sensitive = SensitiveAreas.normalize(assessment.sensitiveAreas);
    const legalItems = constraints.items.filter(function (item) { return item.category === "legal"; });
    const technicalItems = constraints.items.filter(function (item) { return item.category !== "legal"; });
    const legalStatus = summary.hasBindingRestriction
      ? "restricted_verified"
      : summary.hasUnknownBindingConstraints
      ? "not_evaluated"
      : "not_detected";
    const legalPresentation = constraintPresentation({ status: legalStatus });
    return (
      '<div class="spk-section">' +
      '<div class="spk-spatial-summary">' +
      '<div class="spk-spatial-summary-card"><span>Guna lahan</span><b>' +
      escapeHtml(landUse.statusLabel) +
      "</b><small>" +
      escapeHtml(landUse.summaryText) +
      "</small></div>" +
      '<div class="spk-spatial-summary-card"><span>Objek / kawasan</span><b>' +
      escapeHtml(sensitive.summary.statusLabel) +
      "</b><small>" +
      escapeHtml(sensitive.summaryText) +
      "</small></div>" +
      '<div class="spk-spatial-summary-card"><span>Pembatas legal</span><b>' +
      escapeHtml(legalPresentation.label) +
      "</b><small>" +
      escapeHtml(
        summary.notEvaluated
          ? summary.notEvaluated + " pembatas legal belum dapat diverifikasi."
          : "Tidak ada pembatas legal terverifikasi pada data tersedia; ini bukan pembebasan."
      ) +
      "</small></div>" +
      "</div>" +
      renderLandUseSection(assessment) +
      renderSensitiveSection(assessment) +
      '<section class="spk-section spk-spatial-section">' +
      '<div class="spk-section-head"><div><p class="panel-eyebrow">Verifikasi aturan</p><h3>Verifikasi Aturan dan Pembatas Lahan</h3><p>Status ini tidak dapat disimpulkan sebagai bebas pembatas.</p></div></div>' +
      '<div class="spk-alert spk-alert--error"><span class="spk-alert-title">Pembatas legal belum terverifikasi</span><span class="spk-alert-text">' +
      escapeHtml(summary.note) +
      " WLC yang baik tidak dapat mengalahkan pembatas hukum/spasial yang mengikat.</span></div>" +
      '<div class="spk-constraint-list">' +
      legalItems.map(renderConstraintCard).join("") +
      "</div>" +
      (technicalItems.length
        ? '<div class="spk-subsection"><h4>Indikator teknis dan model</h4><p class="spk-section-desc">Indikator berikut bukan pembatas hukum dan tidak boleh dibaca sebagai penetapan resmi.</p><div class="spk-constraint-list">' +
          technicalItems.map(renderConstraintCard).join("") +
          "</div></div>"
        : "") +
      '<div class="spk-disclaimer"><b>Status belum dievaluasi bukan berarti tidak ada batasan.</b> ' +
      escapeHtml(
        Engine
          ? "Evaluasi ini tidak dapat menyimpulkan kelayakan legal. Verifikasi ke instansi berwenang tetap diperlukan."
          : ""
      ) +
      "</div></section></div>"
    );
  }

  function renderDecisionTab(assessment) {
    const draft = Store.loadDraft();
    if (!state.formDraft) {
      const fromDraft =
        draft && draft.assessmentId === assessment.assessmentId && draft.form ? draft.form : null;
      state.formDraft = fromDraft || {
        reviewer: "",
        decidedAt: new Date().toISOString().slice(0, 10),
        status: "pending",
        rationale: "",
        notes: "",
      };
    }
    const form = state.formDraft;
    const statusOptions = Store.DECISION_STATUSES.map(function (status) {
      return (
        '<option value="' +
        status.value +
        '"' +
        (form.status === status.value ? " selected" : "") +
        ">" +
        escapeHtml(status.label) +
        "</option>"
      );
    }).join("");
    const records = Store.listReviews();
    const history = records.slice(0, 6);
    const saved = state.savedRecord;
    return (
      '<div class="spk-section">' +
      '<div class="spk-decision-summary"><h4>Rekomendasi sistem</h4><p>' +
      escapeHtml(
        assessment.recommendations && assessment.recommendations.summary
          ? assessment.recommendations.summary.title + ". " + assessment.recommendations.summary.nextStep
          : "Rekomendasi belum tersedia."
      ) +
      "</p><p><b>Rekomendasi sistem bukan keputusan akhir.</b> Pengguna dapat menerima, menolak, atau meminta kajian tambahan dengan alasan yang tercatat.</p></div>" +
      (saved
        ? '<div class="spk-alert spk-alert--success"><span class="spk-alert-title">Keputusan tersimpan lokal</span><span class="spk-alert-text">' +
          escapeHtml(saved.reviewId) +
          " • " +
          escapeHtml(saved.humanDecision.reviewer) +
          ". Catatan ini tersimpan di browser, bukan basis data terpusat.</span></div>"
        : "") +
      '<div class="spk-alert spk-alert--info"><span class="spk-alert-title">Draf lokal browser</span><span class="spk-alert-text">Catatan keputusan disimpan di localStorage perangkat ini. Ekspor JSON untuk arsip. Data tidak terkirim ke server dan bukan keputusan resmi/terpusat.</span></div>' +
      '<form class="spk-form" id="spk-decision-form">' +
      '<div class="spk-form-grid">' +
      field("Nama peninjau", '<input id="spk-reviewer" name="reviewer" type="text" autocomplete="name" value="' + escapeHtml(form.reviewer) + '" placeholder="Nama / peran" required>') +
      field("Tanggal keputusan", '<input id="spk-decision-date" name="decidedAt" type="date" value="' + escapeHtml(form.decidedAt) + '">') +
      "</div>" +
      field("Status keputusan", '<select id="spk-decision-status" name="status">' + statusOptions + "</select>") +
      field("Alasan / pertimbangan", '<textarea id="spk-rationale" name="rationale" placeholder="Jelaskan dasar keputusan, termasuk perbedaan dengan rekomendasi sistem bila ada.">' + escapeHtml(form.rationale) + "</textarea>") +
      field("Catatan tambahan", '<textarea id="spk-notes" name="notes" placeholder="Tindak lanjut, syarat, atau kebutuhan verifikasi.">' + escapeHtml(form.notes) + "</textarea>") +
      '<div class="spk-field-help">Nama peninjau wajib diisi. Alasan wajib untuk keputusan selain “Belum diputuskan”.</div>' +
      '<div class="spk-actions">' +
      '<button type="button" class="btn btn-primary" id="spk-save-decision">Simpan keputusan</button>' +
      '<button type="button" class="btn btn-secondary" id="spk-save-draft">Simpan draf</button>' +
      '<button type="button" class="btn btn-secondary" id="spk-export-decision">Ekspor JSON</button>' +
      "</div>" +
      '<div id="spk-form-status" class="spk-field-help" role="status"></div>' +
      "</form>" +
      '<div class="spk-disclaimer"><b>Rekam jejak:</b> konfigurasi bobot, skor, FS, pembatas, rekomendasi, dan keputusan pengguna disertakan dalam catatan ekspor. Keputusan dapat berbeda dari rekomendasi sistem.</div>' +
      "</div>" +
      '<div class="spk-section"><div class="spk-section-head"><div><h3>Riwayat lokal</h3><p>' +
      records.length +
      " catatan tersimpan di browser ini.</p></div>" +
      (records.length
        ? '<button type="button" class="btn btn-secondary" id="spk-clear-history">Hapus riwayat</button>'
        : "") +
      "</div>" +
      (history.length
        ? '<div class="spk-history">' +
          history
            .map(function (record) {
              return (
                '<div class="spk-history-item"><div class="spk-history-main"><b>' +
                escapeHtml(record.humanDecision.reviewer || "(tanpa nama)") +
                "</b><span>" +
                escapeHtml(decisionLabel(record.humanDecision.status)) +
                " • " +
                escapeHtml(record.createdAt ? new Date(record.createdAt).toLocaleString("id-ID") : "") +
                "</span><span class=\"mono\">" +
                escapeHtml(record.assessmentId) +
                "</span></div>" +
                '<div class="spk-history-actions"><button type="button" class="btn btn-secondary" data-export-review="' +
                escapeHtml(record.reviewId) +
                '">Ekspor</button><button type="button" class="btn btn-ghost" data-delete-review="' +
                escapeHtml(record.reviewId) +
                '">Hapus</button></div></div>'
              );
            })
            .join("") +
          "</div>"
        : '<div class="spk-empty" style="padding:12px;"><p>Belum ada keputusan tersimpan. Simpan draf atau keputusan untuk membuat riwayat lokal.</p></div>') +
      "</div>"
    );
  }

  function field(label, control) {
    return (
      '<div class="spk-field"><label>' +
      escapeHtml(label) +
      "</label>" +
      control +
      "</div>"
    );
  }

  function decisionLabel(value) {
    const found = Store.DECISION_STATUSES.find(function (status) {
      return status.value === value;
    });
    return found ? found.label : value;
  }

  function collectForm() {
    const reviewer = document.getElementById("spk-reviewer");
    const decidedAt = document.getElementById("spk-decision-date");
    const status = document.getElementById("spk-decision-status");
    const rationale = document.getElementById("spk-rationale");
    const notes = document.getElementById("spk-notes");
    const value = {
      reviewer: reviewer ? reviewer.value.trim() : "",
      decidedAt: decidedAt ? decidedAt.value : new Date().toISOString().slice(0, 10),
      status: status ? status.value : "pending",
      rationale: rationale ? rationale.value.trim() : "",
      notes: notes ? notes.value.trim() : "",
    };
    state.formDraft = value;
    return value;
  }

  function validateDecision(form) {
    if (!form.reviewer) return "Nama peninjau wajib diisi.";
    if (form.status !== "pending" && !form.rationale) {
      return "Alasan/pertimbangan wajib diisi untuk keputusan selain “Belum diputuskan”.";
    }
    return null;
  }

  function setFormStatus(message, tone) {
    const el = document.getElementById("spk-form-status");
    if (!el) return;
    el.textContent = message;
    el.style.color =
      tone === "error" ? "var(--red)" : tone === "success" ? "var(--green)" : "var(--text-muted)";
  }

  function saveDecision(saveAsDraft) {
    const assessment = state.assessment;
    if (!assessment) return;
    const form = collectForm();
    if (!saveAsDraft) {
      const error = validateDecision(form);
      if (error) {
        setFormStatus(error, "error");
        return;
      }
    }
    const result = saveAsDraft
      ? Store.saveDraft(assessment, form)
      : Store.saveReview(assessment, form);
    if (!result.ok) {
      setFormStatus(result.error || "Gagal menyimpan.", "error");
      return;
    }
    if (saveAsDraft) {
      setFormStatus("Draf lokal tersimpan pada perangkat ini.", "success");
      return;
    }
    state.savedRecord = result.record;
    assessment.humanDecision = result.record.humanDecision;
    render();
  }

  function exportDecision() {
    const assessment = state.assessment;
    if (!assessment) return;
    const form = collectForm();
    const record =
      state.savedRecord || Store.createReviewRecord(assessment, form);
    const ok = Store.downloadReview(record);
    if (!ok) setFormStatus("Ekspor tidak tersedia di browser ini.", "error");
    else setFormStatus("Catatan JSON diekspor.", "success");
  }

  function bindResultEvents() {
    const editConfig = document.getElementById("spk-edit-config");
    if (editConfig) {
      editConfig.addEventListener("click", function () {
        state.view = "config";
        state.error = null;
        render();
      });
    }
    els.body.querySelectorAll("[data-spk-tab]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.activeTab = button.getAttribute("data-spk-tab");
        state.error = null;
        render();
      });
    });
    els.body.querySelectorAll("[data-segment-id]").forEach(function (row) {
      row.addEventListener("click", function () {
        selectSegment(row.getAttribute("data-segment-id"), { fromTable: true });
      });
    });

    const save = document.getElementById("spk-save-decision");
    if (save) save.addEventListener("click", function () { saveDecision(false); });
    const saveDraft = document.getElementById("spk-save-draft");
    if (saveDraft) saveDraft.addEventListener("click", function () { saveDecision(true); });
    const exportButton = document.getElementById("spk-export-decision");
    if (exportButton) exportButton.addEventListener("click", exportDecision);
    const clearHistory = document.getElementById("spk-clear-history");
    if (clearHistory) {
      clearHistory.addEventListener("click", function () {
        if (root.confirm("Hapus seluruh riwayat keputusan lokal? Tindakan ini tidak dapat dibatalkan.")) {
          Store.clearReviews();
          state.savedRecord = null;
          render();
        }
      });
    }
    els.body.querySelectorAll("[data-export-review]").forEach(function (button) {
      button.addEventListener("click", function () {
        const record = Store.findReview(button.getAttribute("data-export-review"));
        if (record) Store.downloadReview(record);
      });
    });
    els.body.querySelectorAll("[data-delete-review]").forEach(function (button) {
      button.addEventListener("click", function () {
        if (!root.confirm("Hapus catatan lokal ini?")) return;
        Store.deleteReview(button.getAttribute("data-delete-review"));
        render();
      });
    });

    ["spk-reviewer", "spk-decision-date", "spk-decision-status", "spk-rationale", "spk-notes"].forEach(function (id) {
      const input = document.getElementById(id);
      if (!input) return;
      input.addEventListener("input", collectForm);
      input.addEventListener("change", collectForm);
    });
  }

  function selectSegment(segmentId, options) {
    if (!segmentId) return;
    state.selectedSegmentId = segmentId;
    if (state.assessment) {
      state.activeTab = "criteria";
      state.view = "results";
      if (!state.open) open({ source: "segment" });
      else render();
      const api = bridge();
      if (api && typeof api.focusSegment === "function") api.focusSegment(segmentId);
      requestAnimationFrame(function () {
        const row = els.body.querySelector('[data-segment-id="' + segmentId + '"]');
        if (row) {
          row.scrollIntoView({ block: "center", behavior: "smooth" });
          row.classList.add("spk-segment-highlight");
          setTimeout(function () { row.classList.remove("spk-segment-highlight"); }, 1200);
        }
      });
    } else {
      open({ source: "segment" });
    }
  }

  root.LahanAmanSPKUI = {
    init: init,
    open: open,
    close: close,
    notifyPolygonUpdated: notifyPolygonUpdated,
    handlePolygonCleared: handlePolygonCleared,
    selectSegment: selectSegment,
    getAssessment: function () { return state.assessment; },
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
