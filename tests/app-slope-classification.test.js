const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.join(__dirname, "../Web/app.js"), "utf8");
const functionSource = appSource.match(
  /function evaluasiKemiringanLereng\(derajatInput, persenInput\) \{[\s\S]*?\n  \}/
);
assert.ok(functionSource, "Slope evaluator should remain defined in Web/app.js");
const evaluasiKemiringanLereng = vm.runInNewContext(`(${functionSource[0]})`);

test("degree thresholds govern classification when rounded percent is supplied", () => {
  const cases = [
    [8, 14.05, 1],
    [8.01, 14.08, 2],
    [15, 26.79, 2],
    [15.01, 26.83, 3],
    [25, 46.63, 3],
    [25.01, 46.65, 4],
    [35, 70.02, 4],
    [35.01, 70.04, 5],
  ];

  for (const [degrees, percent, expectedScore] of cases) {
    assert.equal(evaluasiKemiringanLereng(degrees, percent).skor, expectedScore, `${degrees}°`);
  }
});

test("all stored kerawanan slope scores match the degree-based evaluator", () => {
  const dataPath = path.join(__dirname, "../public/data/clean_kerawanan_longsor.geojson");
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const mismatches = data.features.filter((feature) => {
    const props = feature.properties || {};
    return evaluasiKemiringanLereng(props.lereng_derajat, props.lereng_persen).skor !== Number(props.skor_lereng);
  });

  assert.equal(data.features.length, 915);
  assert.deepEqual(
    mismatches.map((feature) => feature.properties.fid),
    []
  );
});
