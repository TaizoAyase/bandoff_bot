import { describe, expect, it } from "vitest";
import { formStringArray, formStringArrayPositional } from "../../src/routes/form";

// この2つの関数の違いは `File` の扱いだけで、そこにしか存在理由がない。
// 譜面URLと譜面の名前のように同名フィールド2本を位置(n番目同士)で組にする
// 入力では、`File` を取り除くとその行以降の対応が1つずつずれる。
// `formStringArrayPositional` はそのために要素数を保つ。

describe("formStringArrayPositional", () => {
  it("returns a string array as it is", () => {
    expect(formStringArrayPositional(["https://a", "https://b"])).toEqual([
      "https://a",
      "https://b",
    ]);
  });

  // 取り除くと以降の行がずれるので、空文字列に潰して位置を保つ。
  // この関数を `formStringArray` に置き換えたらここで落ちる。
  it("flattens a File into an empty string so later rows do not shift", () => {
    expect(formStringArrayPositional([new File([], "a.txt"), "b"])).toEqual(["", "b"]);
  });

  it("keeps the element count when every value is a File", () => {
    expect(
      formStringArrayPositional([new File([], "a.txt"), new File([], "b.txt")]),
    ).toEqual(["", ""]);
  });

  it("wraps a single string into a one-element array", () => {
    expect(formStringArrayPositional("https://a")).toEqual(["https://a"]);
  });

  it("returns an empty list for undefined", () => {
    expect(formStringArrayPositional(undefined)).toEqual([]);
  });

  it("returns an empty list for an empty array", () => {
    expect(formStringArrayPositional([])).toEqual([]);
  });
});

describe("formStringArray", () => {
  it("returns a string array as it is", () => {
    expect(formStringArray(["https://a", "https://b"])).toEqual([
      "https://a",
      "https://b",
    ]);
  });

  // 対比。こちらは `File` を取り除くので要素数が減り、位置で組にする用途には
  // 使えない(このずれこそが `formStringArrayPositional` を別に持つ理由)。
  it("drops a File and shrinks the element count", () => {
    expect(formStringArray([new File([], "a.txt"), "b"])).toEqual(["b"]);
  });

  it("wraps a single string into a one-element array", () => {
    expect(formStringArray("https://a")).toEqual(["https://a"]);
  });

  it("returns an empty list for undefined", () => {
    expect(formStringArray(undefined)).toEqual([]);
  });

  it("returns an empty list for an empty array", () => {
    expect(formStringArray([])).toEqual([]);
  });
});
