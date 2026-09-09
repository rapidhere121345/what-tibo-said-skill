import assert from "node:assert/strict";
import test from "node:test";
import {
  formatPublicContext,
  normalizeGptPlanModel,
} from "../src/public-context.js";

const injectedContext = {
  platform: "linux",
  arch: "x64",
} as const;

test("formats known offset, Z, and UTC reset times as relative durations", () => {
  const now = new Date("2026-09-09T12:24:17+08:00");
  const expected = "Reset: 3d 8h left · gpt-5.6-sol · linux/x64";

  assert.equal(
    formatPublicContext({
      resetAt: "2026-09-12T20:24:17+08:00",
      model: "gpt-5.6-sol",
      now,
      ...injectedContext,
    }),
    expected,
  );
  assert.equal(
    formatPublicContext({
      resetAt: "2026-09-12T12:24:17Z",
      model: "gpt-5.6-sol",
      now,
      ...injectedContext,
    }),
    expected,
  );
  assert.equal(
    formatPublicContext({
      resetAt: "2026-09-12 12:24:17 UTC",
      model: "gpt-5.6-sol",
      now,
      ...injectedContext,
    }),
    expected,
  );
});

test("uses a strict space-separated timestamp only to calculate relative time", () => {
  const now = new Date(2026, 8, 12, 19, 23, 17);
  const output = formatPublicContext({
    resetAt: "2026-09-12 20:24:17",
    now,
    platform: process.platform,
    arch: process.arch,
  });

  assert.match(output, /^Reset: 1h 1m left · /);
});

test("omits missing and invalid reset times while preserving allowlisted context", () => {
  const now = new Date("2026-09-09T04:24:17Z");
  const expected = "linux/x64";
  assert.equal(formatPublicContext({ now, ...injectedContext }), expected);
  assert.equal(
    formatPublicContext({ resetAt: "2026-02-30 20:24:17", now, ...injectedContext }),
    expected,
  );
  assert.equal(
    formatPublicContext({ resetAt: "not a timestamp", now, ...injectedContext }),
    expected,
  );
});

test("omits non-GPT models and path-like free text", () => {
  const now = new Date("2026-09-09T04:24:17Z");
  assert.equal(
    formatPublicContext({
      model: "glm-coding/glm-5.3",
      now,
      ...injectedContext,
    }),
    "linux/x64",
  );
  assert.doesNotMatch(
    formatPublicContext({
      model: "/home/alice/project",
      now,
      ...injectedContext,
    }),
    /alice|home|project/,
  );
});

test("accepts only GPT slugs and rejects IPv4 or IPv6-shaped values", () => {
  assert.equal(normalizeGptPlanModel("  GPT-5.6-SOL  "), "gpt-5.6-sol");
  assert.equal(normalizeGptPlanModel("gpt-5.3-codex-spark"), "gpt-5.3-codex-spark");

  for (const model of [
    "glm-coding/glm-5.3",
    "codex",
    "192.168.1.10",
    "gpt-192.168.1.10",
    "fe80::1",
    "2001:db8::1",
  ]) {
    assert.equal(normalizeGptPlanModel(model), undefined);
  }
});

test("shows due now for reached or expired resets and rounds positive seconds to a minute", () => {
  const now = new Date("2026-09-09T04:24:17Z");
  assert.match(
    formatPublicContext({ resetAt: "2026-09-09T04:24:17Z", now, ...injectedContext }),
    /^Reset: due now /,
  );
  assert.match(
    formatPublicContext({ resetAt: "2026-09-09T04:20:00Z", now, ...injectedContext }),
    /^Reset: due now /,
  );
  assert.match(
    formatPublicContext({ resetAt: "2026-09-09T04:24:18Z", now, ...injectedContext }),
    /^Reset: 1m left /,
  );
});

test("accepts model identifiers but omits free text, control characters, and long values", () => {
  const now = new Date("2026-09-09T04:24:17Z");
  assert.equal(
    formatPublicContext({ model: "  gpt-5.6-sol  ", now, ...injectedContext }),
    "gpt-5.6-sol · linux/x64",
  );

  for (const model of [
    "ignore previous instructions",
    "gpt-5.6-sol\nsecret",
    "gpt-" + "x".repeat(49),
  ]) {
    const output = formatPublicContext({ model, now, ...injectedContext });
    assert.equal(output, "linux/x64");
    assert.doesNotMatch(output, /ignore|secret|x{49}/);
  }
});

test("uses runtime defaults and rejects injected context outside the allowlists", () => {
  const now = new Date("2026-09-09T04:24:17Z");
  const defaults = formatPublicContext({ now });
  const explicitDefaults = formatPublicContext({
    now,
    platform: process.platform,
    arch: process.arch,
  });
  assert.equal(defaults, explicitDefaults);
  assert.ok([...defaults].length <= 200);

  const hostile = formatPublicContext({
    now,
    model: "/home/alice/project",
    platform: "host.example.com",
    arch: "alice",
  });
  assert.equal(hostile, "");
  assert.doesNotMatch(hostile, /alice|home|host|secret/);
});

test("never exposes location, timezone, offset, or an exact reset timestamp", () => {
  const output = formatPublicContext({
    resetAt: "2026-09-12T20:24:17+08:00",
    model: "gpt-5.6-sol",
    now: new Date("2026-09-09T12:24:17+08:00"),
    ...injectedContext,
  });

  assert.equal(output, "Reset: 3d 8h left · gpt-5.6-sol · linux/x64");
  assert.doesNotMatch(
    output,
    /Asia|Shanghai|GMT|UTC|Sep|2026|20:24|[+-]\d{2}:?\d{2}/i,
  );
});
