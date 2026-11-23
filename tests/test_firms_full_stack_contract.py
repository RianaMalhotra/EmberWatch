"""FIRMS -> cleaning -> insert -> DB adapter -> Flask response contract.
Uses an in-memory DB adapter implementing the same cursor interface, so no
production database or NASA API key is required in CI.
"""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "data-processing"))
sys.path.insert(0, str(ROOT / "backend"))
from firms_cleaning import clean_rows
from load_firms_to_db import build_rows, insert_detections
import app as backend_app

class MemoryCursor:
    def __init__(self, db):
        self.db = db
        self.rowcount = 0
        self.results = []
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def executemany(self, sql, batch):
        assert "on conflict" in sql.lower()
        self.rowcount = 0
        for row in batch:
            key = (row[0], row[1], row[2], row[6])
            if key not in self.db.rows:
                self.db.rows[key] = row
                self.rowcount += 1
    def execute(self, sql, params):
        assert "public.detections" in sql
        limit = params["limit"]
        self.results = []
        for i, row in enumerate(sorted(self.db.rows.values(), key=lambda r: r[2], reverse=True)[:limit], 1):
            self.results.append((i, row[0], row[1], datetime.fromisoformat(row[2].replace("Z", "+00:00")),
                                 row[3], row[4], row[5], row[6], row[7]))
    def fetchall(self): return self.results

class MemoryDB:
    def __init__(self): self.rows = {}
    def cursor(self): return MemoryCursor(self)
    def commit(self): pass
    def __enter__(self): return self
    def __exit__(self, *args): return False

def raw(**updates):
    item = dict(latitude="49.88", longitude="-119.49", acq_date="2023-06-04",
                acq_time="1745", confidence="82", satellite="Terra",
                instrument="MODIS", frp="35", daynight="D", type="0")
    item.update(updates)
    return item

def test_firms_to_flask_to_frontend_contract(monkeypatch, tmp_path):
    cleaned, report = clean_rows([
        raw(), raw(), raw(latitude="99"), raw(acq_time="1750", confidence="10"),
        raw(acq_time="1755", confidence="not-a-number"),
    ])
    assert report["duplicate_rows"] == 1
    assert report["dropped_rows"] == 2
    assert len(cleaned) == 2
    db = MemoryDB()
    csv_rows = [{key: "" if val is None else str(val) for key, val in row.items()} for row in cleaned]
    tuples = build_rows(csv_rows)
    assert insert_detections(db, tuples) == 2
    assert insert_detections(db, tuples) == 0
    monkeypatch.setattr(backend_app, "get_connection", lambda: db)
    client = backend_app.app.test_client()
    response = client.get("/api/detections?limit=20")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["counts"]["shown"] == 2
    assert payload["counts"]["potential_wildfire"] == 1
    assert payload["counts"]["low_confidence"] == 1
    assert all(d["timestamp"].startswith("2023-06-04") for d in payload["detections"])
    (tmp_path / "detections.json").write_text(json.dumps(payload))
    output = os.environ.get("EMBERWATCH_CONTRACT_OUTPUT")
    if output:
        Path(output).write_text(json.dumps(payload), encoding="utf-8")

def test_database_outage_returns_503_not_fake_detections(monkeypatch):
    def unavailable(): raise ConnectionError("simulated database outage")
    monkeypatch.setattr(backend_app, "get_connection", unavailable)
    response = backend_app.app.test_client().get("/api/detections")
    assert response.status_code == 503
    assert response.get_json()["status"] == "unavailable"
    assert "detections" not in response.get_json()
