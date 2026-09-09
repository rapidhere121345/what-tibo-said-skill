const X_HANDLE_PATTERN = /^@?([A-Za-z0-9_]{1,15})$/;

export const DEFAULT_PLAYFUL_MESSAGES = [
  "@{handle} my Codex quota just hit the wall. Any chance you can wave the reset wand? 🪄",
  "@{handle} my tokens have gone on strike. Could you send in a quota reset? 🛠️",
  "@{handle} Codex says “come back later”; my deadline says “absolutely not.” Reset rescue? 🙏",
  "@{handle} the code is willing, but the quota is weak. Could I get a tiny reset miracle? ✨",
  "@{handle} plot twist: the bugs remain, but my Codex quota does not. Reset, pretty please? 😅",
] as const;

export function normalizeXHandle(rawHandle: string): string {
  const match = X_HANDLE_PATTERN.exec(rawHandle.trim());
  if (!match?.[1]) {
    throw new Error("TIBO_X_HANDLE must be a valid X handle with 1 to 15 characters.");
  }
  return match[1];
}

export function buildPlayfulPost(
  rawHandle: string,
  random: () => number = Math.random,
  messages: readonly string[] = DEFAULT_PLAYFUL_MESSAGES,
  publicContext = "",
): string {
  if (messages.length === 0) {
    throw new Error("At least one playful message is required.");
  }

  const handle = normalizeXHandle(rawHandle);
  const sample = random();
  const bounded = Number.isFinite(sample) ? Math.min(Math.max(sample, 0), 0.999999999) : 0;
  const selected = messages[Math.floor(bounded * messages.length)];
  if (!selected) {
    throw new Error("Could not select a playful message.");
  }

  const baseText = selected.replaceAll("{handle}", handle);
  const contextLine = publicContext.replace(/\s+/g, " ").trim();
  const text = contextLine ? baseText + "\n" + contextLine : baseText;
  if (!text.startsWith("@" + handle)) {
    throw new Error("The generated post must start by mentioning the configured handle.");
  }
  if (/https?:\/\//i.test(text)) {
    throw new Error("The generated post must not contain a URL.");
  }
  if ([...text].length > 280) {
    throw new Error("The generated post exceeds 280 characters.");
  }
  return text;
}
