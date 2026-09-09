import assert from "node:assert/strict";
import test from "node:test";
import { detectQuotaExhaustion } from "../src/detector.js";

test("detects a Chinese Codex GPT plan quota error and reset time", () => {
  const result = detectQuotaExhaustion(
    "Codex GPT plan: 您已达到每周使用上限，您的限额将在 2026-10-01 09:30:00 重置。",
  );

  assert.equal(result.isQuotaExhausted, true);
  assert.equal(result.reason, "account_usage_limit");
  assert.equal(result.resetAt, "2026-10-01 09:30:00");
});

test("detects direct English account usage-limit errors", () => {
  const messages = [
    "You've hit your usage limit. Please wait until the limit resets.",
    "Your Codex quota is exhausted. Try again on 2026-09-13 10:00.",
    "workspace_member_credits_depleted",
    "The monthly usage limit has been reached.",
    "rate limit exceeded: monthly quota resets tomorrow",
  ];

  for (const message of messages) {
    assert.equal(detectQuotaExhaustion(message).isQuotaExhausted, true, message);
  }
});

test("does not confuse transient rate limits or quota discussion with exhaustion", () => {
  const messages = [
    "429 rate limit exceeded",
    "X API returned 429: rate limit exceeded",
    "The request timed out. Please try again.",
    "We should write a detector for when quota is exhausted.",
    "This document explains the quota metric and usage limits.",
    null,
    undefined,
    "",
  ];

  for (const message of messages) {
    assert.equal(detectQuotaExhaustion(message).isQuotaExhausted, false, String(message));
  }
});
