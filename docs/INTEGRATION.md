# Integration Guide (what-tibo-said)

This repo is a local Codex plugin source root containing an stdio MCP server, a
skill, and lifecycle hooks. It detects explicit GPT-backed Codex quota
exhaustion and (only in live mode) publishes one playful X post mentioning
`@tibo`. Verified against Codex CLI 0.151.0 and this repository's code.

## 1. Clone and build

Requires Node.js >= 22.

```bash
git clone git@github.com:rapidhere121345/what-tibo-said-skill.git
cd what-tibo-said-skill
npm install
npm run check        # builds dist/ with tsc and runs the mock-based tests
```

The MCP entry point is `dist/mcp-server.js`. Remember the absolute path of the
repo directory; it is used in every registration command below.

## 2. X Developer credentials

1. In the X Developer Console, select **Web App, Automated App or Bot** and
   grant **Read and write** permission.
2. Generate the OAuth 2.0 credentials: **Client ID**, **Client Secret**,
   **Access Token**, **Refresh Token**.
3. Keep the tokens out of the repo and out of shell history where possible.
   Store them temporarily in a private file (mode `0600`) outside the worktree.

## 3. Import credentials securely

Four-line format (one value per line, in this order): Client ID, Client Secret,
Access Token, Refresh Token.

```bash
node scripts/import-x-credentials.mjs /path/to/four-line-credentials
```

Split-file format (client credentials in one two-line file, tokens in another):

```bash
node scripts/import-x-credentials.mjs --combine /path/to/client-file /path/to/token-file
```

The importer never prints credential values. It writes JSON with `0600` file /
`0700` directory permissions and leaves the source files untouched.

- Default destination: `~/.config/what-tibo-said/x-oauth.json`
  (honors `XDG_CONFIG_HOME`).
- Override with `WHAT_TIBO_SAID_X_CREDENTIALS_FILE=/absolute/path/to/x-oauth.json`.
- Legacy fallback: set `X_USER_ACCESS_TOKEN` only. A static token cannot be
  refreshed automatically, so the OAuth file is strongly preferred.

## 4. Register the MCP server (direct stdio)

```bash
codex mcp add what-tibo-said --env WHAT_TIBO_SAID_LIVE=0 -- node /absolute/path/to/repo/dist/mcp-server.js
```

Inspect and remove:

```bash
codex mcp get what-tibo-said --json
codex mcp remove what-tibo-said
```

Keep `WHAT_TIBO_SAID_LIVE=0` for now. Direct MCP registration gives you the
three tools but **not** the plugin layer: no `Stop`/`SubagentStop` hooks and no
bundled skill guidance. Hooks only run when the repo is installed as a plugin
(see section 8).

## 5. Dry-run smoke test

With the MCP registered, ask Codex to call the tools, or test the server
manually over stdio with any MCP client. Expected tool set and return states:

- `preview_quota_reset` — generate the post text without publishing. Requires a
  verified `gpt-*` model slug; optional error text and manual `reset_at`.
- `handle_quota_signal` — detect, then respect the live flag and cooldown.
- `request_quota_reset` — manual trigger; still gated by live flag and cooldown.

Statuses to check for: `dry_run` (live off, detection matched),
`ignored_not_quota`, `ignored_unsupported_model`, `deduplicated`, `posted`,
`config_error`, `error`. No status or log output should ever contain the access
token.

A good smoke assertion: previewing with a `gpt-*` model returns a draft ending
in the fixed inline attribution
`Sent by https://github.com/rapidhere121345/what-tibo-said-skill — triggered when Codex quota runs out.`,
and previewing with a non-`gpt-*` model returns
`ignored_unsupported_model`.

## 6. Enabling live publishing

Only after the dry-run preview looks right:

```bash
codex mcp remove what-tibo-said
codex mcp add what-tibo-said --env WHAT_TIBO_SAID_LIVE=1 -- node /absolute/path/to/repo/dist/mcp-server.js
```

Setting `WHAT_TIBO_SAID_LIVE=1` is standing authorization to publish one
matching quota-reset post per cooldown window. Note that X's Create Post
endpoint (`POST https://api.x.com/2/tweets`) is paid; check current X API
pricing before going live.

## 7. Cooldown, dedup, refresh, and retry semantics

- Global cooldown + concurrency lock: at most one successful post per
  `WHAT_TIBO_SAID_COOLDOWN_HOURS` window (default 24, allowed 1-720).
- Same-event dedup uses a state fingerprint. State lives in `PLUGIN_DATA`,
  `XDG_STATE_HOME`, or `~/.local/state/what-tibo-said`; override with
  `WHAT_TIBO_SAID_STATE_DIR`. State files are `0600` in `0700` directories.
- Failed posts do **not** consume the cooldown and are never retried
  automatically.
- Automatic 401 handling: on an HTTP 401 from X, the client refreshes the token
  exactly once using confidential-client Basic auth, atomically saves the new
  access/refresh tokens back to the credentials file (keeping `0600`), and
  retries that one request once. This is credential renewal, not general retry
  permission: network errors, timeouts, 403, 429, and 5xx never trigger a
  resend. Requests time out after 10 seconds; only HTTP 201 counts as posted.

## 8. Direct MCP vs full plugin/skill install

| Layer | Direct `codex mcp add` | Plugin install |
| --- | --- | --- |
| MCP tools | yes | yes (via `.mcp.json`, `${PLUGIN_ROOT}`) |
| Skill guidance (`skills/ask-tibo-quota-reset/`) | no | yes |
| `Stop`/`SubagentStop` auto-detection hooks (`hooks/hooks.json`) | no | yes |

Plugin installation goes through a configured marketplace: add a marketplace
source with `codex plugin marketplace add` and then install with
`codex plugin add`. This repository is currently a **plugin source root**
(entry: `.codex-plugin/plugin.json`), **not a marketplace**, and there is no
verified one-command Git marketplace install for it; configure the marketplace
according to your Codex environment's marketplace expectations before running
`codex plugin add what-tibo-said`.

## 9. Upgrade and uninstall

Upgrade:

```bash
cd /absolute/path/to/repo
git pull
npm install
npm run check
# restart Codex sessions; re-run `codex mcp get what-tibo-said --json` to confirm the path/env
```

Uninstall:

```bash
codex mcp remove what-tibo-said
# plus the plugin removal command for your marketplace setup, if installed as a plugin
```

Optionally delete the credential file (securely remove the JSON at your chosen
path) and the state directory to erase cooldown history.

## 10. Security cautions

- Only `gpt-*` model slugs qualify; every other provider, missing model, and
  IP-like string is rejected before any publish path is reached.
- The GitHub attribution URL is **fixed and public** in every post; no other
  URL is accepted or appended.
- Public posts exclude exact reset dates/time zones/UTC offsets, location, raw
  error text, hostnames, usernames, file paths, IPs, session IDs, and tokens.
- Never commit credential files or the state directory into the repo; they
  belong outside the worktree.
- Live mode without a valid credentials file or `X_USER_ACCESS_TOKEN` fails
  closed with `config_error`.
- Auto-hook detection can only see `last_assistant_message` at a normal stop;
  quota errors before any assistant message may be missed. Use
  `request_quota_reset` manually in that case rather than loosening detection.
