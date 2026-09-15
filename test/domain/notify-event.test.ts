import { describe, expect, it } from "vitest";
import {
  buildEventEditedContent,
  buildNewEventContent,
  type EventEditedFields,
  type NewEventInput,
} from "../../src/domain/notify-event";
import { formatEventPeriod, parseJstDateTimeLocal } from "../../src/domain/time";

const STARTS_AT = parseJstDateTimeLocal("2026-09-05T19:00");

function makeNewEventInput(overrides: Partial<NewEventInput> = {}): NewEventInput {
  return {
    title: "〇〇オフ会 vol.3",
    organizerDisplayName: "山田",
    region: "東京",
    startsAt: STARTS_AT,
    durationMinutes: 180,
    place: "スタジオA",
    discordOpenAvailable: false,
    ...overrides,
  };
}

describe("buildNewEventContent", () => {
  it("見出し+地域・日時・場所の3行になる(N1)", () => {
    const content = buildNewEventContent(makeNewEventInput());
    expect(content).toBe(
      [
        "〔〇〇オフ会 vol.3〕山田さんが新しいオフ会を作成しました",
        "- 地域: 東京",
        `- 日時: ${formatEventPeriod(STARTS_AT, 180)}`,
        "- 場所: スタジオA",
      ].join("\n"),
    );
  });

  it("durationMinutes が null なら開始時刻のみの表記になる", () => {
    const content = buildNewEventContent(makeNewEventInput({ durationMinutes: null }));
    expect(content).toContain(`- 日時: ${formatEventPeriod(STARTS_AT, null)}`);
  });

  it("URL・合言葉は含まれない(計画のユーザー決定事項)", () => {
    const content = buildNewEventContent(
      makeNewEventInput({ title: "秘密オフ会", place: "非公開スタジオ" }),
    );
    expect(content).not.toContain("http");
    expect(content).not.toContain("himitsu");
  });

  it("タイトル・地域・場所・主催者表示名の Markdown 記号がエスケープされる", () => {
    const content = buildNewEventContent(
      makeNewEventInput({
        title: "**太字**",
        organizerDisplayName: "`code`",
        region: "_斜体_",
        place: "|spoiler|",
      }),
    );
    expect(content).toContain("\\*\\*太字\\*\\*");
    expect(content).toContain("\\`code\\`");
    expect(content).toContain("\\_斜体\\_");
    expect(content).toContain("\\|spoiler\\|");
  });

  it("各フィールドに改行を仕込んでも本文は1行に収まる行だけになる(見出し込み4行のまま)", () => {
    const content = buildNewEventContent(
      makeNewEventInput({
        title: "本物オフ会\n〔別オフ会〕偽の通知",
        region: "東京\n偽の行",
        place: "スタジオA\n偽の行",
      }),
    );
    expect(content.split("\n")).toHaveLength(4);
  });

  it("discordOpenAvailable が true のときだけ「/bandoff open」の1行が足される(計画7章)", () => {
    const withDiscord = buildNewEventContent(
      makeNewEventInput({ discordOpenAvailable: true }),
    );
    expect(withDiscord.split("\n")).toHaveLength(5);
    expect(withDiscord).toContain("- Discord の `/bandoff open` で開けます");

    const withoutDiscord = buildNewEventContent(
      makeNewEventInput({ discordOpenAvailable: false }),
    );
    expect(withoutDiscord).not.toContain("/bandoff open");
  });
});

function makeFields(overrides: Partial<EventEditedFields> = {}): EventEditedFields {
  return {
    title: "〇〇オフ会 vol.3",
    region: "東京",
    startsAt: STARTS_AT,
    durationMinutes: 180,
    place: "スタジオA",
    notes: "",
    status: "upcoming",
    ...overrides,
  };
}

describe("buildEventEditedContent", () => {
  it("何も変わっていなければ null を返す(送らない)", () => {
    const fields = makeFields();
    expect(buildEventEditedContent({ before: fields, after: fields })).toBeNull();
  });

  it("イベント名だけ変わったとき、見出しは変更後のタイトルで1行だけ出る", () => {
    const before = makeFields({ title: "旧タイトル" });
    const after = makeFields({ title: "新タイトル" });
    const content = buildEventEditedContent({ before, after });
    expect(content).toBe(
      [
        "〔新タイトル〕イベント情報が変更されました",
        "- イベント名: 旧タイトル → 新タイトル",
      ].join("\n"),
    );
  });

  it("地域だけ変わったとき、地域の行だけ出る", () => {
    const before = makeFields({ region: "東京" });
    const after = makeFields({ region: "大阪" });
    const content = buildEventEditedContent({ before, after });
    expect(content).toBe(
      ["〔〇〇オフ会 vol.3〕イベント情報が変更されました", "- 地域: 東京 → 大阪"].join(
        "\n",
      ),
    );
  });

  it("開始時刻だけ変わっても日時の行が1行だけ出る(長さは同じ)", () => {
    const newStartsAt = parseJstDateTimeLocal("2026-09-06T20:00");
    const before = makeFields({ startsAt: STARTS_AT });
    const after = makeFields({ startsAt: newStartsAt });
    const content = buildEventEditedContent({ before, after });
    expect(content).toBe(
      [
        "〔〇〇オフ会 vol.3〕イベント情報が変更されました",
        `- 日時: ${formatEventPeriod(STARTS_AT, 180)} → ${formatEventPeriod(newStartsAt, 180)}`,
      ].join("\n"),
    );
  });

  it("長さだけ変わっても日時の行が1行だけ出る(開始時刻は同じ)", () => {
    const before = makeFields({ durationMinutes: 180 });
    const after = makeFields({ durationMinutes: 240 });
    const content = buildEventEditedContent({ before, after });
    expect(content).toBe(
      [
        "〔〇〇オフ会 vol.3〕イベント情報が変更されました",
        `- 日時: ${formatEventPeriod(STARTS_AT, 180)} → ${formatEventPeriod(STARTS_AT, 240)}`,
      ].join("\n"),
    );
  });

  it("場所だけ変わったとき、場所の行だけ出る", () => {
    const before = makeFields({ place: "スタジオA" });
    const after = makeFields({ place: "スタジオB" });
    const content = buildEventEditedContent({ before, after });
    expect(content).toContain("- 場所: スタジオA → スタジオB");
  });

  it("募集状況が募集中→締切に変わったとき、主催者画面と同じラベルで出る", () => {
    const before = makeFields({ status: "upcoming" });
    const after = makeFields({ status: "closed" });
    const content = buildEventEditedContent({ before, after });
    expect(content).toContain("- 募集状況: 募集中 → 締切");
  });

  it("募集状況が締切→募集中に変わったときも同じラベルで出る", () => {
    const before = makeFields({ status: "closed" });
    const after = makeFields({ status: "upcoming" });
    const content = buildEventEditedContent({ before, after });
    expect(content).toContain("- 募集状況: 締切 → 募集中");
  });

  it("備考が変わったときは値を出さず「変更しました」だけになる", () => {
    const before = makeFields({ notes: "旧備考(誰にも見せたくない値)" });
    const after = makeFields({ notes: "新備考(これも見せない)" });
    const content = buildEventEditedContent({ before, after });
    expect(content).toContain("- 備考を変更しました");
    expect(content).not.toContain("旧備考");
    expect(content).not.toContain("新備考");
  });

  it("複数項目が変わったとき、変わった項目だけが決まった順序で並ぶ", () => {
    const before = makeFields({
      title: "旧タイトル",
      region: "東京",
      place: "スタジオA",
      notes: "旧備考",
      status: "upcoming",
    });
    const after = makeFields({
      title: "新タイトル",
      region: "大阪",
      place: "スタジオB",
      notes: "新備考",
      status: "closed",
    });
    const content = buildEventEditedContent({ before, after });
    expect(content).toBe(
      [
        "〔新タイトル〕イベント情報が変更されました",
        "- イベント名: 旧タイトル → 新タイトル",
        "- 地域: 東京 → 大阪",
        "- 場所: スタジオA → スタジオB",
        "- 募集状況: 募集中 → 締切",
        "- 備考を変更しました",
      ].join("\n"),
    );
  });

  it("空文字への変更は (なし) と表示される", () => {
    const before = makeFields({ place: "スタジオA" });
    const after = makeFields({ place: "" });
    const content = buildEventEditedContent({ before, after });
    expect(content).toContain("- 場所: スタジオA → (なし)");
  });

  it("変更後の値に Markdown 記号が含まれてもエスケープされる", () => {
    const before = makeFields({ title: "旧タイトル" });
    const after = makeFields({ title: "**新タイトル**" });
    const content = buildEventEditedContent({ before, after });
    expect(content).toContain("旧タイトル → \\*\\*新タイトル\\*\\*");
    // 見出しも変更後のタイトルを使うので、そちらもエスケープされる。
    expect(content).toContain("〔\\*\\*新タイトル\\*\\*〕");
  });

  it("値に改行を仕込んでも本文の行数は増えない", () => {
    const before = makeFields({ title: "旧タイトル" });
    const after = makeFields({
      title: "新タイトル\n〔別オフ会〕田中さんが「偽の曲」のGt1に入りました",
    });
    const content = buildEventEditedContent({ before, after });
    expect(content).not.toBeNull();
    expect(content?.split("\n")).toHaveLength(2);
  });
});
