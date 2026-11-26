"""Post-deployment smoke check for the EmberWatch backend (issue #61).

Run it against a deployed (or local) backend and paste the printed table into
the issue as evidence:

    python scripts/smoke_check.py https://your-backend.onrender.com
    python scripts/smoke_check.py https://your-backend.onrender.com \
        --frontend-origin https://your-site.vercel.app

It only sends read-only GET requests, needs no secrets and uses only the
standard library. It does not create reports or change any data.

Exit code: 0 when nothing failed (warnings are allowed), 1 when a check
failed, 2 for a usage error.
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from collections import namedtuple
from datetime import datetime, timezone
from urllib.parse import urlparse

PASS, FAIL, WARN = "PASS", "FAIL", "WARN"

# 502/503/504 are what a sleeping or still-starting Render instance answers.
TRANSIENT_STATUSES = {502, 503, 504}

# An origin that should never be in CORS_ORIGINS; used to prove the API does
# not answer every site.
DENIED_ORIGIN = "https://origin-not-in-cors-origins.invalid"

Response = namedtuple("Response", "status headers body ms")
Result = namedtuple("Result", "name outcome detail ms")


def normalize_base_url(raw):
    """Return the backend origin without a trailing slash, or raise ValueError."""
    parsed = urlparse((raw or "").strip())
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("The backend address must start with http:// or https://")
    if parsed.username or parsed.password:
        raise ValueError("Do not put a username or password in the address")
    if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise ValueError("Give the origin only (no /api path), e.g. https://host.example.com")
    return f"{parsed.scheme}://{parsed.netloc}"


def http_get(url, headers=None, timeout=30):
    """GET ``url``. Network errors come back as status 0 instead of raising."""
    request = urllib.request.Request(url, headers={"Accept": "application/json", **(headers or {})})
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as reply:
            status, raw_headers, body = reply.status, reply.headers, reply.read(2_000_000)
    except urllib.error.HTTPError as error:
        status, raw_headers, body = error.code, error.headers, error.read(2_000_000)
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        elapsed = (time.perf_counter() - started) * 1000
        return Response(0, {}, f"{type(error).__name__}: {error}", elapsed)
    elapsed = (time.perf_counter() - started) * 1000
    lowered = {key.lower(): value for key, value in raw_headers.items()}
    return Response(status, lowered, body.decode("utf-8", "replace"), elapsed)


def parse_json(body):
    """The decoded JSON object, or None if the body is not a JSON object."""
    try:
        value = json.loads(body)
    except (TypeError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def fetch_with_wake_up(fetch, url, attempts, wait_seconds, sleep=time.sleep):
    """Retry while the service is asleep or starting (cold start), then give up."""
    response = fetch(url, None)
    for _ in range(max(attempts - 1, 0)):
        if response.status != 0 and response.status not in TRANSIENT_STATUSES:
            break
        sleep(wait_seconds)
        response = fetch(url, None)
    return response


def _explain(response):
    if response.status == 0:
        return response.body
    return f"HTTP {response.status}"


def _json_check(name, response, expected_status="ok"):
    """PASS when the answer is HTTP 200 JSON with the expected ``status``."""
    if response.status != 200:
        return Result(name, FAIL, _explain(response), response.ms), None
    payload = parse_json(response.body)
    if payload is None:
        return Result(name, FAIL, "HTTP 200 but the body is not a JSON object", response.ms), None
    if payload.get("status") != expected_status:
        return Result(name, FAIL, f"status is {payload.get('status')!r}, expected {expected_status!r}", response.ms), None
    return Result(name, PASS, "HTTP 200", response.ms), payload


def run_checks(base, fetch, frontend_origin=None, min_areas=1,
               wake_attempts=4, wake_wait=15, sleep=time.sleep):
    """Run every check and return a list of Result. ``fetch(url, headers)`` is injectable."""
    results = []

    # 1. The API process is up (this one is allowed to wake a sleeping instance).
    health = fetch_with_wake_up(fetch, f"{base}/api/health", wake_attempts, wake_wait, sleep)
    outcome, _ = _json_check("API health  /api/health", health)
    results.append(outcome)

    # 2. The database answers.
    outcome, _ = _json_check("Database    /api/health/db", fetch(f"{base}/api/health/db", None))
    results.append(outcome)

    # 3. Detections load. An empty list is allowed but suspicious.
    response = fetch(f"{base}/api/detections?limit=5", None)
    outcome, payload = _json_check("Detections  /api/detections", response, expected_status="success")
    if payload is not None:
        detections = payload.get("detections")
        if not isinstance(detections, list):
            outcome = Result(outcome.name, FAIL, "no 'detections' list in the answer", response.ms)
        elif not detections:
            outcome = Result(outcome.name, WARN, "0 detections returned (is the data refresh running?)", response.ms)
        else:
            outcome = Result(outcome.name, PASS, f"HTTP 200, {len(detections)} returned (limit 5)", response.ms)
    results.append(outcome)

    # 4. Risk areas load and are not empty.
    response = fetch(f"{base}/api/risk-areas", None)
    outcome, payload = _json_check("Risk areas  /api/risk-areas", response, expected_status="success")
    if payload is not None:
        areas = payload.get("data")
        if not isinstance(areas, list):
            outcome = Result(outcome.name, FAIL, "no 'data' list in the answer", response.ms)
        elif len(areas) < min_areas:
            outcome = Result(outcome.name, FAIL, f"{len(areas)} areas returned, expected at least {min_areas}", response.ms)
        else:
            detail = f"HTTP 200, {len(areas)} areas"
            if payload.get("warnings"):
                detail += f", {len(payload['warnings'])} warning(s)"
            outcome = Result(outcome.name, PASS, detail, response.ms)
    results.append(outcome)

    # 5. Data freshness is informational: stale data is a warning, not a failure.
    response = fetch(f"{base}/api/health/freshness", None)
    outcome, _ = _json_check("Freshness   /api/health/freshness", response)
    if outcome.outcome == FAIL:
        outcome = Result(outcome.name, WARN, outcome.detail, outcome.ms)
    results.append(outcome)

    # 6. CORS: the real frontend is allowed and a stranger is not.
    if frontend_origin:
        allowed = fetch(f"{base}/api/health", {"Origin": frontend_origin})
        header = allowed.headers.get("access-control-allow-origin")
        if allowed.status == 0:
            results.append(Result("CORS allowed", FAIL, _explain(allowed), allowed.ms))
        elif header == frontend_origin:
            results.append(Result("CORS allowed", PASS, f"{frontend_origin} is allowed", allowed.ms))
        else:
            results.append(Result("CORS allowed", FAIL,
                                  f"Access-Control-Allow-Origin is {header!r}; add {frontend_origin} to CORS_ORIGINS", allowed.ms))

        denied = fetch(f"{base}/api/health", {"Origin": DENIED_ORIGIN})
        header = denied.headers.get("access-control-allow-origin")
        if denied.status == 0:
            results.append(Result("CORS denied", FAIL, _explain(denied), denied.ms))
        elif header in (None, ""):
            results.append(Result("CORS denied", PASS, "an unknown origin gets no CORS header", denied.ms))
        else:
            results.append(Result("CORS denied", FAIL,
                                  f"an unknown origin was answered with Access-Control-Allow-Origin {header!r}", denied.ms))
    return results


def format_report(base, results, now=None):
    """A Markdown block to paste into the issue as evidence."""
    now = now or datetime.now(timezone.utc)
    lines = [
        f"**Smoke check of {base}** at {now.strftime('%Y-%m-%d %H:%M UTC')}",
        "",
        "| Check | Result | Time | Detail |",
        "|---|---|---|---|",
    ]
    for item in results:
        lines.append(f"| {item.name} | {item.outcome} | {item.ms:.0f} ms | {item.detail} |")
    failed = sum(1 for item in results if item.outcome == FAIL)
    warned = sum(1 for item in results if item.outcome == WARN)
    lines += ["", f"{len(results)} checks: {len(results) - failed - warned} passed, {warned} warning(s), {failed} failed."]
    return "\n".join(lines)


def main(argv=None, fetch=None, sleep=time.sleep):
    parser = argparse.ArgumentParser(description="Read-only smoke check of a deployed EmberWatch backend.")
    parser.add_argument("backend", help="backend origin, e.g. https://your-backend.onrender.com")
    parser.add_argument("--frontend-origin", help="deployed frontend origin to test CORS against, e.g. https://your-site.vercel.app")
    parser.add_argument("--min-areas", type=int, default=1, help="fewest monitored areas /api/risk-areas must return (default 1)")
    parser.add_argument("--timeout", type=float, default=30, help="seconds to wait for each request (default 30)")
    parser.add_argument("--wake-attempts", type=int, default=4, help="tries for the first request while a sleeping instance wakes (default 4)")
    parser.add_argument("--wake-wait", type=float, default=15, help="seconds between wake-up tries (default 15)")
    args = parser.parse_args(argv)

    try:
        base = normalize_base_url(args.backend)
        frontend = normalize_base_url(args.frontend_origin) if args.frontend_origin else None
    except ValueError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 2

    if fetch is None:
        def fetch(url, headers):
            return http_get(url, headers, timeout=args.timeout)

    results = run_checks(base, fetch, frontend, args.min_areas, args.wake_attempts, args.wake_wait, sleep)
    print(format_report(base, results))
    return 1 if any(item.outcome == FAIL for item in results) else 0


if __name__ == "__main__":
    sys.exit(main())
