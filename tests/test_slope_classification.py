import unittest

from scripts.slope_classification import resolve_slope_degree
from scripts.pipeline_data import eval_slope_score
from scripts.build_pipeline_from_raw import eval_slope


class SlopeClassificationTests(unittest.TestCase):
    def test_valid_sample_is_not_clamped_to_previous_score(self):
        self.assertEqual(resolve_slope_degree(35.1, 4), 35.1)
        self.assertEqual(resolve_slope_degree(7.25, 5), 7.25)

    def test_downloaded_benchmark_boundary_value_moves_to_degree_class(self):
        beta_mean = resolve_slope_degree(8.040142440795899, 1)
        self.assertEqual(beta_mean, 8.04)
        self.assertEqual(eval_slope_score(beta_mean)[0], 2)

    def test_missing_or_invalid_sample_uses_previous_class_midpoint(self):
        self.assertEqual(resolve_slope_degree(None, 3), 20.0)
        self.assertEqual(resolve_slope_degree(float("nan"), 2), 11.5)
        self.assertEqual(resolve_slope_degree(90.0, 9), 3.5)

    def test_pipeline_classifiers_share_the_degree_boundaries(self):
        expected = [(8.0, 1), (8.01, 2), (15.0, 2), (15.01, 3), (25.0, 3), (25.01, 4), (35.0, 4), (35.01, 5)]
        for degrees, score in expected:
            with self.subTest(degrees=degrees):
                self.assertEqual(eval_slope_score(degrees)[0], score)
                self.assertEqual(eval_slope(degrees)[0], score)


if __name__ == "__main__":
    unittest.main()
