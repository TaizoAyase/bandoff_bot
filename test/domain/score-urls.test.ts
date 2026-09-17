import { describe, expect, it } from "vitest";
import {
  buildScoreUrlLinks,
  toScoreUrlInputs,
  zipScoreUrlRows,
} from "../../src/domain/score-urls";

describe("zipScoreUrlRows", () => {
  it("pairs urls and labels by position", () => {
    expect(zipScoreUrlRows(["https://a", "https://b"], ["ギター", "ベース"])).toEqual([
      { url: "https://a", label: "ギター" },
      { url: "https://b", label: "ベース" },
    ]);
  });

  it("fills missing labels with an empty string when urls are longer", () => {
    expect(zipScoreUrlRows(["https://a", "https://b"], ["ギター"])).toEqual([
      { url: "https://a", label: "ギター" },
      { url: "https://b", label: "" },
    ]);
  });

  it("fills missing urls with an empty string when labels are longer", () => {
    expect(zipScoreUrlRows(["https://a"], ["ギター", "ベース"])).toEqual([
      { url: "https://a", label: "ギター" },
      { url: "", label: "ベース" },
    ]);
  });

  it("returns an empty list for two empty lists", () => {
    expect(zipScoreUrlRows([], [])).toEqual([]);
  });
});

describe("toScoreUrlInputs", () => {
  it("turns a null label into an empty string", () => {
    expect(toScoreUrlInputs([{ url: "https://a", label: null }])).toEqual([
      { url: "https://a", label: "" },
    ]);
  });

  it("keeps a string label as it is", () => {
    expect(toScoreUrlInputs([{ url: "https://a", label: "ギター" }])).toEqual([
      { url: "https://a", label: "ギター" },
    ]);
  });

  it("returns an empty list for an empty list", () => {
    expect(toScoreUrlInputs([])).toEqual([]);
  });
});

describe("buildScoreUrlLinks", () => {
  // 名前を1つも付けていない曲は v0.4.1 とまったく同じ表示になること。
  // この後方互換を固定するためのテスト。
  it("numbers every link as 譜面N when no row has a label", () => {
    expect(
      buildScoreUrlLinks([
        { url: "https://a", label: null },
        { url: "https://b", label: null },
      ]),
    ).toEqual([
      { url: "https://a", text: "譜面1" },
      { url: "https://b", text: "譜面2" },
    ]);
  });

  it("shows only the label when every row has one", () => {
    expect(
      buildScoreUrlLinks([
        { url: "https://a", label: "ギター" },
        { url: "https://b", label: "ベース" },
      ]),
    ).toEqual([
      { url: "https://a", text: "ギター" },
      { url: "https://b", text: "ベース" },
    ]);
  });

  it("keeps the overall position so the numbering skips labeled rows", () => {
    expect(
      buildScoreUrlLinks([
        { url: "https://a", label: null },
        { url: "https://b", label: "ギター" },
        { url: "https://c", label: null },
      ]),
    ).toEqual([
      { url: "https://a", text: "譜面1" },
      { url: "https://b", text: "ギター" },
      { url: "https://c", text: "譜面3" },
    ]);
  });

  it("treats a form-side empty label the same as a db-side null label", () => {
    const fromForm = buildScoreUrlLinks([
      { url: "https://a", label: "" },
      { url: "https://b", label: "ギター" },
    ]);
    const fromDb = buildScoreUrlLinks([
      { url: "https://a", label: null },
      { url: "https://b", label: "ギター" },
    ]);
    expect(fromForm).toEqual(fromDb);
    expect(fromForm).toEqual([
      { url: "https://a", text: "譜面1" },
      { url: "https://b", text: "ギター" },
    ]);
  });

  it("returns an empty list for an empty list", () => {
    expect(buildScoreUrlLinks([])).toEqual([]);
  });

  it("passes the url through unchanged", () => {
    expect(
      buildScoreUrlLinks([{ url: "https://example.com/a?b=1&c=2", label: null }]),
    ).toEqual([{ url: "https://example.com/a?b=1&c=2", text: "譜面1" }]);
  });
});
