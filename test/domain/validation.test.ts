import { describe, expect, it } from "vitest";
import { STARTS_TIME_OPTIONS } from "../../src/domain/starts-time";
import {
  LIMITS,
  normalizeJoinCode,
  validateDisplayName,
  validateDurationMinutes,
  validateEventEditForm,
  validateJoinCode,
  validateNewEventForm,
  validateParticipantForm,
  validateRefUrl,
  validateSlotForm,
  validateSongForm,
  validateStartsDate,
  validateStartsTime,
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

describe("validateStartsDate", () => {
  it("accepts a well-formed, real date", () => {
    expect(validateStartsDate("2026-09-05")).toEqual({
      ok: true,
      value: "2026-09-05",
    });
  });

  it("rejects an empty value", () => {
    const result = validateStartsDate("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("開催日を入力してください");
    }
  });

  it("rejects a malformed value", () => {
    expect(validateStartsDate("abc").ok).toBe(false);
  });

  it("rejects a date that rolls over via Date.UTC (Feb 30 -> Mar 2)", () => {
    // Date.UTC(2026, 1, 30) は 2026-03-02 にロールオーバーするため、
    // 見た目だけ形式が合っていても実在しない日付として拒否する必要がある。
    expect(validateStartsDate("2026-02-30").ok).toBe(false);
  });

  it("rejects a month out of range (13)", () => {
    expect(validateStartsDate("2026-13-01").ok).toBe(false);
  });
});

describe("validateStartsTime", () => {
  it("accepts every value in the 15 minute allow list", () => {
    for (const time of STARTS_TIME_OPTIONS) {
      expect(validateStartsTime(time)).toEqual({ ok: true, value: time });
    }
  });

  it("has exactly 96 options (00:00-23:45 in 15 minute steps)", () => {
    expect(STARTS_TIME_OPTIONS).toHaveLength(96);
  });

  it("rejects a value not on the 15 minute allow list (tampered select value)", () => {
    const result = validateStartsTime("19:07");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("開始時刻を15分刻みで選び直してください");
    }
  });

  it("rejects a non-time value", () => {
    expect(validateStartsTime("abc").ok).toBe(false);
  });

  it("rejects an empty value", () => {
    const result = validateStartsTime("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("開始時刻を選んでください");
    }
  });
});

describe("validateDurationMinutes", () => {
  it("treats an empty string as unset (null)", () => {
    expect(validateDurationMinutes("")).toEqual({ ok: true, value: null });
  });

  it("accepts a value from the allow list", () => {
    expect(validateDurationMinutes("180")).toEqual({ ok: true, value: 180 });
  });

  it("rejects a value outside the allow list (tampered select value)", () => {
    expect(validateDurationMinutes("100").ok).toBe(false);
  });

  it("rejects a non-numeric value", () => {
    expect(validateDurationMinutes("abc").ok).toBe(false);
  });
});

describe("validateNewEventForm", () => {
  const validInput = {
    title: "テストオフ会",
    region: "東京",
    startsDate: "2026-09-05",
    startsTime: "19:00",
    durationMinutes: "180",
    place: "スタジオA",
    notes: "",
    joinCode: "himitsu",
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
      startsDate: "",
      startsTime: "",
      durationMinutes: "",
      place: "",
      notes: "",
      joinCode: "",
      organizerDisplayName: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(
        [
          "title",
          "region",
          "startsDate",
          "startsTime",
          "place",
          "joinCode",
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

describe("validateEventEditForm", () => {
  const validInput = {
    title: "テストオフ会",
    region: "東京",
    startsDate: "2026-09-05",
    startsTime: "19:00",
    durationMinutes: "180",
    place: "スタジオA",
    notes: "",
    status: "upcoming",
  };

  it("accepts a fully valid form", () => {
    const result = validateEventEditForm(validInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("upcoming");
    }
  });

  it("accepts status=closed", () => {
    const result = validateEventEditForm({ ...validInput, status: "closed" });
    expect(result.ok).toBe(true);
  });

  it("rejects an invalid status value", () => {
    const result = validateEventEditForm({ ...validInput, status: "bogus" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.status).toBeDefined();
    }
  });
});

describe("LIMITS", () => {
  it("matches the counts defined in the plan", () => {
    expect(LIMITS.MAX_TAKES_PER_SONG).toBe(5);
    expect(LIMITS.MAX_SLOTS_PER_TAKE).toBe(20);
    expect(LIMITS.MAX_SONGS_PER_EVENT).toBe(200);
  });
});
