import { describe, it, expect } from "vitest";
import { generatePassword, sealWith, openWith, randomBytes } from "../src/crypto";

describe("crypto", () => {
  it("generates strong passwords with all character classes", () => {
    for (let i = 0; i < 50; i++) {
      const p = generatePassword();
      expect(p).toHaveLength(28);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[0-9]/);
      expect(p).toMatch(/[^a-zA-Z0-9]/);
    }
  });

  it("AES-GCM round-trips and rejects the wrong key", async () => {
    const k = randomBytes(32);
    const box = await sealWith(k, "hunter2");
    expect(await openWith(k, box)).toBe("hunter2");
    await expect(openWith(randomBytes(32), box)).rejects.toThrow();
  });
});
