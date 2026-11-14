"""Approximate test for "is this point in Canada?" (#46, FIRMS NRT feed).

FIRMS's country API is not available (every call returns "Invalid API call",
and FIRMS advises against it for large countries anyway), so recent
detections are fetched for a box around Canada and filtered here. The box
also covers the northern US, the Alaska panhandle and western Greenland.

The border is simplified: it follows the real line to within a few km along
the 49th parallel and in the Arctic, but around the Great Lakes, Niagara and
the St. Lawrence it can be off by up to ~10-15 km (for example Windsor and
Detroit sit on opposite sides of a river that this model does not follow).
That is fine for a regional fire map, not for legal boundaries.
"""

# Canada-US border south of Canada, west to east, as (longitude, latitude),
# sorted by longitude. A point is in the US if it is south of the line.
SOUTH_BORDER = [
    (-141.0, 48.25),   # open Pacific (no US land west of -124.8 below 49 N)
    (-123.30, 48.25),  # Strait of Juan de Fuca, south of Victoria
    (-123.25, 49.0),
    (-95.15, 49.0),    # 49th parallel to Lake of the Woods
    (-94.6, 48.7),     # Rainy River
    (-93.4, 48.6),
    (-92.0, 48.3),
    (-89.55, 48.0),    # Pigeon River, Lake Superior
    (-88.9, 48.3),     # north of Isle Royale (US)
    (-86.0, 47.5),
    (-84.8, 46.9),
    (-84.4, 46.5),     # Sault Ste. Marie
    (-83.9, 46.0),
    (-83.5, 45.7),     # Lake Huron, north of Michigan's Thumb
    (-82.43, 45.3),
    (-82.42, 41.85),   # east of Port Huron / Sarnia: Lake Erie line
    (-81.0, 42.25),
    (-80.0, 42.45),
    (-79.1, 42.75),
    (-79.0, 43.3),     # Niagara River into Lake Ontario
    (-77.5, 43.6),     # Lake Ontario
    (-76.4, 44.0),
    (-75.5, 44.6),     # St. Lawrence River
    (-74.7, 45.0),
    (-71.5, 45.0),     # 45th parallel (Quebec - New York / Vermont / NH)
    (-71.1, 45.3),
    (-70.0, 46.3),     # Quebec - Maine
    (-69.2, 47.45),
    (-68.3, 47.35),    # Saint John River
    (-67.80, 47.07),
    (-67.79, 45.9),    # New Brunswick - Maine, running south
    (-67.0, 45.07),    # St. Croix River mouth
    (-66.95, 44.8),    # east of here there is no US land
]

# Southwestern Ontario west of Sarnia (Windsor, Essex County, Pelee Island).
# The line above runs through Lake Huron there, north of Michigan's Thumb,
# so this corner of Canada is added back. As (latitude, longitude).
ESSEX_COUNTY = [
    (41.68, -82.75),
    (42.03, -83.15),
    (42.33, -83.08),
    (42.56, -82.65),
    (42.98, -82.42),
    (41.68, -82.42),
]

# Southeast Alaska (the panhandle), as (latitude, longitude) around the outside.
ALASKA_PANHANDLE = [
    (60.31, -141.05),
    (59.80, -139.00),
    (58.91, -137.53),  # Mount Fairweather
    (59.80, -136.50),
    (59.62, -135.15),  # White Pass
    (58.90, -134.00),
    (57.50, -132.30),
    (56.60, -131.10),
    (56.00, -130.00),  # Portland Canal (Hyder AK / Stewart BC)
    (54.70, -130.60),
    (54.60, -133.50),  # Dixon Entrance
    (55.50, -137.00),
    (58.00, -141.05),
]

# Line between Canada's Arctic islands and Greenland, as (latitude, longitude).
# East of the line is Greenland.
GREENLAND_DIVIDE = [
    (60.0, -57.0),
    (66.0, -58.5),
    (70.0, -63.0),
    (74.0, -68.0),
    (76.0, -75.0),
    (78.0, -73.6),     # Nares Strait
    (79.0, -69.5),
    (80.5, -67.7),
    (81.5, -63.0),
    (82.5, -55.0),
    (84.0, -40.0),
]


def _interpolate(x, points):
    """Linear interpolation of y at x along points [(x, y), ...] sorted by x."""
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if x0 <= x <= x1:
            if x1 == x0:
                return min(y0, y1)
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return None


def _inside(lat, lon, polygon):
    """Ray casting point-in-polygon; polygon is [(lat, lon), ...]."""
    inside = False
    for (la0, lo0), (la1, lo1) in zip(polygon, polygon[1:] + polygon[:1]):
        if (la0 > lat) != (la1 > lat):
            cross = lo0 + (lat - la0) * (lo1 - lo0) / (la1 - la0)
            if lon < cross:
                inside = not inside
    return inside


def in_canada(latitude, longitude):
    """True if the point is (approximately) in Canada or its waters."""
    lat, lon = float(latitude), float(longitude)
    if not (41.6 <= lat <= 84.0 and -141.05 <= lon <= -52.0):
        return False
    if _inside(lat, lon, ALASKA_PANHANDLE):
        return False
    if lat >= 60.0:
        divide = _interpolate(lat, GREENLAND_DIVIDE)
        if divide is not None and lon > divide:
            return False
    if _inside(lat, lon, ESSEX_COUNTY):
        return True
    if lon < -66.95:
        border = _interpolate(lon, SOUTH_BORDER)
        if border is not None and lat < border:
            return False
    return True
