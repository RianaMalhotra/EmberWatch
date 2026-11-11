from datetime import datetime, timezone

import pytest

import app as api

# The fixtures use observation times in mid-October 2026. Freezing "now" shortly
# after them keeps those tests independent of the real date (#49 staleness).
FROZEN_NOW = datetime(2026, 10, 17, 0, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def frozen_clock(monkeypatch):
    monkeypatch.setattr(api, "_utcnow", lambda: FROZEN_NOW)
