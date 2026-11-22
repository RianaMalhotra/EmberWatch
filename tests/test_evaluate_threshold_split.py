"""Tests for the held-out threshold evaluation (#56)."""

import csv
import os

import pytest

import evaluate_threshold_split as ev
from backtest_threshold import choose_threshold, metrics_from_counts

COUNT_COLUMNS = ("true_positives", "false_positives", "false_negatives", "true_negatives")


def write_results(folder, year, counts):
    """Write a minimal backtest_<year>.csv. counts: {threshold: (tp, fp, fn, tn)}."""
    path = os.path.join(folder, f"backtest_{year}.csv")
    with open(path, "w", newline="", encoding="utf-8") as target:
        writer = csv.writer(target)
        writer.writerow(["threshold", *COUNT_COLUMNS])
        for threshold, values in counts.items():
            writer.writerow([threshold, *values])


# Thresholds 0 / 50 / 100. Training years: 50 keeps 92% of fires and drops 80% of
# one-offs, 100 drops half the fires, 0 keeps everything.
TRAIN = {0: (100, 50, 0, 0), 50: (92, 10, 8, 40), 100: (50, 0, 50, 50)}
# A test year where 100 would have looked better than 50, but must not be chosen.
TEST = {0: (100, 50, 0, 0), 50: (80, 30, 20, 20), 100: (60, 0, 40, 50)}


def synthetic():
    return {2023: TRAIN, 2024: TRAIN, 2025: TEST}


def test_pool_sums_counts_per_threshold():
    pooled = ev.pool({2023: TRAIN, 2024: TRAIN}, [2023, 2024])
    assert pooled[50] == (184, 20, 16, 80)


def test_pool_rejects_missing_year_and_mismatched_thresholds():
    with pytest.raises(ValueError):
        ev.pool({2023: TRAIN}, [2023, 2024])
    with pytest.raises(ValueError):
        ev.pool({2023: TRAIN, 2024: {0: (1, 1, 1, 1)}}, [2023, 2024])
    with pytest.raises(ValueError):
        ev.pool({}, [])


def test_threshold_is_chosen_on_training_years_only():
    split = ev.evaluate_split(synthetic(), [2023, 2024], [2025])
    assert split["threshold"] == 50  # 100 fails the 90% recall rule on the training years
    assert split["test"] == metrics_from_counts(50, *TEST[50])
    assert split["test"]["true_positives"] == 80
    assert split["test_no_filter"]["precision"] == pytest.approx(100 / 150, abs=1e-4)


def test_training_and_test_years_must_not_overlap():
    with pytest.raises(ValueError):
        ev.evaluate_split(synthetic(), [2023, 2024], [2024, 2025])


def test_leave_one_year_out_gives_one_fold_per_year():
    folds = ev.leave_one_year_out(synthetic())
    assert [fold["test_years"] for fold in folds] == [[2023], [2024], [2025]]
    for fold in folds:
        assert fold["test_years"][0] not in fold["train_years"]


def test_choose_threshold_falls_back_when_none_meet_min_recall_and_ties_go_higher():
    results = [metrics_from_counts(t, *c) for t, c in {0: (10, 10, 0, 0), 50: (6, 5, 4, 5)}.items()]
    assert choose_threshold(results, min_recall=0.99)["threshold"] == 0  # only 0 qualifies
    results = [metrics_from_counts(t, *c) for t, c in {10: (9, 4, 1, 6), 20: (9, 4, 1, 6)}.items()]
    assert choose_threshold(results, min_recall=0.5)["threshold"] == 20  # tie -> higher


def test_report_shows_confusion_matrix_and_flags_recall_below_target():
    split = ev.evaluate_split(synthetic(), [2023, 2024], [2025])
    report = ev.format_report(split)
    assert "actually real" in report and "actually one-off" in report
    assert "NOTE: held-out recall" in report  # 0.80 < 0.90 target
    assert "threshold 0" in report  # shows what no filter would give


def test_cli_writes_main_split_and_one_fold_per_year(tmp_path, capsys):
    for year, counts in synthetic().items():
        write_results(tmp_path, year, counts)
    output = tmp_path / "evaluation.csv"
    ev.main(["--results-dir", str(tmp_path), "--output", str(output)])
    rows = list(csv.DictReader(open(output, newline="", encoding="utf-8")))
    assert [r["split"] for r in rows] == ["time-ordered"] + ["leave-one-year-out"] * 3
    assert rows[0]["train_years"] == "2023+2024" and rows[0]["test_years"] == "2025"
    assert int(rows[0]["true_positives"]) == 80
    assert "persistence proxy" in capsys.readouterr().out


def test_cli_needs_at_least_two_years(tmp_path):
    write_results(tmp_path, 2023, TRAIN)
    with pytest.raises(SystemExit):
        ev.main(["--results-dir", str(tmp_path), "--output", str(tmp_path / "x.csv")])


# The numbers in docs/threshold-backtest.md come from the committed results.
# If ml/results is regenerated these fail: update the docs, then this test.

def committed():
    years = ev.find_years()
    assert years == [2023, 2024, 2025]
    return ev.load_years(years)


def test_metrics_from_counts_match_the_committed_backtest_files():
    for year in (2023, 2024, 2025):
        with open(os.path.join(ev.RESULTS_DIR, f"backtest_{year}.csv"), newline="", encoding="utf-8") as source:
            for row in csv.DictReader(source):
                m = metrics_from_counts(int(row["threshold"]), *(int(row[c]) for c in COUNT_COLUMNS))
                for field in ("precision", "recall", "false_positive_rate", "youden_j", "f1", "kept_share"):
                    assert m[field] == pytest.approx(float(row[field]), abs=1e-9), (year, row["threshold"], field)


def test_committed_results_headline_numbers():
    split = ev.evaluate_split(committed(), [2023, 2024], [2025])
    assert split["threshold"] == 20
    test = split["test"]
    assert (test["true_positives"], test["false_positives"],
            test["false_negatives"], test["true_negatives"]) == (109640, 28786, 13713, 4160)
    assert test["precision"] == 0.792 and test["recall"] == 0.8888


#fixed threshold report and the burned-area (NBAC) results

def test_fixed_threshold_is_scored_on_every_year_next_to_no_filter():
    rows = ev.evaluate_fixed_threshold(synthetic(), 50)
    assert [row["year"] for row in rows] == [2023, 2024, 2025]
    assert rows[2]["at_threshold"] == metrics_from_counts(50, *TEST[50])
    assert rows[2]["no_filter"] == metrics_from_counts(0, *TEST[0])
    text = ev.format_fixed_threshold(rows, 50)
    assert "Fixed threshold 50" in text and "2025" in text and "drops real / one-off" in text
    assert "drops inside / outside" in ev.format_fixed_threshold(rows, 50, "nbac")


def test_fixed_threshold_that_was_never_scored_is_rejected():
    with pytest.raises(ValueError, match="not scored"):
        ev.evaluate_fixed_threshold(synthetic(), 37)


def test_cli_reports_a_fixed_threshold(tmp_path, capsys):
    for year, counts in synthetic().items():
        write_results(tmp_path, year, counts)
    ev.main(["--results-dir", str(tmp_path), "--output", str(tmp_path / "e.csv"), "--report-threshold", "50"])
    assert "Fixed threshold 50" in capsys.readouterr().out
    with pytest.raises(SystemExit):
        ev.main(["--results-dir", str(tmp_path), "--output", str(tmp_path / "e.csv"), "--report-threshold", "37"])


# The burned-area numbers in docs/threshold-backtest.md come from ml/results/nbac_<year>.csv.
# If those are regenerated these fail: update the docs, then this test.

def committed_nbac():
    years = ev.find_years(prefix="nbac")
    assert years == [2023, 2024, 2025]
    return ev.load_years(years, prefix="nbac")


def test_committed_nbac_results_choose_no_filter_in_every_fold():
    for fold in ev.leave_one_year_out(committed_nbac()):
        assert fold["threshold"] == 0


def test_committed_nbac_results_for_the_deployed_threshold_of_20():
    by_year = {row["year"]: row for row in ev.evaluate_fixed_threshold(committed_nbac(), 20)}
    at = {year: (row["at_threshold"]["precision"], row["at_threshold"]["recall"],
                 row["at_threshold"]["false_positive_rate"]) for year, row in by_year.items()}
    assert at == {2023: (0.9717, 0.9038, 0.9055), 2024: (0.9488, 0.904, 0.9153), 2025: (0.9496, 0.8845, 0.9086)}
    assert [by_year[y]["no_filter"]["precision"] for y in (2023, 2024, 2025)] == [0.9717, 0.9494, 0.9509]
