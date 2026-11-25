"""Check detections against official burned-area maps (NBAC) (#56).

The #19 backtest has no ground truth: it labels a detection "real" if it is
seen again nearby within 72 hours. Here the answer key is an independent
source, Natural Resources Canada's National Burned Area Composite (NBAC):
polygons of where wildfires actually burned, mapped after the fact.

A detection is labelled **inside** a burned area if it lies within
``--buffer-km`` (default 1 km, about one MODIS pixel) of an NBAC polygon from
the same year, otherwise **outside**. Only location and year are used. NBAC's
date fields are not, because some are derived from satellite hotspots and
would make the check partly circular.

The output has the same columns as ``ml/results/backtest_<year>.csv``, so
``evaluate_threshold_split.py --labels nbac`` can read it.

Read before trusting the numbers:

* "Outside" does not prove a false alarm. Small fires, unmapped fires and
  other heat sources (such as agricultural burning) all end up outside, so
  the false-positive rate here is overstated.
* NBAC is built from several sources; check its metadata for how much of it
  is hotspot-based before calling this fully independent.
* Fires that burn across New Year are matched only to polygons of the
  detection's own calendar year.

Needs geopandas, shapely and pyproj (``pip install -r ml/requirements-nbac.txt``).

Usage (from the repository root):

    python ml/evaluate_against_nbac.py data-processing/data/cleaned_2023.csv \\
        data-processing/data/NBAC_2023_20260513.zip --year 2023
"""

import argparse
import csv
import os
import sys
import tempfile
import zipfile

from backtest_threshold import run_backtest

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS_DIR = os.path.join(HERE, "results")
NBAC_CRS = "EPSG:3978"  # NAD83 / NRCan Lambert Conformal Conic, in metres
DEFAULT_BUFFER_KM = 1.0
INSTALL_HINT = "pip install -r ml/requirements-nbac.txt"


def warn(message):
    print(f"WARNING: {message}", file=sys.stderr)


def load_detections(path, year):
    """Detections from a cleaned FIRMS CSV for one calendar year.

    Needs latitude, longitude, confidence and a timestamp column
    (``timestamp``, or ``detected_at`` for a database export).
    Returns (latitudes, longitudes, confidences, rows left out).
    """
    lats, lons, confidences, skipped = [], [], [], 0
    with open(path, newline="", encoding="utf-8") as source:
        for row in csv.DictReader(source):
            stamp = (row.get("timestamp") or row.get("detected_at") or "").strip()
            if not stamp[:4].isdigit():
                skipped += 1
                continue
            if int(stamp[:4]) != year:
                continue  # another year's detection, not an error
            try:
                lat, lon = float(row["latitude"]), float(row["longitude"])
                confidence = float(row["confidence"])
            except (KeyError, TypeError, ValueError):
                skipped += 1
                continue
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                skipped += 1
                continue
            lats.append(lat)
            lons.append(lon)
            confidences.append(confidence)
    return lats, lons, confidences, skipped


def _find_shapefile(folder):
    found = []
    for root, _, files in os.walk(folder):
        found += [os.path.join(root, name) for name in files if name.lower().endswith(".shp")]
    return sorted(found)


def load_burned_areas(path, year=None):
    """NBAC polygons as a GeoDataFrame in EPSG:3978.

    ``path`` is a .shp, or a .zip holding exactly one .shp. If the data has a
    YEAR column (the combined 1972-2025 file does) and ``year`` is given, only
    that year is kept. Invalid shapes are repaired, empty ones dropped.
    """
    try:
        import geopandas as gpd
        import shapely
    except ImportError as error:
        raise ImportError(f"{error}. Install the map libraries first: {INSTALL_HINT}") from error

    def read(shp):
        return gpd.read_file(shp)

    if path.lower().endswith(".zip"):
        with tempfile.TemporaryDirectory() as folder:
            with zipfile.ZipFile(path) as archive:
                archive.extractall(folder)
            shapefiles = _find_shapefile(folder)
            if len(shapefiles) != 1:
                names = [os.path.relpath(p, folder) for p in shapefiles]
                raise ValueError(f"Expected one .shp inside {path}, found {len(shapefiles)}: {names}. "
                                 "Unzip it and pass the .shp you want.")
            burned = read(shapefiles[0])
    else:
        burned = read(path)

    if burned.crs is None:
        warn(f"{path} has no coordinate system; assuming {NBAC_CRS}.")
        burned = burned.set_crs(NBAC_CRS)
    else:
        burned = burned.to_crs(NBAC_CRS)

    if year is not None and "YEAR" in burned.columns:
        burned = burned[burned["YEAR"] == year]
    burned = burned[~burned.geometry.isna() & ~burned.geometry.is_empty].copy()
    invalid = ~burned.geometry.is_valid
    if invalid.any():
        burned.loc[invalid, "geometry"] = shapely.make_valid(burned.geometry[invalid].values)
    return burned


def label_inside_burned_areas(latitudes, longitudes, burned, buffer_km=DEFAULT_BUFFER_KM):
    """For each detection: is it within ``buffer_km`` of a burned-area polygon?"""
    try:
        import numpy as np
        import shapely
        from pyproj import Transformer
    except ImportError as error:
        raise ImportError(f"{error}. Install the map libraries first: {INSTALL_HINT}") from error

    if len(latitudes) == 0:
        return []
    if buffer_km < 0:
        raise ValueError("buffer_km must not be negative")
    transformer = Transformer.from_crs("EPSG:4326", burned.crs, always_xy=True)
    xs, ys = transformer.transform(np.asarray(longitudes, dtype=float), np.asarray(latitudes, dtype=float))
    points = shapely.points(xs, ys)
    inside = np.zeros(len(points), dtype=bool)
    if len(burned):
        polygons = np.asarray(burned.geometry.values)
        # Step 1 (fast): points strictly inside a polygon. Prepared polygons make this cheap
        # even for the huge, very detailed perimeters of big fire years.
        shapely.prepare(polygons)
        _, contained = shapely.STRtree(points).query(polygons, predicate="contains")
        inside[contained] = True
        # Step 2: the distance test only for the rest (edges, the buffer zone, far-away points).
        rest = np.flatnonzero(~inside)
        if len(rest):
            near, _ = shapely.STRtree(polygons).query(points[rest], predicate="dwithin",
                                                      distance=buffer_km * 1000.0)
            inside[rest[near]] = True
    return inside.tolist()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("cleaned_csv", help="cleaned FIRMS CSV (firms_cleaning.py) or the export from data-processing/export_detections.py")
    parser.add_argument("burned_areas", help="NBAC .shp, or the .zip that holds one (NBAC_<year>_*.zip)")
    parser.add_argument("--year", type=int, required=True, help="calendar year to evaluate")
    parser.add_argument("--output", default=None, help="results CSV (default ml/results/nbac_<year>.csv)")
    parser.add_argument("--buffer-km", type=float, default=DEFAULT_BUFFER_KM,
                        help="distance from a burned-area polygon that still counts as inside (default 1)")
    parser.add_argument("--min-recall", type=float, default=0.9,
                        help="only recommend thresholds that keep at least this share of detections inside burned areas")
    args = parser.parse_args(argv)

    try:
        lats, lons, confidences, skipped = load_detections(args.cleaned_csv, args.year)
        if not lats:
            sys.exit(f"No usable {args.year} detections in {args.cleaned_csv}.")
        burned = load_burned_areas(args.burned_areas, args.year)
        if len(burned) == 0:
            sys.exit(f"No burned-area polygons for {args.year} in {args.burned_areas}.")
        inside = label_inside_burned_areas(lats, lons, burned, args.buffer_km)
    except ImportError as error:
        sys.exit(str(error))
    except ValueError as error:
        sys.exit(str(error))

    try:
        results, best = run_backtest(list(zip(confidences, inside)), min_recall=args.min_recall)
    except ValueError as error:
        sys.exit(f"{error} ({sum(inside)} of {len(inside)} detections are inside burned areas.)")

    output = args.output or os.path.join(RESULTS_DIR, f"nbac_{args.year}.csv")
    with open(output, "w", newline="", encoding="utf-8") as target:
        writer = csv.DictWriter(target, fieldnames=list(results[0].keys()), lineterminator="\n")
        writer.writeheader()
        writer.writerows(results)

    n_inside = sum(inside)
    print(f"{args.year}: {len(lats):,} detections scored ({skipped:,} unusable rows left out); "
          f"{len(burned):,} burned-area polygons; buffer {args.buffer_km:g} km.")
    print(f"Inside a mapped burned area: {n_inside:,} ({n_inside / len(inside):.1%}); "
          f"outside: {len(inside) - n_inside:,}. 'Outside' is not proof of a false alarm.")
    print(f"Best threshold on this year alone (recall >= {args.min_recall:.0%}): {best['threshold']} "
          f"(recall {best['recall']}, false-positive rate {best['false_positive_rate']}, "
          f"precision {best['precision']}, Youden J {best['youden_j']}).")
    print(f"Full results written to {output}.")


if __name__ == "__main__":
    main()
