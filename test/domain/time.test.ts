import { describe, expect, it } from "vitest";
import {
  formatJst,
  isPast24h,
  parseJstDateTimeLocal,
  toJstDateTimeLocal,
} from "../../src/domain/time";

describe("parseJstDateTimeLocal", () => {
  it("converts a JST datetime-local value to a UTC epoch second", () => {
    // 2026-09-05T19:00 JST = 2026-09-05T10:00 UTC
    const epoch = parseJstDateTimeLocal("2026-09-05T19:00");
    expect(epoch).toBe(Date.UTC(2026, 8, 5, 10, 0, 0) / 1000);
  });

  it("throws on malformed input", () => {
    expect(() => parseJstDateTimeLocal("not-a-date")).toThrow();
  });
});

describe("formatJst", () => {
  it("formats an epoch second as YYYY/MM/DD(曜) HH:mm in JST", () => {
    const epoch = parseJstDateTimeLocal("2026-09-05T19:00");
    // 2026-09-05 is a Saturday.
    expect(formatJst(epoch)).toBe("2026/09/05(土) 19:00");
  });

  it("round-trips with parseJstDateTimeLocal", () => {
    const original = "2026-01-01T00:30";
    const epoch = parseJstDateTimeLocal(original);
    expect(formatJst(epoch)).toBe("2026/01/01(木) 00:30");
  });
});

describe("toJstDateTimeLocal", () => {
  it("round-trips with parseJstDateTimeLocal", () => {
    const original = "2026-12-31T23:45";
    const epoch = parseJstDateTimeLocal(original);
    expect(toJstDateTimeLocal(epoch)).toBe(original);
  });
});

describe("isPast24h", () => {
  const startsAt = 1_000_000;

  it("is not past when now equals startsAt", () => {
    expect(isPast24h(startsAt, startsAt)).toBe(false);
  });

  it("is not past exactly at the 86400 second boundary", () => {
    expect(isPast24h(startsAt, startsAt + 86_400)).toBe(false);
  });

  it("is past just after the 86400 second boundary", () => {
    expect(isPast24h(startsAt, startsAt + 86_401)).toBe(true);
  });
});
