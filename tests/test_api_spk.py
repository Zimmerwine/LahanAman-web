import math
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.index import app, calc_infinite_slope_fs, get_soil_params  # noqa: E402


DEMO_POLYGON = {
    "type": "Polygon",
    "coordinates": [
        [
            [110.40119, -7.92426],
            [110.40392, -7.92427],
            [110.40391, -7.92155],
            [110.40119, -7.92155],
            [110.40119, -7.92426],
        ]
    ],
}


class SPKApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app.config["TESTING"] = True
        cls.client = app.test_client()

    def test_segment_endpoint_returns_spk_fields_and_preserves_baseline(self):
        response = self.client.post(
            "/api/analisis-segmen-kavling",
            json={"geometry": DEMO_POLYGON},
        )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(len(payload["features"]), 9)

        summary = payload["summary"]
        self.assertAlmostEqual(summary["total_luas_m2"], 90826.2, places=1)
        self.assertAlmostEqual(summary["luas_poligon_m2"], 90833.2, places=1)
        self.assertAlmostEqual(summary["persen_cakupan"], 100.0, places=1)
        self.assertEqual(summary["jumlah_segmen"], 9)
        self.assertAlmostEqual(summary["beta_mean_kavling"], 10.67, places=2)
        self.assertGreater(summary["land_use_coverage_ratio"], 0.99)
        self.assertEqual(summary["sensitive_indication_count"], 0)

        land_use = payload["land_use"]
        self.assertTrue(land_use["available"])
        self.assertEqual(land_use["status"], "evaluated")
        self.assertEqual(len(land_use["features"]), 9)
        self.assertGreater(land_use["coveredAreaM2"], 89000.0)
        classes = {item["className"]: item for item in land_use["classes"]}
        self.assertIn("Tegalan/Ladang", classes)
        self.assertIn("Kebun", classes)
        self.assertIn("Permukiman", classes)
        self.assertEqual(classes["Tegalan/Ladang"]["featureCount"], 3)
        self.assertFalse(land_use["dataset"]["legalDesignationVerified"])
        self.assertEqual(land_use["dataset"]["sourceInstitution"], None)

        sensitive = payload["sensitive_areas"]
        self.assertTrue(sensitive["available"])
        self.assertEqual(sensitive["summary"]["status"], "not_detected")
        self.assertEqual(sensitive["items"], [])
        self.assertFalse(sensitive["summary"]["legalDesignationVerified"])

        properties = payload["features"][0]["properties"]
        self.assertEqual(set(properties["spk_scores"]), {
            "slope",
            "soil",
            "geology",
            "rainfall",
            "landCover",
        })
        self.assertEqual(set(properties["spk_actual"]), {
            "slopeDeg",
            "soilType",
            "geologyUnit",
            "rainfallMm",
            "landCover",
        })
        self.assertTrue(all(properties["score_completeness"].values()))
        self.assertEqual(properties["data_missing"], [])

        for feature in payload["features"]:
            props = feature["properties"]
            scores = props["spk_scores"]
            expected = (
                scores["slope"] * 0.30
                + scores["soil"] * 0.25
                + scores["geology"] * 0.20
                + scores["rainfall"] * 0.15
                + scores["landCover"] * 0.10
            )
            self.assertAlmostEqual(
                round(expected + 1e-12, 2),
                props["skor_akhir"],
                places=2,
                msg="standard score mismatch for " + str(props.get("segmen_id")),
            )
            zone = props["kategori_zona"].lower()
            if props["skor_akhir"] < 2.2:
                self.assertIn("hijau", zone)
            elif props["skor_akhir"] <= 3.4:
                self.assertIn("kuning", zone)
            else:
                self.assertIn("merah", zone)

    def test_query_endpoint_baseline_is_unchanged(self):
        response = self.client.get("/api/query?lat=-7.602026&lng=110.451126")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["wilayah"]["kalurahan"], "Kepuharjo")
        self.assertEqual(payload["wilayah"]["kapanewon"], "Cangkringan")
        self.assertAlmostEqual(payload["wilayah"]["elevasi_mdpl"], 869.14, places=2)
        self.assertAlmostEqual(payload["skor_internal"]["skor_akhir"], 2.55, places=2)
        self.assertEqual(payload["triase"]["zona"], "Zona Kuning")
        self.assertAlmostEqual(payload["triase"]["fs"], 2.10, places=2)
        self.assertEqual(payload["triase"]["fs_label"], "Aman — KOR-03")
        self.assertEqual(payload["triase"]["sni_label"], "Syarat Aman SNI 8460:2017: FS ≥ 1,50")

    def test_locked_soil_lookup_and_three_mandatory_fs_points(self):
        # 1. Tabel Lookup Parameter Tanah Terkunci (Layer 2)
        expected_soils = {
            "Grumusol": (5, 9.0, 15.0, 19.0, 2.0),
            "Latosol": (4, 10.0, 18.0, 18.5, 2.0),
            "Mediteran": (4, 11.0, 20.0, 18.5, 2.0),
            "Regosol": (3, 3.5, 36.0, 17.5, 1.5),
            "Kambisol": (2, 8.0, 30.0, 18.0, 1.5),
            "Aluvial": (1, 14.0, 25.0, 18.5, 2.0),
        }
        for name, (skor, c_kpa, phi_deg, gamma_sat, z) in expected_soils.items():
            s = get_soil_params(name)
            self.assertEqual(s["skor"], skor)
            self.assertEqual(s["c"], c_kpa)
            self.assertEqual(s["phi"], phi_deg)
            self.assertEqual(s["gamma_sat"], gamma_sat)
            self.assertEqual(s["z"], z)

        # 2. Tes 3 titik wajib di API maupun Excel agar selisihnya <= 0,1%:
        # - Kasus Datar (beta = 0°): Harus mengembalikan 9.99 (bukan error atau NaN).
        res_flat = calc_infinite_slope_fs(0.0, 9.0, 0.0, 15.0, 19.0, 2.0, 0.75, 0.0, soil_str="Grumusol")
        self.assertEqual(res_flat["fs"], 9.99)
        self.assertEqual(res_flat["fs_raw"], 9.99)
        self.assertEqual(res_flat["koridor"], "KOR-02")

        # - Kasus Landai Grumusol (beta = 5°, c' = 9,0 kPa, phi' = 15°, gamma_sat = 19,0 kN/m3, z = 2,0 m, m = 0,75):
        #   Harus menghasilkan 4.6050 dengan toleransi selisih <= 0,1% (tampil 4.61 / 4.60).
        res_grumusol = calc_infinite_slope_fs(5.0, 9.0, 0.0, 15.0, 19.0, 2.0, 0.75, 0.0, soil_str="Grumusol")
        self.assertLessEqual(abs(res_grumusol["fs_raw"] - 4.6050) / 4.6050, 0.001)
        self.assertIn(res_grumusol["fs"], (4.60, 4.61))
        self.assertEqual(res_grumusol["koridor"], "KOR-02")

        # - Kasus Kritis Latosol (beta = 20°, c' = 10,0 kPa, phi' = 18°, gamma_sat = 18,5 kN/m3, z = 2,0 m, m = 0,75):
        #   Harus menghasilkan 1.3786 dengan toleransi selisih <= 0,1% (tampil 1.38, status Tidak Aman — KOR-04).
        res_latosol = calc_infinite_slope_fs(20.0, 10.0, 0.0, 18.0, 18.5, 2.0, 0.75, 0.0, soil_str="Latosol")
        self.assertLessEqual(abs(res_latosol["fs_raw"] - 1.3786) / 1.3786, 0.001)
        self.assertEqual(res_latosol["fs"], 1.38)
        self.assertEqual(res_latosol["koridor"], "KOR-04")
        self.assertEqual(res_latosol["label"], "Tidak Aman — KOR-04")
        self.assertGreaterEqual(res_latosol["fs_pasca"], 1.50)

    def test_invalid_geometry_returns_clear_error(self):
        response = self.client.post(
            "/api/analisis-segmen-kavling",
            json={"geometry": {"type": "Point", "coordinates": [110.4, -7.9]}},
        )
        self.assertEqual(response.status_code, 400)
        payload = response.get_json()
        self.assertEqual(payload["status"], "error")
        self.assertTrue(payload["message"])

    def test_sensitive_candi_is_an_indication_not_a_legal_determination(self):
        cx, cy = 110.487968, -7.752366
        polygon = {
            "type": "Polygon",
            "coordinates": [
                [
                    [cx - 0.001, cy - 0.001],
                    [cx + 0.001, cy - 0.001],
                    [cx + 0.001, cy + 0.001],
                    [cx - 0.001, cy + 0.001],
                    [cx - 0.001, cy - 0.001],
                ]
            ],
        }
        response = self.client.post(
            "/api/analisis-segmen-kavling",
            json={"geometry": polygon},
        )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        land_use_classes = {item["className"] for item in payload["land_use"]["classes"]}
        self.assertIn("Candi Prambanan", land_use_classes)

        sensitive = payload["sensitive_areas"]
        self.assertEqual(sensitive["summary"]["status"], "indication_detected")
        item = next(
            entry for entry in sensitive["items"] if entry["id"] == "cultural_candi_prambanan"
        )
        self.assertEqual(item["status"], "indication_detected")
        self.assertEqual(item["sourceClass"], "Candi Prambanan")
        self.assertFalse(item["binding"])
        self.assertFalse(item["authoritative"])
        self.assertFalse(item["legalDesignationVerified"])
        self.assertTrue(item["geometryAvailable"])
        self.assertGreater(item["areaM2"], 0)
        self.assertGreater(len(sensitive["features"]), 0)
        self.assertFalse(sensitive["summary"]["officialBoundaryAvailable"])

    def test_polygon_area_supports_multipolygon_components(self):
        multi = {
            "type": "MultiPolygon",
            "coordinates": [DEMO_POLYGON["coordinates"]],
        }
        response = self.client.post(
            "/api/analisis-segmen-kavling",
            json={"geometry": multi},
        )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(math.isclose(payload["summary"]["luas_poligon_m2"], 90833.2, abs_tol=0.2))
        self.assertEqual(payload["summary"]["jumlah_segmen"], 9)


if __name__ == "__main__":
    unittest.main()
