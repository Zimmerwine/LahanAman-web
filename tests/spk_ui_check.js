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

    await page.locator("#btn-open-spk-panel").click();
    await page.waitForSelector("#spk-overlay", { state: "visible", timeout: 10000 });
    report("DRAWER_OPEN", await page.locator("#spk-drawer").isVisible());
    report("CONFIG_HEADING", (await page.locator("#spk-body").innerText()).includes("Pilih profil bobot"));
    report("CONFIG_COVERAGE", (await page.locator("#spk-body").innerText()).includes("26,2%"));
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
    report("CUSTOM_BANNER", (await page.locator("#spk-body").innerText()).includes("Indeks kustom belum terkalibrasi"));
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
    report("NO_PREFERRED_FOR_UNKNOWN_LEGAL", (await page.locator("#spk-body").innerText()).includes("Belum ada skenario yang dapat diutamakan"));
    report("NO_DESIGN_NUMBERS", (await page.locator("#spk-body").innerText()).includes("Tidak ada volume cut/fill"));
    await page.screenshot({ path: path.join(OUT, "spk-development.png") });

    await page.locator('[data-spk-tab="constraints"]').click();
    await page.waitForTimeout(300);
    const constraintsText = await page.locator("#spk-body").innerText();
    report("CONSTRAINTS_COUNT", await page.locator(".spk-constraint").count());
    report("LAND_USE_SECTION", constraintsText.includes("Penggunaan Lahan di Area yang Dianalisis"));
    report("LAND_USE_ROWS", await page.locator(".spk-data-table .spk-data-row:not(.spk-data-row--head)").count());
    report("SENSITIVE_SECTION", constraintsText.includes("Objek dan Kawasan yang Perlu Diperhatikan"));
    report("SENSITIVE_NO_DATA_NOTE", constraintsText.includes("bukan verifikasi bahwa lokasi bebas objek atau kawasan sensitif"));
    report("LEGAL_SECTION", constraintsText.includes("Verifikasi Aturan dan Pembatas Lahan"));
    report("LEGAL_STATUS_NOT_EVALUATED", constraintsText.includes("NOT EVALUATED"));
    report("LEGAL_DISCLAIMER", constraintsText.includes("bukan berarti tidak ada batasan"));
    report("SPK_LAYER_CONTROLS", await page.locator("[data-spk-layer]").count());
    report("LAND_USE_LAYER_ENABLED", !(await page.locator("#chk-spk-land-use").isDisabled()));
    report("SENSITIVE_LAYER_DISABLED_WITHOUT_FEATURES", await page.locator("#chk-spk-sensitive").isDisabled());
    report("LEGAL_LAYER_DISABLED", await page.locator("#chk-spk-legal").isDisabled());
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
    report("LAND_USE_LAYER_LEGEND", landUseLegend.includes("Guna lahan - informasi sumber"));
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

    await page.locator('[data-spk-tab="decision"]').click();
    await page.waitForTimeout(300);
    await page.locator("#spk-reviewer").fill("Reviewer Uji");
    await page.locator("#spk-decision-status").selectOption("accepted_with_conditions");
    await page.locator("#spk-rationale").fill("Syarat drainase, verifikasi geoteknik, dan cek pembatas legal.");
    await page.locator("#spk-save-decision").click();
    await page.waitForTimeout(500);
    report("DECISION_SAVED", (await page.locator("#spk-body").innerText()).includes("Keputusan tersimpan lokal"));
    report("DECISION_HISTORY", (await page.locator("#spk-body").innerText()).includes("Reviewer Uji"));
    report(
      "LOCAL_STORAGE_COUNT",
      await page.evaluate(() => JSON.parse(localStorage.getItem("lahanaman.spk.reviews.v1") || "[]").length)
    );
    const downloadPromise = page.waitForEvent("download", { timeout: 5000 });
    await page.locator("#spk-export-decision").click();
    const download = await downloadPromise;
    report("EXPORT_FILENAME", download.suggestedFilename());
    await page.screenshot({ path: path.join(OUT, "spk-decision.png") });

    await page.locator("#btn-close-spk").click();
    await page.waitForTimeout(300);
    report("DRAWER_CLOSED", await page.locator("#spk-overlay").isHidden());

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.LahanAmanSPKBridge.loadSample());
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.LahanAmanSPKUI.open({ source: "polygon" }));
    await page.waitForSelector("#spk-overlay", { state: "visible", timeout: 10000 });
    await page.locator("#spk-run").click();
    await page.waitForSelector('[data-spk-tab="summary"]', { timeout: 10000 });
    const box = await page.locator("#spk-drawer").boundingBox();
    report("MOBILE_DRAWER_WIDTH", box ? Math.round(box.width) : null);
    report("MOBILE_VIEWPORT_WIDTH", await page.evaluate(() => window.innerWidth));
    report("MOBILE_TAB_COUNT", await page.locator("[data-spk-tab]").count());
    report("MOBILE_BODY_SCROLLABLE", await page.locator("#spk-body").evaluate((element) => element.scrollHeight > element.clientHeight));
    await page.screenshot({ path: path.join(OUT, "spk-mobile.png") });

    console.log("ERRORS:", errors.length ? JSON.stringify(errors, null, 2) : "none");
    if (errors.length) process.exitCode = 2;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error("SPK_UI_FAILED", error);
  process.exit(1);
});

