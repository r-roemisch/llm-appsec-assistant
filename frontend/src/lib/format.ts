const EM_DASH = "—";

function isMissing(value: number | null | undefined): value is null | undefined {
  return value === null || value === undefined || Number.isNaN(value);
}

/**
 * Money in US dollars: "$0.0012" (four decimals, trailing zeros trimmed to at
 * least two), "$1.50" from one dollar up, "<$0.0001" for tiny amounts,
 * "$0" for zero and an em dash when unknown.
 */
export function formatCost(usd: number | null | undefined): string {
  if (isMissing(usd)) return EM_DASH;
  if (usd === 0) return "$0";
  const sign = usd < 0 ? "-" : "";
  const abs = Math.abs(usd);
  if (abs < 0.0001) return `${sign}<$0.0001`;
  if (abs >= 1) return `${sign}$${abs.toFixed(2)}`;
  const trimmed = abs.toFixed(4).replace(/0+$/, "");
  const [whole, fraction = ""] = trimmed.split(".");
  return `${sign}$${whole}.${fraction.padEnd(2, "0")}`;
}

/** Token counts: 812, 1.2k, 15.6k, 2.3M; an em dash when unknown. */
export function formatTokens(count: number | null | undefined): string {
  if (isMissing(count)) return EM_DASH;
  const abs = Math.abs(count);
  if (abs < 1000) return String(count);
  const units: Array<[number, string]> = [
    [1_000_000_000, "B"],
    [1_000_000, "M"],
    [1000, "k"],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size * 0.9995) {
      const scaled = (count / size).toFixed(1).replace(/\.0$/, "");
      return `${scaled}${suffix}`;
    }
  }
  return String(count);
}

/** Full number with thousands separators, for table columns. */
export function formatNumber(value: number | null | undefined): string {
  if (isMissing(value)) return EM_DASH;
  return new Intl.NumberFormat("en-US").format(value);
}

/** "1 passage", "1,284 passages". */
export function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

/**
 * File sizes in binary units, as upload limits are set: "812 B", "1.5 KB",
 * "12 KB", "5 MB"; an em dash when unknown.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (isMissing(bytes)) return EM_DASH;
  if (Math.abs(bytes) < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  const round = (n: number) => (Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
  while (Math.abs(round(value)) >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${round(value)} ${units[unit]}`;
}

/** Stat-tile value: grouped below ten thousand, compact above. */
export function formatCompact(value: number | null | undefined): string {
  if (isMissing(value)) return EM_DASH;
  return Math.abs(value) < 10_000 ? formatNumber(value) : formatTokens(value);
}

/** "840 ms", "1.2 s", "34 s"; an em dash when unknown. */
export function formatLatency(ms: number | null | undefined): string {
  if (isMissing(ms)) return EM_DASH;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 1000)} s`;
}

/**
 * "just now", "5 min ago", "3 h ago", "2 d ago", then a short date
 * ("Oct 12", with the year when it differs). Empty for invalid input.
 */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  const seconds = Math.max(0, now - time) / 1000;
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)} d ago`;
  const date = new Date(time);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}

/** "Nov 6, 2026" in the viewer's time zone; empty for invalid input. */
export function formatDate(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(time));
}

/** "Nov 6, 2026, 10:15 AM" in the viewer's time zone; empty for invalid input. */
export function formatDateTime(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(time),
  );
}

/**
 * "Nov 6, 10:15:30 AM" for audit tables: the year only when it is not the
 * current one; empty for invalid input.
 */
export function formatShortDateTime(iso: string, now: number = Date.now()): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  const date = new Date(time);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

/**
 * Time left until a deadline: "14:05" below an hour, "3 h 20 min" below a
 * day, then "2 d 4 h"; "0:00" once it has passed.
 */
export function formatCountdown(ms: number): string {
  if (Number.isNaN(ms) || ms <= 0) return "0:00";
  const totalSeconds = Math.ceil(ms / 1000);
  if (totalSeconds < 3600) {
    const minutes = Math.floor(totalSeconds / 60);
    return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 24 * 60) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
  }
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  return hours ? `${days} d ${hours} h` : `${days} d`;
}
