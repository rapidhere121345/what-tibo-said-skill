import type { QuotaDetection } from "./types.js";

const ISO_LIKE_DATE =
  /\b(20\d{2}[-/]\d{2}[-/]\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?(?:\s*(?:Z|UTC|[+-]\d{2}:?\d{2}))?)\b/i;

const CHINESE_EXHAUSTION_PATTERNS = [
  /您(?:已经|已)?达到(?:了)?[^。\n]{0,28}(?:每周|每月|周|月)(?:\s*[/、]\s*(?:每周|每月|周|月))?[^。\n]{0,20}(?:使用上限|限额|额度上限|配额上限)/i,
  /(?:您的)?(?:额度|配额|使用限额)[^。\n]{0,18}(?:不足|耗尽|已用完|用尽|达到上限)/i,
];

const ENGLISH_EXHAUSTION_PATTERNS = [
  /\byou(?:'ve| have)?\s+(?:hit|reached)\s+your\s+(?:weekly\s+|monthly\s+)?usage\s+limit\b/i,
  /\byour\s+(?:codex\s+)?(?:quota|credits?|usage limit)\s+(?:is|are|has been|have been)?\s*(?:exhausted|depleted|used up)\b/i,
  /\b(?:weekly|monthly)\s+(?:quota|usage|credit)\s+limit\s+(?:has been\s+)?(?:reached|exceeded|exhausted)\b/i,
  /\b(?:usage_limit_reached|workspace_(?:member|owner)_(?:credits_depleted|usage_limit_reached)|spend_control_reached)\b/i,
];

const RATE_LIMIT_WITH_ACCOUNT_WINDOW =
  /\brate limit exceeded\b[\s\S]{0,180}\b(?:weekly|monthly|usage limit|quota|credits?)\b/i;

function normalizeMessage(message: string): string {
  return message.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function extractResetAt(message: string): string | undefined {
  return ISO_LIKE_DATE.exec(message)?.[1];
}

export function detectQuotaExhaustion(message: string | null | undefined): QuotaDetection {
  if (!message || typeof message !== "string") {
    return { isQuotaExhausted: false };
  }

  const normalized = normalizeMessage(message);
  if (!normalized) {
    return { isQuotaExhausted: false };
  }

  for (const pattern of CHINESE_EXHAUSTION_PATTERNS) {
    if (pattern.test(normalized)) {
      const result: QuotaDetection = {
        isQuotaExhausted: true,
        reason: "account_usage_limit",
      };
      const resetAt = extractResetAt(normalized);
      if (resetAt) {
        result.resetAt = resetAt;
      }
      return result;
    }
  }

  for (const pattern of ENGLISH_EXHAUSTION_PATTERNS) {
    if (pattern.test(normalized)) {
      const result: QuotaDetection = {
        isQuotaExhausted: true,
        reason: "account_usage_limit",
      };
      const resetAt = extractResetAt(normalized);
      if (resetAt) {
        result.resetAt = resetAt;
      }
      return result;
    }
  }

  if (RATE_LIMIT_WITH_ACCOUNT_WINDOW.test(normalized)) {
    const result: QuotaDetection = {
      isQuotaExhausted: true,
      reason: "account_rate_limit_window",
    };
    const resetAt = extractResetAt(normalized);
    if (resetAt) {
      result.resetAt = resetAt;
    }
    return result;
  }

  return { isQuotaExhausted: false };
}
