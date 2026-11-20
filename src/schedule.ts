// Daily unlock-window scheduling. Pure functions: no clock or network access here.

export interface WindowConfig {
  /** Window start, in UTC. 18:00 EAT (UTC+3) = 15:00 UTC. */
  hourUTC: number;
  minuteUTC: number;
  /** How long the window is meant to last (advisory: used for the re-lock nag). */
  durationMin: number;
}

export const DEFAULT_WINDOW: WindowConfig = { hourUTC: 15, minuteUTC: 0, durationMin: 30 };

/**
 * Minimum gap between locking and the window it targets. Stops "edit the schedule
 * to 10 minutes from now, then re-lock" from giving you a second window the same day:
 * whatever the schedule says, you get at most one unlock per MIN_GAP.
 */
export const MIN_GAP_MS = 20 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** First window start that is at least MIN_GAP_MS after `nowMs`. */
export function nextWindowStart(nowMs: number, cfg: WindowConfig = DEFAULT_WINDOW): number {
  const earliest = nowMs + MIN_GAP_MS;
  const d = new Date(earliest);
  let start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), cfg.hourUTC, cfg.minuteUTC);
  while (start < earliest) start += DAY_MS;
  return start;
}

/** The window currently in progress (or most recently started) relative to nowMs. */
export function windowEnd(startMs: number, cfg: WindowConfig = DEFAULT_WINDOW): number {
  return startMs + cfg.durationMin * 60 * 1000;
}

export function validateConfig(cfg: WindowConfig): string | null {
  if (!Number.isInteger(cfg.hourUTC) || cfg.hourUTC < 0 || cfg.hourUTC > 23) return "Hour must be 0–23";
  if (!Number.isInteger(cfg.minuteUTC) || cfg.minuteUTC < 0 || cfg.minuteUTC > 59) return "Minute must be 0–59";
  if (!Number.isInteger(cfg.durationMin) || cfg.durationMin < 5 || cfg.durationMin > 240) return "Duration must be 5–240 min";
  return null;
}

/** Format a timestamp in East Africa Time and the device's local zone. */
export function fmtTime(ms: number): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  };
  const eat = new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "Africa/Nairobi" }).format(ms);
  return `${eat} EAT`;
}

export function fmtDuration(ms: number): string {
  if (ms <= 0) return "now";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
