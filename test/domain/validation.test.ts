import { describe, expect, it } from "vitest";
import {
  LIMITS,
  normalizeJoinCode,
  validateDisplayName,
  validateJoinCode,
  validateNewEventForm,
  validateOrganizerPassword,
  validateParticipantForm,
  validateRefUrl,
  validateSlotForm,
  validateSongForm,
} from "../../src/domain/validation";

describe("validateDisplayName", () => {
  it("accepts a normal name", () => {
    const result = validateDisplayName("山田");
    expect(result).toEqual({ ok: true, value: "山田" });
  });

  it("rejects an empty name", () => {
    const result = validateDisplayName("   ");
    expect(result.ok).toBe(false);
  });

  it("rejects a name over the 30 character limit", () => {
    const result = validateDisplayName("a".repeat(31));
    expect(result.ok).toBe(false);
  });

  it("accepts a name at exactly the 30 character limit", () => {
    const result = validateDisplayName("a".repeat(30));
    expect(result.ok).toBe(true);
  });
});

describe("validateRefUrl", () => {
  it("accepts an empty value", () => {
    expect(validateRefUrl("")).toEqual({ ok: true, value: "" });
  });

  it("accepts http and https URLs", () => {
    expect(validateRefUrl("https://example.com/song").ok).toBe(true);
    expect(validateRefUrl("http://example.com/song").ok).toBe(true);
  });

  it("rejects non-http(s) protocols", () => {
    expect(validateRefUrl("javascript:alert(1)").ok).toBe(false);
    expect(validateRefUrl("ftp://example.com").ok).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(validateRefUrl("not a url").ok).toBe(false);
  });

  it("rejects URLs over the 500 character limit", () => {
    const longUrl = `https://example.com/${"a".repeat(500)}`;
    expect(validateRefUrl(longUrl).ok).toBe(false);
  });
});

describe("normalizeJoinCode / validateJoinCode", () => {
  it("applies NFKC normalization and trims surrounding whitespace", () => {
    // U+FF21 (fullwidth 'A') NFKC-normalizes to 'A'.
    expect(normalizeJoinCode("  ＡＢ  ")).toBe("AB");
  });

  it("preserves case", () => {
    expect(normalizeJoinCode("AbC")).toBe("AbC");
  });

  it("rejects an empty join code", () => {
    expect(validateJoinCode("   ").ok).toBe(false);
  });

  it("rejects a join code over 32 characters", () => {
    expect(validateJoinCode("a".repeat(33)).ok).toBe(false);
  });

  it("accepts a join code within 1-32 characters", () => {
    expect(validateJoinCode("himitsu").ok).toBe(true);
  });
});

describe("validateOrganizerPassword", () => {
  it("rejects passwords shorter than 4 characters", () => {
    expect(validateOrganizerPassword("abc").ok).toBe(false);
  });

  it("rejects passwords longer than 64 characters", () => {
    expect(validateOrganizerPassword("a".repeat(65)).ok).toBe(false);
  });

  it("accepts passwords within 4-64 characters", () => {
    expect(validateOrganizerPassword("abcd").ok).toBe(true);
    expect(validateOrganizerPassword("a".repeat(64)).ok).toBe(true);
  });
});

describe("validateNewEventForm", () => {
  const validInput = {
    title: "テストオフ会",
    region: "東京",
    startsAt: "2026-09-05T19:00",
    place: "スタジオA",
    notes: "",
    joinCode: "himitsu",
    organizerPassword: "hunter2",
    organizerDisplayName: "主催者",
  };

  it("accepts a fully valid form", () => {
    const result = validateNewEventForm(validInput);
    expect(result.ok).toBe(true);
  });

  it("collects errors for every invalid field", () => {
    const result = validateNewEventForm({
      title: "",
      region: "",
      startsAt: "",
      place: "",
      notes: "",
      joinCode: "",
      organizerPassword: "",
      organizerDisplayName: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(
        [
          "title",
          "region",
          "startsAt",
          "place",
          "joinCode",
          "organizerPassword",
          "organizerDisplayName",
        ].sort(),
      );
    }
  });
});

describe("validateSongForm", () => {
  it("accepts a minimal valid song", () => {
    const result = validateSongForm({
      title: "曲名",
      artist: "",
      refUrl: "",
      songKey: "",
      notes: "",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a missing title", () => {
    const result = validateSongForm({
      title: "",
      artist: "",
      refUrl: "",
      songKey: "",
      notes: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.title).toBeDefined();
    }
  });
});

describe("validateParticipantForm", () => {
  it("accepts a valid display name", () => {
    expect(validateParticipantForm({ displayName: "山田" }).ok).toBe(true);
  });

  it("rejects an empty display name", () => {
    expect(validateParticipantForm({ displayName: "" }).ok).toBe(false);
  });
});

describe("validateSlotForm", () => {
  it("accepts a preset instrument with no note", () => {
    expect(validateSlotForm({ instrument: "Gt", note: "" }).ok).toBe(true);
  });

  it("rejects an empty instrument", () => {
    expect(validateSlotForm({ instrument: "", note: "" }).ok).toBe(false);
  });

  it("rejects a note over the 50 character limit", () => {
    const result = validateSlotForm({ instrument: "Gt", note: "a".repeat(51) });
    expect(result.ok).toBe(false);
  });
});

describe("LIMITS", () => {
  it("matches the counts defined in the plan", () => {
    expect(LIMITS.MAX_TAKES_PER_SONG).toBe(5);
    expect(LIMITS.MAX_SLOTS_PER_TAKE).toBe(20);
    expect(LIMITS.MAX_SONGS_PER_EVENT).toBe(200);
  });
});
