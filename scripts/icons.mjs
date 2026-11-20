// Rasterize the lock icon to PNGs (no deps). Coordinates match public/icon.svg (64x64 grid).
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const BG = [15, 17, 21], FG = [232, 176, 75];
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };

function inRRect(x, y, x0, y0, w, h, r) {
  if (x < x0 || y < y0 || x > x0 + w || y > y0 + h) return false;
  const cx = Math.min(Math.max(x, x0 + r), x0 + w - r), cy = Math.min(Math.max(y, y0 + r), y0 + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function color(x, y, full) {
  // full-bleed background for iOS (it applies its own rounding)
  if (!full && !inRRect(x, y, 0, 0, 64, 64, 14)) return null;
  const d = Math.hypot(x - 32, y - 22);
  const shackle = (y <= 22 && Math.abs(d - 10) <= 2.5) || ((Math.abs(x - 22) <= 2.5 || Math.abs(x - 42) <= 2.5) && y >= 22 && y <= 30);
  if (inRRect(x, y, 16, 28, 32, 24, 5)) {
    const hole = Math.hypot(x - 32, y - 39) <= 3.5 || inRRect(x, y, 30.5, 40, 3, 7, 1.5);
    return hole ? BG : FG;
  }
  return shackle ? FG : BG;
}
function png(size, full, file) {
  const ss = 3, rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const c = color(((px + (sx + 0.5) / ss) / size) * 64, ((py + (sy + 0.5) / ss) / size) * 64, full);
        if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
      }
      const n = ss * ss, o = 1 + px * 4;
      if (a) { row[o] = r / a; row[o + 1] = g / a; row[o + 2] = b / a; }
      row[o + 3] = (a / n) * 255;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]));
}
png(180, true, "public/apple-touch-icon.png");
png(192, false, "public/icon-192.png");
png(512, false, "public/icon-512.png");
console.log("icons written");
