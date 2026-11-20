import { describe, it, expect } from "vitest";
import { createPuzzle, solveStep, openPuzzle, calibrate, type Checkpoint } from "../src/puzzle";

describe("time-lock puzzle", () => {
  it("calibrates to a positive rate", async () => {
    const r = await calibrate(300);
    console.log(`squarings/sec on this machine: ${r}`);
    expect(r).toBeGreaterThan(1000);
  });

  it("solves to the secret only after all T squarings, resumable from checkpoints", async () => {
    // ~50k squarings: target 1s at 50k/s
    const pz = await createPuzzle("s3cret-pw", 1 / 3600, 50000);
    expect(pz.t).toBe(50000);
    let cp: Checkpoint | null = null;
    let steps = 0;
    while (!cp || cp.done < pz.t) {
      cp = await solveStep(pz, cp, 20); // small budget forces many resumes
      steps++;
    }
    expect(steps).toBeGreaterThan(1);
    expect(await openPuzzle(pz, cp)).toBe("s3cret-pw");
  });

  it("an unfinished or tampered checkpoint does not open", async () => {
    const pz = await createPuzzle("x", 1 / 3600, 5000);
    const cp = await solveStep(pz, null, 1e6);
    await expect(openPuzzle(pz, { ...cp, done: cp.done - 1 })).rejects.toThrow();
    await expect(openPuzzle(pz, { done: pz.t, y: "abcdef" })).rejects.toThrow();
  });
});
