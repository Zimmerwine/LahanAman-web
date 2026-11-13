const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const OUT = "C:\\Users\\user\\AppData\\Local\\Temp\\opencode";
const BASE = "http://127.0.0.1:5000/";
const CHROME =
  "C:\\Users\\user\\AppData\\Local\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe";

function report(name, value) {
  console.log(name + ": " + (typeof value === "string" ? value : JSON.stringify(value)));
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const errors = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  const attach = (target, tag) => {
    target.on("console", (message) => {
      if (message.type() === "error") errors.push("[" + tag + "] console: " + message.text());
    });
    target.on("pageerror", (error) => errors.push("[" + tag + "] pageerror: " + error.message));
    target.on("response", (response) => {
      if (response.status() >= 400) errors.push("[" + tag + "] HTTP " + response.status() + ": " + response.url());
    });
  };
  attach(page, "desktop");

  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(4500);
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4500);

    report("TITLE", await page.title());
    report("HEADER_SPK_VISIBLE", await page.locator("#btn-open-spk").isVisible());

    await page.locator("#btn-demo-kavling").click();
    await page.waitForSelector("#btn-open-spk-panel", { state: "visible", timeout: 30000 });
    await page.waitForTimeout(2200);

    report("COVERAGE_NOTE", (await page.locator(".kavling-coverage-note").innerText()).replace(/\s+/g, " ").trim());
    report("COVERAGE_LOW", await page.locator(".kavling-coverage-note").evaluate((element) => element.classList.contains("is-low")));
    report("POLYGON_AREA", (await page.locator(".kavling-area-value").innerText()).replace(/\s+/g, " ").trim());
    report("SEGMENT_ROWS", await page.locator(".kavling-seg-row").count());
    const countyOptions = await page.locator("#select-kabupaten option").evaluateAll((options) => options.filter((option) => option.value).map((option) => option.value));
    report("COUNTY_FILTER_OPTIONS", countyOptions.length);
    if (countyOptions.length) {
      await page.locator("#select-kabupaten").selectOption(countyOptions[0]);
      report("SUBDISTRICT_FILTER_OPTIONS_AFTER_COUNTY", await page.locator("#select-kapanewon option").evaluateAll((options) => options.filter((option) => option.value).length));
      const subdistrictValue = await page.locator("#select-kapanewon option").evaluateAll((options) => options.find((option) => option.value)?.value || "");
      if (subdistrictValue) {
        await page.locator("#select-kapanewon").selectOption(subdistrictValue);
        report("VILLAGE_FILTER_OPTIONS_AFTER_SUBDISTRICT", await page.locator("#select-kalurahan option").evaluateAll((options) => options.filter((option) => option.value).length));
      }
      await page.locator("#select-kabupaten").selectOption("");
    }

    await page.locator("#btn-open-spk-panel").click();
    await page.waitForSelector("#spk-overlay", { state: "visible", timeout: 10000 });
    report("DRAWER_OPEN", await page.locator("#spk-drawer").isVisible());
    report("CONFIG_HEADING", (await page.locator("#spk-body").innerText()).includes("Pilih profil bobot"));
    report("CONFIG_COVERAGE", (await page.locator("#spk-body").innerText()).includes("26,2%"));
    report("CONFIG_COVERAGE_LABEL", (await page.locator("#spk-body").innerText()).includes("Cakupan data penilaian SPK"));
    report("CONFIG_COVERAGE_DESCRIPTION", (await page.locator("#spk-body").innerText()).includes("Persentase area yang memiliki data untuk penilaian kerawanan longsor."));
    await page.screenshot({ path: path.join(OUT, "spk-config.png") });

    await page.locator("#spk-run").click();
    await page.waitForSelector('[data-spk-tab="summary"]', { timeout: 10000 });
    await page.waitForTimeout(600);
    const standardTag = (await page.locator(".spk-tag").first().innerText()).trim();
    const standardScore = (await page.locator(".spk-score-value").first().innerText()).trim();
    report("STANDARD_TAG", standardTag);
    report("STANDARD_SCORE", standardScore);
    report("SUMMARY_MENTIONS_GAP", (await page.locator("#spk-body").innerText()).includes("Tidak tercakup"));
    report("LEGEND_MODE", await page.evaluate(() => document.getElementById("map-legend")?.textContent || ""));

    const tabs = await page.locator("[data-spk-tab]").allTextContents();
    report("TABS", tabs);
    await page.screenshot({ path: path.join(OUT, "spk-standard-summary.png") });

    await page.locator("#spk-edit-config").click();
    await page.waitForSelector('[data-profile="custom"]', { timeout: 5000 });
    await page.locator('[data-profile="custom"]').click();
    await page.waitForSelector('[data-importance-key="slope"]', { timeout: 5000 });
    for (const [key, value] of Object.entries({
      slope: "5",
      soil: "1",
      geology: "1",
      rainfall: "1",
      landCover: "1",
    })) {
      await page.locator('[data-importance-key="' + key + '"]').evaluate((element, next) => {
        element.value = next;
        element.dispatchEvent(new Event("input", { bubbles: true }));
      }, value);
    }
    report("CUSTOM_WEIGHT_PREVIEW", (await page.locator('[data-weight-value="slope"]').innerText()).trim());
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#spk-run").click();
    await page.waitForSelector('[data-spk-tab="summary"]', { timeout: 10000 });
    await page.waitForTimeout(500);
    report("CUSTOM_TAG", (await page.locator(".spk-tag").first().innerText()).trim());
    report("CUSTOM_SCORE", (await page.locator(".spk-score-value").first().innerText()).trim());
    report("CUSTOM_BANNER", (await page.locator("#spk-body").innerText()).includes("Bobot Pilihan Belum Terkalibrasi"));
    report("CUSTOM_WARNING_ONCE", (await page.locator("#spk-body .spk-alert-title").allTextContents()).filter((title) => title.includes("Bobot Pilihan Belum Terkalibrasi")).length);
    await page.screenshot({ path: path.join(OUT, "spk-custom-summary.png") });

    await page.locator('[data-spk-tab="criteria"]').click();
    await page.waitForTimeout(300);
    report("CRITERIA_ROWS", await page.locator(".spk-table tbody tr").count());
    report("CRITERIA_ACTUAL", (await page.locator("#spk-body").innerText()).includes("Kemiringan aktual"));
    await page.screenshot({ path: path.join(OUT, "spk-criteria.png") });

    await page.locator('[data-spk-tab="slope"]').click();
    await page.waitForTimeout(300);
    report("SLOPE_FS_SEPARATE", (await page.locator("#spk-body").innerText()).includes("FS tidak digabungkan ke WLC"));
    report("SLOPE_MIN", (await page.locator(".spk-kpi-value").first().innerText()).trim());
    await page.screenshot({ path: path.join(OUT, "spk-slope.png") });

    await page.locator('[data-spk-tab="development"]').click();
    await page.waitForTimeout(300);
    report("SCENARIOS", await page.locator(".spk-scenario").count());
    report("NO_PREFERRED_WITH_INCOMPLETE_DATA", (await page.locator("#spk-body").innerText()).includes("Belum ada skenario yang dapat diutamakan"));
    report("NO_DESIGN_NUMBERS", (await page.locator("#spk-body").innerText()).includes("Tidak ada volume cut/fill"));
    await page.screenshot({ path: path.join(OUT, "spk-development.png") });

    await page.locator('[data-spk-tab="constraints"]').click();
    await page.waitForTimeout(300);
    const constraintsText = await page.locator("#spk-body").innerText();
    report("CONSTRAINTS_COUNT", await page.locator(".spk-constraint").count());
    report("LAND_USE_SECTION", constraintsText.includes("Penggunaan Lahan di Lokasi Ini"));
    report("LAND_USE_ROWS", await page.locator(".spk-data-table .spk-data-row:not(.spk-data-row--head)").count());
    report("SENSITIVE_SECTION_ABSENT", !constraintsText.includes("Objek dan Kawasan yang Perlu Diperhatikan"));
    report("LEGAL_STATUS_ABSENT", !constraintsText.includes("NOT EVALUATED") && !constraintsText.includes("Verifikasi Aturan dan Pembatas Lahan"));
    report("SINGLE_SOURCE_NOTE", constraintsText.split("tidak otomatis menunjukkan batas resmi atau status hukum suatu kawasan").length - 1);
    report("LAND_USE_COVERAGE_LABEL", constraintsText.includes("Cakupan data penggunaan lahan"));
    report("LAND_USE_COVERAGE_DESCRIPTION", constraintsText.includes("Persentase area yang memiliki informasi penggunaan lahan."));
    report("SIMPLE_SOURCE_FEATURE_NOTE", constraintsText.includes("Satu objek pada data sumber tidak dihitung karena bukan merupakan area."));
    report("LAND_USE_CATEGORY_NAMES", await page.locator(".spk-data-row:not(.spk-data-row--head) .spk-data-cell--primary").allTextContents());
    report("SPK_LAYER_CONTROLS", await page.locator("[data-spk-layer]").count());
    report("LAND_USE_LAYER_ENABLED", !(await page.locator("#chk-spk-land-use").isDisabled()));
    report("SENSITIVE_LAYER_CONTROL_ABSENT", await page.locator("#chk-spk-sensitive").count() === 0);
    report("LEGAL_LAYER_CONTROL_ABSENT", await page.locator("#chk-spk-legal").count() === 0);
    report("ADMIN_REGION_FILTERS_PRESENT", await page.locator("#select-kabupaten, #select-kapanewon, #select-kalurahan").count());
    await page.locator("#chk-spk-land-use").evaluate((element) => {
      element.checked = true;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(300);
    report(
      "LAND_USE_MAP_LAYER_VISIBLE",
      await page.evaluate(() => {
        const pane = document.querySelector(".leaflet-spkLandUse-pane");
        return Boolean(pane && pane.querySelectorAll("path").length > 0);
      })
    );
    const landUseLegend = (await page.locator("#map-legend").textContent()).replace(/\s+/g, " ").trim();
    report("LAND_USE_LAYER_LEGEND", landUseLegend.includes("Penggunaan lahan di lokasi ini"));
    await page.screenshot({ path: path.join(OUT, "spk-constraints.png") });
    await page.locator("#chk-spk-land-use").evaluate((element) => {
      element.checked = false;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(300);
    report(
      "LAND_USE_MAP_LAYER_HIDDEN",
      await page.evaluate(() => {
        const pane = document.querySelector(".leaflet-spkLandUse-pane");
        return !pane || pane.querySelectorAll("path").length === 0;
      })
    );
    report(
      "SPK_LEGEND_RESTORED_AFTER_LAYER_HIDE",
      (await page.locator("#map-legend").textContent()).includes("SPK aktif")
    );

    await page.locator('[data-spk-tab="conclusion"]').click();
    await page.waitForTimeout(300);
    const conclusionText = await page.locator("#spk-body").innerText();
    report("CONCLUSION_HEADING", conclusionText.includes("Kesimpulan dan Arahan Tindak Lanjut"));
    report("CONCLUSION_STATUS", conclusionText.includes("Belum Dapat Disimpulkan"));
    report("CONCLUSION_ACTIONS", conclusionText.includes("Arahan Tindak Lanjut"));
    report("CONCLUSION_WLC_RISK", conclusionText.includes("Zona Merah"));
    report("CONCLUSION_HUMAN_DECISION_NOTE", conclusionText.includes("Keputusan akhir tetap berada pada pihak yang berwenang"));
    report("SEGMENT_COMPLETENESS_SEPARATE_FROM_COVERAGE", conclusionText.includes("3 dari 3 lengkap") && conclusionText.includes("26,2%") && conclusionText.includes("73,8%"));
    report("FACTOR_METRICS_DISTINCT", conclusionText.includes("Skor faktor tertinggi") && conclusionText.includes("Bobot profil aktif") && conclusionText.includes("Kontribusi"));
    report("ACTUAL_SLOPE_ROUNDED", conclusionText.includes("10,17°") && !conclusionText.includes("10.168543209876544"));
    report("ALTERNATIVE_COUNTS_ACCURATE", conclusionText.includes("5 belum dapat dievaluasi") && conclusionText.includes("1 dapat dipertimbangkan untuk kajian") && conclusionText.includes("0 diprioritaskan untuk kajian"));
    report("ACTION_ORDER_SEQUENTIAL", JSON.stringify(await page.locator(".spk-followup-priority").allTextContents()) === JSON.stringify(["1", "2", "3", "4", "5"]));
    await page.screenshot({ path: path.join(OUT, "spk-conclusion.png") });
    const desktopFactorScroll = await page.locator(".spk-factor-ranking").evaluate((element) => {
      const scroller = document.getElementById("spk-body");
      return element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    });
    await page.locator("#spk-body").evaluate((element, top) => { element.scrollTop = Math.max(0, top - 10); }, desktopFactorScroll);
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(OUT, "spk-conclusion-factors.png") });
    await page.locator("#spk-body").evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT, "spk-conclusion-details.png") });
    await page.locator("#spk-body").evaluate((element) => { element.scrollTop = 0; });

    await page.locator('[data-spk-tab="decision"]').click();
    await page.waitForTimeout(300);
    const decisionBasisText = await page.locator("#spk-body").innerText();
    report("DECISION_HAS_SYSTEM_BASIS", decisionBasisText.includes("Dasar Keputusan"));
    report("DECISION_AUTHORITY_NOTE_ONCE", decisionBasisText.split("Kesimpulan sistem merupakan bahan pertimbangan berdasarkan data yang tersedia. Keputusan akhir tetap berada pada pihak yang berwenang.").length - 1 === 1);
    await page.locator("#spk-reviewer").fill("Reviewer Uji");
    await page.locator("#spk-decision-status").selectOption("accepted_with_conditions");
    await page.locator("#spk-rationale").fill("Syarat drainase, verifikasi geoteknik, dan cek pembatas legal.");
    await page.screenshot({ path: path.join(OUT, "spk-decision.png") });
    await page.locator("#spk-save-decision").click();
    await page.waitForTimeout(500);
    const finalText = await page.locator("#spk-body").innerText();
    report("DECISION_SAVED", finalText.includes("Hasil Akhir Pemeriksaan"));
    report("FINAL_SYSTEM_CONCLUSION", finalText.includes("Kesimpulan Sistem"));
    report("FINAL_DECISION_STATUS", finalText.includes("Disetujui dengan syarat"));
    report("DECISION_HISTORY", finalText.includes("Reviewer Uji"));
    report("FINAL_LOCAL_ARCHIVE_NOTE", finalText.includes("bukan basis data terpusat"));
    report(
      "LOCAL_STORAGE_COUNT",
      await page.evaluate(() => JSON.parse(localStorage.getItem("lahanaman.spk.reviews.v1") || "[]").length)
    );
    const downloadPromise = page.waitForEvent("download", { timeout: 5000 });
    await page.locator("#spk-final-export").click();
    const download = await downloadPromise;
    report("EXPORT_FILENAME", download.suggestedFilename());
    const exportPath = path.join(OUT, "spk-final.json");
    await download.saveAs(exportPath);
    const exportedRecord = JSON.parse(fs.readFileSync(exportPath, "utf8"));
    report("EXPORT_FORMAT_VERSION", exportedRecord.formatVersion);
    report("EXPORT_HAS_SYSTEM_INTERPRETATION", Boolean(exportedRecord.systemInterpretation && exportedRecord.systemInterpretation.status));
    report("EXPORT_HAS_HUMAN_DECISION", Boolean(exportedRecord.humanDecision && exportedRecord.humanDecision.rationale));
    report("EXPORT_HAS_ASSESSMENT_SNAPSHOT", Boolean(exportedRecord.assessment && exportedRecord.assessment.standard));
    await page.screenshot({ path: path.join(OUT, "spk-final.png") });

    await page.locator("#btn-close-spk").click();
    await page.waitForTimeout(300);
    report("DRAWER_CLOSED", await page.locator("#spk-overlay").isHidden());
    await page.locator("#chk-spk-land-use").evaluate((element) => {
      element.checked = true;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.locator("#sidebar-left .panel-scroll").evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, "spk-layer-sidebar.png") });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.LahanAmanSPKBridge.loadSample());
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.LahanAmanSPKUI.open({ source: "polygon" }));
    await page.waitForSelector("#spk-overlay", { state: "visible", timeout: 10000 });
    await page.locator("#spk-run").click();
    await page.waitForSelector('[data-spk-tab="summary"]', { timeout: 10000 });
    for (const [tab, filename] of [
      ["summary", "spk-mobile-summary.png"],
      ["criteria", "spk-mobile-criteria.png"],
      ["slope", "spk-mobile-slope.png"],
      ["development", "spk-mobile-development.png"],
      ["constraints", "spk-mobile-land-use.png"],
      ["conclusion", "spk-mobile-conclusion.png"],
      ["decision", "spk-mobile-decision.png"],
    ]) {
      await page.locator('[data-spk-tab="' + tab + '"]').click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(OUT, filename) });
      if (tab === "conclusion") {
        const mobileFactorScroll = await page.locator(".spk-factor-ranking").evaluate((element) => {
          const scroller = document.getElementById("spk-body");
          return element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
        });
        await page.locator("#spk-body").evaluate((element, top) => { element.scrollTop = Math.max(0, top - 8); }, mobileFactorScroll);
        await page.waitForTimeout(100);
        await page.screenshot({ path: path.join(OUT, "spk-mobile-conclusion-factors.png") });
        await page.locator("#spk-body").evaluate((element) => { element.scrollTop = element.scrollHeight; });
        await page.waitForTimeout(100);
        await page.screenshot({ path: path.join(OUT, "spk-mobile-conclusion-details.png") });
        await page.locator("#spk-body").evaluate((element) => { element.scrollTop = 0; });
      }
    }
    await page.locator("#spk-reviewer").fill("Reviewer Mobile");
    await page.locator("#spk-decision-status").selectOption("accepted_with_conditions");
    await page.locator("#spk-rationale").fill("Keputusan mensyaratkan verifikasi lapangan.");
    await page.locator("#spk-save-decision").click();
    await page.waitForTimeout(300);
    report("MOBILE_FINAL_RESULT", (await page.locator("#spk-body").innerText()).includes("Hasil Akhir Pemeriksaan"));
    const box = await page.locator("#spk-drawer").boundingBox();
    report("MOBILE_DRAWER_WIDTH", box ? Math.round(box.width) : null);
    report("MOBILE_VIEWPORT_WIDTH", await page.evaluate(() => window.innerWidth));
    report("MOBILE_TAB_COUNT", await page.locator("[data-spk-tab]").count());
    report("MOBILE_BODY_SCROLLABLE", await page.locator("#spk-body").evaluate((element) => element.scrollHeight > element.clientHeight));
    await page.screenshot({ path: path.join(OUT, "spk-mobile-final.png") });
    report("MOBILE_NO_HORIZONTAL_OVERFLOW", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: path.join(OUT, "spk-mobile-conclusion.png") });

    console.log("ERRORS:", errors.length ? JSON.stringify(errors, null, 2) : "none");
    if (errors.length) process.exitCode = 2;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error("SPK_UI_FAILED", error);
  process.exit(1);
});

