// Small crypto helpers: password generation, AES-GCM, hex/base64.

const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!#$%*+-=?@^_";
const ALPHABET = LOWER + UPPER + DIGITS + SYMBOLS;

function randIndex(n: number): number {
  // Rejection sampling for a uniform pick.
  const limit = Math.floor(256 / n) * n;
  const b = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(b);
    if (b[0] < limit) return b[0] % n;
  }
}

/** Random password: 28 chars with at least one character from each class. */
export function generatePassword(length = 28): string {
  for (;;) {
    let s = "";
    for (let i = 0; i < length; i++) s += ALPHABET[randIndex(ALPHABET.length)];
    if ([LOWER, UPPER, DIGITS, SYMBOLS].every((set) => [...s].some((c) => set.includes(c)))) return s;
  }
}

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function fromHex(h: string): Uint8Array {
  if (h.length % 2) h = "0" + h;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function toB64(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

export function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function aesKey(raw: Uint8Array): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", raw as BufferSource);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** AES-256-GCM with key = SHA-256(keyMaterial). */
export async function sealWith(keyMaterial: Uint8Array, plaintext: string): Promise<{ iv: string; ct: string }> {
  const iv = randomBytes(12);
  const key = await aesKey(keyMaterial);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, new TextEncoder().encode(plaintext));
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

export async function openWith(keyMaterial: Uint8Array, box: { iv: string; ct: string }): Promise<string> {
  const key = await aesKey(keyMaterial);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(box.iv) as BufferSource }, key, fromB64(box.ct) as BufferSource);
  return new TextDecoder().decode(pt);
}
