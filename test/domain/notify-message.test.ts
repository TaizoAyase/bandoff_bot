import { describe, expect, it } from "vitest";
import {
  buildEntryChangedContent,
  type EntryChangedEvent,
} from "../../src/domain/notify-message";

function makeEvent(overrides: Partial<EntryChangedEvent> = {}): EntryChangedEvent {
  return {
    type: "join",
    eventTitle: "〇〇オフ会 vol.3",
    participantName: "山田",
    songTitle: "テスト曲",
    slotLabel: "Gt2",
    takeOrdinal: null,
    ...overrides,
  };
}

describe("buildEntryChangedContent", () => {
  it("空配列なら null を返す(送るものがない)", () => {
    expect(buildEntryChangedContent([])).toBeNull();
  });

  it("join 1件は「〜に入りました」になる", () => {
    const content = buildEntryChangedContent([makeEvent({ type: "join" })]);
    expect(content).toBe(
      "〔〇〇オフ会 vol.3〕山田さんが「テスト曲」の Gt2 に入りました",
    );
  });

  it("leave 1件は「〜を辞退しました」になる", () => {
    const content = buildEntryChangedContent([makeEvent({ type: "leave" })]);
    expect(content).toBe(
      "〔〇〇オフ会 vol.3〕山田さんが「テスト曲」の Gt2 を辞退しました",
    );
  });

  it("複数件(一括辞退)は見出し+箇条書きになる", () => {
    const content = buildEntryChangedContent([
      makeEvent({ type: "leave", songTitle: "曲A", slotLabel: "Gt1" }),
      makeEvent({ type: "leave", songTitle: "曲B", slotLabel: "Ba" }),
      makeEvent({ type: "leave", songTitle: "曲C", slotLabel: "Cho" }),
    ]);
    expect(content).toBe(
      [
        "〔〇〇オフ会 vol.3〕山田さんが以下のエントリーを辞退しました",
        "- 「曲A」の Gt1",
        "- 「曲B」の Ba",
        "- 「曲C」の Cho",
      ].join("\n"),
    );
  });

  it("表示名に @everyone や ** や ` が入ってもエスケープされる", () => {
    const content = buildEntryChangedContent([
      makeEvent({ participantName: "@everyone `test` **太字**" }),
    ]);
    // Markdown 記号はバックスラッシュ付きになり字面どおり表示される。
    // `@everyone` 自体のメンション発火防止は送信側の allowed_mentions が担う
    // ので、ここではエスケープされていることだけを確認する。
    expect(content).toContain("\\`test\\` \\*\\*太字\\*\\*");
  });

  it("曲名・枠ラベルに Markdown 記号が入ってもエスケープされる", () => {
    const content = buildEntryChangedContent([
      makeEvent({ songTitle: "_斜体_ ~取消~ |spoiler|", slotLabel: "> quote" }),
    ]);
    expect(content).toContain("\\_斜体\\_ \\~取消\\~ \\|spoiler\\|");
    expect(content).toContain("\\> quote");
  });

  it("2000文字を超えたら切り詰められ、上限以下に収まる", () => {
    const content = buildEntryChangedContent([
      makeEvent({ participantName: "あ".repeat(3000) }),
    ]);
    expect(content).not.toBeNull();
    expect(content?.length).toBeLessThanOrEqual(2000);
    expect(content?.endsWith("…(以下省略)")).toBe(true);
  });

  it("末尾が絵文字(サロゲートペア)の境界に来ても孤立サロゲートを作らない", () => {
    const eventTitle = "〇〇オフ会 vol.3";
    const cutLength = 2000 - "…(以下省略)".length;
    // participantName を空にして「さんが」の直前までの長さ(プレフィックス長)
    // を実測する。ハードコードした桁数を使うとテンプレート文言が変わった
    // ときに追従できないため、実際の出力から逆算する。
    const probe = buildEntryChangedContent([
      makeEvent({ eventTitle, participantName: "" }),
    ]);
    if (probe === null) throw new Error("expected content");
    const prefixLength = probe.indexOf("さんが");
    expect(prefixLength).toBeGreaterThan(0);

    // 絵文字(サロゲートペア)の高位側がちょうど切り詰め境界の直前
    // (cutLength - 1)に来るように、直前の埋め文字の長さを合わせる。
    const fillerLength = cutLength - 1 - prefixLength;
    const participantName = `${"あ".repeat(fillerLength)}😀${"い".repeat(50)}`;

    const content = buildEntryChangedContent([
      makeEvent({ eventTitle, participantName }),
    ]);
    expect(content).not.toBeNull();
    expect(content?.length).toBeLessThanOrEqual(2000);
    // 孤立した高位サロゲート(直後に低位サロゲートが続かないもの)が
    // 無いこと。
    expect(content ?? "").not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it("takeOrdinal があれば「曲名」の直後に「(n回目)」が入り、無ければ入らない", () => {
    const withOrdinal = buildEntryChangedContent([
      makeEvent({ type: "join", takeOrdinal: 2 }),
    ]);
    expect(withOrdinal).toBe(
      "〔〇〇オフ会 vol.3〕山田さんが「テスト曲」(2回目)の Gt2 に入りました",
    );

    const withoutOrdinal = buildEntryChangedContent([
      makeEvent({ type: "join", takeOrdinal: null }),
    ]);
    expect(withoutOrdinal).not.toContain("回目");
  });

  it("複数件の箇条書きでも takeOrdinal ごとに「(n回目)」の有無が変わる", () => {
    const content = buildEntryChangedContent([
      makeEvent({ type: "leave", songTitle: "曲A", slotLabel: "Gt1", takeOrdinal: 2 }),
      makeEvent({
        type: "leave",
        songTitle: "曲B",
        slotLabel: "Ba",
        takeOrdinal: null,
      }),
    ]);
    expect(content).toBe(
      [
        "〔〇〇オフ会 vol.3〕山田さんが以下のエントリーを辞退しました",
        "- 「曲A」(2回目)の Gt1",
        "- 「曲B」の Ba",
      ].join("\n"),
    );
  });

  it("表示名に改行を仕込んでも偽の通知行を作れない(レビュー指摘の実例)", () => {
    // レビュアーが実測した攻撃例そのもの。DISPLAY_NAME_MAX(30文字)以内の
    // 23文字だが、\n 以降が単独の正規通知に見える文字列になっている。
    const participantName = "山田\n〔別オフ会〕田中さんが「偽の曲」のGt1に入りました";
    const content = buildEntryChangedContent([makeEvent({ participantName })]);
    expect(content).not.toBeNull();
    // 改行が消えて偽の行がスペース区切りで同一行に埋め込まれるだけになり、
    // 独立した2行目(単独の正規通知に見える文字列)にはならないこと。
    expect(content?.split("\n")).toHaveLength(1);
    expect(content).toBe(
      "〔〇〇オフ会 vol.3〕山田 〔別オフ会〕田中さんが「偽の曲」のGt1に入りましたさんが「テスト曲」の Gt2 に入りました",
    );
  });

  it("曲名に改行を仕込んでも偽の通知行を作れない", () => {
    const songTitle = "テスト曲\n〔別オフ会〕鈴木さんが「別の曲」のBaに入りました";
    const content = buildEntryChangedContent([makeEvent({ songTitle })]);
    expect(content).not.toBeNull();
    expect(content?.split("\n")).toHaveLength(1);
  });

  it("楽器名(枠ラベル)に改行を仕込んでも偽の通知行を作れない", () => {
    const slotLabel = "Gt1\n〔別オフ会〕佐藤さんが「別の曲」のDrに入りました";
    const content = buildEntryChangedContent([makeEvent({ slotLabel })]);
    expect(content).not.toBeNull();
    expect(content?.split("\n")).toHaveLength(1);
  });

  it("イベント名に改行を仕込んでも偽の通知行を作れない", () => {
    const eventTitle = "本物オフ会\n〔別オフ会〕高橋さんが「別の曲」のCho に入りました";
    const content = buildEntryChangedContent([makeEvent({ eventTitle })]);
    expect(content).not.toBeNull();
    expect(content?.split("\n")).toHaveLength(1);
  });

  it("複数件(一括辞退)に改行を仕込んでも行数が 1+件数 のまま増えない", () => {
    const content = buildEntryChangedContent([
      makeEvent({
        type: "leave",
        songTitle: "曲A\n〔別オフ会〕田中さんが「偽の曲」のGt1に入りました",
        slotLabel: "Gt1",
      }),
      makeEvent({ type: "leave", songTitle: "曲B", slotLabel: "Ba\n偽の行" }),
      makeEvent({ type: "leave", songTitle: "曲C", slotLabel: "Cho" }),
    ]);
    expect(content).not.toBeNull();
    // 見出し1行 + 件数分の箇条書き = 1 + 3 = 4行から増えないこと。
    expect(content?.split("\n")).toHaveLength(1 + 3);
  });

  it("戻り値に将来追加されうる id 系フィールドの値を含まない(csrf.test.ts の slug 非漏洩テストと同じ発想)", () => {
    // EntryChangedEvent は元々 eventId/participantId を持っていたが、
    // 通知先が1本に決まったため計画で意図的に落とした(仕様書参照)。
    // 将来これらのフィールドが復活しても buildEntryChangedContent が
    // 本文へ混ぜていないことを検知できるよう、型を広げて余剰フィールドを
    // 渡してみる。
    const eventWithLeakyFields = {
      ...makeEvent(),
      eventId: "leaky-event-id-000",
      participantId: "leaky-participant-id-111",
    } as EntryChangedEvent;

    const content = buildEntryChangedContent([eventWithLeakyFields]);

    expect(content).not.toContain("leaky-event-id-000");
    expect(content).not.toContain("leaky-participant-id-111");
  });
});
