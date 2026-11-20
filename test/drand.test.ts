// Hits the real drand network (needs internet).
import { describe, it, expect } from "vitest";
import { lockToRound, tryUnlock, latestRound, roundAtOrAfter, trustedNow, CHAIN } from "../src/drand";
import { roundTime } from "tlock-js";

describe("drand tlock (network)", () => {
  it("decrypts a ciphertext locked to a past round", async () => {
    const latest = await latestRound();
    const box = await lockToRound("past-secret", latest - 10);
    const r = await tryUnlock(box);
    expect(r).toEqual({ ok: true, secret: "past-secret" });
  });

  it("refuses to decrypt a ciphertext locked to a future round", async () => {
    const latest = await latestRound();
    const box = await lockToRound("future-secret", latest + 20 * 60 * 24 * 365);
    const r = await tryUnlock(box);
    expect(r.ok).toBe(false);
  });

  it("trustedNow ignores a device clock set in the past", async () => {
    const real = Date.now;
    Date.now = () => real() - 7 * 24 * 3600e3;
    try {
      const t = await trustedNow();
      expect(Math.abs(t - real())).toBeLessThan(60_000);
    } finally {
      Date.now = real;
    }
  });

  it("roundAtOrAfter never unlocks before the requested time", () => {
    const ms = Date.parse("2026-11-21T15:00:00Z");
    expect(roundTime(CHAIN, roundAtOrAfter(ms))).toBeGreaterThanOrEqual(ms);
  });
});
