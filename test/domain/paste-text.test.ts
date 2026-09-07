import { describe, expect, it } from "vitest";
import { buildPasteText } from "../../src/domain/paste-text";
import { parseJstDateTimeLocal } from "../../src/domain/time";

/**
 * 貼付文面はそのまま Discord に貼られる。行の並びと本数を固定しておかないと、
 * `PasteTextBlock` の `rows` とずれて末尾が見切れる(実際に一度起きた)。
 */
describe("buildPasteText", () => {
  const startsAt = parseJstDateTimeLocal("2026-09-20T19:00");

  it("タイトル・日時・場所・URL・合言葉をこの順で5行にする", () => {
    const text = buildPasteText(
      "https://example.test",
      "abc123",
      "〇〇オフ会 vol.3",
      startsAt,
      180,
      "スタジオノア渋谷店",
      "himitsu",
    );

    expect(text.split("\n")).toEqual([
      "〇〇オフ会 vol.3",
      "2026/09/20(日) 19:00〜22:00 (3時間)",
      "スタジオノア渋谷店",
      "https://example.test/e/abc123/",
      "合言葉: himitsu",
    ]);
  });

  it("長さが未設定なら日時の行は開始時刻のみになる(行数は変わらない)", () => {
    const text = buildPasteText(
      "https://example.test",
      "abc123",
      "〇〇オフ会 vol.3",
      startsAt,
      null,
      "スタジオノア渋谷店",
      "himitsu",
    );
    const lines = text.split("\n");

    expect(lines).toHaveLength(5);
    expect(lines[1]).toBe("2026/09/20(日) 19:00");
  });
});
