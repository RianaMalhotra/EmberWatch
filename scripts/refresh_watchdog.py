"""Check whether the FIRMS refresh GitHub Actions workflow completed recently."""
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

MAX_AGE_HOURS = 7


def check_refresh(runs, now=None):
    """Return age in hours, or raise ValueError for missing/stale/bad history."""
    now = now or datetime.now(timezone.utc)
    successful = [r for r in runs if r.get("conclusion") == "success"]
    if not successful:
        raise ValueError("No successful FIRMS refresh in recent workflow history")
    completed = []
    for run in successful:
        stamp = run.get("updated_at")
        if not stamp:
            raise ValueError("Invalid FIRMS refresh completion timestamp: missing updated_at")
        try:
            parsed = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                raise ValueError("timezone missing")
            completed.append(parsed)
        except (ValueError, TypeError, AttributeError) as exc:
            raise ValueError("Invalid FIRMS refresh completion timestamp") from exc
    age = (now - max(completed)).total_seconds() / 3600
    if age < 0:
        raise ValueError("FIRMS refresh completion timestamp is in the future")
    if age > MAX_AGE_HOURS:
        raise ValueError(f"FIRMS refresh stale ({age:.1f} hours); investigate API, DB, or workflow errors")
    return age


def main():
    repo = os.environ["REPO"]
    token = os.environ["GH_TOKEN"]
    url = f"https://api.github.com/repos/{repo}/actions/workflows/refresh-detections.yml/runs?per_page=100&status=completed"
    req = urllib.request.Request(url, headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "User-Agent": "EmberWatch-refresh-watchdog",
    })
    with urllib.request.urlopen(req, timeout=20) as response:
        runs = json.load(response).get("workflow_runs", [])
    try:
        age = check_refresh(runs)
    except ValueError as exc:
        print(f"::error::{exc}")
        return 1
    print(f"Last successful FIRMS refresh completed {age:.1f} hours ago")
    return 0


if __name__ == "__main__":
    sys.exit(main())
