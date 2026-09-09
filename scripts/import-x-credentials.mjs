#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_FIELDS = [
  "clientId",
  "clientSecret",
  "accessToken",
  "refreshToken",
];

function defaultDestination(env = process.env) {
  const explicit = env.WHAT_TIBO_SAID_X_CREDENTIALS_FILE?.trim();
  if (explicit) {
    return resolve(explicit);
  }

  const configHome = env.XDG_CONFIG_HOME?.trim();
  return join(configHome ? resolve(configHome) : join(homedir(), ".config"), "what-tibo-said", "x-oauth.json");
}

function parseCredentials(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Credential source is empty.");
  }

  if (trimmed.startsWith("{")) {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("Credential source contains invalid JSON.");
    }

    const credentials = {};
    for (const field of REQUIRED_FIELDS) {
      const value = parsed?.[field];
      if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`Credential source is missing ${field}.`);
      }
      credentials[field] = value.trim();
    }
    return credentials;
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length !== REQUIRED_FIELDS.length) {
    throw new Error(
      "Plain-text credential source must contain exactly four non-empty lines: client ID, client secret, access token, refresh token.",
    );
  }

  return Object.fromEntries(REQUIRED_FIELDS.map((field, index) => [field, lines[index]]));
}

function parsePair(raw, fields, description) {
  const lines = raw
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length !== fields.length) {
    throw new Error(`${description} must contain exactly ${fields.length} non-empty lines.`);
  }
  return Object.fromEntries(fields.map((field, index) => [field, lines[index]]));
}

async function writeCredentials(destination, credentials) {
  const directory = dirname(destination);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);

  try {
    const existing = await stat(destination);
    if (!existing.isFile()) {
      throw new Error("Credential destination exists but is not a regular file.");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const temporary = join(directory, `.x-oauth.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(credentials, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  await chmod(temporary, 0o600);
  await rename(temporary, destination);
  await chmod(destination, 0o600);
}

export async function importCredentials(source, destination = defaultDestination()) {
  const sourcePath = resolve(source);
  const sourceStat = await stat(sourcePath);
  if (!sourceStat.isFile()) {
    throw new Error("Credential source is not a regular file.");
  }

  const credentials = parseCredentials(await readFile(sourcePath, "utf8"));
  await writeCredentials(resolve(destination), credentials);
  return resolve(destination);
}

export async function importSplitCredentials(
  clientSource,
  tokenSource,
  destination = defaultDestination(),
) {
  const clientPath = resolve(clientSource);
  const tokenPath = resolve(tokenSource);
  for (const sourcePath of [clientPath, tokenPath]) {
    const sourceStat = await stat(sourcePath);
    if (!sourceStat.isFile()) {
      throw new Error("Credential source is not a regular file.");
    }
  }

  const clients = parsePair(
    await readFile(clientPath, "utf8"),
    ["clientId", "clientSecret"],
    "Client credential source",
  );
  const tokens = parsePair(
    await readFile(tokenPath, "utf8"),
    ["accessToken", "refreshToken"],
    "Token source",
  );
  const outputPath = resolve(destination);
  await writeCredentials(outputPath, { ...clients, ...tokens });
  return outputPath;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--combine") {
    const [, clientSource, tokenSource, destination] = args;
    if (!clientSource || !tokenSource) {
      throw new Error(
        "Usage: node scripts/import-x-credentials.mjs --combine <client-file> <token-file> [destination-file]",
      );
    }
    const storedAt = await importSplitCredentials(
      clientSource,
      tokenSource,
      destination ?? defaultDestination(),
    );
    process.stdout.write(`Stored OAuth credentials at ${storedAt} with mode 600.\n`);
    return;
  }

  const [source, destination] = args;
  if (!source) {
    throw new Error(
      "Usage: node scripts/import-x-credentials.mjs <source-file> [destination-file]\n" +
        "   or: node scripts/import-x-credentials.mjs --combine <client-file> <token-file> [destination-file]",
    );
  }

  const storedAt = await importCredentials(source, destination ?? defaultDestination());
  process.stdout.write(`Stored OAuth credentials at ${storedAt} with mode 600.\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Credential import failed."}\n`);
    process.exitCode = 1;
  });
}
