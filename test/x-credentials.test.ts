import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  parseXOAuthCredentials,
  readXOAuthCredentials,
  writeXOAuthCredentials,
} from "../src/x-credentials.js";

test("parses and trims all confidential-client credential fields", () => {
  assert.deepEqual(
    parseXOAuthCredentials({
      clientId: " client-id ",
      clientSecret: " client-secret ",
      accessToken: " access-token ",
      refreshToken: " refresh-token ",
    }),
    {
      clientId: "client-id",
      clientSecret: "client-secret",
      accessToken: "access-token",
      refreshToken: "refresh-token",
    },
  );
});

test("credential validation errors identify fields without exposing values", () => {
  const secret = "should-never-appear";
  assert.throws(
    () =>
      parseXOAuthCredentials({
        clientId: secret,
        clientSecret: secret,
        accessToken: secret,
        refreshToken: "",
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /refreshToken/);
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
});

test("atomically persisted credentials are readable and mode 0600", async () => {
  const directory = await mkdtemp(join(tmpdir(), "what-tibo-said-credentials-"));
  try {
    const path = join(directory, "nested", "x-oauth.json");
    const credentials = {
      clientId: "client-id",
      clientSecret: "client-secret",
      accessToken: "rotated-access",
      refreshToken: "rotated-refresh",
    };
    await writeXOAuthCredentials(path, credentials);

    assert.deepEqual(await readXOAuthCredentials(path), credentials);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), credentials);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
