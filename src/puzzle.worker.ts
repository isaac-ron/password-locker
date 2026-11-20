/// <reference lib="webworker" />
import { calibrate, createPuzzle, solveStep, openPuzzle, type Puzzle, type Checkpoint } from "./puzzle";

export type WorkerIn =
  | { type: "calibrate" }
  | { type: "create"; secret: string; hours: number; rate: number }
  | { type: "solve"; puzzle: Puzzle; cp: Checkpoint | null };

export type WorkerOut =
  | { type: "rate"; rate: number }
  | { type: "created"; puzzle: Puzzle }
  | { type: "progress"; cp: Checkpoint; rate: number }
  | { type: "solved"; secret: string; cp: Checkpoint }
  | { type: "error"; error: string };

const post = (m: WorkerOut) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = async (ev: MessageEvent<WorkerIn>) => {
  const m = ev.data;
  try {
    if (m.type === "calibrate") {
      post({ type: "rate", rate: await calibrate() });
    } else if (m.type === "create") {
      post({ type: "created", puzzle: await createPuzzle(m.secret, m.hours, m.rate) });
    } else if (m.type === "solve") {
      let cp = m.cp;
      while (!cp || cp.done < m.puzzle.t) {
        const before = cp?.done ?? 0;
        const t0 = performance.now();
        cp = await solveStep(m.puzzle, cp, 3000);
        const rate = (cp.done - before) / ((performance.now() - t0) / 1000);
        post({ type: "progress", cp, rate });
      }
      post({ type: "solved", secret: await openPuzzle(m.puzzle, cp), cp });
    }
  } catch (e) {
    post({ type: "error", error: e instanceof Error ? e.message : String(e) });
  }
};
