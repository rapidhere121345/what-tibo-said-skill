---
name: ask-tibo-quota-reset
description: "Detect an explicit GPT-backed Codex account quota-exhaustion error, preview a playful X post mentioning @thsottiaux, or publish one cooldown-protected reset request when live mode is enabled. Use only for verified gpt-* weekly or monthly usage limits, depleted credits, and direct manual reset requests; do not use for other model providers, generic HTTP 429 errors, transient rate limiting, or ordinary discussion about quotas."
---

# Ask Tibo Quota Reset

Use the bundled MCP tools as follows:

- Let the `Stop` and `SubagentStop` hooks call `handle_quota_signal` automatically. It performs the high-precision detection itself.
- Proceed only when the hook model is a verified `gpt-*` slug. Ignore missing models and every other provider.
- Call `preview_quota_reset` when the user wants to see the proposed post without publishing it.
- Call `request_quota_reset` only for a direct manual request to ask for a reset.
- Treat `WHAT_TIBO_SAID_LIVE=1` as standing authorization to publish a matching post. Any other value is dry-run mode.
- Trust the tool's cooldown and deduplication result. Do not bypass it or retry a failed post automatically.
- A single create-post retry after X rejects an expired token with HTTP 401 is credential renewal, not permission to retry timeouts, ambiguous failures, or any other status.
- Include only a compact relative remaining-time estimate when the error provides a valid reset timestamp.
- Public local context is limited to the verified GPT model slug and operating system/architecture.
- End every generated post with the bundled inline what-tibo-said-skill attribution and its fixed GitHub repository URL; do not accept or add any other URL.
- Never put an exact reset date or time, time zone, UTC/GMT offset, location, raw error text, host name, user name, paths, IP addresses, session identifiers, or access tokens into the public post.
- Do not treat a plain HTTP 429, networking failure, server overload, or hypothetical quota discussion as account quota exhaustion.
