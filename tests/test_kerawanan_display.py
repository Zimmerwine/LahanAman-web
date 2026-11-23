import json
import unittest

import shapely
from shapely.geometry import shape

from scripts import prepare_kerawanan_display as display


class KerawananDisplayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = display.run()
        cls.data = json.loads(display.OUTPUT.read_text(encoding="utf-8"))
        cls.app_data = json.loads(display.APP_OUTPUT.read_text(encoding="utf-8"))

    def test_source_feature_count_and_red_count_are_preserved(self):
        source = json.loads(display.SOURCE.read_text(encoding="utf-8"))
        self.assertEqual(len(self.data["features"]), len(source["features"]))
        self.assertEqual(self.app_data, self.data)
        self.assertEqual(len(self.report["red_feature_audit"]), 230)
        self.assertEqual(self.report["red_displayable_polygon_count"], 230)

    def test_polygon_display_geometries_are_valid_without_converting_lines(self):
        lines = []
        for feature in self.data["features"]:
            geom = shape(feature["geometry"])
            props = feature["properties"]
            self.assertIn(geom.geom_type, {"Polygon", "MultiPolygon"})
            self.assertTrue(geom.is_valid)
            if props.get("_display_geometry_original_type") == "LineString":
                lines.append(geom.geom_type)
        self.assertEqual(lines, [])

    def test_source_is_not_rewritten(self):
        report = json.loads(display.REPORT.read_text(encoding="utf-8"))
        self.assertTrue(report["source_unchanged"])
        self.assertTrue(display.SOURCE.exists())


if __name__ == "__main__":
    unittest.main()
