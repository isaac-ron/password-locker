// Rivest–Shamir–Wagner time-lock puzzle: the emergency path.
//
// Creating one is fast because the creator knows phi(N):
//   e = 2^T mod phi(N),  y = x^e mod N.
// Solving it without phi(N) takes T modular squarings one after another
// (y = x^(2^T) mod N), and those can't be run in parallel. phi(N) is thrown away
// right after creation, so even the person who made the puzzle has to do the work.
import { init, type GMPLib } from "gmp-wasm";
import { randomBytes, toHex, fromHex, sealWith, openWith } from "./crypto";

let gmpP: Promise<GMPLib> | null = null;
const gmp = () => (gmpP ??= init());

export interface Puzzle {
  v: 1;
  n: string; // modulus, hex
  x: string; // base, hex
  t: number; // number of squarings
  iv: string;
  ct: string; // AES-GCM(SHA-256(y), secret)
  rate: number; // squarings/sec the T was calibrated for
  targetHours: number;
}

export const MODULUS_BITS = 2048;

/** Sequential squarings per second on this device (gmp-wasm, same code path as the solver). */
export async function calibrate(ms = 1500): Promise<number> {
  const g = await gmp();
  // gmp-wasm's published typings are inconsistent (nextPrime() etc. return a narrower type); tests cover behaviour.
  const ctx: any = g.getContext();
  try {
    const n = randomOddHex(MODULUS_BITS);
    const N = ctx.Integer(n, 16);
    let y = ctx.Integer(toHex(randomBytes(MODULUS_BITS / 8 - 1)), 16);
    const batch = 2000;
    const exp = ctx.Integer(2).pow(batch);
    let count = 0;
    const start = performance.now();
    while (performance.now() - start < ms) {
      y = y.pow(exp, N);
      count += batch;
    }
    return Math.round(count / ((performance.now() - start) / 1000));
  } finally {
    ctx.destroy();
  }
}

function randomOddHex(bits: number): string {
  const b = randomBytes(bits / 8);
  b[0] |= 0xc0; // top two bits set, so p*q has exactly 2*bits bits
  b[b.length - 1] |= 1;
  return toHex(b);
}

export async function createPuzzle(secret: string, targetHours: number, rate: number): Promise<Puzzle> {
  const t = Math.max(1, Math.round(targetHours * 3600 * rate));
  const g = await gmp();
  // gmp-wasm's published typings are inconsistent (nextPrime() etc. return a narrower type); tests cover behaviour.
  const ctx: any = g.getContext();
  try {
    const p = ctx.Integer(randomOddHex(MODULUS_BITS / 2), 16).nextPrime();
    let q = ctx.Integer(randomOddHex(MODULUS_BITS / 2), 16).nextPrime();
    while (q.isEqual(p)) q = ctx.Integer(randomOddHex(MODULUS_BITS / 2), 16).nextPrime();
    const N = p.mul(q);
    const phi = p.sub(1).mul(q.sub(1));
    const x = ctx.Integer(toHex(randomBytes(MODULUS_BITS / 8 - 1)), 16).add(2);
    const e = ctx.Integer(2).pow(ctx.Integer(String(t)), phi);
    const y = x.pow(e, N);
    const box = await sealWith(fromHex(y.toString(16)), secret);
    return { v: 1, n: N.toString(16), x: x.toString(16), t, rate, targetHours, ...box };
  } finally {
    ctx.destroy(); // p, q, phi gone
  }
}

export interface Checkpoint {
  done: number; // squarings completed
  y: string; // hex value after `done` squarings
}

/**
 * Run squarings from a checkpoint for up to `budgetMs`, then return the new checkpoint.
 * The caller loops, saving each checkpoint, so progress survives closing the tab.
 */
export async function solveStep(pz: Puzzle, cp: Checkpoint | null, budgetMs: number): Promise<Checkpoint> {
  const g = await gmp();
  // gmp-wasm's published typings are inconsistent (nextPrime() etc. return a narrower type); tests cover behaviour.
  const ctx: any = g.getContext();
  try {
    const N = ctx.Integer(pz.n, 16);
    let done = cp?.done ?? 0;
    let y = ctx.Integer(cp?.y ?? pz.x, 16);
    const start = performance.now();
    let batch = 1000;
    while (done < pz.t && performance.now() - start < budgetMs) {
      const k = Math.min(batch, pz.t - done);
      y = y.pow(ctx.Integer(2).pow(k), N);
      done += k;
      if (batch < 200000) batch *= 2;
    }
    return { done, y: y.toString(16) };
  } finally {
    ctx.destroy();
  }
}

export async function openPuzzle(pz: Puzzle, cp: Checkpoint): Promise<string> {
  if (cp.done !== pz.t) throw new Error("Puzzle not finished");
  return openWith(fromHex(cp.y), { iv: pz.iv, ct: pz.ct });
}

/** Stable id for a puzzle, for keying its checkpoint. */
export function puzzleId(pz: Puzzle): string {
  return pz.n.slice(0, 32);
}
