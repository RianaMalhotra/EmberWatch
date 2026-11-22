"""Tests for the burned-area (NBAC) check (#56) that need geopandas, shapely and pyproj.

These are optional libraries (ml/requirements-nbac.txt), so the whole file is
skipped when they are not installed. Install them to run it locally:
pip install -r ml/requirements-nbac.txt
"""

import csv
import os
import zipfile

import pytest

import evaluate_against_nbac as nbac
import evaluate_threshold_split as split

gpd = pytest.importorskip("geopandas")
shapely = pytest.importorskip("shapely")
pyproj = pytest.importorskip("pyproj")
from shapely.geometry import box  # noqa: E402

CLEANED_COLUMNS = ["latitude", "longitude", "timestamp", "confidence"]


def write_cleaned(path, rows):
    with open(path, "w", newline="", encoding="utf-8") as target:
        writer = csv.writer(target)
        writer.writerow(CLEANED_COLUMNS)
        writer.writerows(rows)

CENTRE_LON, CENTRE_LAT = -100.0, 52.0


def centre_xy():
    return pyproj.Transformer.from_crs("EPSG:4326", nbac.NBAC_CRS, always_xy=True).transform(CENTRE_LON, CENTRE_LAT)


def square(half_m=2000.0, dx=0.0, dy=0.0):
    x, y = centre_xy()
    return box(x + dx - half_m, y + dy - half_m, x + dx + half_m, y + dy + half_m)


def lonlat_at(dx_m=0.0, dy_m=0.0):
    x, y = centre_xy()
    lon, lat = pyproj.Transformer.from_crs(nbac.NBAC_CRS, "EPSG:4326", always_xy=True).transform(x + dx_m, y + dy_m)
    return lat, lon


def burned_frame(geometries, years=None, crs=nbac.NBAC_CRS):
    data = {"geometry": geometries}
    if years is not None:
        data["YEAR"] = years
    return gpd.GeoDataFrame(data, crs=crs)


def write_shapefile_zip(folder, name, frame, extra_shapefile=False):
    shp_dir = os.path.join(folder, f"{name}_shp")
    os.makedirs(shp_dir)
    frame.to_file(os.path.join(shp_dir, f"{name}.shp"))
    if extra_shapefile:
        frame.to_file(os.path.join(shp_dir, f"{name}_other.shp"))
    zip_path = os.path.join(folder, f"{name}.zip")
    with zipfile.ZipFile(zip_path, "w") as archive:
        for file_name in os.listdir(shp_dir):
            archive.write(os.path.join(shp_dir, file_name), arcname=f"{name}/{file_name}")
    return zip_path


def test_projection_sanity_central_meridian_is_x_zero():
    x, _ = pyproj.Transformer.from_crs("EPSG:4326", nbac.NBAC_CRS, always_xy=True).transform(-95.0, 55.0)
    assert abs(x) < 1e-6


def test_labels_inside_near_and_far_detections():
    burned = burned_frame([square(half_m=2000)])
    points = [lonlat_at(0, 0),        # inside
              lonlat_at(2500, 0),     # 500 m outside the edge: within the 1 km buffer
              lonlat_at(6000, 0)]     # 4 km outside: not inside
    lats, lons = [p[0] for p in points], [p[1] for p in points]
    assert nbac.label_inside_burned_areas(lats, lons, burned, buffer_km=1.0) == [True, True, False]
    assert nbac.label_inside_burned_areas(lats, lons, burned, buffer_km=0.0) == [True, False, False]


def test_no_polygons_or_no_detections():
    empty = burned_frame([])
    assert nbac.label_inside_burned_areas([52.0], [-100.0], empty) == [False]
    assert nbac.label_inside_burned_areas([], [], burned_frame([square()])) == []
    with pytest.raises(ValueError):
        nbac.label_inside_burned_areas([52.0], [-100.0], burned_frame([square()]), buffer_km=-1)


def test_repairs_invalid_shapes_and_drops_empty_ones(tmp_path):
    bowtie = shapely.Polygon([(0, 0), (4000, 4000), (4000, 0), (0, 4000)])  # self-crossing
    x, y = centre_xy()
    bowtie = shapely.affinity.translate(bowtie, x - 2000, y - 2000)
    frame = burned_frame([bowtie, shapely.Polygon()], years=[2023, 2023])
    path = tmp_path / "bad.shp"
    frame.to_file(path)
    burned = nbac.load_burned_areas(str(path), 2023)
    assert len(burned) == 1 and burned.geometry.is_valid.all()
    in_triangle, in_gap = lonlat_at(1500, 0), lonlat_at(0, 1500)  # the filled triangles are left and right
    result = nbac.label_inside_burned_areas([in_triangle[0], in_gap[0]], [in_triangle[1], in_gap[1]],
                                            burned, buffer_km=0.0)
    assert result == [True, False]


def test_keeps_only_the_requested_year_when_the_file_has_a_year_column(tmp_path):
    frame = burned_frame([square(), square(dx=50000)], years=[2023, 2024])
    path = tmp_path / "combined.shp"
    frame.to_file(path)
    assert len(nbac.load_burned_areas(str(path), 2023)) == 1
    assert len(nbac.load_burned_areas(str(path), 2024)) == 1
    assert len(nbac.load_burned_areas(str(path), 1999)) == 0
    assert len(nbac.load_burned_areas(str(path))) == 2  # no year given: everything


def test_other_coordinate_systems_are_reprojected(tmp_path):
    frame = burned_frame([square()], years=[2023]).to_crs("EPSG:4326")
    path = tmp_path / "lonlat.shp"
    frame.to_file(path)
    burned = nbac.load_burned_areas(str(path), 2023)
    assert str(burned.crs).endswith("3978")
    lat, lon = lonlat_at(0, 0)
    assert nbac.label_inside_burned_areas([lat], [lon], burned, buffer_km=0.0) == [True]


def test_reads_a_zip_with_one_shapefile_and_rejects_several(tmp_path):
    frame = burned_frame([square()], years=[2023])
    good = write_shapefile_zip(str(tmp_path), "NBAC_2023", frame)
    assert len(nbac.load_burned_areas(good, 2023)) == 1
    several = write_shapefile_zip(str(tmp_path), "NBAC_2024", frame, extra_shapefile=True)
    with pytest.raises(ValueError, match="Expected one .shp"):
        nbac.load_burned_areas(several, 2024)


def synthetic_year(folder, year):
    """A cleaned CSV plus an NBAC zip where high-confidence detections burn and low ones do not."""
    rows = []
    for i in range(40):  # inside the polygon: mostly high confidence
        lat, lon = lonlat_at(100 * (i % 5), 100 * (i // 5))
        rows.append((lat, lon, f"{year}-06-0{1 + i % 9}T00:05:00Z", 90 if i < 34 else 15))
    for i in range(20):  # far outside: mostly low confidence
        lat, lon = lonlat_at(20000 + 300 * i, 0)
        rows.append((lat, lon, f"{year}-07-01T10:00:00Z", 15 if i < 17 else 90))
    cleaned = os.path.join(folder, f"cleaned_{year}.csv")
    write_cleaned(cleaned, rows)
    zip_path = write_shapefile_zip(folder, f"NBAC_{year}", burned_frame([square(half_m=3000)], years=[year]))
    return cleaned, zip_path


def test_end_to_end_writes_backtest_format_results(tmp_path, capsys):
    cleaned, zip_path = synthetic_year(str(tmp_path), 2023)
    output = tmp_path / "nbac_2023.csv"
    nbac.main([cleaned, zip_path, "--year", "2023", "--output", str(output)])
    rows = list(csv.DictReader(open(output, newline="", encoding="utf-8")))

    # same columns as ml/results/backtest_<year>.csv, so the split script can read it
    with open(os.path.join(split.RESULTS_DIR, "backtest_2023.csv"), newline="", encoding="utf-8") as ref:
        assert list(rows[0].keys()) == next(csv.reader(ref))

    at_zero = next(r for r in rows if r["threshold"] == "0")
    assert (int(at_zero["true_positives"]), int(at_zero["false_positives"])) == (40, 20)
    at_50 = next(r for r in rows if r["threshold"] == "50")
    assert (int(at_50["true_positives"]), int(at_50["false_positives"]),
            int(at_50["false_negatives"]), int(at_50["true_negatives"])) == (34, 3, 6, 17)
    assert "not proof of a false alarm" in capsys.readouterr().out


def test_nbac_results_feed_the_held_out_evaluation(tmp_path, capsys):
    for year in (2023, 2024, 2025):
        cleaned, zip_path = synthetic_year(str(tmp_path), year)
        nbac.main([cleaned, zip_path, "--year", str(year), "--output", str(tmp_path / f"nbac_{year}.csv")])
    capsys.readouterr()
    split.main(["--labels", "nbac", "--results-dir", str(tmp_path)])
    out = capsys.readouterr().out
    assert "burned-area polygon (NBAC)" in out and "actually inside burned area" in out
    rows = list(csv.DictReader(open(tmp_path / "threshold_split_evaluation_nbac.csv", newline="", encoding="utf-8")))
    assert rows[0]["split"] == "time-ordered" and rows[0]["test_years"] == "2025"


def test_clear_errors_for_empty_inputs(tmp_path):
    cleaned, zip_path = synthetic_year(str(tmp_path), 2023)
    with pytest.raises(SystemExit, match="No usable 1999 detections"):
        nbac.main([cleaned, zip_path, "--year", "1999"])
    other_year = write_shapefile_zip(str(tmp_path), "NBAC_other", burned_frame([square()], years=[2020]))
    with pytest.raises(SystemExit, match="No burned-area polygons for 2023"):
        nbac.main([cleaned, other_year, "--year", "2023"])
