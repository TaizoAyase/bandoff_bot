import { describe, expect, it } from "vitest";
import {
  buildParticipantRegisteredContent,
  type ParticipantRegisteredInput,
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
