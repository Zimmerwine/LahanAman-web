import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin
from shapely.geometry import LineString, MultiPolygon, Polygon, box

from scripts import slope_regeneration as regen


class SlopeClassificationTests(unittest.TestCase):
    def test_slope_boundaries(self):
        self.assertEqual([regen.slope_score(x) for x in (0, 8, 8.0001, 15, 15.001, 25, 25.001, 35, 35.001)], [1, 1, 2, 2, 3, 3, 4, 4, 5])

    def test_percent_is_derived_from_degree_mean(self):
        self.assertAlmostEqual(regen.slope_percent(45), 100.0)
        self.assertIsNone(regen.slope_percent(90))

    def test_wlc_keeps_operational_weights_and_thresholds(self):
        score = regen.wlc_score({"skor_lereng": 2, "skor_tanah": 3, "skor_batuan": 4, "skor_hujan": 2, "skor_lahan": 1})
        self.assertEqual(score, 2.55)
        self.assertEqual(regen.zone_for_wlc(2.19), "Hijau")
        self.assertEqual(regen.zone_for_wlc(2.20), "Kuning")
        self.assertEqual(regen.zone_for_wlc(3.40), "Kuning")
        self.assertEqual(regen.zone_for_wlc(3.41), "Merah")

    def test_candidate_wlc_changes_only_with_slope_score(self):
        props = {"lereng_derajat": 8.04, "skor_lereng": 1, "skor_tanah": 3, "skor_batuan": 2, "skor_hujan": 3, "skor_lahan": 1}
        stats = {"sampling_status": "ok", "candidate_eligible": True, "candidate_method": "pixel_center", "mean": 8.04, "median": 8.0, "min": 5.0, "max": 10.0, "std": 1.0, "p25": 7.0, "p75": 9.0}
        candidate = regen._candidate_values(props, stats)
        self.assertEqual(candidate["slope_candidate_score"], 2)
        self.assertAlmostEqual(candidate["slope_candidate_wlc_recomputed"] - candidate["slope_old_wlc_recomputed_same_other_scores"], 0.3)


class RasterSamplingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "synthetic_slope.tif"
        arr = np.full((20, 20), 10.0, dtype=np.float32)
        arr[:, 10:] = 30.0
        arr[0, 0] = -9999
        with rasterio.open(self.path, "w", driver="GTiff", width=20, height=20, count=1, dtype="float32", crs="EPSG:32749", transform=from_origin(500000, 9200000, 10, 10), nodata=-9999) as dst:
            dst.write(arr, 1)
        self.src = rasterio.open(self.path)

    def tearDown(self):
        self.src.close()
        self.temp.cleanup()

    def test_nodata_is_excluded_and_sampling_is_reproducible(self):
        geom = box(500000, 9199800, 500200, 9200000)
        first = regen.sample_geometry(geom, "EPSG:32749", self.src)
        second = regen.sample_geometry(geom, "EPSG:32749", self.src)
        self.assertEqual(first["mean"], second["mean"])
        self.assertEqual(first["valid_count"], 399)
        self.assertEqual(first["sampling_status"], "ok")

    def test_large_polygon_statistics_exclude_nodata(self):
        geom = box(500000, 9199800, 500200, 9200000)
        stats = regen.sample_geometry(geom, "EPSG:32749", self.src)
        self.assertEqual(stats["valid_count"], 399)
        self.assertAlmostEqual(stats["mean"], (199 * 10 + 200 * 30) / 399)
        self.assertEqual(stats["sampling_status"], "ok")

    def test_raster_edge_window_is_clipped_safely(self):
        geom = box(500000, 9199990, 500020, 9200000)
        stats = regen.sample_geometry(geom, "EPSG:32749", self.src)
        self.assertEqual(stats["selected_pixel_count"], 2)
        self.assertEqual(stats["valid_count"], 1)
        self.assertEqual(stats["sampling_status"], "insufficient_coverage")

    def test_polygon_without_raster_pixels_is_insufficient(self):
        geom = box(501000, 9201000, 501020, 9201020)
        stats = regen.sample_geometry(geom, "EPSG:32749", self.src)
        self.assertEqual(stats["valid_count"], 0)
        self.assertEqual(stats["sampling_status"], "insufficient_coverage")

    def test_small_polygon_fails_minimum_pixel_rule(self):
        geom = box(500004, 9199996, 500006, 9199994)
        stats = regen.sample_geometry(geom, "EPSG:32749", self.src)
        self.assertLess(stats["valid_count"], regen.MIN_VALID_PIXELS)
        self.assertEqual(stats["sampling_status"], "insufficient_coverage")

    def test_partial_raster_coverage_is_reported(self):
        geom = box(499900, 9199900, 500100, 9200100)
        stats = regen.sample_geometry(geom, "EPSG:32749", self.src)
        self.assertLess(stats["raster_extent_overlap_ratio"], 1.0)
        self.assertEqual(stats["sampling_status"], "insufficient_coverage")

    def test_area_weighted_mean_uses_exact_pixel_intersection_areas(self):
        geom = box(500095, 9199990, 500105, 9200000)
        stats = regen._area_weighted_summary(geom, self.src)
        self.assertAlmostEqual(stats["mean"], 20.0)
        self.assertAlmostEqual(stats["valid_coverage_ratio"], 1.0)
        self.assertAlmostEqual(stats["effective_pixel_support"], 2.0)

    def test_small_polygon_without_center_support_uses_provisional_area_weighted_value(self):
        geom = box(500095, 9199995, 500105, 9199999)
        stats = regen.sample_geometry(geom, "EPSG:32749", self.src)
        self.assertEqual(stats["sampling_status"], "provisional")
        self.assertEqual(stats["candidate_method"], "area_weighted")
        self.assertTrue(stats["candidate_eligible"])
        self.assertEqual(stats["slope_quality"], "PROVISIONAL")
        self.assertEqual(stats["slope_unit_status"], "unit_unverified")

    def test_area_weighted_coverage_remains_insufficient_when_nodata_dominates(self):
        geom = box(500000, 9199990, 500010, 9200000)
        stats = regen.sample_geometry(geom, "EPSG:32749", self.src)
        self.assertEqual(stats["sampling_status"], "insufficient_coverage")
        self.assertFalse(stats["candidate_eligible"])


    def test_multipart_and_all_touched_are_reported_separately(self):
        geom = MultiPolygon([box(500000, 9199900, 500050, 9199950), box(500150, 9199850, 500200, 9199900)])
        stats = regen.sample_geometry(geom, "EPSG:32749", self.src)
        self.assertGreater(stats["valid_count"], 0)
        self.assertGreaterEqual(stats["all_touched_valid_pixel_count"], stats["valid_count"])
        self.assertIn(stats["sampling_status"], {"ok", "insufficient_coverage"})

    def test_invalid_geometry_is_repaired_for_sampling_only(self):
        bowtie = Polygon([(500000, 9199900), (500100, 9199800), (500000, 9199800), (500100, 9199900), (500000, 9199900)])
        stats = regen.sample_geometry(bowtie, "EPSG:32749", self.src)
        self.assertFalse(stats["original_geometry_valid"])
        self.assertEqual(stats["geometry_status"], "repaired_for_sampling")

    def test_different_crs_is_transformed(self):
        geom = box(110.0, -7.0, 111.0, -6.0)
        stats = regen.sample_geometry(geom, "EPSG:4326", self.src)
        self.assertEqual(stats["sampling_status"], "insufficient_coverage")

    def test_nonpolygon_geometry_stays_insufficient_without_synthetic_score(self):
        stats = regen.sample_geometry(LineString([(500000, 9199990), (500010, 9199990)]), "EPSG:32749", self.src)
        candidate = regen._candidate_values({}, stats)
        self.assertEqual(stats["slope_quality"], "INSUFFICIENT DATA")
        self.assertIsNone(candidate["slope_candidate_deg"])
        self.assertIsNone(candidate["slope_candidate_score"])
        self.assertIsNone(candidate["slope_candidate_wlc_recomputed"])


class BTL05RegressionTests(unittest.TestCase):
    def test_btl05_source_anomaly_and_candidate_score_are_preserved(self):
        path = regen.OUT_DIR / "btL05_validation.json"
        if not path.exists():
            self.skipTest("Regeneration output has not been generated in this checkout.")
        data = json.loads(path.read_text(encoding="utf-8"))
        rows = data.get("source_rows", [])
        self.assertTrue(rows, "BTL-05 row must be present in the local benchmark audit")
        row = rows[0]
        self.assertEqual(row.get("id-kavling"), "BTL-05")
        self.assertAlmostEqual(float(row.get("beta_mean")), 8.040142440795899, places=5)
        self.assertEqual(int(row.get("skor_lereng")), 1)
        self.assertEqual(row.get("slope_sampling_method"), "pixel_center")
        if row.get("slope_candidate_deg") is not None:
            self.assertEqual(row.get("slope_candidate_score"), regen.slope_score(row["slope_candidate_deg"]))


if __name__ == "__main__":
    unittest.main()
