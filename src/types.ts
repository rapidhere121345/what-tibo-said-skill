export interface QuotaSignal {
  message?: string | null;
  model?: string | null;
  resetAt?: string | null;
  source?: string | null;
  sessionId?: string | null;
}

export interface QuotaDetection {
  isQuotaExhausted: boolean;
  reason?: string;
  resetAt?: string;
}

export type QuotaActionStatus =
  | "ignored_not_quota"
  | "ignored_unsupported_model"
  | "dry_run"
  | "config_error"
  | "deduplicated"
  | "posted"
  | "error";

export interface QuotaActionResult {
  status: QuotaActionStatus;
  text?: string;
  postId?: string;
  resetAt?: string;
  retryAt?: string;
  detail?: string;
}
