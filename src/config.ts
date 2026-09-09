import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface AppConfig {
  live: boolean;
  xUserAccessToken?: string;
  targetHandle: string;
  cooldownMs: number;
  stateDir: string;
  xEndpoint: string;
  requestTimeoutMs: number;
}

const DEFAULT_COOLDOWN_HOURS = 24;
const MIN_COOLDOWN_HOURS = 1;
const MAX_COOLDOWN_HOURS = 24 * 30;

function parseCooldownHours(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_COOLDOWN_HOURS;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < MIN_COOLDOWN_HOURS || parsed > MAX_COOLDOWN_HOURS) {
    throw new Error(
      "WHAT_TIBO_SAID_COOLDOWN_HOURS must be a number between 1 and 720.",
    );
  }
  return parsed;
}

function resolveStateDir(env: NodeJS.ProcessEnv): string {
  const explicit = env.WHAT_TIBO_SAID_STATE_DIR?.trim();
  if (explicit) {
    return resolve(explicit);
  }

  const pluginData = env.PLUGIN_DATA?.trim();
  if (pluginData) {
    return resolve(pluginData);
  }

  const xdgState = env.XDG_STATE_HOME?.trim();
  if (xdgState) {
    return join(resolve(xdgState), "what-tibo-said");
  }

  return join(homedir(), ".local", "state", "what-tibo-said");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const token = env.X_USER_ACCESS_TOKEN?.trim();
  const config: AppConfig = {
    live: env.WHAT_TIBO_SAID_LIVE === "1",
    targetHandle: env.TIBO_X_HANDLE?.trim() || "tibo",
    cooldownMs: parseCooldownHours(env.WHAT_TIBO_SAID_COOLDOWN_HOURS) * 60 * 60 * 1000,
    stateDir: resolveStateDir(env),
    xEndpoint: "https://api.x.com/2/tweets",
    requestTimeoutMs: 10_000,
  };

  if (token) {
    config.xUserAccessToken = token;
  }
  return config;
}
