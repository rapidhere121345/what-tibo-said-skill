export interface PublicContextOptions {
  resetAt?: string;
  model?: string | null;
  now: Date;
  platform?: string;
  arch?: string;
}

const GPT_MODEL_PATTERN = /^gpt-[a-z0-9]+(?:[._-][a-z0-9]+)*$/i;
const IPV4_LITERAL_PATTERN =
  /(?:^|[^0-9])(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}(?:$|[^0-9])/;
const LOCAL_DATE_TIME_PATTERN =
  /^([1-9]\d{3})[-/](\d{2})[-/](\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const ZONED_DATE_TIME_PATTERN =
  /^([1-9]\d{3})[-/](\d{2})[-/](\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:\s?(Z|UTC)|([+-])(\d{2}):?(\d{2}))$/i;

const ALLOWED_PLATFORMS = new Set([
  "aix",
  "android",
  "cygwin",
  "darwin",
  "freebsd",
  "haiku",
  "linux",
  "netbsd",
  "openbsd",
  "sunos",
  "win32",
]);

const ALLOWED_ARCHITECTURES = new Set([
  "arm",
  "arm64",
  "ia32",
  "loong64",
  "mips",
  "mipsel",
  "ppc",
  "ppc64",
  "riscv64",
  "s390",
  "s390x",
  "x64",
]);

const MINUTE_MS = 60_000;
const MAX_OUTPUT_LENGTH = 150;

function isValidDateParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): boolean {
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    return false;
  }
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysByMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDay = daysByMonth[month - 1];
  return maxDay !== undefined && day >= 1 && day <= maxDay;
}

function parseResetAt(value: string | undefined): Date | undefined {
  if (value === undefined) {
    return undefined;
  }

  const input = value.trim();
  const localMatch = LOCAL_DATE_TIME_PATTERN.exec(input);
  if (localMatch) {
    const parts = localMatch.slice(1).map(Number);
    const [year, month, day, hour, minute, second] = parts;
    if (
      year === undefined ||
      month === undefined ||
      day === undefined ||
      hour === undefined ||
      minute === undefined ||
      second === undefined ||
      !isValidDateParts(year, month, day, hour, minute, second)
    ) {
      return undefined;
    }
    return new Date(year, month - 1, day, hour, minute, second);
  }

  const zonedMatch = ZONED_DATE_TIME_PATTERN.exec(input);
  if (!zonedMatch) {
    return undefined;
  }

  const year = Number(zonedMatch[1]);
  const month = Number(zonedMatch[2]);
  const day = Number(zonedMatch[3]);
  const hour = Number(zonedMatch[4]);
  const minute = Number(zonedMatch[5]);
  const second = Number(zonedMatch[6] ?? "0");
  const offsetHour = Number(zonedMatch[10] ?? "0");
  const offsetMinute = Number(zonedMatch[11] ?? "0");
  if (
    !isValidDateParts(year, month, day, hour, minute, second) ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return undefined;
  }

  const normalized = input
    .replace(/^([1-9]\d{3})\/(\d{2})\/(\d{2})/, "$1-$2-$3")
    .replace(" ", "T")
    .replace(/\s?UTC$/i, "Z")
    .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp) : undefined;
}

export function normalizeGptPlanModel(
  value: string | null | undefined,
): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (
    trimmed.length > 48 ||
    !GPT_MODEL_PATTERN.test(trimmed) ||
    IPV4_LITERAL_PATTERN.test(trimmed)
  ) {
    return undefined;
  }
  return trimmed.toLowerCase();
}

function formatRemaining(resetAt: Date, now: Date): string {
  const remainingMs = resetAt.getTime() - now.getTime();
  if (remainingMs <= 0) {
    return "due now";
  }

  let minutes = Math.ceil(remainingMs / MINUTE_MS);
  const days = Math.floor(minutes / (24 * 60));
  minutes -= days * 24 * 60;
  const hours = Math.floor(minutes / 60);
  minutes -= hours * 60;

  if (days > 0) {
    return `${days}d${hours > 0 ? ` ${hours}h` : ""} left`;
  }
  if (hours > 0) {
    return `${hours}h${minutes > 0 ? ` ${minutes}m` : ""} left`;
  }
  return `${minutes}m left`;
}

/** Formats quota timing and an allowlisted subset of non-sensitive runtime context. */
export function formatPublicContext(options: PublicContextOptions): string {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const segments: string[] = [];

  const resetAt = parseResetAt(options.resetAt);
  if (resetAt && Number.isFinite(options.now.getTime())) {
    segments.push(`Reset: ${formatRemaining(resetAt, options.now)}`);
  }

  const model = normalizeGptPlanModel(options.model);
  if (model) {
    segments.push(model);
  }
  if (ALLOWED_PLATFORMS.has(platform) && ALLOWED_ARCHITECTURES.has(arch)) {
    segments.push(`${platform}/${arch}`);
  }
  const included: string[] = [];
  for (const segment of segments) {
    const candidate = [...included, segment].join(" · ");
    if ([...candidate].length <= MAX_OUTPUT_LENGTH) {
      included.push(segment);
    }
  }
  return included.join(" · ");
}
