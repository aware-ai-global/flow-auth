---
name: onboard-to-flow-sso
description: >
  Onboard an existing app's protected routes (e.g. /admin) to Flow SSO using the
  flow-auth middleware. Use when someone says "put this admin behind Flow login",
  "add SSO to this app", "onboard <app> to the gateway", or "protect these routes
  with Aware sign-in". For fully-internal apps that route entirely through the
  wildcard gateway, this skill does NOT apply — that's a registry-only onboard.
---

# Onboard an app to Flow SSO (Shape 2: public app, gated subset)

Wire an app's protected routes to Flow SSO with the `flow-auth` package. The app
keeps its public routes direct; only the routes you choose require sign-in. No
load balancer, no Entra change, no rerouting public traffic.

## 0. Confirm this is the right shape
- App is public on its own subdomain, only some routes need auth → ✅ use this skill.
- App is fully internal (everything needs auth) → NOT this skill; register it and
  route it through the wildcard gateway instead. Stop and say so.

## 1. Gather inputs
- **Slug** — the app's registry id, e.g. `example-admin`. kebab-case.
- **Protected routes** — path prefixes to gate, e.g. `/admin`, `/api/admin`.
- **Framework + module system** — Express/Flask/FastAPI/other, AND whether the
  app is ESM (`"type":"module"` / uses `import`) or CommonJS (`require`). This
  decides the import style in step 4.
- **Deploy target + branch** — App Runner / ECS / EKS / Amplify / Lambda, and the
  branch it actually deploys from (often NOT `main`). You need this for step 7.
- **Gateway origin** — the `FLOW_GATEWAY` value (e.g. `https://auth.<your-domain>`).
  Ask if unknown; do not guess.

## 2. Register the app in Flow (once)
Human path (preferred): add it in **Flow → Administration → SSO Apps** (name,
slug, url `https://<host>`, kind `gateway-app`, allowed roles).
Automation: POST to the registry API with the registry token:
```
POST https://<registry-endpoint>/apps
Authorization: Bearer <registry token>
{ "id":"<slug>", "name":"<name>", "url":"https://<host>", "kind":"gateway-app",
  "ownerEmail":"<requester>", "allowedRoleIds":[...] }
```
Do NOT invent role ids — read them from Flow, or leave empty (admins always
allowed) and have the user set roles in the UI.

## 3. Install flow-auth + set the gateway
`flow-auth` is a PUBLIC package — installs in any region/account/managed build
with no token or private-git creds.
- Node: `npm install github:aware-ai-global/flow-auth#v2`
- Python: `pip install "git+https://github.com/aware-ai-global/flow-auth@v2#subdirectory=python"`
Pin the tag. Never copy the source into the app.

**Set `FLOW_GATEWAY`** in the app's runtime env (required as of v2), e.g.
`FLOW_GATEWAY=https://auth.<your-domain>`. Without it, flow-auth throws on
startup (by design — fail fast, don't silently allow).

## 4. Wrap the protected routes (only those)
**ESM (`import`) app:**
```js
import { flowAuth } from "flow-auth";
app.use(["/admin", "/api/admin"], flowAuth("<slug>"));
```
**CommonJS (`require`) app** — flow-auth is ESM-only, so load it via dynamic
import through a tiny wrapper (do NOT `require("flow-auth")`, it will throw):
```js
// flowGate.cjs
let mw;
module.exports = function flowGate(slug) {
  return async (req, res, next) => {
    if (!mw) ({ flowAuth: mw } = await import("flow-auth"));
    return mw(slug)(req, res, next);
  };
};
// usage: app.use(["/admin","/api/admin"], require("./flowGate.cjs")("<slug>"));
```
Flask/FastAPI: see the flow-auth README; guard the admin blueprint/router only.
Leave public routes with no middleware.

## 5. Remove the app's own gate
Delete the legacy auth on those routes (e.g. `ADMIN_PASSWORD`, basic-auth). The
gateway is the source of truth now. Confirm nothing else depends on the old gate.

## 6. Wire identity through
Use `req.userEmail` (Node) / `request.user_email` (Python) that flow-auth sets,
in place of any "current admin user" logic. If the app mapped a password to an
"is admin" flag, treat the presence of a valid Flow user as authorized (finer
role checks already happened server-side in the PDP).

## 7. Deploy — and confirm it actually deployed (fail-loud)
Managed builds fail SILENTLY in ways that leave prod on the old version:
- Deploy to the **correct branch** (the target may track e.g. `alpha/2.0.0`, not `main`).
- After deploy, **confirm the new build ran** (check the build log / image digest /
  a version marker), not just that the pipeline returned success.
- If the install step errored (e.g. old private-git assumptions, wrong Node/py
  version), the deploy may no-op and prod silently stays old. Verify, don't assume.

## 8. Test
- Hit a protected route **unauthenticated** → redirect to the gateway login.
- Sign in → land back on the route, authenticated.
- Hit a **public** route → no auth, unchanged.
- Confirm in the gateway logs that `/verify?resource=<slug>` returns **200**
  (a 403 with a tiny body that never reaches the PDP usually means a gateway
  misconfig, not a policy denial — escalate to the Flow side).
- Note: flow-auth caches only *allows* (30s); denials are re-checked every
  request, so a just-granted user gets in immediately.

## 9. Report
State: slug registered, `FLOW_GATEWAY` set, routes wrapped, old gate removed,
deploy confirmed on the right branch, test result. Flag if the app is NOT a
subdomain of the gateway's parent domain (then the shared cookie isn't sent and
it needs the different-domain flow — surface it, don't guess).
