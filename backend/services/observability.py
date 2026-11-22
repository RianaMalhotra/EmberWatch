"""Lightweight, process-local API diagnostics; no user data or credentials."""
from collections import defaultdict, deque
from datetime import datetime, timezone
from threading import Lock
import time

_lock = Lock()
_started = time.time()
_requests = defaultdict(int)
_durations = defaultdict(lambda: deque(maxlen=200))

def record_request(endpoint, status, elapsed_ms):
    """Store bounded latency samples and status-class counts per route."""
    key = endpoint or "unmatched"
    with _lock:
        _requests[(key, f"{status // 100}xx")] += 1
        _durations[key].append(round(elapsed_ms, 2))

def snapshot():
    """Return aggregate metrics without paths containing user-supplied values."""
    with _lock:
        endpoints = sorted({key for key, _ in _requests})
        result = {}
        for endpoint in endpoints:
            samples = sorted(_durations[endpoint])
            result[endpoint] = {
                "requests": sum(count for (name, _), count in _requests.items() if name == endpoint),
                "status_classes": {kind: count for (name, kind), count in _requests.items() if name == endpoint},
                "latency_ms_p95": samples[min(len(samples)-1, int(0.95 * len(samples)))] if samples else None,
            }
    return {"started_at": datetime.fromtimestamp(_started, tz=timezone.utc).isoformat(), "endpoints": result}
