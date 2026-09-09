import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { XOAuthCredentials } from "./types.js";

const CREDENTIAL_KEYS = ["clientId", "clientSecret", "accessToken", "refreshToken"] as const;

export function parseXOAuthCredentials(value: unknown): XOAuthCredentials {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The X OAuth credentials file is not a JSON object.");
  }

  const candidate = value as Record<string, unknown>;
  for (const key of CREDENTIAL_KEYS) {
    if (typeof candidate[key] !== "string" || candidate[key].trim() === "") {
      throw new Error("The X OAuth credentials file contains an invalid " + key + ".");
    }
  }

  return {
    clientId: (candidate.clientId as string).trim(),
    clientSecret: (candidate.clientSecret as string).trim(),
    accessToken: (candidate.accessToken as string).trim(),
    refreshToken: (candidate.refreshToken as string).trim(),
  };
}

export async function readXOAuthCredentials(path: string): Promise<XOAuthCredentials> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("The X OAuth credentials file contains invalid JSON.");
    }
    throw error;
  }
  return parseXOAuthCredentials(parsed);
}

export async function writeXOAuthCredentials(
  path: string,
  credentials: XOAuthCredentials,
): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = join(
    directory,
    ".x-oauth." + process.pid + "." + randomUUID() + ".tmp",
  );

  let handle: FileHandle | undefined;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.chmod(0o600);
    await handle.writeFile(JSON.stringify(credentials, null, 2) + "\n", "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
