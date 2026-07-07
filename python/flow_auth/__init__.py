"""
flow-auth (Python) — drop-in SSO for protected routes, backed by an
identity-aware gateway (oauth2-proxy-style) + a policy endpoint.

Apps use it to guard the routes that need auth; public routes stay untouched.
It calls the gateway's /verify (authN via the shared cookie + authz via the
policy decision point). Set the gateway origin with the FLOW_GATEWAY env var
(e.g. https://auth.example.com) or pass `gateway=`.

Core is dependency-free (urllib, synchronous). See the README for Flask and
FastAPI wiring.
"""
import os
import urllib.parse
import urllib.request
import urllib.error

DEFAULT_GATEWAY = os.environ.get("FLOW_GATEWAY", "")

__all__ = ["verify_request", "DEFAULT_GATEWAY"]


def verify_request(cookie: str, resource: str, gateway: str = DEFAULT_GATEWAY) -> dict:
    """Ask the gateway whether this session may open `resource`.

    Returns {"status": int, "email": str | None}:
      200 = allowed (email set), 401 = not signed in,
      403 = signed in but denied, 503 = gateway unreachable.
    """
    if not gateway:
        raise ValueError("flow-auth: set the FLOW_GATEWAY env var (your SSO gateway origin, e.g. https://auth.example.com) or pass gateway=")
    if not resource:
        raise ValueError("flow-auth: `resource` (the app slug) is required")
    url = f"{gateway}/verify?resource={urllib.parse.quote(resource)}"
    req = urllib.request.Request(
        url,
        # accept:json → gateway returns 401 (not a 302 redirect) when unauthenticated
        headers={"Cookie": cookie or "", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req) as r:
            return {"status": r.status, "email": r.headers.get("x-auth-request-email")}
    except urllib.error.HTTPError as e:
        return {"status": e.code, "email": e.headers.get("x-auth-request-email")}
    except Exception as e:  # network/DNS/etc.
        return {"status": 503, "email": None, "error": str(e)}


def login_url(return_to: str, gateway: str = DEFAULT_GATEWAY) -> str:
    """Where to send an unauthenticated browser to sign in, then come back."""
    return f"{gateway}/oauth2/start?rd={urllib.parse.quote(return_to, safe='')}"
