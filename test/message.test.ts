import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlayfulPost,
  DEFAULT_PLAYFUL_MESSAGES,
  normalizeXHandle,
  PROJECT_ATTRIBUTION,
  PROJECT_URL,
} from "../src/message.js";

test("all default messages mention Tibo's current handle, stay short, and contain only the project URL", () => {
  for (let index = 0; index < DEFAULT_PLAYFUL_MESSAGES.length; index += 1) {
    const random = () => (index + 0.01) / DEFAULT_PLAYFUL_MESSAGES.length;
    const text = buildPlayfulPost("thsottiaux", random);
    assert.match(text, /^@thsottiaux\b/);
    assert.equal((text.match(/https?:\/\/\S+/gi) ?? []).length, 1);
    assert.match(text, new RegExp("Sent by " + PROJECT_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.ok(text.endsWith("— triggered when Codex quota runs out."));
    assert.ok([...text].length <= 280);
  }
});

test("normalizes a leading at-sign and deterministically selects a message", () => {
  assert.equal(normalizeXHandle("@thsottiaux"), "thsottiaux");
  assert.equal(
    buildPlayfulPost("@thsottiaux", () => 0),
    "@thsottiaux my Codex quota just hit the wall. Any chance you can wave the reset wand? 🪄\n\n" +
      PROJECT_ATTRIBUTION,
  );
  assert.match(buildPlayfulPost("thsottiaux", () => Number.NaN), /^@thsottiaux\b/);
});

test("rejects invalid handles, URLs, and overlong messages", () => {
  assert.throws(() => normalizeXHandle("thsottiaux.example"));
  assert.throws(() =>
    buildPlayfulPost("thsottiaux", () => 0, ["@{handle} see https://example.com"]),
  );
  assert.throws(() =>
    buildPlayfulPost("thsottiaux", () => 0, ["@{handle} " + "x".repeat(300)]),
  );
});

test("appends one compact public-context line and validates the final post", () => {
  const text = buildPlayfulPost(
    "thsottiaux",
    () => 0,
    DEFAULT_PLAYFUL_MESSAGES,
    "Reset: 3d 8h left   · gpt-5.6-sol · linux/x64",
  );

  assert.match(text, /\nReset: 3d 8h left · gpt-5\.6-sol · linux\/x64\n\nSent by/);
  assert.match(
    text,
    new RegExp("Sent by " + PROJECT_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.ok([...text].length <= 280);
  assert.throws(() =>
    buildPlayfulPost("thsottiaux", () => 0, DEFAULT_PLAYFUL_MESSAGES, "https://example.com"),
  );
});

test("trims oversized public context at segment boundaries before dropping attribution", () => {
  const text = buildPlayfulPost(
    "thsottiaux",
    () => 0,
    DEFAULT_PLAYFUL_MESSAGES,
    "Reset: 999d 23h left · gpt-" + "x".repeat(48) + " · linux/x64",
  );

  assert.ok([...text].length <= 280);
  assert.match(text, /\nReset: 999d 23h left/);
  assert.match(text, /Sent by https:\/\/github\.com\//);
  assert.ok(text.endsWith(PROJECT_ATTRIBUTION));
});
