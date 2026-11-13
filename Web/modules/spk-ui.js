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
    { id: "slope", label: "Kestabilan Lereng (FS)" },
    { id: "development", label: "Alternatif Pengembangan" },
    { id: "constraints", label: "Penggunaan Lahan dan Informasi" },
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
        "Ringkasan kondisi lahan, kestabilan lereng, penggunaan lahan, dan keputusan pemeriksa.";
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
          " luas area yang diperiksa memiliki data penilaian. Bagian tanpa data tidak boleh dianggap aman.</span></div>"
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
      : '<div class="spk-alert spk-alert--info"><span class="spk-alert-title">Bobot standar penelitian</span><span class="spk-alert-text">Kemiringan tanah 30%, tanah 25%, batuan 20%, hujan 15%, dan penggunaan lahan 10%. Pilihan ini mempertahankan hasil penilaian standar yang sudah ada.</span></div>';

    els.body.innerHTML =
      renderError() +
      '<section class="spk-section">' +
      '<div class="spk-location-card">' +
      '<div class="spk-section-head"><div><p class="panel-eyebrow">Area pemeriksaan</p><h3>Lokasi yang diperiksa</h3>' +
      '<p>' +
      escapeHtml(activeLabel) +
      " • " +
      escapeHtml(String((ctx.segments || []).length)) +
      " bagian</p></div></div>" +
      '<div class="spk-location-grid">' +
      metric("Luas poligon", fmtArea(area), "Batas poligon yang dievaluasi") +
      metric("Cakupan data", coverage != null ? fmtPercent(coverage) : "-", fmtArea(summary.total_luas_m2) + " memiliki data") +
      metric("Bagian area", String((ctx.segments || []).length), "Bagian yang dianalisis") +
      "</div></div></section>" +
      coverageWarning +
      activeWarning +
      '<section class="spk-section">' +
      '<div class="spk-section-head"><div><h3>Pilih cara memberi bobot</h3><p>Gunakan bobot standar penelitian atau atur tingkat kepentingan setiap faktor.</p></div></div>' +
      '<div class="spk-profile-grid">' +
      renderProfileCard("standard", "Bobot standar penelitian", "30/25/20/15/10", "Pakai pilihan ini untuk mempertahankan hasil penilaian standar.", !custom) +
      renderProfileCard("custom", "Atur bobot sendiri", "5/4/3/3/2", "Pilih tingkat kepentingan tiap faktor. Hasilnya tidak memakai pembagian tingkat kerawanan standar.", custom) +
      "</div>" +
      weightsHtml +
      "</section>" +
      '<section class="spk-section">' +
      '<div class="spk-actions">' +
      '<button type="button" class="btn btn-primary" id="spk-run">Jalankan evaluasi</button>' +
      (active ? '<button type="button" class="btn btn-secondary" id="spk-view-last">Lihat hasil terakhir</button>' : "") +
      '<button type="button" class="btn btn-secondary" id="spk-config-cancel">Tutup</button>' +
      "</div>" +
      '<p class="spk-inline-note">Ini merupakan pemeriksaan awal berdasarkan data yang tersedia. Informasi batas resmi kawasan dan tata ruang belum tersedia untuk diperiksa.</p>' +
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
          escapeHtml(({ slope: "Kemiringan tanah", soil: "Jenis dan kondisi tanah", geology: "Jenis batuan", rainfall: "Jumlah curah hujan", landCover: "Penggunaan lahan" })[criterion.key] || criterion.label) +
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
      '<div class="spk-weight-total"><span>Jumlah tingkat kepentingan</span><span><b id="spk-weight-total-value">' +
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
        '<div class="spk-alert spk-alert--warn"><span class="spk-alert-title">Bobot pilihan belum diuji sebagai standar</span><span class="spk-alert-text">Hasil ini tidak memakai pembagian tingkat kerawanan standar. Gunakan hasil standar penelitian sebagai pembanding.</span></div>'
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
      '<div class="spk-alert spk-alert--info"><span class="spk-alert-title">Batas resmi belum tersedia</span><span class="spk-alert-text">Data tata ruang dan batas resmi kawasan perlindungan belum tersedia untuk diperiksa. Hasil analisis bukan izin pembangunan.</span></div>'
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
      escapeHtml(custom ? "BOBOT PILIHAN" : "BOBOT STANDAR") +
      '</span><button type="button" class="btn btn-secondary" id="spk-edit-config" style="height:26px;padding:0 8px;font-size:9px;">Ubah parameter</button></div></div>' +
      '<div class="spk-score-grid">' +
      scoreCard(custom ? "Nilai dengan bobot pilihan" : "Nilai penilaian", fmt(active.score, 2), activeClass, true) +
      scoreCard("Nilai standar penelitian", fmt(assessment.standard.score, 2), standardClass, false) +
      scoreCard("Kestabilan lereng terendah (FS)", fsMin != null ? fmt(fsMin, 2) : "-", "Dihitung terpisah", false) +
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
      escapeHtml(custom ? "Nilai dengan bobot pilihan" : "Nilai standar penelitian") +
      '</span><span class="spk-alert-text">' +
      escapeHtml(
        custom
          ? "Pembagian zona di bawah memakai bobot standar penelitian sebagai pembanding."
          : "Nilai ini merangkum lima faktor lahan. Kestabilan lereng dihitung secara terpisah."
      ) +
      "</span></div>" +
      '<div class="spk-kpi-grid">' +
      kpi("Segmen", String(assessment.location.segmentCount), assessment.location.completeSegmentCount + " segmen lengkap") +
      kpi("Luas poligon", fmtArea(total), assessment.location.coveredAreaM2 + " m² tercakup") +
      kpi("Nilai penilaian", fmt(active.score, 2), active.label) +
      kpi("Kestabilan lereng terendah (FS)", assessment.infiniteSlope.min != null ? fmt(assessment.infiniteSlope.min, 2) : "-", assessment.infiniteSlope.classification ? assessment.infiniteSlope.classification.label : "tidak tersedia") +
      "</div>" +
      '<div class="spk-stack"><div class="spk-section-head"><div><h3>Pembagian tingkat kerawanan (standar penelitian)</h3><p>Proporsi dihitung dari luas area yang diperiksa. Bagian tanpa data tetap ditampilkan.</p></div></div>' +
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
      '<div class="spk-alert spk-alert--info"><span class="spk-alert-title">Cara membaca hasil</span><span class="spk-alert-text">Hasil ini menggambarkan kondisi relatif berdasarkan lima faktor dan data yang tersedia. Periksa juga penggunaan lahan, kelengkapan data, serta kebutuhan pemeriksaan lapangan.</span></div>' +
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

    const criterionLabels = {
      slope: "Kemiringan tanah",
      soil: "Jenis dan kondisi tanah",
      geology: "Jenis batuan",
      rainfall: "Jumlah curah hujan",
      landCover: "Penggunaan lahan",
    };
    return (
      '<div class="spk-section">' +
      '<div class="spk-section-head"><div><h3>Faktor yang dinilai</h3><p>Nilai pengaruh menunjukkan sumbangan tiap faktor pada hasil penilaian. Persentase bobot menunjukkan porsi faktor dalam perhitungan.</p></div>' +
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
            escapeHtml(criterionLabels[criterion.key] || criterion.label) +
            '</div><div class="spk-criterion-meta"><span>Skor <b>' +
            (score != null ? fmt(score, 2) : "–") +
            "</b></span><span>" +
            (custom ? "Tingkat kepentingan <b>" + criterion.importance + " dari 5</b>" : "Bobot <b>" + fmtPercent(criterion.weightPercent) + "</b>") +
            "</span><span>Pengaruh pada nilai akhir <b>" +
            (criterion.contribution != null ? fmt(criterion.contribution, 3) : "–") +
            "</b></span><span>" +
            escapeHtml(criterion.dataStatus === "complete" ? "data lengkap" : criterion.dataStatus === "partial" ? "data sebagian" : "data belum tersedia") +
            "</span></div></div>" +
            '<span class="spk-criterion-score">' +
            (score != null ? fmt(score, 1) : "–") +
            "</span></div>" +
            '<div class="spk-criterion-bar"><span style="width:' + bar + '%"></span></div>' +
            '<div class="spk-criterion-actual">' +
            escapeHtml(criterionExplanation(criterion.key)) + " " +
            escapeHtml(criterion.actualSummary != null ? formatActual(criterion.key, criterion.actualSummary) : "Nilai aktual tidak tersedia.") +
            " " +
            escapeHtml(standardNote) +
            "</div></div>"
          );
        })
        .join("") +
      "</div></div>" +
      '<div class="spk-section"><div class="spk-section-head"><div><h3>Rincian bagian lahan</h3><p>Pilih baris atau bagian pada peta untuk melihat lokasinya.</p></div></div>' +
      '<div class="spk-table-wrap"><table class="spk-table"><thead><tr><th>Bagian</th><th>Kemiringan</th><th>Tanah</th><th>Batuan</th><th>Hujan</th><th>Penggunaan lahan</th><th>Nilai</th><th>FS</th></tr></thead><tbody>' +
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

  function criterionExplanation(key) {
    const explanations = {
      slope: "Menunjukkan tingkat kemiringan permukaan tanah di lokasi ini.",
      soil: "Menggambarkan jenis dan kondisi tanah yang tercatat pada data.",
      geology: "Menunjukkan jenis batuan yang tercatat pada data.",
      rainfall: "Menunjukkan jumlah curah hujan yang tercatat untuk lokasi ini.",
      landCover: "Menunjukkan penggunaan lahan yang tercatat pada data.",
    };
    return explanations[key] || "Informasi ini berasal dari data yang tersedia untuk lokasi.";
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
      '<div class="spk-section-head"><div><h3>Kestabilan Lereng (FS)</h3><p>Nilai ini membantu memperkirakan kemampuan lereng dalam menahan kemungkinan pergerakan tanah.</p></div></div>' +
      '<div class="spk-fs-grid">' +
      kpi("FS minimum", slope.min != null ? fmt(slope.min, 2) : "-", slope.classification ? slope.classification.label : "tidak tersedia") +
      kpi("FS rerata", slope.mean != null ? fmt(slope.mean, 2) : "-", "Rata-rata tiap segmen berdasarkan luas") +
      kpi("FS maksimum", slope.max != null ? fmt(slope.max, 2) : "-", "Nilai tertinggi pada segmen") +
      "</div>" +
      '<div class="spk-kpi-grid" style="margin-top:8px;">' +
      kpi("FS > 1,25", String(counts.stabil || 0), "Segmen pada kategori stabil") +
      kpi("FS 1,07–1,25", String(counts.kritis || 0), "Segmen pada kategori kritis") +
      kpi("FS < 1,07", String(counts.labil || 0), "Segmen pada kategori labil") +
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
      '<p class="spk-inline-note">Perhitungan ini merupakan pemeriksaan awal berdasarkan data yang tersedia, bukan jaminan bahwa suatu lokasi aman untuk dibangun. Segmen dengan nilai rendah perlu diperiksa lebih lanjut.</p></div>'
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
          const scenarioCopy = {
            contour_adaptive: ["Menyesuaikan tapak mengikuti kontur", "Penyesuaian bentuk tapak dapat mengurangi perubahan lereng. Drainase dan kestabilan tetap perlu diperiksa."],
            terraced: ["Membuat teras pada lereng", "Teras dapat membagi panjang lereng, tetapi mengubah bentuk dan beban lereng."],
            controlled_cut: ["Pemotongan lereng terkendali", "Pemotongan lereng perlu dikaji untuk mengetahui dampaknya pada kestabilan dan area sekitar."],
            controlled_fill: ["Penimbunan terkendali", "Penimbunan perlu diperiksa terhadap kekuatan tanah, penurunan, kestabilan, dan aliran air."],
            cut_and_fill: ["Pemotongan dan penimbunan terkendali", "Pekerjaan galian dan timbunan perlu dikaji bersama karena dapat mengubah kestabilan dan aliran air."],
            no_development: ["Tidak membangun atau melakukan kajian lanjutan", "Pilihan untuk menunda pembangunan sampai pemeriksaan tambahan selesai."],
          }[scenario.id] || [scenario.label, scenario.summary];
          return (
            '<details class="spk-scenario ' +
            (scenario.isPreferredForStudy ? "is-preferred" : "") +
            '">' +
            '<summary class="spk-scenario-head"><span class="spk-scenario-code">' +
            escapeHtml(scenario.code) +
            '</span><span class="spk-scenario-title"><b>' +
            escapeHtml(scenarioCopy[0]) +
            "</b><span>" +
            escapeHtml(scenarioCopy[1]) +
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
    const descriptions = {
      "Hutan Lindung": "Area yang tercatat sebagai hutan lindung dalam data penggunaan lahan.",
      "Hutan Konservasi": "Area yang tercatat sebagai hutan konservasi dalam data penggunaan lahan.",
      "Hutan Produksi": "Area yang tercatat sebagai hutan produksi dalam data penggunaan lahan.",
      "Candi Prambanan": "Area yang diberi label Candi Prambanan dalam data penggunaan lahan.",
      "Permukiman": "Area yang tercatat sebagai tempat tinggal dan lingkungan permukiman.",
      "Kebun": "Area yang tercatat sebagai kebun.",
      "Sawah Irigasi": "Area yang tercatat sebagai sawah irigasi.",
      "Sawah Tadah Hujan": "Area yang tercatat sebagai sawah tadah hujan.",
      "Tegalan/Ladang": "Area yang tercatat sebagai lahan pertanian kering atau ladang.",
    };
    const rows = report.classes
      .map(function (item) {
        return (
          '<div class="spk-data-row">' +
          '<span class="spk-data-cell spk-data-cell--primary">' +
          escapeHtml(item.className) +
          '<small class="spk-land-use-description">' +
          escapeHtml(descriptions[item.className] || ("Area yang tercatat sebagai " + item.className + " dalam data penggunaan lahan.")) +
          "</small></span>" +
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
      '<div class="spk-section-head"><div><p class="panel-eyebrow">Informasi dari data yang tersedia</p><h3>Penggunaan Lahan di Lokasi Ini</h3><p>Informasi mengenai jenis penggunaan atau tutupan lahan yang ditemukan pada area yang sedang diperiksa.</p></div></div>' +
      '<div class="spk-spatial-meta">' +
      '<span>Total luas dengan informasi: <b>' +
      escapeHtml(LandUse.formatArea(report.coveredAreaM2)) +
      "</b></span>" +
      '<span>Area yang diperiksa: <b>' +
      escapeHtml(LandUse.formatArea(report.polygonAreaM2)) +
      "</b></span>" +
      '<span>Area tanpa informasi: <b>' + escapeHtml(LandUse.formatArea(report.uncoveredAreaM2)) + "</b></span>" +
      '<span>Proporsi area: <b>' + escapeHtml(LandUse.formatPercent(report.coveragePercent)) + "</b></span>" +
      "</div>" +
      (rows
        ? '<div class="spk-data-table"><div class="spk-data-row spk-data-row--head"><span class="spk-data-cell">Jenis penggunaan lahan</span><span class="spk-data-cell spk-data-cell--num">Proporsi area</span><span class="spk-data-cell spk-data-cell--num">Luas</span></div>' +
          rows +
          "</div>"
        : '<div class="spk-inline-empty">Data penggunaan lahan belum tersedia untuk area ini. Area tanpa data tidak dapat dianggap kosong atau bebas pembatasan.</div>') +
      (report.warnings.length
        ? '<div class="spk-warning-list">' +
          report.warnings
            .map(function (warning) {
              const simpleWarning = /tumpang tindih/i.test(warning)
                ? "Sebagian data saling tumpang tindih. Total luas area tercakup dihitung satu kali; proporsi per kategori dapat saling bertumpuk."
                : warning;
              return "<span>" + escapeHtml(simpleWarning) + "</span>";
            })
            .join("") +
          "</div>"
        : "") +
      (report.overlapAreaM2 > 0 && !report.warnings.some(function (warning) { return /tumpang tindih/i.test(warning); })
        ? '<div class="spk-inline-note">Sebagian poligon data saling tumpang tindih (' + escapeHtml(LandUse.formatArea(report.overlapAreaM2)) + '). Luas total yang tercakup dihitung tanpa menghitung bagian tumpang tindih dua kali; proporsi kategori dapat saling bertumpuk.</div>'
        : "") +
      '<div class="spk-disclaimer">Informasi ini mengikuti kategori pada data penggunaan lahan yang tersedia. Label tersebut tidak otomatis menunjukkan batas resmi kawasan lindung atau zonasi hukum.</div>' +
      '<div class="spk-inline-note">Data penggunaan lahan yang tersedia belum mencakup seluruh wilayah DIY. Hasil analisis hanya menggambarkan area yang masuk dalam cakupan data.</div>' +
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
          escapeHtml(item.sourceClass || item.label) +
          '</div><div class="spk-criterion-meta"><span>Tercatat pada data penggunaan lahan</span></div></div></div>' +
          '<div class="spk-spatial-meta"><span>Luas irisan: <b>' +
          escapeHtml(SensitiveAreas.formatArea(item.areaM2)) +
          "</b></span><span>Persentase poligon: <b>" +
          escapeHtml(SensitiveAreas.formatPercent(item.percentOfPolygon)) +
          "</b></span></div>" +
          "</div>"
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
      (cards ? '<div class="spk-disclaimer">Kategori mengikuti label data penggunaan lahan dan tidak otomatis menunjukkan batas resmi atau penetapan hukum.</div>' : "") +
      "</section>"
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
    const sensitive = SensitiveAreas.normalize(assessment.sensitiveAreas);
    return (
      '<div class="spk-section">' +
      renderLandUseSection(assessment) +
      (sensitive.items.length ? renderSensitiveSection(assessment) : "") +
      '<div class="spk-disclaimer">Data batas resmi kawasan perlindungan dan tata ruang belum tersedia untuk diperiksa dalam aplikasi ini. Hasil ini tidak menyimpulkan bahwa lokasi bebas dari pembatasan hukum.</div></div>'
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
      "</p><p>Rekomendasi sistem merupakan bahan pertimbangan. Keputusan akhir tetap berada pada pihak yang berwenang.</p></div>" +
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
      field("Tanggal pemeriksaan", '<input id="spk-decision-date" name="decidedAt" type="date" value="' + escapeHtml(form.decidedAt) + '">') +
      "</div>" +
      field("Keputusan", '<select id="spk-decision-status" name="status">' + statusOptions + "</select>") +
      field("Alasan keputusan", '<textarea id="spk-rationale" name="rationale" placeholder="Jelaskan alasan keputusan dan hal yang menjadi pertimbangan.">' + escapeHtml(form.rationale) + "</textarea>") +
      field("Catatan tambahan", '<textarea id="spk-notes" name="notes" placeholder="Tuliskan tindak lanjut atau pemeriksaan yang masih diperlukan.">' + escapeHtml(form.notes) + "</textarea>") +
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
