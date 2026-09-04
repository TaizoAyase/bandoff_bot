import { describe, expect, it } from "vitest";
import {
  hashPassword,
  sha256Hex,
  timingSafeEqual,
  verifyPassword,
} from "../../src/domain/crypto";

describe("hashPassword / verifyPassword", () => {
  it("round-trips a correct password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", stored)).resolves.toBe(
      true,
    );
  });

  it("rejects an incorrect password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("wrong password", stored)).resolves.toBe(false);
  });

  it("stores the value in the pbkdf2-sha256$<iter>$<salt>$<hash> format", async () => {
    const stored = await hashPassword("hunter2");
    const parts = stored.split("$");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("pbkdf2-sha256");
    expect(parts[1]).toBe("20000");
    expect(parts[2]?.length).toBeGreaterThan(0);
    expect(parts[3]?.length).toBeGreaterThan(0);
  });

  it("produces different salts for the same password", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
  });

  it("rejects malformed stored values", async () => {
    await expect(verifyPassword("anything", "not-a-valid-hash")).resolves.toBe(false);
  });

  it("verifies using the iteration count recorded in the stored value", async () => {
    // 保存値に記録された反復回数と異なる回数を指定しても、
    // 保存値側の回数が使われるため検証が通ることを確認する。
    const stored = await hashPassword("hunter2");
    const [, , salt, hash] = stored.split("$");
    const oldIterationStored = `pbkdf2-sha256$1000$${salt}$${hash}`;
    // 反復回数を書き換えると、その回数で再計算されて一致しなくなるはず。
    await expect(verifyPassword("hunter2", oldIterationStored)).resolves.toBe(false);
  });
});

describe("sha256Hex", () => {
  it("returns the known SHA-256 hex digest for an empty string", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("is deterministic", async () => {
    expect(await sha256Hex("bandoff")).toBe(await sha256Hex("bandoff"));
  });
});

describe("timingSafeEqual", () => {
  it("returns true for equal strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
  });

  it("returns false for different strings of the same length", () => {
    expect(timingSafeEqual("abc", "abd")).toBe(false);
  });

  it("returns false for different lengths", () => {
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});
