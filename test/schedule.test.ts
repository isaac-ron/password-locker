import { describe, it, expect } from "vitest";
import { nextWindowStart, MIN_GAP_MS, DEFAULT_WINDOW } from "../src/schedule";

const at = (iso: string) => Date.parse(iso);

describe("nextWindowStart", () => {
  it("targets 15:00 UTC (18:00 EAT)", () => {
    const s = nextWindowStart(at("2026-11-20T10:00:00Z"));
    expect(new Date(s).toISOString()).toBe("2026-11-21T15:00:00.000Z");
  });

  it("re-locking during a window targets the next day's window", () => {
    const s = nextWindowStart(at("2026-11-20T15:10:00Z"));
    expect(new Date(s).toISOString()).toBe("2026-11-21T15:00:00.000Z");
  });

  it("re-locking late in the evening still targets the next day", () => {
    const s = nextWindowStart(at("2026-11-20T18:59:00Z"));
    expect(new Date(s).toISOString()).toBe("2026-11-21T15:00:00.000Z");
  });

  it("never returns a window within MIN_GAP of now, whatever the schedule", () => {
    const now = at("2026-11-20T15:00:00Z");
    for (let h = 0; h < 24; h++) {
      const s = nextWindowStart(now, { ...DEFAULT_WINDOW, hourUTC: h });
      expect(s - now).toBeGreaterThanOrEqual(MIN_GAP_MS);
      expect(s - now).toBeLessThan(MIN_GAP_MS + 24 * 3600e3);
    }
  });
});
