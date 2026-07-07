/**
 * flow-auth (Node) — drop-in SSO for protected routes, backed by an
 * identity-aware gateway (oauth2-proxy-style) + a policy endpoint.
 *
 * Apps import it and wrap the routes that need auth; public routes stay
 * untouched. It calls the gateway's /verify (authN via the shared cookie +
 * authz via the policy decision point) and /oauth2/start (login).
 *
 *   import { flowAuth } from "flow-auth";
 *   app.use(["/admin", "/api/admin"], flowAuth("example-admin"));
 *
 * Configure the gateway origin with the FLOW_GATEWAY env var (e.g.
 * https://auth.example.com) or pass { gateway }. A request is allowed only
 * when the gateway says the signed-in user may open this app (resource).
 * Decisions are cached briefly per session to avoid a call on every request.
 */

const DEFAULT_GATEWAY = process.env.FLOW_GATEWAY || "";
const TTL_MS = Number(process.env.FLOW_AUTH_CACHE_MS || 30_000);
const NO_GATEWAY = "flow-auth: set the FLOW_GATEWAY env var (your SSO gateway origin, e.g. https://auth.example.com) or pass { gateway }.";

// Tiny TTL cache keyed by (resource, cookie) so we don't call /verify per request.
const _cache = new Map();

/**
 * Framework-agnostic check. Returns { status, email }:
 *   200 = allowed (email set), 401 = not signed in, 403 = signed in but denied,
 *   503 = gateway unreachable.
 */
export async function verifyRequest({ cookie = "", resource, gateway = DEFAULT_GATEWAY } = {}) {
  if (!gateway) throw new Error(NO_GATEWAY);
  if (!resource) throw new Error("flow-auth: `resource` (the app slug) is required");
  const key = resource + "\n" + cookie;
  const now = Date.now();
  const hit = _cache.get(key);
  if (hit && hit.exp > now) return hit.val;

  let val;
  try {
    const r = await fetch(`${gateway}/verify?resource=${encodeURIComponent(resource)}`, {
      // accept:json makes the gateway return 401 (not a 302 redirect) when unauthenticated
      headers: { cookie, accept: "application/json" },
      redirect: "manual",
    });
    val = { status: r.status, email: r.headers.get("x-auth-request-email") || null };
  } catch (err) {
    val = { status: 503, email: null, error: String(err) };
  }
  // Cache ONLY allows. Denials (401/403) are re-checked every request so a
  // user who was just granted access (or re-authenticates) gets in immediately
  // instead of waiting out a cached deny.
  if (val.status === 200) _cache.set(key, { val, exp: now + TTL_MS });
  return val;
}

/**
 * Express/Connect middleware. `resource` is the app's registry slug.
 * Options: { gateway, denyMessage }.
 */
export function flowAuth(resource, opts = {}) {
  const gateway = opts.gateway || DEFAULT_GATEWAY;
  if (!gateway) throw new Error(NO_GATEWAY);   // fail fast at wire-up, not per request
  return async function flowAuthMiddleware(req, res, next) {
    const cookie = req.headers.cookie || "";
    const { status, email } = await verifyRequest({ cookie, resource, gateway });
    if (status === 200) {
      req.userEmail = email;
      req.flowUser = { email };
      return next();
    }
    if (status === 403) return res.status(403).send(opts.denyMessage || "You don't have access to this app.");
    if (status === 503) return res.status(503).send("Auth gateway unavailable — try again shortly.");
    // 401 / anything else → send the browser to log in, then back here.
    const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
    const back = encodeURIComponent(`${proto}://${req.headers.host}${req.originalUrl}`);
    return res.redirect(`${gateway}/oauth2/start?rd=${back}`);
  };
}

export default flowAuth;
