import { createHash } from "node:crypto";
import type { AppConfig } from "./config.js";
import { detectQuotaExhaustion } from "./detector.js";
import { buildPlayfulPost, DEFAULT_PLAYFUL_MESSAGES } from "./message.js";
import {
  formatPublicContext,
  normalizeGptPlanModel,
  type PublicContextOptions,
} from "./public-context.js";
import { StateStore } from "./state-store.js";
import type { QuotaActionResult, QuotaDetection, QuotaSignal } from "./types.js";
import { XApiError, XPostClient } from "./x-client.js";

export interface QuotaResetServiceOptions {
  config: AppConfig;
  stateStore?: StateStore;
  xClient?: XPostClient;
  now?: () => Date;
  random?: () => number;
  publicContext?: Pick<PublicContextOptions, "platform" | "arch">;
}

export class QuotaResetService {
  private readonly config: AppConfig;
  private readonly stateStore: StateStore;
  private readonly xClient: XPostClient;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly publicContext: Pick<
    PublicContextOptions,
    "platform" | "arch"
  >;

  constructor(options: QuotaResetServiceOptions) {
    this.config = options.config;
    this.stateStore = options.stateStore ?? new StateStore(options.config.stateDir);
    this.xClient =
      options.xClient ??
      new XPostClient({
        endpoint: options.config.xEndpoint,
        timeoutMs: options.config.requestTimeoutMs,
      });
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
    this.publicContext = options.publicContext ?? {};
  }

  previewQuotaReset(signal: QuotaSignal = {}): QuotaActionResult {
    if (!normalizeGptPlanModel(signal.model)) {
      return this.unsupportedModelResult();
    }
    if (signal.message !== undefined && signal.message !== null) {
      const detection = this.withSignalResetAt(detectQuotaExhaustion(signal.message), signal);
      if (!detection.isQuotaExhausted) {
        return { status: "ignored_not_quota" };
      }
      return this.buildPreview(signal, detection);
    }
    return this.buildPreview(
      signal,
      this.withSignalResetAt(
        { isQuotaExhausted: true, reason: "manual_preview" },
        signal,
      ),
    );
  }

  async handleQuotaSignal(signal: QuotaSignal): Promise<QuotaActionResult> {
    const detection = this.withSignalResetAt(detectQuotaExhaustion(signal.message), signal);
    if (!detection.isQuotaExhausted) {
      return { status: "ignored_not_quota" };
    }
    return this.publishOrPreview(signal, detection);
  }

  async requestQuotaReset(signal: Omit<QuotaSignal, "message"> = {}): Promise<QuotaActionResult> {
    return this.publishOrPreview(
      signal,
      this.withSignalResetAt(
        { isQuotaExhausted: true, reason: "manual_request" },
        signal,
      ),
    );
  }

  private buildPreview(signal: QuotaSignal, detection: QuotaDetection): QuotaActionResult {
    try {
      const contextOptions: PublicContextOptions = {
        now: this.now(),
        ...this.publicContext,
      };
      if (detection.resetAt) {
        contextOptions.resetAt = detection.resetAt;
      }
      if (signal.model !== undefined) {
        contextOptions.model = signal.model;
      }
      const publicContext = formatPublicContext(contextOptions);
      const result: QuotaActionResult = {
        status: "dry_run",
        text: buildPlayfulPost(
          this.config.targetHandle,
          this.random,
          DEFAULT_PLAYFUL_MESSAGES,
          publicContext,
        ),
      };
      if (detection.resetAt) {
        result.resetAt = detection.resetAt;
      }
      return result;
    } catch (error) {
      return {
        status: "config_error",
        detail: error instanceof Error ? error.message : "Invalid message configuration.",
      };
    }
  }

  private async publishOrPreview(
    signal: QuotaSignal,
    detection: QuotaDetection,
  ): Promise<QuotaActionResult> {
    const model = normalizeGptPlanModel(signal.model);
    if (!model) {
      return this.unsupportedModelResult();
    }
    const eligibleSignal: QuotaSignal = { ...signal, model };
    const preview = this.buildPreview(eligibleSignal, detection);
    if (preview.status === "config_error") {
      return preview;
    }
    if (!this.config.live) {
      return preview;
    }

    const token = this.config.xUserAccessToken;
    if (!token) {
      return {
        status: "config_error",
        detail: "X_USER_ACCESS_TOKEN is required when WHAT_TIBO_SAID_LIVE=1.",
      };
    }

    const text = preview.text;
    if (!text) {
      return { status: "config_error", detail: "No post text was generated." };
    }
    const fingerprint = this.buildFingerprint(eligibleSignal, detection);

    try {
      return await this.stateStore.withLock(async () => {
        const state = await this.stateStore.read();
        const now = this.now();
        const lastPostedAt = state.lastPostedAt
          ? Date.parse(state.lastPostedAt)
          : Number.NaN;

        if (
          Number.isFinite(lastPostedAt) &&
          now.getTime() - lastPostedAt < this.config.cooldownMs
        ) {
          const detail =
            state.lastFingerprint === fingerprint
              ? "The same quota event was already posted during the cooldown window."
              : "A quota-reset post was already published during the global cooldown window.";
          return { status: "deduplicated", detail };
        }

        try {
          const posted = await this.xClient.createPost(text, token);
          await this.stateStore.write({
            version: 1,
            lastPostedAt: now.toISOString(),
            lastFingerprint: fingerprint,
            postId: posted.id,
          });
          const result: QuotaActionResult = {
            status: "posted",
            text: posted.text,
            postId: posted.id,
          };
          if (detection.resetAt) {
            result.resetAt = detection.resetAt;
          }
          return result;
        } catch (error) {
          if (error instanceof XApiError) {
            const result: QuotaActionResult = {
              status: "error",
              detail: error.message,
            };
            if (error.retryAt) {
              result.retryAt = error.retryAt;
            }
            return result;
          }
          return {
            status: "error",
            detail: error instanceof Error ? error.message : "Unknown publish failure.",
          };
        }
      });
    } catch (error) {
      return {
        status: "error",
        detail: error instanceof Error ? error.message : "State coordination failed.",
      };
    }
  }

  private buildFingerprint(signal: QuotaSignal, detection: QuotaDetection): string {
    const components = [
      detection.reason ?? "quota",
      detection.resetAt ?? "unknown-reset",
      signal.model?.trim() || "unknown-model",
    ];
    return createHash("sha256").update(components.join("|")).digest("hex");
  }

  private withSignalResetAt(
    detection: QuotaDetection,
    signal: Pick<QuotaSignal, "resetAt">,
  ): QuotaDetection {
    const resetAt = signal.resetAt?.trim();
    if (detection.resetAt || !resetAt) {
      return detection;
    }
    return { ...detection, resetAt };
  }

  private unsupportedModelResult(): QuotaActionResult {
    return {
      status: "ignored_unsupported_model",
      detail: "Only verified gpt-* model quota events are eligible.",
    };
  }
}
