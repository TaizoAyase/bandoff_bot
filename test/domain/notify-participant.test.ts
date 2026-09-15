import { describe, expect, it } from "vitest";
import {
  buildParticipantRegisteredContent,
  buildParticipantWithdrawnContent,
  type ParticipantRegisteredInput,
  type ParticipantWithdrawnInput,
} from "../../src/domain/notify-participant";

function makeInput(
  overrides: Partial<ParticipantRegisteredInput> = {},
): ParticipantRegisteredInput {
  return {
    eventTitle: "〇〇オフ会 vol.3",
    displayName: "山田",
    entry: null,
    ...overrides,
  };
}

describe("buildParticipantRegisteredContent", () => {
  it("entry が null なら「参加登録しました」だけになる(N7)", () => {
    const content = buildParticipantRegisteredContent(makeInput({ entry: null }));
    expect(content).toBe("〔〇〇オフ会 vol.3〕山田さんが参加登録しました");
  });

  it("entry があれば登録+エントリーの1通にまとまる(N8)", () => {
    const content = buildParticipantRegisteredContent(
      makeInput({
        entry: { songTitle: "テスト曲", takeOrdinal: null, slotLabel: "Gt1" },
      }),
    );
    expect(content).toBe(
      "〔〇〇オフ会 vol.3〕山田さんが参加登録し、「テスト曲」の Gt1 に入りました",
    );
  });

  it("2回目以降の Take へのエントリーなら「(n回目)」が付く", () => {
    const content = buildParticipantRegisteredContent(
      makeInput({
        entry: { songTitle: "テスト曲", takeOrdinal: 2, slotLabel: "Gt1" },
      }),
    );
    expect(content).toBe(
      "〔〇〇オフ会 vol.3〕山田さんが参加登録し、「テスト曲」(2回目)の Gt1 に入りました",
    );
  });

  it("表示名・曲名・枠ラベルの Markdown 記号がエスケープされる", () => {
    const content = buildParticipantRegisteredContent(
      makeInput({
        displayName: "`code`",
        entry: { songTitle: "**太字**", takeOrdinal: null, slotLabel: "_Gt1_" },
      }),
    );
    expect(content).toContain("\\`code\\`");
    expect(content).toContain("\\*\\*太字\\*\\*");
    expect(content).toContain("\\_Gt1\\_");
  });

  it("値に改行を仕込んでも本文は1行のままになる", () => {
    const content = buildParticipantRegisteredContent(
      makeInput({
        displayName: "山田\n〔別オフ会〕偽の通知",
        entry: { songTitle: "テスト曲", takeOrdinal: null, slotLabel: "Gt1" },
      }),
    );
    expect(content.split("\n")).toHaveLength(1);
  });
});

// 2026-09-15 追加分: 参加の取りやめ(N9)。主催者による削除は通知しない
// (呼び出し側で分岐するため、この関数自体のテストは自己取りやめのみ)。
function makeWithdrawnInput(
  overrides: Partial<ParticipantWithdrawnInput> = {},
): ParticipantWithdrawnInput {
  return {
    eventTitle: "〇〇オフ会 vol.3",
    displayName: "山田",
    entries: [],
    ...overrides,
  };
}

describe("buildParticipantWithdrawnContent", () => {
  it("entries が空なら「参加を取りやめました」だけになる", () => {
    const content = buildParticipantWithdrawnContent(makeWithdrawnInput());
    expect(content).toBe("〔〇〇オフ会 vol.3〕山田さんが参加を取りやめました");
  });

  it("entries があれば箇条書きでまとめる", () => {
    const content = buildParticipantWithdrawnContent(
      makeWithdrawnInput({
        entries: [
          { songTitle: "曲A", takeOrdinal: null, slotLabel: "Gt1" },
          { songTitle: "曲B", takeOrdinal: null, slotLabel: "Ba" },
        ],
      }),
    );
    expect(content).toBe(
      [
        "〔〇〇オフ会 vol.3〕山田さんが参加を取りやめ、以下のエントリーを辞退しました",
        "- 「曲A」の Gt1",
        "- 「曲B」の Ba",
      ].join("\n"),
    );
  });

  it("2回目以降の Take のエントリーなら「(n回目)」が付く", () => {
    const content = buildParticipantWithdrawnContent(
      makeWithdrawnInput({
        entries: [{ songTitle: "曲A", takeOrdinal: 2, slotLabel: "Gt1" }],
      }),
    );
    expect(content).toContain("「曲A」(2回目)の Gt1");
  });

  it("表示名・曲名・枠ラベルの Markdown 記号がエスケープされる", () => {
    const content = buildParticipantWithdrawnContent(
      makeWithdrawnInput({
        displayName: "`code`",
        entries: [{ songTitle: "**太字**", takeOrdinal: null, slotLabel: "_Ba_" }],
      }),
    );
    expect(content).toContain("\\`code\\`");
    expect(content).toContain("\\*\\*太字\\*\\*");
    expect(content).toContain("\\_Ba\\_");
  });

  it("値に改行を仕込んでも1エントリーにつき1行のままになる", () => {
    // 制御文字はソース中に直接書かず String.fromCharCode で組み立てる
    // (改行を含むリテラルをファイルに直書きしないための取り決め)。
    const newline = String.fromCharCode(10);
    const content = buildParticipantWithdrawnContent(
      makeWithdrawnInput({
        displayName: `山田${newline}〔別オフ会〕偽の通知`,
        entries: [
          { songTitle: `曲A${newline}injected`, takeOrdinal: null, slotLabel: "Gt1" },
        ],
      }),
    );
    // ヘッダー行 + entries 1件 = 2行。displayName・songTitle 由来の改行は
    // escapeMarkdown で除去されているはず。
    expect(content.split(newline)).toHaveLength(2);
  });
});
