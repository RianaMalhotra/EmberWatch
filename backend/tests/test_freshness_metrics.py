from datetime import datetime, timezone, timedelta
from services.freshness_metrics import detection_freshness

class Cursor:
    def __init__(self, row): self.row = row
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def execute(self, sql): assert "max(created_at)" in sql
    def fetchone(self): return self.row
class DB:
    def __init__(self, row): self.row = row
    def cursor(self): return Cursor(self.row)

def test_recent_ingestion_is_not_stale():
    now = datetime(2026, 11, 22, tzinfo=timezone.utc)
    result = detection_freshness(DB((12, now - timedelta(days=20), now - timedelta(hours=2))), now)
    assert result["ingestion_stale"] is False
    assert result["latest_detection_at"] != result["latest_insert_at"]

def test_missing_or_old_ingestion_is_stale():
    now = datetime(2026, 11, 22, tzinfo=timezone.utc)
    assert detection_freshness(DB((0,None,None)), now)["ingestion_stale"]
    assert detection_freshness(DB((1,now,now-timedelta(hours=7))), now)["ingestion_stale"]
