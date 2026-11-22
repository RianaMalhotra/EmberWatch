"""Evaluate the detection confidence threshold on held-out years (#56).

The #19 backtest (``backtest_threshold.py``) picks a threshold and scores it
on the same year of data. This script adds the missing train/evaluation
split: the threshold is chosen on training years only, then scored on years
the choice never saw.

* Main split (time-ordered, like real use: learn from the past, apply to the
  future): train on every year except the latest, test on the latest.
* Leave-one-year-out check: each year takes a turn as the test year. With
  only a few seasons this shows how stable the choice is.

It works from the per-threshold results ``backtest_threshold.py`` already
writes (``ml/results/backtest_<year>.csv``). Confusion-matrix counts add up
across years, so training years are pooled by summing counts. No raw FIRMS
files are needed and it uses only the standard library.

Answer key: the labels come from the persistence proxy in
``backtest_threshold.py`` (a detection is "real" if it is seen again nearby
within 72 hours). That is a proxy, not field-verified ground truth, so every
number here is a proxy-based estimate and not a validated accuracy.

Usage (from the repository root):

    python ml/evaluate_threshold_split.py
    python ml/evaluate_threshold_split.py --train 2023 2024 --test 2025
"""

import argparse
import csv
import glob
import os
import re

from backtest_threshold import choose_threshold, metrics_from_counts

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS_DIR = os.path.join(HERE, "results")
OUTPUT_CSV = os.path.join(RESULTS_DIR, "threshold_split_evaluation.csv")
COUNT_FIELDS = ("true_positives", "false_positives", "false_negatives", "true_negatives")


def load_counts(path):
    """Read one backtest results CSV into {threshold: (tp, fp, fn, tn)}."""
    counts = {}
    with open(path, newline="", encoding="utf-8") as source:
        for row in csv.DictReader(source):
            counts[int(row["threshold"])] = tuple(int(row[field]) for field in COUNT_FIELDS)
    if not counts:
        raise ValueError(f"No threshold rows in {path}")
    return counts


def find_years(results_dir=RESULTS_DIR):
    """Years that have a backtest_<year>.csv in the results folder."""
    years = []
    for path in glob.glob(os.path.join(results_dir, "backtest_*.csv")):
        match = re.fullmatch(r"backtest_(\d{4})\.csv", os.path.basename(path))
        if match:
            years.append(int(match.group(1)))
    return sorted(years)


def load_years(years, results_dir=RESULTS_DIR):
    return {year: load_counts(os.path.join(results_dir, f"backtest_{year}.csv")) for year in years}


def pool(counts_by_year, years):
    """Sum the counts of several years, threshold by threshold."""
    if not years:
        raise ValueError("Need at least one year.")
    missing = [year for year in years if year not in counts_by_year]
    if missing:
        raise ValueError(f"No results loaded for year(s): {missing}")
    thresholds = set(counts_by_year[years[0]])
    for year in years[1:]:
        if set(counts_by_year[year]) != thresholds:
            raise ValueError(f"Year {year} was scored at different thresholds than {years[0]}.")
    return {t: tuple(sum(counts_by_year[y][t][i] for y in years) for i in range(4)) for t in thresholds}


def evaluate_split(counts_by_year, train_years, test_years, min_recall=0.9):
    """Choose the threshold on the training years, score it on the test years."""
    train_years, test_years = sorted(train_years), sorted(test_years)
    if set(train_years) & set(test_years):
        raise ValueError("Training and test years must not overlap.")
    train, test = pool(counts_by_year, train_years), pool(counts_by_year, test_years)
    if set(train) != set(test):
        raise ValueError("Training and test years were scored at different thresholds.")

    train_results = [metrics_from_counts(t, *train[t]) for t in sorted(train)]
    best = choose_threshold(train_results, min_recall)
    threshold = best["threshold"]
    return {
        "train_years": train_years,
        "test_years": test_years,
        "min_recall": min_recall,
        "threshold": threshold,
        "train": best,
        "test": metrics_from_counts(threshold, *test[threshold]),
        # "Keep everything" on the test years, to show what the filter changes.
        "test_no_filter": metrics_from_counts(0, *test[0]) if 0 in test else None,
    }


def leave_one_year_out(counts_by_year, min_recall=0.9):
    years = sorted(counts_by_year)
    return [evaluate_split(counts_by_year, [y for y in years if y != test], [test], min_recall)
            for test in years]


def _years(years):
    return "+".join(str(y) for y in years)


def format_report(split):
    """Plain-text report: confusion matrix and metrics on the held-out years."""
    test, train = split["test"], split["train"]
    lines = [
        f"Train {_years(split['train_years'])} -> threshold {split['threshold']} "
        f"(recall >= {split['min_recall']:.0%} rule, best Youden's J)",
        f"  on the training years: recall {train['recall']}, "
        f"false-positive rate {train['false_positive_rate']}, Youden's J {train['youden_j']}",
        f"Held-out {_years(split['test_years'])} at threshold {split['threshold']}:",
        "                       predicted real   predicted one-off",
        f"  actually real        {test['true_positives']:>14,}   {test['false_negatives']:>17,}",
        f"  actually one-off     {test['false_positives']:>14,}   {test['true_negatives']:>17,}",
        f"  precision {test['precision']}, recall {test['recall']}, "
        f"false-positive rate {test['false_positive_rate']}, Youden's J {test['youden_j']}",
        f"  removes {1 - test['recall']:.1%} of real fires and "
        f"{1 - test['false_positive_rate']:.1%} of one-off hotspots",
    ]
    if test["recall"] < split["min_recall"]:
        lines.append(f"  NOTE: held-out recall {test['recall']} is below the "
                     f"{split['min_recall']:.0%} target used to choose the threshold.")
    base = split["test_no_filter"]
    if base:
        lines.append(f"  with no filter (threshold 0) precision would be {base['precision']}")
    return "\n".join(lines)


CSV_FIELDS = ["split", "train_years", "test_years", "threshold", "precision", "recall",
              "false_positive_rate", "youden_j", "kept_share", *COUNT_FIELDS,
              "train_recall", "train_false_positive_rate"]


def csv_row(name, split):
    test, train = split["test"], split["train"]
    return {
        "split": name,
        "train_years": _years(split["train_years"]),
        "test_years": _years(split["test_years"]),
        "threshold": split["threshold"],
        **{k: test[k] for k in ("precision", "recall", "false_positive_rate", "youden_j", "kept_share", *COUNT_FIELDS)},
        "train_recall": train["recall"],
        "train_false_positive_rate": train["false_positive_rate"],
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--results-dir", default=RESULTS_DIR,
                        help="folder with backtest_<year>.csv files (default ml/results)")
    parser.add_argument("--train", type=int, nargs="+", help="training years (default: all but the latest)")
    parser.add_argument("--test", type=int, nargs="+", help="test years (default: the latest year)")
    parser.add_argument("--min-recall", type=float, default=0.9,
                        help="only choose thresholds that keep at least this share of real fires")
    parser.add_argument("--output", default=None,
                        help=f"results CSV (default {os.path.relpath(OUTPUT_CSV)} in the default results folder)")
    args = parser.parse_args(argv)

    years = find_years(args.results_dir)
    if len(years) < 2:
        parser.error(f"Need backtest_<year>.csv for at least two years in {args.results_dir}; found {years}.")
    counts = load_years(years, args.results_dir)

    test_years = args.test or [years[-1]]
    train_years = args.train or [y for y in years if y not in test_years]
    main_split = evaluate_split(counts, train_years, test_years, args.min_recall)
    folds = leave_one_year_out(counts, args.min_recall)

    print("Held-out evaluation of the detection confidence threshold (#56)")
    print("Labels: persistence proxy (not field-verified ground truth).\n")
    print(format_report(main_split))
    print("\nLeave-one-year-out (each year held out in turn):")
    for fold in folds:
        test = fold["test"]
        print(f"  train {_years(fold['train_years'])} -> threshold {fold['threshold']}; "
              f"held-out {_years(fold['test_years'])}: precision {test['precision']}, "
              f"recall {test['recall']}, false-positive rate {test['false_positive_rate']}")

    output = args.output or (OUTPUT_CSV if args.results_dir == RESULTS_DIR
                             else os.path.join(args.results_dir, "threshold_split_evaluation.csv"))
    with open(output, "w", newline="", encoding="utf-8") as target:
        writer = csv.DictWriter(target, fieldnames=CSV_FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerow(csv_row("time-ordered", main_split))
        writer.writerows(csv_row("leave-one-year-out", fold) for fold in folds)
    print(f"\nResults written to {output}.")


if __name__ == "__main__":
    main()
