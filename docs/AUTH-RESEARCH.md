# Six Flags authenticated integration — research & design plan

**Status: research, not started.** This repo ships today as a keyless,
read-only MCP over the public [themeparks.wiki](https://themeparks.wiki) API,
with a hosted Cloudflare Worker connector. Nothing here talks to Six Flags'
own account system. This doc plans the work to add *authenticated* Six Flags
features (a user's passes, reservations, Flash Pass, etc.) and records what a
first reconnaissance pass established, so a later session can resume without
re-deriving it.

Last updated 2026-07-19.

## What the web login actually is (observed live, 2026-07-19)

Driven through Chrome against `www.sixflags.com/carowinds` with a real account:

- **Two-step, email-first login.** Submit email → account lookup → *then* it
  asks for the password. Creating an account if none exists is folded into the
  same flow.
- **reCAPTCHA-gated.** The login form is protected by Google reCAPTCHA
  ("This site is protected by reCAPTCHA…").
- **Same-origin session.** A successful login returns to
  `www.sixflags.com/carowinds/account` — there is **no** redirect to a separate
  identity domain (`accounts.*`, an Auth0/Okta tenant, etc.) and no visible
  token handoff. The authenticated state is almost certainly a **session cookie
  on `sixflags.com`**, not a bearer token minted by a standalone auth server.
- **Heavy session-replay instrumentation.** The site runs Quantum Metric
  (`ingest.quantummetric.com`) which fires beacons every couple of seconds.

### Why the web endpoint wasn't captured

The browser tool available here (`read_network_requests`) has three limits that,
combined with the site's instrumentation, made web-flow token capture
impractical:

1. The request buffer holds only the last ~4 requests and cannot be cleared
   from the tooling side, so the Quantum Metric beacons flush the auth POST out
   within seconds of it firing.
2. The URL filter is include-only — there's no way to *exclude* the analytics
   host to surface the auth call underneath it.
3. It returns **url / method / status only** — not request/response headers or
   bodies, which is exactly where a token or `Set-Cookie` would be visible.

This is a tooling wall, not a dead end — see Track B.

### Conclusion from recon

reCAPTCHA + same-origin session + no separate token service is the signature of
a **browser cookie session, not a storable bearer token.** If that holds, the
"collect username/password → mint & store a durable token" idea has nothing
durable to store from the web, and a headless Worker could not replay the
reCAPTCHA login to re-mint one. That is the single most important input to the
design below, and Track B exists to confirm or refute it against the mobile app.

## Two tracks

### Track A (primary) — fetchproxy: ride the user's own signed-in browser

Matches the ~19 other fetchproxy MCPs in the fleet. The connector never sees or
stores the password or the session cookie; each authenticated request runs in
the user's own signed-in `sixflags.com` tab via the fetchproxy extension.

This is the design the observed architecture actually fits, and it sidesteps
reCAPTCHA entirely (the user logged in themselves, in their own browser).

Rough shape:
- New `SixFlagsSessionClient` (fetchproxy transport) alongside the existing
  keyless `SixFlagsClient` — keep the public themeparks.wiki tools untouched.
- Declare `sixflags.com` as the fetchproxy domain.
- Determine the authenticated read endpoints the `/account` page itself calls
  (passes, profile, orders) — these were **not** captured in this pass and are
  the first concrete TODO (see checklist).
- Read-only first. Any write (reservations, Flash Pass booking) is a separate,
  confirm-gated decision.
- Reference siblings for the pattern: `resy-mcp`, `opentable-mcp`,
  `zillow-mcp` (Pattern A), and the fleet conventions doc in
  [`chrischall/workflows`](https://github.com/chrischall/workflows) →
  `docs/fleet-conventions.md` (transport archetypes, bot-wall handling).

### Track B (investigation) — does the mobile app expose a durable token?

Only needed if we want a **hosted** path that acts *without* the user's browser
open (i.e. the `ofw-mcp` model: store a token/credential in `OAUTH_KV`, act
server-side). The web flow can't provide that; the app might.

Method (cannot be driven from this environment — operator runs it):
1. Put a TLS-intercepting proxy between a phone and the network — mitmproxy or
   Proxyman, with the proxy CA trusted on the device.
2. Fresh-install / log into the Six Flags app while capturing.
3. Look for, in order of usefulness:
   - a **token endpoint** returning a JWT + refresh token (→ durable, storable,
     `ofw`-style hosted connector becomes viable);
   - an `Authorization: Bearer …` header on authenticated API calls (confirms
     bearer, not cookie);
   - whether the app *also* rides reCAPTCHA / cookies (→ confirms fetchproxy is
     the only real option).
4. Watch for cert pinning — if the app pins, capture needs a patched build or a
   pinning-bypass (Frida/objection), which raises the cost a lot.

**Decision gate:** if Track B finds a durable bearer/refresh token, a hosted
token-storing connector is possible and we design that. If the app is also
cookie/reCAPTCHA-bound, Track A (fetchproxy) is the answer and Track B closes.

## Guardrails to carry forward (do not drop these)

This connector is **public and shared with other people**, and its deployed
login page currently promises *"No credentials are collected or stored."*
Therefore:

- **Prefer fetchproxy (Track A): nothing collected, nothing stored.** That is
  both the best architectural fit and the cleanest privacy posture.
- If Track B ever leads to credential collection, it must be **consented and
  disclosed** at the point of entry, and the privacy note in `src/sixflags-auth.ts`
  **and** `docs/DEPLOY-CONNECTOR.md` (which sells "No credentials — anywhere")
  must be rewritten in the *same* PR. No silent capture behind the current
  promise.
- Store a **token**, never the raw password — and keep the password only if the
  token genuinely needs periodic re-minting (the `ofw` reason: expiring token,
  no refresh). Never stockpile credentials for a feature that doesn't exist yet.

## Open questions (decide before building)

- **Which authenticated features are actually wanted?** Passes/QR, reservations,
  Flash Pass, order history, personalized wait times? This scopes everything.
- Is there any documented Six Flags / former–Cedar Fair partner API? (Assume no
  until shown otherwise.)

## Resumption checklist

- [ ] Decide the target feature set (open question above).
- [ ] **Track A:** capture the authenticated read endpoints the `/account` page
      calls — needs a capture tool that exposes bodies/headers, or an in-tab
      fetch log. This is the concrete blocker that stopped this pass.
- [ ] **Track B:** run the mitmproxy/Proxyman app-login capture; record the
      token model in this doc.
- [ ] Choose architecture per the Track B decision gate.
- [ ] Build read-only tools first; gate any writes.
- [ ] If any credential collection: update `sixflags-auth.ts` privacy note +
      `DEPLOY-CONNECTOR.md` in the same PR.
