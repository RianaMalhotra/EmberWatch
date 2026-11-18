"""Which IP address to rate-limit a request by (#52 review).

``X-Forwarded-For`` is a list the client can start itself: anyone can send
``X-Forwarded-For: 1.2.3.4``. Each proxy in front of the app *appends* the
address it received the request from. So only the last ``N`` entries, added
by the ``N`` proxies we run behind and trust, are real. Everything to the
left of them was written by the client and is ignored.

* ``trusted_proxies = 0`` (default): the header is not trusted at all and the
  TCP peer address (``remote_addr``) is used. Safe anywhere, but behind a
  proxy every user then shares the proxy's address.
* ``trusted_proxies = N``: use the N-th entry from the right, the address the
  outermost trusted proxy saw. Same rule as Werkzeug's ``ProxyFix(x_for=N)``.
  Render puts one proxy in front of the app, so production uses ``1``.

If the header has fewer than N entries (the request did not come through all
trusted proxies) or the chosen entry is not an IP address, ``remote_addr`` is
used instead of guessing.
"""

import ipaddress


def client_ip(remote_addr, forwarded_for, trusted_proxies):
    if trusted_proxies <= 0:
        return remote_addr
    hops = [hop.strip() for hop in (forwarded_for or "").split(",") if hop.strip()]
    if len(hops) < trusted_proxies:
        return remote_addr
    candidate = hops[-trusted_proxies]
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return remote_addr
