// Vault model and persistence. The vault holds only ciphertexts, except for `pending`:
// a freshly generated password you are about to set on a site. That one is never shown
// on screen and is left out of exports.
import type { TlockBox } from "./drand";
import type { Puzzle } from "./puzzle";
import { DEFAULT_WINDOW, type WindowConfig } from "./schedule";

export type EntryKind = "scheduled" | "emergency-only";

export interface Pending {
  secret: string;
  createdAt: number;
  /** "initial": first lock of a new entry. "relock": rotating after an unlock. */
  reason: "initial" | "relock";
  copiedAt?: number;
}

export interface Entry {
  id: string;
  label: string;
  site: "x" | "reddit" | "email" | "other";
  kind: EntryKind;
  username: string;
  /** Present when the entry is locked. Scheduled entries have both; emergency-only has just the puzzle. */
  tlock?: TlockBox;
  puzzle?: Puzzle;
  lockedAt?: number;
  pending?: Pending;
  history: { at: number; event: string }[];
}

export interface Settings {
  window: WindowConfig;
  emergencyHours: number;
  /** Fastest squarings/sec seen on any of your devices. Puzzles are sized to this. */
  maxRate: number;
  maxRateDevice?: string;
  /** Native gmpy2 speed from `emergency.py calibrate` on the PC. Usually far above maxRate. */
  nativeRate?: number;
}

/** The speed puzzles are sized for: the fastest solver you are known to have. */
export function sizingRate(s: Settings): number {
  return Math.max(s.maxRate, s.nativeRate ?? 0);
}

export interface Vault {
  v: 1;
  settings: Settings;
  entries: Entry[];
  updatedAt: number;
  exportedAt?: number;
}

const KEY = "pl.vault.v1";

export function emptyVault(): Vault {
  return {
    v: 1,
    settings: { window: { ...DEFAULT_WINDOW }, emergencyHours: 72, maxRate: 0 },
    entries: [],
    updatedAt: Date.now(),
  };
}

export function load(): Vault {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Vault;
  } catch {
    /* fall through */
  }
  return emptyVault();
}

export function save(v: Vault): void {
  v.updatedAt = Date.now();
  localStorage.setItem(KEY, JSON.stringify(v));
}

export function log(e: Entry, event: string): void {
  e.history.unshift({ at: Date.now(), event });
  e.history.length = Math.min(e.history.length, 200);
}

/** Safe-to-share export: everything except plaintext pending passwords. */
export function exportJson(v: Vault): string {
  const copy: Vault = JSON.parse(JSON.stringify(v));
  for (const e of copy.entries) delete e.pending;
  return JSON.stringify(copy, null, 1);
}

export function parseImport(text: string): Vault {
  const v = JSON.parse(text) as Vault;
  if (v?.v !== 1 || !Array.isArray(v.entries) || !v.settings) throw new Error("Not a password-locker vault file");
  for (const e of v.entries) delete e.pending;
  return v;
}

export function hasUnbackedChanges(v: Vault): boolean {
  return v.entries.length > 0 && (!v.exportedAt || v.exportedAt < v.updatedAt - 1000);
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** Ask the browser not to evict our storage (iOS home-screen apps and Chrome honour this). */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
