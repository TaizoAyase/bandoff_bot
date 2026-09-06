import { describe, expect, it } from "vitest";
import {
  isValidSlug,
  newAccessKey,
  newId,
  newSlug,
  newToken,
  normalizeAccessKey,
} from "../../src/domain/ids";

describe("newSlug", () => {
  it("returns a 26 character lowercase base32 string", () => {
    const slug = newSlug();
    expect(slug).toMatch(/^[a-z2-7]{26}$/);
  });

  it("is accepted by isValidSlug", () => {
    expect(isValidSlug(newSlug())).toBe(true);
  });

  it("generates unique values across many samples", () => {
    const slugs = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      slugs.add(newSlug());
    }
    expect(slugs.size).toBe(2000);
  });
});

describe("isValidSlug", () => {
  it("rejects wrong length", () => {
    expect(isValidSlug("a".repeat(25))).toBe(false);
    expect(isValidSlug("a".repeat(27))).toBe(false);
  });

  it("rejects invalid characters (uppercase, 0/1/8/9)", () => {
    expect(isValidSlug("A".repeat(26))).toBe(false);
    expect(isValidSlug(`${"a".repeat(25)}0`)).toBe(false);
    expect(isValidSlug(`${"a".repeat(25)}1`)).toBe(false);
    expect(isValidSlug(`${"a".repeat(25)}8`)).toBe(false);
    expect(isValidSlug(`${"a".repeat(25)}9`)).toBe(false);
  });
});

describe("newId", () => {
  it("returns a UUID v4", () => {
    const id = newId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("newToken", () => {
  it("returns a base64url string with no padding", () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain("=");
  });

  it("generates unique values", () => {
    expect(newToken()).not.toBe(newToken());
  });
});

describe("newAccessKey", () => {
  const ALLOWED =
    /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/;

  it("matches the XXXX-XXXX-XXXX format with the restricted charset", () => {
    for (let i = 0; i < 10_000; i++) {
      expect(newAccessKey()).toMatch(ALLOWED);
    }
  });

  it("never contains ambiguous characters (I, O, 0, 1)", () => {
    for (let i = 0; i < 10_000; i++) {
      const key = newAccessKey();
      expect(key).not.toMatch(/[IO01]/);
    }
  });
});

describe("normalizeAccessKey", () => {
  it("uppercases and strips hyphens and whitespace", () => {
    expect(normalizeAccessKey("k7qm-3xpt-9rvn")).toBe("K7QM3XPT9RVN");
  });

  it("strips surrounding and internal whitespace", () => {
    expect(normalizeAccessKey("  k7qm 3xpt-9rvn  ")).toBe("K7QM3XPT9RVN");
  });
});
