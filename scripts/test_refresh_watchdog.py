"""Unit tests for the FIRMS GitHub Actions refresh watchdog (no network)."""
import unittest
from datetime import datetime, timedelta, timezone

from refresh_watchdog import check_refresh, MAX_AGE_HOURS

NOW = datetime(2026, 11, 22, 12, 0, tzinfo=timezone.utc)


def run(hours_ago, conclusion="success", field="run_completed_at"):
    return {
        "conclusion": conclusion,
        field: (NOW - timedelta(hours=hours_ago)).isoformat().replace("+00:00", "Z"),
    }


class RefreshWatchdogTests(unittest.TestCase):
    def test_fresh(self):
        self.assertLessEqual(check_refresh([run(2)], NOW), MAX_AGE_HOURS)

    def test_boundary(self):
        self.assertEqual(check_refresh([run(7)], NOW), 7)

    def test_stale(self):
        with self.assertRaisesRegex(ValueError, "stale"):
            check_refresh([run(8)], NOW)

    def test_missing_success(self):
        with self.assertRaisesRegex(ValueError, "No successful"):
            check_refresh([run(1, "failure")], NOW)

    def test_empty_history(self):
        with self.assertRaisesRegex(ValueError, "No successful"):
            check_refresh([], NOW)

    def test_invalid_timestamp(self):
        with self.assertRaisesRegex(ValueError, "Invalid"):
            check_refresh([{"conclusion": "success", "run_completed_at": "bad"}], NOW)

    def test_missing_timestamp(self):
        with self.assertRaisesRegex(ValueError, "Invalid"):
            check_refresh([{"conclusion": "success"}], NOW)

    def test_future_timestamp(self):
        with self.assertRaisesRegex(ValueError, "future"):
            check_refresh([run(-1)], NOW)

    def test_latest_success_wins(self):
        self.assertEqual(check_refresh([run(12), run(2), run(1, "failure")], NOW), 2)

    def test_updated_at_does_not_mask_old_completion(self):
        old = run(10)
        old["updated_at"] = NOW.isoformat()
        with self.assertRaisesRegex(ValueError, "stale"):
            check_refresh([old], NOW)


if __name__ == "__main__":
    unittest.main()
