// End-to-end: a puzzle made by the app is solved by public/emergency.py and opened by the app.
// Skipped when Python + gmpy2 are not installed (e.g. CI).
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPuzzle, openPuzzle } from "../src/puzzle";

const py = process.platform === "win32" ? "python" : "python3";
const hasGmpy = spawnSync(py, ["-c", "import gmpy2"]).status === 0;

describe.skipIf(!hasGmpy)("emergency.py interop", () => {
  it("solves an app-made puzzle and the result opens in the app", async () => {
    const pz = await createPuzzle("native-solved-pw", 1 / 3600, 300_000); // 300k squarings
    const dir = mkdtempSync(join(tmpdir(), "locker-"));
    const vaultPath = join(dir, "vault.json");
    writeFileSync(vaultPath, JSON.stringify({ v: 1, entries: [{ label: "X", username: "@me", puzzle: pz }] }));
    const run = spawnSync(py, ["-I", "public/emergency.py", "solve", vaultPath], {
      input: "1\nthis is a real emergency\n",
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(run.status, run.stderr).toBe(0);
    const line = run.stdout.trim().split(/\r?\n/).pop()!;
    const r = JSON.parse(line);
    expect(r.locker).toBe("emergency-result");
    expect(r.pid).toBe(pz.n.slice(0, 32));
    expect(await openPuzzle(pz, { done: r.done, y: r.y })).toBe("native-solved-pw");
  });
});
