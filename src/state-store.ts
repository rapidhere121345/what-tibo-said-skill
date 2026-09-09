import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface StoredState {
  version: 1;
  lastPostedAt?: string;
  lastFingerprint?: string;
  postId?: string;
}

export interface StateStoreOptions {
  lockTimeoutMs?: number;
  staleLockMs?: number;
  retryDelayMs?: number;
}

const EMPTY_STATE: StoredState = { version: 1 };

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

function validateState(value: unknown): StoredState {
  if (!value || typeof value !== "object") {
    throw new Error("The what-tibo-said state file is not a JSON object.");
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) {
    throw new Error("The what-tibo-said state file has an unsupported version.");
  }

  for (const key of ["lastPostedAt", "lastFingerprint", "postId"] as const) {
    if (candidate[key] !== undefined && typeof candidate[key] !== "string") {
      throw new Error("The what-tibo-said state file contains an invalid " + key + ".");
    }
  }

  const state: StoredState = { version: 1 };
  if (typeof candidate.lastPostedAt === "string") {
    state.lastPostedAt = candidate.lastPostedAt;
  }
  if (typeof candidate.lastFingerprint === "string") {
    state.lastFingerprint = candidate.lastFingerprint;
  }
  if (typeof candidate.postId === "string") {
    state.postId = candidate.postId;
  }
  return state;
}

export class StateStore {
  readonly statePath: string;
  readonly lockPath: string;

  private readonly stateDir: string;
  private readonly lockTimeoutMs: number;
  private readonly staleLockMs: number;
  private readonly retryDelayMs: number;

  constructor(stateDir: string, options: StateStoreOptions = {}) {
    this.stateDir = stateDir;
    this.statePath = join(stateDir, "state.json");
    this.lockPath = join(stateDir, "state.lock");
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5_000;
    this.staleLockMs = options.staleLockMs ?? 30_000;
    this.retryDelayMs = options.retryDelayMs ?? 20;
  }

  async read(): Promise<StoredState> {
    try {
      const content = await readFile(this.statePath, "utf8");
      return validateState(JSON.parse(content) as unknown);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { ...EMPTY_STATE };
      }
      if (error instanceof SyntaxError) {
        throw new Error("The what-tibo-said state file contains invalid JSON.");
      }
      throw error;
    }
  }

  async write(state: StoredState): Promise<void> {
    await mkdir(this.stateDir, { recursive: true, mode: 0o700 });
    const temporaryPath = join(
      this.stateDir,
      ".state." + process.pid + "." + randomUUID() + ".tmp",
    );

    let temporaryHandle: FileHandle | undefined;
    try {
      temporaryHandle = await open(temporaryPath, "wx", 0o600);
      await temporaryHandle.writeFile(JSON.stringify(state, null, 2) + "\n", "utf8");
      await temporaryHandle.sync();
      await temporaryHandle.close();
      temporaryHandle = undefined;
      await rename(temporaryPath, this.statePath);
    } catch (error) {
      await temporaryHandle?.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const release = await this.acquireLock();
    try {
      return await operation();
    } finally {
      await release();
    }
  }

  private async acquireLock(): Promise<() => Promise<void>> {
    await mkdir(this.stateDir, { recursive: true, mode: 0o700 });
    const deadline = Date.now() + this.lockTimeoutMs;

    while (true) {
      try {
        const handle = await open(this.lockPath, "wx", 0o600);
        await handle.writeFile(
          JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }) + "\n",
          "utf8",
        );

        return async () => {
          await handle.close().catch(() => undefined);
          await unlink(this.lockPath).catch(() => undefined);
        };
      } catch (error) {
        if (!isNodeError(error) || error.code !== "EEXIST") {
          throw error;
        }

        try {
          const lockStat = await stat(this.lockPath);
          if (Date.now() - lockStat.mtimeMs > this.staleLockMs) {
            await unlink(this.lockPath);
            continue;
          }
        } catch (statError) {
          if (isNodeError(statError) && statError.code === "ENOENT") {
            continue;
          }
          throw statError;
        }

        if (Date.now() >= deadline) {
          throw new Error("Timed out waiting for the what-tibo-said state lock.");
        }
        await delay(this.retryDelayMs);
      }
    }
  }
}
