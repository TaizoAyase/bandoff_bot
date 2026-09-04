import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLOTS,
  normalizeInstruments,
  numberInstruments,
  PRESET_INSTRUMENTS,
  parseInstrumentsInput,
} from "../../src/domain/instruments";

describe("PRESET_INSTRUMENTS / DEFAULT_SLOTS", () => {
  it("has the defined preset instruments", () => {
    expect(PRESET_INSTRUMENTS).toEqual(["Gt", "Ba", "Dr", "Vo", "Key", "Cho"]);
  });

  it("has the default initial slot composition", () => {
    expect(DEFAULT_SLOTS).toEqual(["Gt", "Gt", "Ba", "Dr", "Vo"]);
  });
});

describe("numberInstruments", () => {
  it("numbers duplicated instruments in order and leaves singles unnumbered", () => {
    expect(numberInstruments(["Gt", "Gt", "Ba", "Dr", "Vo"])).toEqual([
      "Gt1",
      "Gt2",
      "Ba",
      "Dr",
      "Vo",
    ]);
  });

  it("only matches on exact string equality", () => {
    expect(numberInstruments(["Gt", "ギター"])).toEqual(["Gt", "ギター"]);
  });

  it("handles three or more duplicates", () => {
    expect(numberInstruments(["Vo", "Vo", "Vo"])).toEqual(["Vo1", "Vo2", "Vo3"]);
  });

  it("handles an empty list", () => {
    expect(numberInstruments([])).toEqual([]);
  });
});

describe("normalizeInstruments", () => {
  it("trims whitespace", () => {
    expect(normalizeInstruments(["  Gt  ", "Ba "])).toEqual(["Gt", "Ba"]);
  });

  it("removes empty entries", () => {
    expect(normalizeInstruments(["Gt", "", "   ", "Ba"])).toEqual(["Gt", "Ba"]);
  });

  it("removes exact duplicates while preserving order", () => {
    expect(normalizeInstruments(["Gt", "Ba", "Gt"])).toEqual(["Gt", "Ba"]);
  });

  it("truncates each entry to 20 characters", () => {
    const long = "a".repeat(30);
    expect(normalizeInstruments([long])).toEqual(["a".repeat(20)]);
  });
});

describe("parseInstrumentsInput", () => {
  it("splits a comma-separated string", () => {
    expect(parseInstrumentsInput("Gt, Ba")).toEqual(["Gt", "Ba"]);
  });

  it("trims surrounding whitespace around each item", () => {
    expect(parseInstrumentsInput("  Gt , Ba  ,Dr")).toEqual(["Gt", "Ba", "Dr"]);
  });

  it("drops empty entries", () => {
    expect(parseInstrumentsInput("Gt,,Ba,")).toEqual(["Gt", "Ba"]);
  });

  it("removes exact duplicates", () => {
    expect(parseInstrumentsInput("Gt,Ba,Gt")).toEqual(["Gt", "Ba"]);
  });

  it("also splits on full-width commas (、 and ，)", () => {
    expect(parseInstrumentsInput("Gt、Ba，Dr")).toEqual(["Gt", "Ba", "Dr"]);
  });

  it("handles a mix of half-width and full-width commas", () => {
    expect(parseInstrumentsInput("Gt, Ba、Dr，Vo")).toEqual(["Gt", "Ba", "Dr", "Vo"]);
  });

  it("handles an empty string", () => {
    expect(parseInstrumentsInput("")).toEqual([]);
  });
});
