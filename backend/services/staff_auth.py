"""Fail-closed Supabase Auth verification and explicit staff UUID allowlist.

Never trust client-supplied role headers or unsigned JWT payloads.
"""
import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


def verify_staff(bearer_header):
    """Return verified staff UUID, or None. Network/config errors deny access."""
    if not isinstance(bearer_header, str) or not bearer_header.startswith("Bearer "):
        return None
    token = bearer_header[7:].strip()
    if not token or len(token) > 8192 or any(c.isspace() for c in token):
        return None
    base = os.getenv("SUPABASE_URL", "").rstrip("/")
    anon_key = os.getenv("SUPABASE_ANON_KEY", "")
    allowed = {value.strip().lower() for value in os.getenv("REPORTS_STAFF_USER_IDS", "").split(",") if value.strip()}
    parsed = urlparse(base)
    if not allowed or not anon_key or parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password or parsed.path not in ("", "/"):
        return None
    try:
        req = Request(base + "/auth/v1/user", headers={
            "apikey": anon_key, "Authorization": "Bearer " + token,
        })
        with urlopen(req, timeout=5) as response:
            if response.status != 200:
                return None
            user = json.load(response)
        user_id = user.get("id") if isinstance(user, dict) else None
        return user_id if isinstance(user_id, str) and user_id.lower() in allowed else None
    except (HTTPError, URLError, TimeoutError, ValueError, OSError, KeyError):
        return None
