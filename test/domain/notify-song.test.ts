import { describe, expect, it } from "vitest";
import {
  buildSongAddedContent,
  buildSongEditedContent,
  buildTakeAddedContent,
  type SongAddedInput,
  type SongEditedFields,
  type SongEditedInput,
  type TakeAddedInput,
} from "../../src/domain/notify-song";

function makeSongAddedInput(overrides: Partial<SongAddedInput> = {}): SongAddedInput {
  return {
    eventTitle: "〇〇オフ会 vol.3",
    actorDisplayName: "山田",
    title: "テスト曲",
    artist: "テストアーティスト",
    instruments: ["Gt", "Gt", "Ba", "Dr", "Vo"],
    ...overrides,
  };
}

describe("buildSongAddedContent", () => {
  it("見出し+アーティスト+パートの3行になる(N3)", () => {
    const content = buildSongAddedContent(makeSongAddedInput());
    expect(content).toBe(
      [
        "〔〇〇オフ会 vol.3〕山田さんが「テスト曲」を追加しました",
        "- アーティスト: テストアーティスト",
        "- パート: Gt1、Gt2、Ba、Dr、Vo",
      ].join("\n"),
    );
  });

  it("アーティストが空ならその行を出さない", () => {
    const content = buildSongAddedContent(makeSongAddedInput({ artist: "" }));
    expect(content).not.toContain("アーティスト");
  });

  it("同じ楽器が複数あれば Gt1・Gt2 のように採番される", () => {
    const content = buildSongAddedContent(
      makeSongAddedInput({ instruments: ["Gt", "Gt", "Gt"] }),
    );
    expect(content).toContain("- パート: Gt1、Gt2、Gt3");
  });

  it("actorDisplayName が null なら「主催者が」になる", () => {
    const content = buildSongAddedContent(
      makeSongAddedInput({ actorDisplayName: null }),
    );
    expect(content).toContain("〔〇〇オフ会 vol.3〕主催者が「テスト曲」を追加しました");
  });

  it("曲名・アーティスト名・楽器名の Markdown 記号がエスケープされる", () => {
    const content = buildSongAddedContent(
      makeSongAddedInput({
        title: "**太字**",
        artist: "`code`",
        instruments: ["_斜体_"],
      }),
    );
    expect(content).toContain("\\*\\*太字\\*\\*");
    expect(content).toContain("\\`code\\`");
    expect(content).toContain("\\_斜体\\_");
  });

  it("値に改行を仕込んでも本文の行数は増えない", () => {
    const content = buildSongAddedContent(
      makeSongAddedInput({
        title: "テスト曲\n〔別オフ会〕偽の通知",
        artist: "テストアーティスト\n偽の行",
      }),
    );
    expect(content.split("\n")).toHaveLength(3);
  });
});

function makeSongFields(overrides: Partial<SongEditedFields> = {}): SongEditedFields {
  return {
    title: "テスト曲",
    artist: "テストアーティスト",
    refUrl: "",
    songKey: "",
    notes: "",
    scoreUrls: [],
    ...overrides,
  };
}

function makeSongEditedInput(
  before: Partial<SongEditedFields>,
  after: Partial<SongEditedFields>,
  overrides: Partial<Omit<SongEditedInput, "before" | "after">> = {},
): SongEditedInput {
  return {
    eventTitle: "〇〇オフ会 vol.3",
    actorDisplayName: "山田",
    before: makeSongFields(before),
    after: makeSongFields(after),
    ...overrides,
  };
}

describe("buildSongEditedContent", () => {
  it("何も変わっていなければ null を返す(送らない)", () => {
    const fields = makeSongFields();
    const content = buildSongEditedContent(makeSongEditedInput(fields, fields));
    expect(content).toBeNull();
  });

  it("曲名だけ変わったとき、見出しは変更前の曲名で1行だけ出る(N4)", () => {
    const content = buildSongEditedContent(
      makeSongEditedInput({ title: "旧曲名" }, { title: "新曲名" }),
    );
    expect(content).toBe(
      [
        "〔〇〇オフ会 vol.3〕山田さんが「旧曲名」の曲情報を変更しました",
        "- 曲名: 旧曲名 → 新曲名",
      ].join("\n"),
    );
  });

  it("アーティストだけ変わったとき、アーティストの行だけ出る", () => {
    const content = buildSongEditedContent(
      makeSongEditedInput({ artist: "旧アーティスト" }, { artist: "新アーティスト" }),
    );
    expect(content).toContain("- アーティスト: 旧アーティスト → 新アーティスト");
  });

  it("キーだけ変わったとき、キーの行だけ出る", () => {
    const content = buildSongEditedContent(
      makeSongEditedInput({ songKey: "C" }, { songKey: "D" }),
    );
    expect(content).toContain("- キー: C → D");
  });

  it("参考URLが変わったときは値を出さず「変更しました」だけになる", () => {
    const content = buildSongEditedContent(
      makeSongEditedInput(
        { refUrl: "https://example.com/old" },
        { refUrl: "https://example.com/new" },
      ),
    );
    expect(content).toContain("- 参考URLを変更しました");
    expect(content).not.toContain("example.com");
  });

  it("譜面URLが増えたときは値を出さず「変更しました」だけになる", () => {
    const content = buildSongEditedContent(
      makeSongEditedInput(
        { scoreUrls: ["https://example.com/a"] },
        { scoreUrls: ["https://example.com/a", "https://example.com/b"] },
      ),
    );
    expect(content).toContain("- 譜面URLを変更しました");
    expect(content).not.toContain("example.com");
  });

  it("譜面URLが減ったときは値を出さず「変更しました」だけになる", () => {
    const content = buildSongEditedContent(
      makeSongEditedInput(
        { scoreUrls: ["https://example.com/a", "https://example.com/b"] },
        { scoreUrls: ["https://example.com/a"] },
      ),
    );
    expect(content).toContain("- 譜面URLを変更しました");
    expect(content).not.toContain("example.com");
  });

  it("譜面URLが同じ集合でも並び順だけ違えば変更ありになる", () => {
    const content = buildSongEditedContent(
      makeSongEditedInput(
        { scoreUrls: ["https://example.com/a", "https://example.com/b"] },
        { scoreUrls: ["https://example.com/b", "https://example.com/a"] },
      ),
    );
    expect(content).toContain("- 譜面URLを変更しました");
  });

  it("譜面URLが before・after で同一なら行が出ない", () => {
    const urls = ["https://example.com/a", "https://example.com/b"];
    const content = buildSongEditedContent(
      makeSongEditedInput(
        { scoreUrls: urls, title: "旧曲名" },
        { scoreUrls: urls, title: "新曲名" },
      ),
    );
    expect(content).not.toContain("譜面URL");
  });

  it("備考が変わったときは値を出さず「変更しました」だけになる", () => {
    const content = buildSongEditedContent(
      makeSongEditedInput({ notes: "旧備考" }, { notes: "新備考" }),
    );
    expect(content).toContain("- 備考を変更しました");
    expect(content).not.toContain("旧備考");
    expect(content).not.toContain("新備考");
  });

  it("null と空文字は同一視され、変更なし扱いになる", () => {
    const before: SongEditedFields = {
      title: "テスト曲",
      artist: "",
      refUrl: "",
      songKey: "",
      notes: "",
      scoreUrls: [],
    };
    // DB の null は呼び出し側で "" に正規化してから渡す前提。
    const after: SongEditedFields = { ...before };
    const content = buildSongEditedContent({
      eventTitle: "〇〇オフ会 vol.3",
      actorDisplayName: "山田",
      before,
      after,
    });
    expect(content).toBeNull();
  });

  it("actorDisplayName が null なら「主催者が」になる", () => {
    const content = buildSongEditedContent(
      makeSongEditedInput(
        { title: "旧曲名" },
        { title: "新曲名" },
        { actorDisplayName: null },
      ),
    );
    expect(content).toContain("主催者が「旧曲名」の曲情報を変更しました");
  });

  it("複数項目が変わったとき、変わった項目だけが決まった順序で並ぶ", () => {
    const content = buildSongEditedContent(
      makeSongEditedInput(
        { title: "旧曲名", artist: "旧アーティスト", songKey: "C", notes: "旧備考" },
        { title: "新曲名", artist: "新アーティスト", songKey: "D", notes: "新備考" },
      ),
    );
    expect(content).toBe(
      [
        "〔〇〇オフ会 vol.3〕山田さんが「旧曲名」の曲情報を変更しました",
        "- 曲名: 旧曲名 → 新曲名",
        "- アーティスト: 旧アーティスト → 新アーティスト",
        "- キー: C → D",
        "- 備考を変更しました",
      ].join("\n"),
    );
  });

  it("空文字への変更は (なし) と表示される", () => {
    const content = buildSongEditedContent(
      makeSongEditedInput({ artist: "旧アーティスト" }, { artist: "" }),
    );
    expect(content).toContain("- アーティスト: 旧アーティスト → (なし)");
  });

  it("値に Markdown 記号や改行が含まれてもエスケープされ行数が増えない", () => {
    const content = buildSongEditedContent(
      makeSongEditedInput(
        { title: "旧曲名" },
        { title: "新曲名\n〔別オフ会〕偽の通知**太字**" },
      ),
    );
    expect(content).not.toBeNull();
    expect(content?.split("\n")).toHaveLength(2);
    expect(content).toContain("\\*\\*太字\\*\\*");
  });
});

function makeTakeAddedInput(overrides: Partial<TakeAddedInput> = {}): TakeAddedInput {
  return {
    eventTitle: "〇〇オフ会 vol.3",
    actorDisplayName: "山田",
    songTitle: "テスト曲",
    takeOrdinal: 2,
    ...overrides,
  };
}

describe("buildTakeAddedContent", () => {
  it("「{n}回目を追加しました」になる(N5)", () => {
    const content = buildTakeAddedContent(makeTakeAddedInput({ takeOrdinal: 2 }));
    expect(content).toBe(
      "〔〇〇オフ会 vol.3〕山田さんが「テスト曲」の2回目を追加しました",
    );
  });

  it("actorDisplayName が null なら「主催者が」になる", () => {
    const content = buildTakeAddedContent(
      makeTakeAddedInput({ actorDisplayName: null }),
    );
    expect(content).toContain("主催者が「テスト曲」の2回目を追加しました");
  });

  it("曲名の Markdown 記号がエスケープされる", () => {
    const content = buildTakeAddedContent(
      makeTakeAddedInput({ songTitle: "**太字**" }),
    );
    expect(content).toContain("\\*\\*太字\\*\\*");
  });

  it("曲名に改行を仕込んでも本文は1行のままになる", () => {
    const content = buildTakeAddedContent(
      makeTakeAddedInput({ songTitle: "テスト曲\n〔別オフ会〕偽の通知" }),
    );
    expect(content.split("\n")).toHaveLength(1);
  });
});
