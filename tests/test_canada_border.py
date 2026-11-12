"""Tests for the simplified Canada border used to filter the FIRMS NRT box."""
import pytest

from canada_border import SOUTH_BORDER, in_canada

CANADA = {
    "Vancouver": (49.28, -123.12), "Victoria": (48.43, -123.37), "Kelowna": (49.888, -119.496),
    "Calgary": (51.05, -114.07), "Winnipeg": (49.90, -97.14), "Thunder Bay": (48.38, -89.25),
    "Sault Ste. Marie ON": (46.53, -84.30), "Sudbury": (46.49, -80.99), "Toronto": (43.65, -79.38),
    "Windsor": (42.30, -83.03), "Leamington": (42.05, -82.60), "Pelee Island": (41.77, -82.65),
    "Sarnia": (42.97, -82.40), "Goderich": (43.74, -81.71), "Niagara Falls ON": (43.09, -79.08),
    "Kingston": (44.23, -76.48), "Ottawa": (45.42, -75.70), "Montreal": (45.50, -73.57),
    "Quebec City": (46.81, -71.21), "Chibougamau": (49.91, -74.37), "Fredericton": (45.96, -66.64),
    "Saint John NB": (45.27, -66.06), "Halifax": (44.65, -63.58), "Yarmouth": (43.84, -66.12),
    "St. John's": (47.56, -52.71), "Iqaluit": (63.75, -68.52), "Clyde River": (70.47, -68.59),
    "Grise Fiord": (76.42, -82.90), "Alert": (82.50, -62.35), "Whitehorse": (60.72, -135.06),
    "Haines Junction": (60.75, -137.51), "Atlin": (59.58, -133.70), "Telegraph Creek": (57.90, -131.17),
    "Stewart BC": (55.94, -129.95), "Prince Rupert": (54.31, -130.32), "Fort McMurray": (56.73, -111.38),
    "Yellowknife": (62.45, -114.37), "Lytton": (50.23, -121.58),
    # Real detections from the stored archive, close to the border.
    "archive: Osoyoos area": (49.025, -119.560), "archive: Fort Frances area": (48.858, -93.122),
    "archive: Sooke": (48.503, -123.942), "archive: Nanticoke": (42.805, -80.100),
    "archive: Essex County": (42.102, -82.719), "archive: Sarnia area": (42.872, -82.418),
    "archive: Quetico": (48.386, -91.592), "archive: NB near Maine": (46.156, -67.704),
    "archive: Quebec Eastern Townships": (45.461, -71.954), "archive: St. Lawrence": (45.160, -74.720),
    "archive: Tatshenshini BC": (59.964, -138.523), "archive: near Atlin": (59.740, -134.293),
}

NOT_CANADA = {
    "Seattle": (47.61, -122.33), "Port Angeles": (48.12, -123.43), "Bellingham": (48.75, -122.48),
    "Spokane": (47.66, -117.43), "Duluth": (46.79, -92.10), "Isle Royale": (48.00, -88.90),
    "Marquette": (46.54, -87.40), "Port Huron": (42.97, -82.43), "Port Austin MI": (44.05, -83.00),
    "Toledo": (41.65, -83.54), "Erie PA": (42.13, -80.08), "Buffalo": (42.89, -78.88),
    "Rochester NY": (43.16, -77.61), "Burlington VT": (44.48, -73.21), "Bangor": (44.80, -68.77),
    "Caribou ME": (46.86, -68.01), "Juneau": (58.30, -134.42), "Haines AK": (59.24, -135.44),
    "Skagway": (59.46, -135.31), "Yakutat": (59.55, -139.73), "Ketchikan": (55.34, -131.64),
    "Wrangell": (56.47, -132.38), "Anchorage": (61.22, -149.90),
    "Sisimiut, Greenland": (66.94, -53.67), "Qaanaaq, Greenland": (77.47, -69.23),
    "Pituffik, Greenland": (76.53, -68.70), "Upernavik, Greenland": (72.79, -56.15),
    # From the first live dry run.
    "live: South Dakota": (43.84, -103.93), "live: Montana": (46.99, -114.06), "live: Oregon": (45.43, -123.46),
}


@pytest.mark.parametrize("name", CANADA)
def test_places_in_canada(name):
    assert in_canada(*CANADA[name]), name


@pytest.mark.parametrize("name", NOT_CANADA)
def test_places_outside_canada(name):
    assert not in_canada(*NOT_CANADA[name]), name


def test_border_points_are_sorted_west_to_east():
    longitudes = [lon for lon, _ in SOUTH_BORDER]
    assert longitudes == sorted(longitudes)


def test_far_outside_the_box_is_not_canada():
    assert not in_canada(35.0, -100.0)
    assert not in_canada(51.5, -0.1)  # London


def test_text_coordinates_from_csv_work():
    assert in_canada("49.888", "-119.496")
