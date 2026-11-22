"""Real PostGIS integration: FIRMS cleaning -> psycopg inserts -> Flask response."""
import os
import sys
from pathlib import Path
import pytest
import psycopg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "data-processing"))
sys.path.insert(0, str(ROOT / "backend"))
from firms_cleaning import clean_rows
from load_firms_to_db import build_rows, insert_detections
import app as backend_app

@pytest.fixture
def database(monkeypatch):
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL is required for PostGIS integration")
    monkeypatch.setenv("DATABASE_URL", url)
    with psycopg.connect(url) as conn:
        conn.execute("TRUNCATE public.detections RESTART IDENTITY")
    yield url
    with psycopg.connect(url) as conn:
        conn.execute("TRUNCATE public.detections RESTART IDENTITY")

def raw(**changes):
    row = dict(latitude="49.88",longitude="-119.49",acq_date="2023-06-04",
               acq_time="1745",confidence="82",satellite="Terra",instrument="MODIS",
               frp="35",daynight="D",type="0")
    row.update(changes)
    return row

def test_real_database_ingestion_deduplication_and_api(database):
    cleaned, report = clean_rows([raw(),raw(),raw(latitude="99"),
                                   raw(acq_time="1750",confidence="10"),
                                   raw(acq_time="1755",satellite="")])
    assert report["duplicate_rows"] == 1
    assert report["dropped_rows"] == 1
    rows = build_rows([{k:"" if v is None else str(v) for k,v in row.items()} for row in cleaned])
    with psycopg.connect(database) as conn:
        assert insert_detections(conn,rows) == 3
        assert insert_detections(conn,rows) == 0
        # Real PostGIS geography is generated from inserted coordinates.
        count, distance = conn.execute(
            "SELECT count(*), min(ST_Distance(location, "
            "ST_SetSRID(ST_MakePoint(-119.49,49.88),4326)::geography)) "
            "FROM public.detections"
        ).fetchone()
        assert count == 3
        assert distance < 1
    response = backend_app.app.test_client().get("/api/detections?limit=20")
    assert response.status_code == 200
    result = response.get_json()
    assert result["counts"]["shown"] == 3
    assert result["counts"]["potential_wildfire"] == 2
    assert result["counts"]["low_confidence"] == 1
    assert all(d["timestamp"].startswith("2023-06-04") for d in result["detections"])
    assert any(d["satellite"] is None for d in result["detections"])

def test_null_satellite_duplicate_constraint(database):
    cleaned, _ = clean_rows([raw(satellite="")])
    rows = build_rows([{k:"" if v is None else str(v) for k,v in row.items()} for row in cleaned])
    with psycopg.connect(database) as conn:
        assert insert_detections(conn,rows) == 1
        assert insert_detections(conn,rows) == 0
        assert conn.execute("SELECT count(*) FROM public.detections").fetchone()[0] == 1

def test_api_database_outage_returns_503(database, monkeypatch):
    def broken():
        raise psycopg.OperationalError("simulated outage")
    monkeypatch.setattr(backend_app, "get_connection", broken)
    response = backend_app.app.test_client().get("/api/detections")
    assert response.status_code == 503
    assert response.get_json()["status"] == "unavailable"
    assert "detections" not in response.get_json()
