(function (root) {
  "use strict";

  const Engine = root.LahanAmanSPK;
  const Constraints = root.LahanAmanSPKConstraints;
  const Recommendation = root.LahanAmanSPKRecommendation;
  const Store = root.LahanAmanSPKStore;
  const LandUse = root.LahanAmanLandUse;
  const Interpretation = root.LahanAmanSPKInterpretation;

  const TABS = [
    { id: "summary", label: "Ringkasan SPK" },
    { id: "criteria", label: "Analisis Kriteria" },
    { id: "slope", label: "Kestabilan Lereng (FS)" },
    { id: "development", label: "Alternatif Pengembangan" },
    { id: "constraints", label: "Penggunaan Lahan" },
    { id: "conclusion", label: "Kesimpulan dan Tindak Lanjut" },
    { id: "decision", label: "Keputusan Pengguna" },
    { id: "final", label: "Hasil Akhir Pemeriksaan" },
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

  function isLegalReference(value) {
    return /RTRW|RDTR|sempadan|legal|pembatas|status hukum|batas resmi|kawasan lindung|penetapan hukum|instansi berwenang|objek sensitif/i.test(String(value || ""));
  }

  function recommendationCopy(summary) {
    const note = isLegalReference(summary.note)
      ? "Belum ada alternatif yang dapat diprioritaskan karena data dan pemeriksaan lanjutan masih diperlukan."
      : summary.note;
    const nextStep = isLegalReference(summary.nextStep)
      ? "Lengkapi data dan lakukan pemeriksaan teknis sebelum memilih alternatif."
      : summary.nextStep;
    return { note: note, nextStep: nextStep };
  }

  function visibleRecommendationItems(items) {
    return (items || []).filter(function (item) { return !isLegalReference(item); });
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
    if (!Engine || !Constraints || !Recommendation || !Store || !LandUse || !Interpretation) {
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
    const activeIndex = !results
      ? 0
      : state.activeTab === "conclusion"
      ? 2
      : state.activeTab === "decision"
      ? 3
      : state.activeTab === "final"
      ? 4
      : 1;
    const steps = [
      "Parameter",
      "Evaluasi",
      "Kesimpulan",
      "Keputusan",
      "Hasil Akhir",
    ];
    els.progress.innerHTML = steps
      .map(function (label, index) {
        const status = index < activeIndex ? "done" : index === activeIndex ? "active" : "pending";
        return (
          '<span class="spk-progress-step ' +
          (status === "active" ? "is-active " : "") +
          (status === "done" ? "is-done" : "") +
          '"><b>' +
          (status === "done" ? "✓" : String(index + 1)) +
          "</b>" +
          escapeHtml(label) +
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
        ? '<div class="spk-alert spk-alert--warn"><span class="spk-alert-title">Cakupan data penilaian SPK terbatas</span><span class="spk-alert-text">Hanya ' +
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
      metric("Cakupan data penilaian SPK", coverage != null ? fmtPercent(coverage) : "-", "Persentase area yang memiliki data untuk penilaian kerawanan longsor.") +
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
      '<p class="spk-inline-note">Ini merupakan pemeriksaan awal berdasarkan data yang tersedia. Area yang tidak memiliki data belum dapat dinilai.</p>' +
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
      });
      const constraintResult = Constraints.evaluateConstraints(assessment);
      assessment.constraints = constraintResult;
      assessment.recommendations = Recommendation.evaluateRecommendations(assessment, constraintResult);
      assessment.interpretation = Interpretation.build(assessment);
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
    const warnings = (assessment.dataCompleteness.warnings || []).filter(function (warning) {
      return !(custom && /indeks kustom belum dikalibrasi/i.test(String(warning || "")));
    });
    const alerts = [];
    if (custom) {
      alerts.push(
        '<div class="spk-alert spk-alert--warn"><span class="spk-alert-title">Bobot Pilihan Belum Terkalibrasi</span><span class="spk-alert-text">Bobot yang Anda pilih belum diuji sebagai standar penelitian. Hasil ini tidak menggunakan pembagian tingkat kerawanan standar. Gunakan hasil dengan bobot standar penelitian sebagai pembanding.</span></div>'
      );
    }
    warnings.slice(0, 2).forEach(function (warning) {
      alerts.push(
        '<div class="spk-alert spk-alert--warn"><span class="spk-alert-title">Perhatian data</span><span class="spk-alert-text">' +
          escapeHtml(warning.replace(/^Cakupan data hanya\s+/i, "Cakupan data penilaian SPK hanya ")) +
          "</span></div>"
      );
    });
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
      scoreCard("Cakupan data penilaian SPK", coverage != null ? fmtPercent(coverage * 100) : "-", "Persentase area yang memiliki data untuk penilaian kerawanan longsor.", false) +
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
    const visibleTabs = TABS.filter(function (tab) {
      return tab.id !== "final" || Boolean(state.savedRecord);
    });
    return (
      '<div class="spk-tabs" role="tablist" aria-label="Bagian hasil SPK">' +
      visibleTabs.map(function (tab) {
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
      case "conclusion":
        return renderConclusionTab(assessment);
      case "decision":
        return renderDecisionTab(assessment);
      case "final":
        return renderFinalTab(assessment);
      default:
        return renderSummaryTab(assessment);
    }
  }

  function getInterpretation(assessment) {
    if (!assessment.interpretation) assessment.interpretation = Interpretation.build(assessment);
    return assessment.interpretation;
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
      escapeHtml(assessment.metadata.limitations.filter(function (item) {
        return !isLegalReference(item) && !(custom && /bobot kustom belum dikalibrasi/i.test(String(item || "")));
      }).join(" ")) +
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
    if (key === "slope") return "Kemiringan aktual: " + fmt(value, 2) + "°.";
    if (key === "rainfall") return "Curah hujan aktual: " + fmt(value, 0) + " mm/tahun.";
    if (typeof value === "number" && Number.isFinite(value)) return "Nilai aktual: " + fmt(value, 2) + ".";
    return "Nilai dari data: " + String(value) + ".";
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
    const copy = recommendationCopy(summary);
    const interpretation = getInterpretation(assessment);
    const tone = summary.status === "perlu_perhatian_tinggi" ? "error" : "info";
    return (
      '<div class="spk-section">' +
      '<div class="spk-alert spk-alert--' +
      tone +
      '"><span class="spk-alert-title">' +
      escapeHtml(summary.title) +
      '</span><span class="spk-alert-text">' +
      escapeHtml(copy.note) +
      " <b>Langkah berikutnya:</b> " +
      escapeHtml(copy.nextStep) +
      "</span></div>" +
      '<div class="spk-alert spk-alert--warn"><span class="spk-alert-title">Bukan desain teknis</span><span class="spk-alert-text">Tidak ada volume cut/fill, dimensi fondasi, atau desain teknis yang dihitung. Semua opsi memerlukan penilaian ahli dan verifikasi lapangan.</span></div>' +
      '<div class="spk-decision-summary"><h4>Mengapa belum ada alternatif yang dapat diprioritaskan?</h4><p>' +
      escapeHtml(interpretation.alternatives.reason) +
      "</p></div>" +
      '<div class="spk-scenario-list">' +
      rec.scenarios
        .map(function (scenario) {
          const interpretationItem = interpretation.alternatives.items.find(function (item) { return item.id === scenario.id; });
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
            (scenario.status === "belum_dapat_dievaluasi" && interpretationItem
              ? '<div class="spk-alternative-reason"><b>Mengapa belum dapat dievaluasi?</b><p>' + escapeHtml(interpretationItem.why) + "</p>" +
                '<b>Data atau parameter yang masih dibutuhkan</b><p>' + escapeHtml(interpretationItem.neededParameters.length ? interpretationItem.neededParameters.join(", ") : "Belum ada parameter tambahan yang tercatat.") + "</p>" +
                '<b>Pemeriksaan sebelum dipertimbangkan</b><ul class="spk-list spk-list--verify">' +
                (interpretationItem.verification.length
                  ? interpretationItem.verification.map(function (item) { return "<li>" + escapeHtml(item) + "</li>"; }).join("")
                  : "<li>Lakukan pemeriksaan teknis yang relevan sebelum alternatif ini dipertimbangkan.</li>") +
                "</ul></div>"
              : "") +
            '<span class="spk-label">Bukti</span><ul class="spk-list">' +
            visibleRecommendationItems(scenario.evidence).map(function (item) { return "<li>" + escapeHtml(item) + "</li>"; }).join("") +
            "</ul>" +
            '<span class="spk-label">Risiko</span><ul class="spk-list spk-list--risk">' +
            visibleRecommendationItems(scenario.risks).map(function (item) { return "<li>" + escapeHtml(item) + "</li>"; }).join("") +
            "</ul>" +
            '<span class="spk-label">Verifikasi yang diperlukan</span><ul class="spk-list spk-list--verify">' +
            visibleRecommendationItems(scenario.verification).map(function (item) { return "<li>" + escapeHtml(item) + "</li>"; }).join("") +
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
      escapeHtml(visibleRecommendationItems(summary.limitations).join(" ")) +
      "</div></div>"
    );
  }

  function landUseWarningCopy(warning) {
    const source = String(warning || "");
    const unsupported = source.match(/^(\d+)\s+fitur sumber bukan poligon/i);
    if (unsupported) {
      const count = Number(unsupported[1]);
      return count === 1
        ? "Satu objek pada data sumber tidak dihitung karena bukan merupakan area."
        : count.toLocaleString("id-ID") + " objek pada data sumber tidak dihitung karena bukan merupakan area.";
    }
    const invalid = source.match(/^(\d+)\s+geometri sumber tidak valid/i);
    if (invalid) {
      const count = Number(invalid[1]);
      return (count === 1 ? "Satu objek data" : count.toLocaleString("id-ID") + " objek data") +
        " memiliki bentuk yang tidak valid dan diperbaiki sebelum area dihitung.";
    }
    if (/tumpang tindih/i.test(source)) {
      return "Sebagian data saling tumpang tindih. Luas gabungan dihitung satu kali, sedangkan proporsi per kategori dapat bertumpuk.";
    }
    if (/cakupan guna lahan|cakupan penggunaan lahan/i.test(source)) {
      return "";
    }
    return source;
  }

  function renderLandUseSection(assessment) {
    const report = LandUse.normalize(assessment.landUse);
    const visibleWarnings = Array.from(new Set(report.warnings.map(landUseWarningCopy).filter(Boolean)));
    const descriptions = {
      "Hutan Lindung": "Area yang tercatat sebagai hutan lindung dalam data penggunaan lahan.",
      "Hutan Konservasi": "Area yang tercatat sebagai hutan konservasi dalam data penggunaan lahan.",
      "Hutan Produksi": "Area yang tercatat sebagai hutan produksi dalam data penggunaan lahan.",
      "Candi Prambanan": "Area yang diberi label Candi Prambanan dalam data penggunaan lahan.",
      "Permukiman": "Area yang tercatat sebagai tempat tinggal dan lingkungan permukiman.",
      "Kebun": "Area yang tercatat sebagai kebun.",
      "Sawah Irigasi": "Area yang tercatat sebagai lahan persawahan dengan sistem irigasi.",
      "Sawah Tadah Hujan": "Area persawahan yang mengandalkan air hujan.",
      "Semak/Belukar": "Area yang tercatat sebagai semak atau belukar.",
      "Sungai": "Area yang diberi label sungai dalam data penggunaan lahan.",
      "Danau/Waduk": "Area yang diberi label danau atau waduk dalam data penggunaan lahan.",
      "Makam": "Area yang tercatat sebagai makam dalam data penggunaan lahan.",
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
      '<span><span>Cakupan data penggunaan lahan: </span><b>' + escapeHtml(LandUse.formatPercent(report.coveragePercent)) + '</b><small>Persentase area yang memiliki informasi penggunaan lahan.</small></span>' +
      "</div>" +
      (rows
        ? '<div class="spk-data-table"><div class="spk-data-row spk-data-row--head"><span class="spk-data-cell">Jenis penggunaan lahan</span><span class="spk-data-cell spk-data-cell--num">Proporsi area</span><span class="spk-data-cell spk-data-cell--num">Luas</span></div>' +
          rows +
          "</div>"
        : '<div class="spk-inline-empty">Data penggunaan lahan belum tersedia untuk area ini. Area tersebut belum dapat dinilai.</div>') +
      (report.uncoveredAreaM2 > 0 && rows
        ? '<div class="spk-inline-note">Bagian yang tidak memiliki data penggunaan lahan belum dapat dinilai.</div>'
        : "") +
      (visibleWarnings.length
        ? '<div class="spk-warning-list">' +
          visibleWarnings
            .map(function (warning) {
              return "<span>" + escapeHtml(warning) + "</span>";
            })
            .join("") +
          "</div>"
        : "") +
      (report.overlapAreaM2 > 0 && !report.warnings.some(function (warning) { return /tumpang tindih/i.test(warning); })
        ? '<div class="spk-inline-note">Sebagian poligon data saling tumpang tindih (' + escapeHtml(LandUse.formatArea(report.overlapAreaM2)) + '). Luas total yang tercakup dihitung tanpa menghitung bagian tumpang tindih dua kali; proporsi kategori dapat saling bertumpuk.</div>'
        : "") +
      '<div class="spk-disclaimer">Informasi ini mengikuti kategori pada data penggunaan lahan yang tersedia dan tidak otomatis menunjukkan batas resmi atau status hukum suatu kawasan.</div>' +
      "</div></section>"
    );
  }

  function renderConstraintsTab(assessment) {
    return renderLandUseSection(assessment);
  }

  function renderConclusionTab(assessment) {
    return (
      '<section class="spk-section"><div class="spk-section-head"><div><h3>Kesimpulan dan Arahan Tindak Lanjut</h3><p>Kesimpulan ini dibentuk dari hasil WLC, FS, kelengkapan data, dan status alternatif yang tersedia.</p></div></div>' +
      renderInterpretationContent(assessment, false) +
      '<div class="spk-actions"><button type="button" class="btn btn-primary" data-spk-tab-jump="decision">Lanjut ke keputusan pengguna</button></div>' +
      "</section>"
    );
  }

  function renderInterpretationContent(assessment, compact) {
    const result = getInterpretation(assessment);
    const statusClass = result.status.tone === "positive" ? "positive" : result.status.tone === "caution" ? "caution" : "unknown";
    const formatFactorActual = function (factor) {
      return factor.actual == null ? "Data aktual belum tersedia." : formatActual(factor.key, factor.actual);
    };
    const factors = result.factors.length
      ? result.factors.map(function (factor) {
          const dataNote = factor.dataStatus === "partial" ? "Data tersedia sebagian." : factor.dataStatus === "missing" ? "Data belum tersedia." : "";
          return (
            '<div class="spk-interpretation-item"><b>' + escapeHtml(factor.label) + "</b>" +
            '<dl class="spk-factor-metrics">' +
            '<div><dt>Skor faktor</dt><dd>' + (factor.score == null ? "Belum tersedia" : fmt(factor.score, 2) + " / 5") + "</dd></div>" +
            '<div><dt>Bobot profil aktif</dt><dd>' + (factor.weightPercent == null ? "Belum tersedia" : fmt(factor.weightPercent, 2) + "%") + "</dd></div>" +
            '<div><dt>Kontribusi</dt><dd>' + (factor.contribution == null ? "Belum tersedia" : fmt(factor.contribution, 3)) + "</dd></div>" +
            '<div><dt>Nilai aktual</dt><dd>' + escapeHtml(formatFactorActual(factor)) + "</dd></div></dl>" +
            '<p>' + escapeHtml(factor.explanation) + (dataNote ? " " + escapeHtml(dataNote) : "") + "</p></div>"
          );
        }).join("")
      : '<p class="spk-inline-empty">Skor faktor belum tersedia untuk diurutkan.</p>';
    const ranking = result.factorRanking || {};
    const rankingRow = function (label, factor, metric, digits, suffix) {
      return factor
        ? '<div class="spk-factor-ranking-row"><b>' + escapeHtml(label) + '</b><span>' + escapeHtml(factor.label) + " · " + metric + " " + fmt(factor[metric === "skor" ? "score" : "contribution"], digits) + (suffix || "") + "</span></div>"
        : "";
    };
    const rankingSummary =
      '<div class="spk-factor-ranking">' +
      rankingRow("Kontribusi terbesar", ranking.contributionLeader, "kontribusi", 3, "") +
      rankingRow("Skor faktor tertinggi", ranking.highestScore, "skor", 2, " / 5") +
      (result.profile && result.profile.id === "custom"
        ? '<p>Urutan kontribusi mengikuti bobot kustom aktif (' + escapeHtml(result.profile.label || "Profil kustom") + "); indeks kustom belum menggunakan klasifikasi zona standar.</p>"
        : '<p>Bobot faktor mengikuti ' + escapeHtml(result.profile && result.profile.label || "profil aktif") + ".</p>") +
      "</div>";
    const limitations = result.limitations.map(function (item) { return "<li>" + escapeHtml(item) + "</li>"; }).join("");
    const actions = result.actions.map(function (action) {
      return (
        '<div class="spk-followup-item"><span class="spk-followup-priority">' + escapeHtml(String(action.presentation.order)) + "</span><div><b>" + escapeHtml(action.title) +
        "</b><p>" + escapeHtml(action.reason) + "</p><small>Status: Disarankan · Dasar: " + escapeHtml(action.basis) + "</small></div><span class=\"spk-status spk-status--unknown\">" + escapeHtml(action.presentation.priorityLabel) + "</span></div>"
      );
    }).join("");
    const alt = result.alternatives;
    const alternativeSummary = alt.preferred
      ? "Alternatif yang tersedia untuk kajian awal: " + alt.preferred.label + ". Ini bukan persetujuan pembangunan."
      : alt.reason;
    const alternatives = (
      '<section class="spk-interpretation-block"><h4>Alternatif Pengembangan</h4><p>' + escapeHtml(alternativeSummary) + "</p>" +
      '<div class="spk-interpretation-count">' + escapeHtml(String(alt.totalCount)) + " alternatif tersedia: " +
      escapeHtml(String(alt.statusCounts.belumDapatDievaluasi)) + " belum dapat dievaluasi, " + escapeHtml(String(alt.statusCounts.dapatDikaji)) +
      " dapat dipertimbangkan untuk kajian, dan " + escapeHtml(String(alt.statusCounts.diprioritaskan)) + " diprioritaskan untuk kajian.</div></section>"
    );
    const dataCoverage = result.dataCoverage;
    const segmentDescription = dataCoverage.totalSegments > 0
      ? dataCoverage.completeSegments === dataCoverage.totalSegments
        ? "Seluruh segmen yang memiliki data penilaian sudah dilengkapi dengan parameter yang diperlukan."
        : "Sebagian segmen yang tersedia belum memiliki seluruh parameter penilaian."
      : "Jumlah segmen yang dapat dinilai belum tersedia.";
    const coverageDetail =
      '<section class="spk-interpretation-block"><h4>Kelengkapan segmen dan cakupan area</h4>' +
      '<div class="spk-data-coverage"><div><b>Kelengkapan segmen: ' + escapeHtml(String(dataCoverage.completeSegments)) + " dari " + escapeHtml(String(dataCoverage.totalSegments)) + " lengkap</b><p>" + escapeHtml(segmentDescription) + "</p></div>" +
      '<div><b>Luas yang tercakup: ' + (dataCoverage.coveredAreaM2 == null ? "Belum tersedia" : escapeHtml(fmtArea(dataCoverage.coveredAreaM2))) + "</b><p>Luas yang belum tercakup: " +
      (dataCoverage.uncoveredAreaM2 == null ? "belum dapat dihitung" : escapeHtml(fmtArea(dataCoverage.uncoveredAreaM2)) +
        (dataCoverage.uncoveredPercent == null ? "" : " (" + fmt(dataCoverage.uncoveredPercent, 1) + "% dari area)")) + ". Area tersebut belum dapat dinilai.</p></div></div></section>";
    const detailSections = (
      coverageDetail +
      '<div class="spk-interpretation-grid"><section class="spk-interpretation-block"><h4>Faktor dengan Pengaruh Terbesar terhadap Nilai Penilaian</h4><p class="spk-section-desc">Skor faktor menunjukkan kondisi pada matriks penilaian. Bobot menunjukkan kepentingannya dalam profil aktif. Kontribusi adalah hasil skor dikalikan bobot. Urutan kontribusi terbesar tidak otomatis berarti tingkat bahaya tertinggi.</p>' + rankingSummary + factors +
      '</section><section class="spk-interpretation-block"><h4>Keterbatasan Data</h4><ul class="spk-interpretation-list">' + limitations + "</ul></section></div>" +
      '<section class="spk-interpretation-block"><h4>Arahan Tindak Lanjut</h4><p class="spk-section-desc">Semua item berstatus saran dan belum dinyatakan sudah dilakukan.</p><div class="spk-followup-list">' + actions + "</div></section>" +
      alternatives
    );
    return (
      '<div class="spk-interpretation ' + (compact ? "is-compact" : "") + '"><div class="spk-conclusion-banner"><span class="spk-status spk-status--' + statusClass + '">' + escapeHtml(result.status.label) +
      '</span><p>' + escapeHtml(result.summary) + "</p></div>" +
      '<ul class="spk-interpretation-reasons">' + result.reasons.map(function (reason) { return "<li>" + escapeHtml(reason) + "</li>"; }).join("") + "</ul>" +
      detailSections +
      '<div class="spk-decision-summary"><p>' + escapeHtml(result.decisionNote) + "</p></div></div>"
    );
  }

  function renderFinalTab(assessment) {
    const record = state.savedRecord;
    if (!record) return '<div class="spk-alert spk-alert--warn">Keputusan belum tersimpan.</div>';
    const decision = record.humanDecision || {};
    return (
      '<section class="spk-section"><div class="spk-section-head"><div><h3>Hasil Akhir Pemeriksaan</h3><p>Ringkasan sistem dan keputusan pemeriksa yang tersimpan.</p></div></div>' +
      '<p class="spk-final-record-id">' + escapeHtml(record.assessmentId) + " · " + escapeHtml(record.reviewId) + " · " + escapeHtml(record.createdAt ? new Date(record.createdAt).toLocaleString("id-ID") : "") + "</p>" +
      '<section class="spk-section"><h4>Kesimpulan Sistem</h4>' + renderInterpretationContent(assessment, true) + "</section>" +
      '<section class="spk-final-decision"><h4>Keputusan Pemeriksa</h4><dl>' +
      "<div><dt>Nama peninjau</dt><dd>" + escapeHtml(decision.reviewer || "-") + "</dd></div>" +
      "<div><dt>Tanggal pemeriksaan</dt><dd>" + escapeHtml(decision.decidedAt || "-") + "</dd></div>" +
      "<div><dt>Keputusan</dt><dd>" + escapeHtml(decisionLabel(decision.status || "")) + "</dd></div>" +
      "<div><dt>Alasan keputusan</dt><dd>" + escapeHtml(decision.rationale || "-") + "</dd></div>" +
      "<div><dt>Catatan tambahan</dt><dd>" + escapeHtml(decision.notes || "-") + "</dd></div>" +
      "</dl></section>" +
      '<div class="spk-alert spk-alert--info"><span class="spk-alert-title">Catatan arsip lokal</span><span class="spk-alert-text">Catatan tersimpan pada browser perangkat ini, bukan basis data terpusat. ' + escapeHtml(getInterpretation(assessment).finalNote) + "</span></div>" +
      '<div class="spk-actions"><button type="button" class="btn btn-primary" id="spk-final-export">Ekspor hasil akhir JSON</button></div>' +
      '<div id="spk-final-export-status" class="spk-field-help" role="status"></div></section>'
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
      '<div class="spk-decision-prelude"><h3>Dasar Keputusan</h3>' +
      renderInterpretationContent(assessment, true) +
      "</div>" +
      '<div class="spk-section">' +
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
      field("Alasan keputusan", '<textarea id="spk-rationale" name="rationale" placeholder="Jelaskan pertimbangan, termasuk apakah keputusan mengikuti kesimpulan sistem atau memerlukan pemeriksaan tambahan.">' + escapeHtml(form.rationale) + "</textarea>") +
      field("Catatan tambahan", '<textarea id="spk-notes" name="notes" placeholder="Tuliskan tindak lanjut atau pemeriksaan yang masih diperlukan.">' + escapeHtml(form.notes) + "</textarea>") +
      '<div class="spk-field-help">Nama peninjau wajib diisi. Alasan wajib untuk keputusan selain “Belum diputuskan”.</div>' +
      '<div class="spk-actions">' +
      '<button type="button" class="btn btn-primary" id="spk-save-decision">Simpan keputusan</button>' +
      '<button type="button" class="btn btn-secondary" id="spk-save-draft">Simpan draf</button>' +
      '<button type="button" class="btn btn-secondary" id="spk-export-decision">Ekspor JSON</button>' +
      "</div>" +
      '<div id="spk-form-status" class="spk-field-help" role="status"></div>' +
      "</form>" +
      '<div class="spk-disclaimer"><b>Rekam jejak:</b> konfigurasi bobot, skor, FS, rekomendasi, dan keputusan pengguna disertakan dalam catatan ekspor. Keputusan dapat berbeda dari rekomendasi sistem.</div>' +
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
    state.activeTab = "final";
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
    els.body.querySelectorAll("[data-spk-tab-jump]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.activeTab = button.getAttribute("data-spk-tab-jump");
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
    const finalExport = document.getElementById("spk-final-export");
    if (finalExport) {
      finalExport.addEventListener("click", function () {
        const status = document.getElementById("spk-final-export-status");
        const ok = Store.downloadReview(state.savedRecord);
        if (status) status.textContent = ok ? "Hasil akhir diekspor sebagai JSON." : "Ekspor tidak tersedia di browser ini.";
      });
    }
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
