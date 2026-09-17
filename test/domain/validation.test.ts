import { describe, expect, it } from "vitest";
import { STARTS_TIME_OPTIONS } from "../../src/domain/starts-time";
import {
  LIMITS,
  normalizeJoinCode,
  validateArtist,
  validateDisplayName,
  validateDurationMinutes,
  validateEventEditForm,
  validateEventTitle,
  validateJoinCode,
  validateNewEventForm,
  validateNotes,
  validateParticipantForm,
  validatePlace,
  validateRefUrl,
  validateRegion,
  validateScoreUrls,
  validateSlotForm,
  validateSlotNote,
  validateSongForm,
  validateSongKey,
  validateSongSlots,
  validateSongTitle,
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

  it("strips newlines instead of rejecting (single-line field)", () => {
    // <input type="text"> はキー入力での改行を防ぐが、生の HTTP POST では
    // 改行を送信できてしまう。単一行フィールドはエラーにせず除去して継続する。
    const result = validateDisplayName("山田\n太郎");
    expect(result).toEqual({ ok: true, value: "山田 太郎" });
  });

  it("strips other C0 control characters (not just newlines)", () => {
    const result = validateDisplayName("山田\x1F太郎\x7F");
    expect(result).toEqual({ ok: true, value: "山田 太郎" });
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

describe("control character stripping (single-line fields)", () => {
  // <input type="text"> に対応する単一行フィールドは、改行を含む C0 制御
  // 文字をエラーにせず半角スペースへ除去して継続する
  // (src/domain/validation.ts の CONTROL_CHAR_PATTERN 参照)。

  it("validateEventTitle strips control characters", () => {
    expect(validateEventTitle("テスト\rオフ会")).toEqual({
      ok: true,
      value: "テスト オフ会",
    });
  });

  it("validateRegion strips control characters", () => {
    expect(validateRegion("東京\n都")).toEqual({ ok: true, value: "東京 都" });
  });

  it("validatePlace strips control characters", () => {
    expect(validatePlace("スタジオ\nA")).toEqual({ ok: true, value: "スタジオ A" });
  });

  it("validateSongTitle strips control characters", () => {
    expect(validateSongTitle("偽の曲\n〔別オフ会〕")).toEqual({
      ok: true,
      value: "偽の曲 〔別オフ会〕",
    });
  });

  it("validateArtist strips control characters", () => {
    expect(validateArtist("アーティスト\n名")).toEqual({
      ok: true,
      value: "アーティスト 名",
    });
  });

  it("validateSongKey strips control characters", () => {
    expect(validateSongKey("C\nm")).toEqual({ ok: true, value: "C m" });
  });

  it("validateSlotNote strips control characters", () => {
    expect(validateSlotNote("メモ\n改行")).toEqual({ ok: true, value: "メモ 改行" });
  });

  it("validateNotes keeps newlines (textarea-backed multi-line field)", () => {
    // notes は複数行が正当な内容(イベント詳細・曲の備考など)のフィールド
    // なので、他の単一行フィールドと違って改行を保持しなければならない
    // (将来ここが一律で潰されるのを防ぐ回帰テスト)。
    const value = "1行目\n2行目\r\n3行目";
    expect(validateNotes(value)).toEqual({ ok: true, value });
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
    discordEnabled: true,
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
      discordEnabled: false,
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

  it("passes discordEnabled through unchanged (true and false)", () => {
    const enabled = validateNewEventForm({ ...validInput, discordEnabled: true });
    expect(enabled.ok && enabled.value.discordEnabled).toBe(true);
    const disabled = validateNewEventForm({ ...validInput, discordEnabled: false });
    expect(disabled.ok && disabled.value.discordEnabled).toBe(false);
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

  it("strips control characters from the instrument field", () => {
    const result = validateSlotForm({ instrument: "Gt\n1", note: "" });
    expect(result).toEqual({ ok: true, value: { instrument: "Gt 1", note: "" } });
  });
});

describe("validateSongSlots", () => {
  it("accepts a valid list of instruments", () => {
    expect(validateSongSlots(["Gt", "Ba"])).toEqual({ ok: true, value: ["Gt", "Ba"] });
  });

  it("strips control characters from each instrument", () => {
    const result = validateSongSlots(["Gt\n1", "Ba\x7F"]);
    expect(result).toEqual({ ok: true, value: ["Gt 1", "Ba"] });
  });

  it("ignores blank rows", () => {
    expect(validateSongSlots(["Gt", "", "  "])).toEqual({ ok: true, value: ["Gt"] });
  });

  it("rejects when there are no non-blank rows", () => {
    expect(validateSongSlots(["", "  "]).ok).toBe(false);
  });
});

describe("validateScoreUrls", () => {
  it("accepts an empty list (optional field)", () => {
    expect(validateScoreUrls([])).toEqual({ ok: true, value: [] });
  });

  it("ignores blank and whitespace-only rows", () => {
    expect(
      validateScoreUrls([
        { url: "https://example.com/a", label: "" },
        { url: "", label: "" },
        { url: "  ", label: "  " },
      ]),
    ).toEqual({
      ok: true,
      value: [{ url: "https://example.com/a", label: "" }],
    });
  });

  it("accepts http and https URLs and preserves input order", () => {
    const result = validateScoreUrls([
      { url: "https://example.com/b", label: "" },
      { url: "http://example.com/a", label: "" },
    ]);
    expect(result).toEqual({
      ok: true,
      value: [
        { url: "https://example.com/b", label: "" },
        { url: "http://example.com/a", label: "" },
      ],
    });
  });

  it("rejects non-http(s) protocols", () => {
    const result = validateScoreUrls([{ url: "javascript:alert(1)", label: "" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.scoreUrls).toBe(
        "譜面URLはhttpまたはhttpsのURLを入力してください",
      );
    }
    expect(validateScoreUrls([{ url: "ftp://example.com", label: "" }]).ok).toBe(false);
  });

  it("rejects malformed URLs", () => {
    const result = validateScoreUrls([{ url: "not a url", label: "" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.scoreUrls).toBe("譜面URLの形式が正しくありません");
    }
  });

  it("rejects URLs over the 500 character limit", () => {
    const longUrl = `https://example.com/${"a".repeat(500)}`;
    const result = validateScoreUrls([{ url: longUrl, label: "" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.scoreUrls).toBe("譜面URLは500文字以内で入力してください");
    }
  });

  it("rejects when there are more than 10 non-blank URLs", () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({
      url: `https://example.com/${i}`,
      label: "",
    }));
    const result = validateScoreUrls(rows);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.scoreUrls).toBe("譜面URLは10件までです");
    }
  });

  it("accepts exactly 10 non-blank URLs", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      url: `https://example.com/${i}`,
      label: "",
    }));
    expect(validateScoreUrls(rows).ok).toBe(true);
  });

  it("collapses rows whose url and label both match, keeping the first", () => {
    const result = validateScoreUrls([
      { url: "https://example.com/a", label: "ギター" },
      { url: "https://example.com/b", label: "" },
      { url: "https://example.com/a", label: "ギター" },
    ]);
    expect(result).toEqual({
      ok: true,
      value: [
        { url: "https://example.com/a", label: "ギター" },
        { url: "https://example.com/b", label: "" },
      ],
    });
  });

  it("keeps both rows when the same URL is given two different labels", () => {
    const result = validateScoreUrls([
      { url: "https://example.com/a", label: "ギター" },
      { url: "https://example.com/a", label: "ベース" },
    ]);
    expect(result).toEqual({
      ok: true,
      value: [
        { url: "https://example.com/a", label: "ギター" },
        { url: "https://example.com/a", label: "ベース" },
      ],
    });
  });

  it("counts the limit after deduplication (11 rows with 1 duplicate pair is 10)", () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => ({
        url: `https://example.com/${i}`,
        label: "",
      })),
      { url: "https://example.com/0", label: "" },
    ];
    expect(rows.length).toBe(11);
    const result = validateScoreUrls(rows);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(10);
    }
  });

  it("counts the limit after deduplication (11 identical rows collapse to 1)", () => {
    const rows = Array.from({ length: 11 }, () => ({
      url: "https://example.com/a",
      label: "ギター",
    }));
    const result = validateScoreUrls(rows);
    expect(result).toEqual({
      ok: true,
      value: [{ url: "https://example.com/a", label: "ギター" }],
    });
  });

  it("trims the label", () => {
    expect(
      validateScoreUrls([{ url: "https://example.com/a", label: "  ギター  " }]),
    ).toEqual({
      ok: true,
      value: [{ url: "https://example.com/a", label: "ギター" }],
    });
  });

  it("replaces control characters in the label with spaces", () => {
    expect(
      validateScoreUrls([{ url: "https://example.com/a", label: "ギター\n1" }]),
    ).toEqual({
      ok: true,
      value: [{ url: "https://example.com/a", label: "ギター 1" }],
    });
  });

  it("accepts a label of exactly 20 characters", () => {
    const label = "あ".repeat(20);
    expect(validateScoreUrls([{ url: "https://example.com/a", label }])).toEqual({
      ok: true,
      value: [{ url: "https://example.com/a", label }],
    });
  });

  it("rejects a label of 21 characters", () => {
    const result = validateScoreUrls([
      { url: "https://example.com/a", label: "あ".repeat(21) },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.scoreUrls).toBe("譜面の名前は20文字以内で入力してください");
    }
  });

  it("rejects a row that has a label but no URL", () => {
    const result = validateScoreUrls([
      { url: "https://example.com/a", label: "" },
      { url: "  ", label: "ギター" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.scoreUrls).toBe(
        "名前を入力した行には譜面URLも入力してください",
      );
    }
  });

  it("drops a row where both the URL and the label are blank without an error", () => {
    expect(
      validateScoreUrls([
        { url: "", label: "" },
        { url: "https://example.com/a", label: "ギター" },
        { url: "  ", label: "\t" },
      ]),
    ).toEqual({
      ok: true,
      value: [{ url: "https://example.com/a", label: "ギター" }],
    });
  });

  it("trims the URL but does not strip control characters from it", () => {
    const url = `https://example.com/a${String.fromCharCode(1)}b`;
    expect(validateScoreUrls([{ url: `  ${url}  `, label: "" }])).toEqual({
      ok: true,
      value: [{ url, label: "" }],
    });
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
    discordEnabled: true,
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

  it("passes discordEnabled through unchanged (true and false)", () => {
    const enabled = validateEventEditForm({ ...validInput, discordEnabled: true });
    expect(enabled.ok && enabled.value.discordEnabled).toBe(true);
    const disabled = validateEventEditForm({ ...validInput, discordEnabled: false });
    expect(disabled.ok && disabled.value.discordEnabled).toBe(false);
  });
});

describe("LIMITS", () => {
  it("matches the counts defined in the plan", () => {
    expect(LIMITS.MAX_TAKES_PER_SONG).toBe(5);
    expect(LIMITS.MAX_SLOTS_PER_TAKE).toBe(20);
    expect(LIMITS.MAX_SONGS_PER_EVENT).toBe(200);
  });
});
