import { describe, expect, it } from "vitest";
import {
  buildSlotAddedContent,
  type SlotAddedInput,
} from "../../src/domain/notify-slot";

function makeInput(overrides: Partial<SlotAddedInput> = {}): SlotAddedInput {
  return {
    eventTitle: "〇〇オフ会 vol.3",
    actorDisplayName: "山田",
    songTitle: "テスト曲",
    takeOrdinal: null,
    slotLabel: "Gt2",
    note: "",
    ...overrides,
  };
}

describe("buildSlotAddedContent", () => {
  it("Take が1件だけのときは回数を出さない(N6)", () => {
    const content = buildSlotAddedContent(makeInput({ takeOrdinal: null }));
    expect(content).toBe(
      "〔〇〇オフ会 vol.3〕山田さんが「テスト曲」に Gt2 の枠を追加しました",
    );
  });

  it("Take が2件以上のときは「(n回目)」が付く", () => {
    const content = buildSlotAddedContent(makeInput({ takeOrdinal: 2 }));
    expect(content).toBe(
      "〔〇〇オフ会 vol.3〕山田さんが「テスト曲」(2回目)に Gt2 の枠を追加しました",
    );
  });

  it("メモが空ならメモ行を出さない", () => {
    const content = buildSlotAddedContent(makeInput({ note: "" }));
    expect(content.split("\n")).toHaveLength(1);
    expect(content).not.toContain("メモ");
  });

  it("メモがあればメモ行を出す", () => {
    const content = buildSlotAddedContent(makeInput({ note: "5弦ベースで" }));
    expect(content).toBe(
      [
        "〔〇〇オフ会 vol.3〕山田さんが「テスト曲」に Gt2 の枠を追加しました",
        "- メモ: 5弦ベースで",
      ].join("\n"),
    );
  });

  it("actorDisplayName が null なら「主催者が」になる", () => {
    const content = buildSlotAddedContent(makeInput({ actorDisplayName: null }));
    expect(content).toContain("主催者が「テスト曲」に Gt2 の枠を追加しました");
  });

  it("曲名・枠ラベル・メモの Markdown 記号がエスケープされる", () => {
    const content = buildSlotAddedContent(
      makeInput({
        songTitle: "**太字**",
        slotLabel: "_Gt2_",
        note: "`code`",
      }),
    );
    expect(content).toContain("\\*\\*太字\\*\\*");
    expect(content).toContain("\\_Gt2\\_");
    expect(content).toContain("\\`code\\`");
  });

  it("値に改行を仕込んでも本文の行数は増えない", () => {
    const content = buildSlotAddedContent(
      makeInput({
        songTitle: "テスト曲\n〔別オフ会〕偽の通知",
        note: "メモ\n偽の行",
      }),
    );
    expect(content.split("\n")).toHaveLength(2);
  });
});
