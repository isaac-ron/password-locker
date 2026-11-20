// drand time-lock encryption (tlock) against the League of Entropy "quicknet" chain.
// A ciphertext locked to round R cannot be decrypted by anyone until the drand network
// publishes the signature for round R. No server we control is involved.
import { timelockEncrypt, timelockDecrypt, mainnetClient, roundAt, roundTime, defaultChainInfo, Buffer } from "tlock-js";
import type { ChainClient } from "tlock-js";
import { nextWindowStart, type WindowConfig } from "./schedule";

let client: ChainClient | null = null;
function getClient(): ChainClient {
  return (client ??= mainnetClient());
}

export const CHAIN = defaultChainInfo;

export interface TlockBox {
  ciphertext: string; // age-armored tlock ciphertext
  round: number;
  unlockAt: number; // ms epoch of `round`
}

/** Latest published drand round (signature-verified by drand-client). */
export async function latestRound(): Promise<number> {
  const b = await getClient().latest();
  return b.round;
}

/**
 * Current time that the user can't wind back. Takes the later of the device clock and
 * the latest drand round, so setting the clock back changes nothing, and replaying an
 * old beacon does nothing while the device clock is correct.
 */
export async function trustedNow(): Promise<number> {
  const r = await latestRound();
  return Math.max(Date.now(), roundTime(CHAIN, r));
}

/** First round whose publish time is at or after `ms`. */
export function roundAtOrAfter(ms: number): number {
  const r = roundAt(ms, CHAIN);
  return roundTime(CHAIN, r) >= ms ? r : r + 1;
}

export async function lockToRound(secret: string, round: number): Promise<TlockBox> {
  const ciphertext = await timelockEncrypt(round, Buffer.from(secret, "utf8"), getClient());
  return { ciphertext, round, unlockAt: roundTime(CHAIN, round) };
}

/** Encrypt `secret` so it only opens at the next daily window (≥20h away). */
export async function lockToNextWindow(secret: string, cfg: WindowConfig): Promise<TlockBox> {
  const now = await trustedNow();
  const start = nextWindowStart(now, cfg);
  return lockToRound(secret, roundAtOrAfter(start));
}

export type UnlockResult = { ok: true; secret: string } | { ok: false; reason: "locked"; latest: number } | { ok: false; reason: "error"; error: string };

export async function tryUnlock(box: TlockBox): Promise<UnlockResult> {
  try {
    const latest = await latestRound();
    if (latest < box.round) return { ok: false, reason: "locked", latest };
    const buf = await timelockDecrypt(box.ciphertext, getClient());
    return { ok: true, secret: buf.toString("utf8") };
  } catch (e) {
    return { ok: false, reason: "error", error: e instanceof Error ? e.message : String(e) };
  }
}
