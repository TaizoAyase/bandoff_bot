import { describe, expect, it } from "vitest";
import {
  buildCandidateName,
  buildDisplayNameHint,
  buildListActionRows,
  buildListBody,
  buildNewCommandMessage,
  buildOpenLinkMessage,
  parseOpenCustomId,
} from "../../src/domain/discord-message";
import { parseJstDateTimeLocal } from "../../src/domain/time";

const STARTS_AT = parseJstDateTimeLocal("2026-09-05T19:00");
const NEWLINE = String.fromCharCode(10);

describe("buildCandidateName", () => {
  it("formats as {M/D(曜) HH:MM} {title}({region})", () => {
    const name = buildCandidateName({
      id: "id-1",
      title: "テストオフ会",
      region: "東京",
      startsAt: STARTS_AT,
    });
    expect(name).toBe("9/5(土) 19:00 テストオフ会(東京)");
  });

  it("escapes markdown characters and neutralizes newlines in title/region", () => {
    const name = buildCandidateName({
      id: "id-1",
      title: `*太字*${NEWLINE}injected`,
      region: "東京",
      startsAt: STARTS_AT,
    });
    expect(name).not.toContain("\n");
    expect(name).toContain("\\*太字\\*");
  });

  it("truncates to 100 UTF-16 code units", () => {
    const name = buildCandidateName({
      id: "id-1",
      title: "あ".repeat(200),
      region: "東京",
      startsAt: STARTS_AT,
    });
    expect(name.length).toBe(100);
  });
});

describe("buildDisplayNameHint", () => {
  it("prefers nick over globalName and username", () => {
    expect(
      buildDisplayNameHint({
        nick: "ニック",
        globalName: "グローバル",
        username: "user",
      }),
    ).toBe("ニック");
  });

  it("falls back to globalName when nick is null", () => {
    expect(
      buildDisplayNameHint({ nick: null, globalName: "グローバル", username: "user" }),
    ).toBe("グローバル");
  });

  it("falls back to username when nick and globalName are null", () => {
    expect(
      buildDisplayNameHint({ nick: null, globalName: null, username: "user" }),
    ).toBe("user");
  });

  it("falls through to the next candidate when a higher-priority value is blank after normalization", () => {
    expect(
      buildDisplayNameHint({ nick: "   ", globalName: "グローバル", username: "user" }),
    ).toBe("グローバル");
  });

  it("returns an empty string when all candidates are null or blank", () => {
    expect(buildDisplayNameHint({ nick: null, globalName: null, username: null })).toBe(
      "",
    );
    expect(buildDisplayNameHint({ nick: "  ", globalName: "", username: null })).toBe(
      "",
    );
  });

  it("strips control characters (including newlines) and trims", () => {
    expect(
      buildDisplayNameHint({
        nick: `  変な${NEWLINE}名前  `,
        globalName: null,
        username: null,
      }),
    ).toBe("変な 名前");
  });

  it("truncates to DISPLAY_NAME_MAX (30)", () => {
    const hint = buildDisplayNameHint({
      nick: "あ".repeat(50),
      globalName: null,
      username: null,
    });
    expect(hint.length).toBe(30);
  });
});

describe("buildOpenLinkMessage", () => {
  it("includes the escaped title and a link button", () => {
    const message = buildOpenLinkMessage({
      eventTitle: "*太字*イベント",
      url: "https://example.test/e/slug/discord#token",
    });
    expect(message.content).toContain("\\*太字\\*イベント");
    expect(message.content).toContain("10分間・1回だけ有効");
    expect(message.components).toEqual([
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: "開く",
            url: "https://example.test/e/slug/discord#token",
          },
        ],
      },
    ]);
  });
});

describe("buildNewCommandMessage", () => {
  it("includes a link button to the given URL", () => {
    const message = buildNewCommandMessage("https://example.test/new");
    expect(message.content).toBe("新しいオフ会を作成するページです");
    expect(message.components).toEqual([
      {
        type: 1,
        components: [
          { type: 2, style: 5, label: "作成する", url: "https://example.test/new" },
        ],
      },
    ]);
  });
});

describe("buildListBody", () => {
  it("returns the fixed message when there are no candidates", () => {
    expect(buildListBody([])).toBe("Discord から開けるイベントはありません");
  });

  it("formats each item with title, joined suffix, and detail line", () => {
    const body = buildListBody([
      {
        id: "id-1",
        title: "オフ会A",
        region: "東京",
        place: "スタジオA",
        startsAt: STARTS_AT,
        joined: true,
      },
      {
        id: "id-2",
        title: "オフ会B",
        region: "大阪",
        place: "スタジオB",
        startsAt: STARTS_AT,
        joined: false,
      },
    ]);
    expect(body).toContain("**オフ会A** (参加中)");
    expect(body).toContain("東京・");
    expect(body).toContain("**オフ会B**");
    expect(body).not.toContain("オフ会B** (参加中)");
  });

  it("omits empty fields from the detail line (no stray separator)", () => {
    // 日時は常に非空のため、region・place の両方が空でも detail line 自体は
    // 残る(日時だけの1行になり、区切り文字 "・" は付かない)。
    const bodyBothEmpty = buildListBody([
      {
        id: "id-1",
        title: "オフ会A",
        region: "",
        place: "",
        startsAt: STARTS_AT,
        joined: false,
      },
    ]);
    const detailLineBothEmpty = bodyBothEmpty.split(NEWLINE)[1] ?? "";
    expect(detailLineBothEmpty).not.toContain("・");
    expect(detailLineBothEmpty).not.toBe("");

    const bodyPlaceEmpty = buildListBody([
      {
        id: "id-1",
        title: "オフ会A",
        region: "東京",
        place: "",
        startsAt: STARTS_AT,
        joined: false,
      },
    ]);
    const detailLinePlaceEmpty = bodyPlaceEmpty.split(NEWLINE)[1] ?? "";
    expect(detailLinePlaceEmpty).toContain("東京・");
  });

  it("escapes markdown and neutralizes newlines in title/region/place", () => {
    const body = buildListBody([
      {
        id: "id-1",
        title: `*太字*${NEWLINE}injected`,
        region: `地域${NEWLINE}injected`,
        place: "スタジオ",
        startsAt: STARTS_AT,
        joined: false,
      },
    ]);
    expect(body).not.toContain(`${NEWLINE}injected`);
    expect(body).toContain("\\*太字\\*");
  });

  it("truncates to 2000 characters when many items are given", () => {
    const items = Array.from({ length: 25 }, (_, i) => ({
      id: `id-${i}`,
      title: "あ".repeat(100),
      region: "地域",
      place: "場所",
      startsAt: STARTS_AT,
      joined: false,
    }));
    const body = buildListBody(items);
    expect(body.length).toBe(2000);
    expect(body).toContain("…(以下省略)");
  });
});

describe("buildListActionRows", () => {
  it("creates one button per item with custom_id open:{id}", () => {
    const rows = buildListActionRows([{ id: "id-1", title: "オフ会A" }]);
    expect(rows).toEqual([
      {
        type: 1,
        components: [{ type: 2, style: 1, label: "オフ会A", custom_id: "open:id-1" }],
      },
    ]);
  });

  it("groups buttons into rows of 5", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      id: `id-${i}`,
      title: `イベント${i}`,
    }));
    const rows = buildListActionRows(items);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.components).toHaveLength(5);
    expect(rows[1]?.components).toHaveLength(5);
    expect(rows[2]?.components).toHaveLength(2);
  });

  it("truncates labels to 80 characters and escapes markdown", () => {
    const rows = buildListActionRows([{ id: "id-1", title: `*${"あ".repeat(100)}*` }]);
    const label = rows[0]?.components[0]?.label ?? "";
    expect(label.length).toBe(80);
    expect(label.startsWith("\\*")).toBe(true);
  });

  it("returns an empty array for no items", () => {
    expect(buildListActionRows([])).toEqual([]);
  });
});

describe("parseOpenCustomId", () => {
  it("extracts the event id", () => {
    expect(parseOpenCustomId("open:abc-123")).toBe("abc-123");
  });

  it("returns null when the prefix does not match or the id part is empty", () => {
    expect(parseOpenCustomId("other:abc-123")).toBeNull();
    expect(parseOpenCustomId("open:")).toBeNull();
    expect(parseOpenCustomId("")).toBeNull();
  });
});
