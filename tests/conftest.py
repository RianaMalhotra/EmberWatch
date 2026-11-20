import os
import sys

# Make data-processing/ and ml/ importable from the top-level tests.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for folder in ("data-processing", "ml"):
    sys.path.insert(0, os.path.join(ROOT, folder))


import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def no_retry_waits(monkeypatch):
    """Open-Meteo retries wait 5-20 s in real runs; don't wait in tests."""
    import load_environment_to_db
    monkeypatch.setattr(load_environment_to_db, "RETRY_DELAYS_S", (0, 0))
