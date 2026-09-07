import { describe, expect, it } from "vitest";
import {
  formatDurationMinutes,
  formatEventPeriod,
  formatJst,
  isPast24h,
  parseJstDateTimeLocal,
  toJstDateString,
  toJstTimeString,
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

describe("toJstDateString / toJstTimeString", () => {
  it("round-trip with parseJstDateTimeLocal", () => {
    const epoch = parseJstDateTimeLocal("2026-12-31T23:45");
    expect(toJstDateString(epoch)).toBe("2026-12-31");
    expect(toJstTimeString(epoch)).toBe("23:45");
  });
});

describe("formatDurationMinutes", () => {
  it("formats whole hours", () => {
    expect(formatDurationMinutes(180)).toBe("3時間");
  });

  it("formats hours with a remainder", () => {
    expect(formatDurationMinutes(90)).toBe("1時間30分");
  });

  it("formats minutes under an hour", () => {
    expect(formatDurationMinutes(30)).toBe("30分");
  });

  it("formats the maximum option (8 hours)", () => {
    expect(formatDurationMinutes(480)).toBe("8時間");
  });
});

describe("formatEventPeriod", () => {
  it("returns just formatJst when durationMinutes is null", () => {
    const startsAt = parseJstDateTimeLocal("2026-09-20T19:00");
    expect(formatEventPeriod(startsAt, null)).toBe(formatJst(startsAt));
  });

  it("formats a normal same-day period", () => {
    const startsAt = parseJstDateTimeLocal("2026-09-20T19:00");
    expect(formatEventPeriod(startsAt, 180)).toBe(
      "2026/09/20(日) 19:00〜22:00 (3時間)",
    );
  });

  it("marks the end time with 翌 when it crosses midnight", () => {
    const startsAt = parseJstDateTimeLocal("2026-09-20T22:00");
    expect(formatEventPeriod(startsAt, 240)).toBe(
      "2026/09/20(日) 22:00〜翌 02:00 (4時間)",
    );
  });

  it("does not throw for an extreme duration spanning multiple days", () => {
    const startsAt = parseJstDateTimeLocal("2026-09-20T22:00");
    expect(() => formatEventPeriod(startsAt, 60 * 50)).not.toThrow();
    expect(formatEventPeriod(startsAt, 60 * 50)).toContain("翌");
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
