import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlayfulPost,
  DEFAULT_PLAYFUL_MESSAGES,
  normalizeXHandle,
} from "../src/message.js";

test("all default messages mention tibo, stay short, and contain no URL", () => {
  for (let index = 0; index < DEFAULT_PLAYFUL_MESSAGES.length; index += 1) {
    const random = () => (index + 0.01) / DEFAULT_PLAYFUL_MESSAGES.length;
    const text = buildPlayfulPost("tibo", random);
    assert.match(text, /^@tibo\b/);
    assert.doesNotMatch(text, /https?:\/\//i);
    assert.ok([...text].length <= 280);
  }
});

test("normalizes a leading at-sign and deterministically selects a message", () => {
  assert.equal(normalizeXHandle("@tibo"), "tibo");
  assert.equal(
    buildPlayfulPost("@tibo", () => 0),
    "@tibo my Codex quota just hit the wall. Any chance you can wave the reset wand? 🪄",
  );
  assert.match(buildPlayfulPost("tibo", () => Number.NaN), /^@tibo\b/);
});

test("rejects invalid handles, URLs, and overlong messages", () => {
  assert.throws(() => normalizeXHandle("tibo.example"));
  assert.throws(() =>
    buildPlayfulPost("tibo", () => 0, ["@{handle} see https://example.com"]),
  );
  assert.throws(() =>
    buildPlayfulPost("tibo", () => 0, ["@{handle} " + "x".repeat(300)]),
  );
});

test("appends one compact public-context line and validates the final post", () => {
  const text = buildPlayfulPost(
    "tibo",
    () => 0,
    DEFAULT_PLAYFUL_MESSAGES,
    "Reset: 3d 8h left   · gpt-5.6-sol · linux/x64",
  );

  assert.match(text, /\nReset: 3d 8h left · gpt-5\.6-sol · linux\/x64$/);
  assert.ok([...text].length <= 280);
  assert.throws(() =>
    buildPlayfulPost("tibo", () => 0, DEFAULT_PLAYFUL_MESSAGES, "https://example.com"),
  );
});
