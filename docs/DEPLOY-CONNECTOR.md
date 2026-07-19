# Deploying the Six Flags remote connector

This is the operator runbook for standing up `sixflags-mcp` as a hosted
Cloudflare Worker — a "remote connector" that anyone you share the URL with can
add to claude.ai (web, desktop, or mobile). It's a manual, one-time (per
operator) process; there is no CI/CD path for it, and none of the steps below
can be done by an agent since they require your own Cloudflare account.

If you just want the server on your own machine, you don't need any of this —
see the main [README](../README.md) for the local stdio / `.mcpb` install.

## No credentials — anywhere

themeparks.wiki, the upstream for every tool here, is a **public, keyless API**.
There are no operator credentials and no user credentials:

- You do **not** register an app, obtain a client id/secret, or set any
  `wrangler secret`.
- Users are **not** asked for a password, API key, or token. The connector's
  login page collects exactly one thing — their **home park** — which is saved
  as the default park for tools that don't name one. Nothing secret is stored.

The login page exists at all because the OAuth harness requires at least one
field (it uses the first field's value as the OAuth `userId`). Home park is a
genuinely useful thing to remember per user, so that's what the field is. See
[How auth works](#how-auth-works) below for the consequences.

## Full tool surface

Unlike some connectors in the fleet, **nothing is carved out**. All seven tools
are read-only keyless public calls, so the hosted connector registers the exact
same surface as the stdio server: `sixflags_list_parks`,
`sixflags_get_park_schedule`, `sixflags_get_wait_times`,
`sixflags_suggest_next`, `sixflags_list_attractions`, `sixflags_get_shows`,
`sixflags_healthcheck`.

> **Stateless — no cache Durable Object.** The only Durable Object is the
> harness's per-session MCP agent (`SixFlagsMcpAgent`, SQLite migration `v1` in
> `wrangler.jsonc`), applied automatically by `wrangler deploy` — no extra
> setup. `ParkDirectory`'s 12h destinations memo lives in that session's memory
> and is rebuilt on demand; nothing is persisted.

## Prerequisites

- A Cloudflare account (free tier is fine).
- Node and this repo checked out with dependencies installed (`npm install`).

## Steps

### 1. Log in to Cloudflare

```sh
npx wrangler login
```

This opens a browser to authorize the CLI against your Cloudflare account. (A
token with **Workers Scripts:Edit + Workers KV Storage:Edit** — the "Edit
Cloudflare Workers" template — also works; a read-only / zone-only token fails
KV-create and deploy.)

### 2. Create the OAuth KV namespace

The connector stores OAuth state and per-user session props (just the home-park
string) in a KV namespace bound as `OAUTH_KV` (see `wrangler.jsonc`). Give it a
distinct title so it never cross-wires with another connector's OAuth store:

```sh
npx wrangler kv namespace create sixflags-connector-oauth
```

The command prints something like:

```
{ "binding": "OAUTH_KV", "id": "abcd1234..." }
```

Copy the returned `id` into `wrangler.jsonc`, replacing the
`"REPLACE_WITH_OAUTH_KV_NAMESPACE_ID"` placeholder:

```jsonc
"kv_namespaces": [{ "binding": "OAUTH_KV", "id": "abcd1234..." }],
```

### 3. Deploy

```sh
npm run worker:deploy
```

This runs `wrangler deploy`, which builds and pushes `src/worker.ts` (plus the
`SixFlagsMcpAgent` per-session agent Durable Object binding and the `OAUTH_KV`
namespace from step 2). On success it prints the deployed URL:

```
https://sixflags-connector.<your-subdomain>.workers.dev
```

Because `wrangler.jsonc` also declares a custom-domain route
(`connector.sixflags.nullnet.app`, matching `connector.setlist.nullnet.app` and
`connector.untappd.nullnet.app`), the connector is additionally served at:

```
https://connector.sixflags.nullnet.app
```

Use the custom domain as the stable production URL you share. (The zone must be
in the deploying Cloudflare account; if it isn't, remove the `routes` entry from
`wrangler.jsonc` and use the `*.workers.dev` URL instead. **The edge TLS cert
provisions a few minutes after the first deploy — `https` on the custom domain
may fail to connect meanwhile. That self-heals; use the `*.workers.dev` URL to
verify in the interim rather than assuming the deploy failed.**) Note whichever
URL you use — it's what gets added as a connector, with `/mcp` appended.

Before deploying to production, you can sanity-check the Worker locally with:

```sh
npm run worker:dev
```

confirm it bundles without deploying:

```sh
npx wrangler deploy --dry-run
```

and run the Worker-specific test suite (Miniflare / real Workers runtime) with:

```sh
npm run worker:test
```

### 4. Add it as a connector in claude.ai

1. Go to claude.ai → **Settings** → **Connectors** → **Add custom connector**.
2. Paste the deployed URL with `/mcp` appended — the custom domain
   `https://connector.sixflags.nullnet.app/mcp` (or, without a custom domain,
   `https://sixflags-connector.<your-subdomain>.workers.dev/mcp`).
3. Claude will open the connector's login page (served by the Worker at
   `/authorize`). It asks for a **home park** and nothing else — a park name,
   themeparks.wiki slug, or park id (e.g. `Carowinds`, `Cedar Point`, `Magic
   Mountain`). The entry is verified against the live park directory on submit,
   so an unknown or ambiguous name is rejected right there with the list of
   matches instead of failing on every later tool call. Submitting it blank
   falls back to `SIXFLAGS_HOME_PARK` / `Carowinds`.

This connector is unlisted: it only shows up for people you've explicitly shared
the URL with, not in any public directory. Since there is nothing to
authenticate, anyone with the URL can use it — the data it exposes is the same
public wait-time data themeparks.wiki serves to everyone.

### 5. Verify on the mobile Claude app

Connectors added on claude.ai sync to all clients for that account, including
the **mobile Claude app**. On mobile:

1. Confirm the connector appears (Settings → Connectors) and shows as connected.
2. Run a read, e.g. ask Claude to run `sixflags_healthcheck`, then
   `sixflags_get_wait_times` with no `park` argument — it should report the home
   park you entered at login.

If that works, the deploy is verified end-to-end.

## How auth works

- There are **no credentials at any level.** No operator app registration, no
  per-user key. themeparks.wiki is keyless; the Worker sends only a descriptive
  `User-Agent`.
- The `/authorize` login page collects one field, the user's **home park**
  (`src/sixflags-auth.ts`). `login()` verifies it by constructing a
  `SixFlagsClient` + `ParkDirectory` and calling `resolve()`, then stores the
  **resolved canonical park name** — so the saved prop is unambiguous even when
  the user typed a slug, an id, or a partial name.
- The stored props are exactly `{ homePark: string }`, held in the OAuth
  provider's KV-backed props (`OAUTH_KV`). `src/worker.ts`'s `buildClient` turns
  that into a per-session `ParkDirectory` with `{ homePark }` injected, which is
  what every tool falls back to when a call doesn't name a park.
- **Consequence worth knowing:** the harness uses the first login field's value
  as the OAuth `userId`, so two users who enter the same home park share a
  userId. For a stateless connector over public read-only data that's harmless —
  there is no private state to leak between them — but don't extend this
  connector with per-user writes or storage without changing the identity
  scheme first.

## Rotation / teardown

There are no secrets to rotate — operator or user. A user changes their home
park by re-adding the connector (or just passing `park` explicitly on a call).

Tear down the whole connector:

```sh
npx wrangler kv namespace delete --namespace-id <id-from-step-2>
```

then delete the Worker itself from the Cloudflare dashboard (Workers &
Pages → `sixflags-connector` → Settings → Delete), or via:

```sh
npx wrangler delete
```

Deleting the KV namespace invalidates every stored user session — everyone who
had added the connector will need to re-enter their home park if it's
redeployed.
