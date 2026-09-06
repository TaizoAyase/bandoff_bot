import { describe, expect, it } from "vitest";
import { sha256Hex, timingSafeEqual } from "../../src/domain/crypto";

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
