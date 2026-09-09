import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("credentials-file environment override is trimmed and resolved", () => {
  const config = loadConfig({
    WHAT_TIBO_SAID_X_CREDENTIALS_FILE: "  ./private/x-oauth.json  ",
  });
  assert.equal(config.xCredentialsFile, resolve("./private/x-oauth.json"));
});

test("blank credentials-file override does not create a configured path", () => {
  const config = loadConfig({ WHAT_TIBO_SAID_X_CREDENTIALS_FILE: "   " });
  const defaultPath = join(homedir(), ".config", "what-tibo-said", "x-oauth.json");
  assert.equal(config.xCredentialsFile, existsSync(defaultPath) ? defaultPath : undefined);
});

test("XDG_CONFIG_HOME selects the default credential location when it exists", async () => {
  const configHome = await mkdtemp(join(tmpdir(), "what-tibo-said-config-"));
  try {
    const defaultPath = join(configHome, "what-tibo-said", "x-oauth.json");
    await mkdir(join(configHome, "what-tibo-said"));
    await writeFile(defaultPath, "{}", { mode: 0o600 });
    assert.equal(loadConfig({ XDG_CONFIG_HOME: configHome }).xCredentialsFile, defaultPath);
  } finally {
    await rm(configHome, { recursive: true, force: true });
  }
});
