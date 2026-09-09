# What Tibo Said

A local Codex plugin / skill / MCP. When it detects an explicit "GPT plan quota
exhausted" message from Codex, it composes a playful X post mentioning `@tibo`
that asks for a quota reset.

Dry-run is the default: nothing is published until you explicitly set
`WHAT_TIBO_SAID_LIVE=1`.

> **Full setup walkthrough (X app creation, credential import, enabling live
> mode): see [docs/INTEGRATION.md](docs/INTEGRATION.md).**

## Behavior

- GPT-only quota detection: only account-level exhaustion signals for
  `gpt-*` models on Codex GPT plans are eligible. Other models, or a missing
  model, are ignored outright.
- Matches explicit weekly/monthly usage-limit and credits-depleted errors
  (English and Chinese wording). Ordinary HTTP 429s, transient rate limits,
  network failures, and general talk of "quota" are ignored.
- Publishes a standalone new post; it never replies to other people's posts.
- The post comes from a fixed set of built-in playful `@tibo` templates; the
  only dynamic parts are the optional context line and the fixed footer.
- When a parseable reset time is available, only the relative remaining
  duration is shown (e.g. `Reset: 3d 8h left`), never an exact date or time.
- Local context is restricted to an allowlist: the validated `gpt-*` model
  slug and the OS platform/architecture pair. No location, IP address,
  timezone, hostname, username, paths, session IDs, tokens, or raw error text
  ever appears in the public post.
- Every post ends with the fixed inline attribution
  `Sent by https://github.com/rapidhere121345/what-tibo-said-skill — triggered when Codex quota runs out.`
  That repository URL is the only link the post generator allows.
- A global cooldown plus a concurrency lock guards publishing; by default at
  most one successful post per 24 hours.
- Failed publishes do not consume the cooldown and are never auto-retried.

Example post:

> @tibo my Codex quota just hit the wall. Any chance you can wave the reset wand? 🪄
> Reset: 3d 8h left · gpt-5.6-sol · linux/x64
>
> Sent by https://github.com/rapidhere121345/what-tibo-said-skill — triggered when Codex quota runs out.

## Components

- `.codex-plugin/plugin.json` — plugin manifest.
- `hooks/hooks.json` — checks the last assistant message on `Stop` and
  `SubagentStop`.
- `skills/ask-tibo-quota-reset/` — trigger and safety-boundary guidance.
- `.mcp.json` — launches the local stdio MCP server.
- `src/` — detection, message composition, cooldown state, X API client.

## Build and tests

Requires Node.js 22 or newer:

```bash
npm install
npm run check    # tsc build + unit tests (tsx --test)
```

Tests use a mocked X client and never make real requests. After building,
install this directory as a local plugin source in Codex; the entry point is
`.codex-plugin/plugin.json`. The project does not modify user-level Codex
configuration or plugin marketplaces.

## X credentials (OAuth 2.0 confidential client)

1. In the X Developer Console, create a Web / Automated / Bot app with
   `Read and write` permission.
2. Generate the OAuth 2.0 Client ID, Client Secret, Access Token, and
   Refresh Token.
3. Put the four values on four lines (Client ID, Client Secret, Access Token,
   Refresh Token) in a temporary file and import them into a private config
   file outside the repository:

```bash
node scripts/import-x-credentials.mjs /path/to/four-line-credentials
```

If the client pair and token pair live in two separate two-line files:

```bash
node scripts/import-x-credentials.mjs --combine /path/to/client-file /path/to/token-file
```

The importer never prints credential values. It writes
`~/.config/what-tibo-said/x-oauth.json` by default (file mode `0600`,
directory mode `0700`); override the destination with
`WHAT_TIBO_SAID_X_CREDENTIALS_FILE`. Source files are left untouched.

Posting uses the access token. The token is refreshed **only** when X returns
an explicit HTTP 401: one refresh using confidential-client Basic auth, the
newest access/refresh tokens from the response saved atomically, and that
single request retried once. Network errors, timeouts, 403, 429, and 5xx never
trigger a refresh or resend.

As a compatibility fallback you may set `X_USER_ACCESS_TOKEN` instead, but
that mode cannot refresh automatically.

Start in dry-run and review the preview:

```bash
export WHAT_TIBO_SAID_LIVE=0
```

Only after confirming the preview, enable publishing:

```bash
export WHAT_TIBO_SAID_LIVE=1
```

Other knobs (target handle, cooldown hours, state directory) are documented in
`.env.example`. State defaults to the plugin data directory, `XDG_STATE_HOME`,
or the user state directory; override with `WHAT_TIBO_SAID_STATE_DIR`.

**X pricing caveat.** Posts are created through the paid `POST
https://api.x.com/2/tweets` endpoint and include a URL. Prices may change, so
check [X API pricing](https://docs.x.com/x-api/getting-started/pricing) and
[Create Posts](https://docs.x.com/x-api/posts/create-post) before enabling
live mode.

## MCP tools

- `preview_quota_reset` — preview only; requires a validated `gpt-*` model,
  optionally with error text and a manual `reset_at`.
- `handle_quota_signal` — detect first, then apply the live flag and cooldown
  policy.
- `request_quota_reset` — manual opt-in trigger; accepts `reset_at` and is
  still protected by the live flag and cooldown.

Tools return `dry_run`, `ignored_not_quota`, `ignored_unsupported_model`,
`deduplicated`, `posted`, `config_error`, or `error`. Access tokens are
never included in results or logs.

## Auto-detection limitation

The hooks can only inspect the `last_assistant_message` available when a turn
ends normally. If the quota error occurs before the model emits any assistant
message, the hooks may never see the error text, so automatic detection is not
guaranteed. In that case, call `request_quota_reset` manually from a session
that still works. This is a visibility limit of the trigger point itself; the
detection rules are not loosened to compensate.

## Security defaults

- Dry-run by default; `WHAT_TIBO_SAID_LIVE=1` is standing authorization for
  one matching post per cooldown window.
- Only strictly validated `gpt-*` model slugs can enter the publish path;
  GLM, unknown models, and IP-shaped strings are rejected.
- Live mode without a valid OAuth credentials file or `X_USER_ACCESS_TOKEN`
  returns a config error immediately.
- X requests time out after 10 seconds; only HTTP 201 counts as success. The
  single retry after a 401 refresh is the only retry.
- OAuth credentials live outside the repository and are rewritten with an
  atomic replace that preserves `0600` permissions.
- State files are `0600`; state directories are `0700`.
