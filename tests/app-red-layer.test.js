const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "Web/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "Web/app.js"), "utf8");

test("kerawanan checkbox starts enabled and header calls its count administrative", () => {
  assert.match(html, /id="chk-kerawanan-longsor"\s+checked/);
  assert.match(html, /title="Jumlah satuan administrasi, bukan jumlah polygon kerawanan">Administrasi/);
  assert.match(html, /id="kerawanan-feature-count"/);
});

test("startup enables the layer after data loading and tracks polygon counts separately", () => {
  assert.match(app, /if \(chkKerawananDefault && chkKerawananDefault\.checked\)\s*\{\s*await toggleKerawananLongsor\(true\);/);
  assert.match(app, /state\.kerawananFeatures\.filter\(isPolygonFeature\)/);
  assert.match(app, /polygonFeatures\.length \+ " poligon · Merah " \+ redCount/);
  assert.match(app, /" poligon · Merah " \+ redCount/);
});

test("display-only geometry asset is loaded separately from the source GeoJSON", () => {
  assert.match(app, /fetchGeoJSON\("clean_kerawanan_longsor_display\.geojson"\)/);
  assert.equal(fs.existsSync(path.join(root, "public/data/clean_kerawanan_longsor_display.geojson")), true);
  assert.equal(fs.existsSync(path.join(root, "public/data/clean_kerawanan_longsor.geojson")), true);
});
