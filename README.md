# flow-auth

Drop-in SSO for protected app routes, backed by the **Flow** SSO gateway.

Use this when an app is **public on its own domain** but a subset of routes
(e.g. `/admin`) must be gated behind Aware sign-in — "Shape 2" in the Flow SSO
runbook. Public routes stay direct and fast; you wrap only the protected ones.

It is a thin, versioned client. All it does is ask the Flow gateway
`GET /verify?resource=<app-slug>` (forwarding the browser's `.<your-domain>`
session cookie) and act on the answer:

| Gateway says | flow-auth does |
|---|---|
| `200` + `X-Auth-Request-Email` | allow, expose the user's email |
| `401` (not signed in) | redirect to `…/oauth2/start` to log in, then back |
| `403` (signed in, not allowed) | return 403 |

Auth (Entra) and authorization (who may open which app) live in Flow. This
library holds **no** auth logic of its own — patch it centrally, apps bump the
version. Never copy-paste it into apps.

## Prerequisite (one-time, in Flow)

Register the app in Flow → **Administration → SSO Apps** (or via the registry
API). Note its **slug** (e.g. `example-admin`) and set which roles may open it.
The app must be on a subdomain of `<your-domain>` so the browser sends the shared
session cookie to it.

## Node (Express / Connect)

```bash
npm install github:aware-ai-global/flow-auth#v2
```

```js
import { flowAuth } from "flow-auth";

// Guard only the admin routes. Public routes get no middleware.
app.use(["/admin", "/api/admin"], flowAuth("example-admin"));

// req.userEmail is set on allowed requests.
```

Options: `flowAuth(slug, { gateway, denyMessage })`. Set the gateway origin with the `FLOW_GATEWAY` env var (required). Decisions are cached
per session for 30s (`FLOW_AUTH_CACHE_MS`).

There's also a framework-agnostic `verifyRequest({ cookie, resource })` → `{ status, email }`.

## Python

```bash
pip install "git+https://github.com/aware-ai-global/flow-auth@v2#subdirectory=python"
```

Flask:
```python
from flask import request, redirect, abort
from flow_auth import verify_request, login_url

@admin_bp.before_request
def gate():
    v = verify_request(request.headers.get("Cookie", ""), "example-admin")
    if v["status"] == 200:
        request.user_email = v["email"]
    elif v["status"] == 403:
        abort(403)
    else:
        return redirect(login_url(request.url))
```

FastAPI (run the sync check off the event loop, or swap `urllib` for `httpx`):
```python
from fastapi import Request, HTTPException
from starlette.responses import RedirectResponse
from starlette.concurrency import run_in_threadpool
from flow_auth import verify_request, login_url

async def flow_auth(request: Request):
    v = await run_in_threadpool(verify_request, request.headers.get("cookie", ""), "example-admin")
    if v["status"] == 200:
        return v["email"]
    if v["status"] == 403:
        raise HTTPException(403, "No access to this app.")
    raise HTTPException(307, headers={"Location": login_url(str(request.url))})
# use as a dependency on the admin router: Depends(flow_auth)
```

## Versioning

Pin a tag (`#v1`). Breaking changes bump the major tag. Security fixes land in
the tag and apps re-install — the whole point of a package over copy-paste.

## Onboarding a whole app (the skill)

`onboard-to-flow-sso` (in `skill/`) is a Claude Code skill that automates the
whole Shape-2 onboard: register the app in Flow, install this package, wrap the
routes, remove the old auth gate, smoke-test.

Install it once per machine — the script resolves your own clone path, so it's
portable across the team (no hardcoded home dirs):

```bash
git clone https://github.com/aware-ai-global/flow-auth
cd flow-auth && ./install.sh        # symlinks into ~/.claude/skills; git pull keeps it current
# or: ./install.sh --copy           # copy instead of symlink
```

Then reload skills in Claude Code. Each teammate runs `./install.sh` after
cloning; `git pull` updates the skill in place (symlink mode).
