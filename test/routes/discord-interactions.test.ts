import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb } from "../../src/db/client";
import { linkDiscordUser } from "../../src/db/queries/participants";
import {
  discordLink,
  event as eventTable,
  participant as participantTable,
} from "../../src/db/schema";
import { sha256Hex } from "../../src/domain/crypto";
import {
  closeEvent,
  consumeDiscordLink,
  createEvent,
  createTestClient,
  issueTestDiscordLink,
  setEventStartsAt,
  setEventStartsAtOffset,
} from "../helpers";

/**
 * `POST /discord/interactions`(計画4章)のルートテスト。
 *
 * 署名は、このファイル内で1度だけ生成した Ed25519 鍵ペア(`beforeAll`)で
 * 実際に署名して作る(`test/discord/verify.test.ts` と同じ方式)。
 * `env.DISCORD_PUBLIC_KEY`/`env.DISCORD_GUILD_ID` は `beforeEach`/`afterEach`
 * で退避・復元する(`test/routes/notify-new-event.test.ts` と同じ方式)。
 *
 * 候補イベントの86400/86401秒境界は実時刻に依存するため、`vi.useFakeTimers
 * ({ toFake: ["Date"] })` で `Date` だけを固定する。`app.request()` は
 * このテストファイルと同じ isolate 内で直接呼び出されるので、固定した
 * 現在時刻はルートハンドラ内の `Date.now()` にもそのまま反映される
 * (確認済み: `createEvent()` の `created_at` が固定値と一致する)。
 *
 * D1 の分離はテストファイル単位([[vitest-pool-workers-storage-per-file]])
 * なので、件数に依存するテスト(`/bandoff list` の0件・オートコンプリートの
 * 25件上限)は、実行順序を先頭にする・タイトルの目印で絞り込む・イベント
 * 単位の差分で比較する、のいずれかで他のテストの行に影響されないようにする。
 */

const GUILD_ID = "900000000000000001";
const OTHER_GUILD_ID = "900000000000000009";
const USER_ID = "800000000000000001";

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

let keyPair: CryptoKeyPair;
let publicKeyHex: string;

beforeAll(async () => {
  keyPair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  // Workers の型定義には DOM 版のような "raw"/"jwk" によるオーバーロードの
  // 絞り込みが無く `ArrayBuffer | JsonWebKey` になるため、"raw" 指定時は
  // 常に ArrayBuffer であることをアサートする。
  const raw = (await crypto.subtle.exportKey("raw", keyPair.publicKey)) as ArrayBuffer;
  publicKeyHex = bytesToHex(raw);
});

async function sign(timestamp: string, body: string): Promise<string> {
  const message = new TextEncoder().encode(timestamp + body);
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    keyPair.privateKey,
    message,
  );
  return bytesToHex(signature);
}

let originalPublicKey: string | undefined;
let originalGuildId: string | undefined;

beforeEach(() => {
  originalPublicKey = env.DISCORD_PUBLIC_KEY;
  originalGuildId = env.DISCORD_GUILD_ID;
  env.DISCORD_PUBLIC_KEY = publicKeyHex;
  env.DISCORD_GUILD_ID = GUILD_ID;
});

afterEach(() => {
  env.DISCORD_PUBLIC_KEY = originalPublicKey as string;
  env.DISCORD_GUILD_ID = originalGuildId as string;
  vi.useRealTimers();
});

interface PostInteractionOptions {
  timestamp?: string;
  signature?: string;
  path?: string;
  omitHeaders?: boolean;
}

async function postInteraction(
  bodyObj: unknown,
  options: PostInteractionOptions = {},
): Promise<Response> {
  const body = JSON.stringify(bodyObj);
  const client = createTestClient();
  if (options.omitHeaders) {
    return client.request(options.path ?? "/discord/interactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  }
  const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature = options.signature ?? (await sign(timestamp, body));
  return client.request(options.path ?? "/discord/interactions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": signature,
      "x-signature-timestamp": timestamp,
    },
    body,
  });
}

function member(overrides: {
  discordUserId?: string;
  nick?: string | null;
  globalName?: string | null;
  username?: string;
}) {
  return {
    nick: overrides.nick ?? null,
    user: {
      id: overrides.discordUserId ?? USER_ID,
      global_name: overrides.globalName ?? null,
      username: overrides.username ?? "user1",
    },
  };
}

function openCommandBody(eventId: string, guildId: string | null = GUILD_ID) {
  return {
    type: 2,
    ...(guildId !== null ? { guild_id: guildId } : {}),
    data: {
      name: "bandoff",
      options: [
        { name: "open", options: [{ name: "event", type: 3, value: eventId }] },
      ],
    },
    member: member({}),
  };
}

function listCommandBody(guildId: string | null = GUILD_ID) {
  return {
    type: 2,
    ...(guildId !== null ? { guild_id: guildId } : {}),
    data: { name: "bandoff", options: [{ name: "list" }] },
    member: member({}),
  };
}

function newCommandBody(guildId: string | null = GUILD_ID) {
  return {
    type: 2,
    ...(guildId !== null ? { guild_id: guildId } : {}),
    data: { name: "bandoff", options: [{ name: "new" }] },
    member: member({}),
  };
}

function autocompleteBody(query: string, guildId: string | null = GUILD_ID) {
  return {
    type: 4,
    ...(guildId !== null ? { guild_id: guildId } : {}),
    data: {
      name: "bandoff",
      options: [
        {
          name: "open",
          options: [{ name: "event", type: 3, value: query, focused: true }],
        },
      ],
    },
    member: member({}),
  };
}

function componentBody(customId: string, guildId: string | null = GUILD_ID) {
  return {
    type: 3,
    ...(guildId !== null ? { guild_id: guildId } : {}),
    data: { custom_id: customId },
    member: member({}),
  };
}

async function findEventIdBySlug(slug: string): Promise<string> {
  const db = createDb(env.DB);
  const rows = await db.select().from(eventTable).where(eq(eventTable.slug, slug));
  const id = rows[0]?.id;
  if (!id) throw new Error(`event not found for slug ${slug}`);
  return id;
}

async function countDiscordLinkRowsForEvent(eventId: string): Promise<number> {
  const db = createDb(env.DB);
  const rows = await db
    .select()
    .from(discordLink)
    .where(eq(discordLink.eventId, eventId));
  return rows.length;
}

async function countDiscordLinkRowsTotal(): Promise<number> {
  const db = createDb(env.DB);
  const rows = await db.select().from(discordLink);
  return rows.length;
}

interface MessageResponseBody {
  type: number;
  data: {
    content: string;
    components: unknown[];
    flags: number;
    allowed_mentions: { parse: unknown[] };
  };
}

function extractFragmentToken(body: MessageResponseBody): string {
  const rows = body.data.components as { components: { url?: string }[] }[];
  const url = rows[0]?.components?.[0]?.url ?? "";
  const token = url.split("#")[1];
  if (!token) throw new Error(`could not extract token from url "${url}"`);
  return token;
}

describe("POST /discord/interactions", () => {
  // D1 の分離はファイル単位のため、候補件数を見る「0件」の確認は、
  // このファイルの中で他のテストが候補イベントを作る前(=先頭)に置く。
  it("list: 候補イベントが1件もなければ固定文言を返す(このファイル最初のテストであること)", async () => {
    const response = await postInteraction(listCommandBody());
    expect(response.status).toBe(200);
    const body = (await response.json()) as MessageResponseBody;
    expect(body.data.content).toBe("Discord から開けるイベントはありません");
    expect(body.data.components).toEqual([]);
  });

  describe("コマンド無効(環境変数未設定)", () => {
    it("DISCORD_PUBLIC_KEY / DISCORD_GUILD_ID のどちらか一方でも欠けていれば404", async () => {
      env.DISCORD_GUILD_ID = "";
      const response = await postInteraction({ type: 1 });
      expect(response.status).toBe(404);

      env.DISCORD_GUILD_ID = GUILD_ID;
      env.DISCORD_PUBLIC_KEY = "";
      const response2 = await postInteraction({ type: 1 });
      expect(response2.status).toBe(404);
    });
  });

  describe("署名検証", () => {
    it("PING には署名検証を通ったうえで PONG を返す", async () => {
      const response = await postInteraction({ type: 1 });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ type: 1 });
    });

    it("署名ヘッダが無ければ401", async () => {
      const response = await postInteraction({ type: 1 }, { omitHeaders: true });
      expect(response.status).toBe(401);
    });

    it("署名が16進として不正なら401", async () => {
      const response = await postInteraction(
        { type: 1 },
        { signature: "not-hex", timestamp: String(Math.floor(Date.now() / 1000)) },
      );
      expect(response.status).toBe(401);
    });

    it("本文を変えると署名が一致せず401になる(タイムスタンプ・本文は正しい署名を別の本文に流用)", async () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = await sign(timestamp, JSON.stringify({ type: 1 }));
      const client = createTestClient();
      const response = await client.request("/discord/interactions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature-ed25519": signature,
          "x-signature-timestamp": timestamp,
        },
        body: JSON.stringify({ type: 1, tampered: true }),
      });
      expect(response.status).toBe(401);
    });

    it("タイムスタンプが±300秒を超えていれば401", async () => {
      const farPast = String(Math.floor(Date.now() / 1000) - 301);
      const response = await postInteraction({ type: 1 }, { timestamp: farPast });
      expect(response.status).toBe(401);
    });
  });

  describe("本文サイズ制限(MAX_BODY_BYTES = 64KB、2段のチェック)", () => {
    // `src/routes/discord-interactions.ts` の `MAX_BODY_BYTES` と同じ値。
    // 定数自体はエクスポートされていないため、ここでは値を直接書く。
    const MAX_BODY_BYTES = 64 * 1024;

    /**
     * `{"type":1,"pad":"..."}` という形の PING 本文を、ちょうど
     * `totalBytes` バイトになるよう組み立てる。`pad` は ASCII のみなので
     * 文字列の `.length` がそのままバイト数になり、実装側の
     * `rawBody.length` による比較と一致する。
     */
    function pingBodyOfExactLength(totalBytes: number): string {
      const overhead = JSON.stringify({ type: 1, pad: "" }).length;
      const padLength = totalBytes - overhead;
      if (padLength < 0) {
        throw new Error(
          `pingBodyOfExactLength: ${totalBytes}バイトには小さすぎる(最小${overhead}バイト)`,
        );
      }
      const body = JSON.stringify({ type: 1, pad: "x".repeat(padLength) });
      if (body.length !== totalBytes) {
        throw new Error(
          `pingBodyOfExactLength: 期待${totalBytes}バイトに対し実際は${body.length}バイト`,
        );
      }
      return body;
    }

    /** 16進文字列の1文字目を別の16進文字に変える(改ざん用、verify.test.ts と同じ方式)。 */
    function flipFirstHexChar(hex: string): string {
      const replacement = hex[0] === "0" ? "1" : "0";
      return replacement + hex.slice(1);
    }

    it("content-length ヘッダが上限を超えていれば、正しい署名・小さい本文でも本文を読む前に401になる(reason: size)", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const body = JSON.stringify({ type: 1 });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = await sign(timestamp, body);
      const client = createTestClient();
      const response = await client.request("/discord/interactions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature-ed25519": signature,
          "x-signature-timestamp": timestamp,
          // 実際の本文(上の `body`)はごく小さいが、ヘッダの申告値だけ
          // 上限を超えさせる。本文を読む前の1段目(63〜69行目付近)で
          // 弾かれることを確かめる。
          "content-length": String(MAX_BODY_BYTES + 1),
        },
        body,
      });
      expect(response.status).toBe(401);
      expect(warnSpy).toHaveBeenCalledWith("discord interaction rejected", {
        reason: "size",
      });
      warnSpy.mockRestore();
    });

    it("content-length ヘッダを偽らなくても、実際の本文が上限を超えていれば401になる(reason: size、正しい署名でも署名検証より前に弾く)", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const body = pingBodyOfExactLength(MAX_BODY_BYTES + 1);
      const timestamp = String(Math.floor(Date.now() / 1000));
      // この本文に対して実際に正しく署名する。それでも401になることで、
      // 署名検証(2段目より後)に進む前に、読み終えた本文の長さ
      // (77〜80行目付近)で弾いていることを確かめる。このテスト環境では
      // `content-length` ヘッダを明示しない限り自動では付与されないため、
      // (別テストで確認済み)1段目には掛からず2段目だけを通す。
      const signature = await sign(timestamp, body);
      const client = createTestClient();
      const response = await client.request("/discord/interactions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature-ed25519": signature,
          "x-signature-timestamp": timestamp,
        },
        body,
      });
      expect(response.status).toBe(401);
      expect(warnSpy).toHaveBeenCalledWith("discord interaction rejected", {
        reason: "size",
      });
      warnSpy.mockRestore();
    });

    it("境界: 本文がちょうど上限バイト数なら size で弾かれず、その先の署名検証まで進む", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const body = pingBodyOfExactLength(MAX_BODY_BYTES);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const validSignature = await sign(timestamp, body);
      // わざと署名を壊す。reason が "signature" になることで、2段の
      // サイズチェックをどちらも通過し、実際の署名検証まで進んだうえで
      // 失敗したことを確認できる(size で弾かれてはいない)。
      const brokenSignature = flipFirstHexChar(validSignature);
      const client = createTestClient();
      const response = await client.request("/discord/interactions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature-ed25519": brokenSignature,
          "x-signature-timestamp": timestamp,
        },
        body,
      });
      expect(response.status).toBe(401);
      expect(warnSpy).toHaveBeenCalledWith("discord interaction rejected", {
        reason: "signature",
      });
      warnSpy.mockRestore();
    });
  });

  describe("CSRF 除外", () => {
    it("Origin も Sec-Fetch-Site も無くても(正しい署名なら)403にならない", async () => {
      const response = await postInteraction({ type: 1 });
      expect(response.status).toBe(200);
    });

    it("他のパス(/e/{slug}/discord)は従来どおり Origin/Sec-Fetch-Site が無ければ403", async () => {
      const created = await createEvent({ title: "CSRF比較用イベント" });
      const client = createTestClient();
      const response = await client.request(`/e/${created.slug}/discord`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "dummy" }),
      });
      expect(response.status).toBe(403);
    });

    it("末尾スラッシュ違い(/discord/interactions/)はアプリ全体の strict: false による正規化で同じパス扱いになり、除外も効く", async () => {
      // アプリ全体が `{ strict: false }` のため、`c.req.path` は
      // ルーティングより前の段階(リクエスト解決時)で末尾スラッシュを
      // 落とす(`hono/dist/utils/url.js` の `getPathNoStrict`)。そのため
      // CSRF 除外の完全一致は `/discord/interactions/` にも効き、
      // 他の無関係なパスを誤って除外しない限りは問題ない(次のテストで
      // 前方一致になっていないことを確認する)。
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = JSON.stringify({ type: 1 });
      const signature = await sign(timestamp, body);
      const client = createTestClient();
      const response = await client.request("/discord/interactions/", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature-ed25519": signature,
          "x-signature-timestamp": timestamp,
        },
        body,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ type: 1 });
    });

    it("前方一致ではないため、prefix を共有するだけの別パスは除外されず CSRF が効く", async () => {
      const client = createTestClient();
      const response = await client.request("/discord/interactions-other", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(response.status).toBe(403);
    });
  });

  describe("サーバー制限(guild_id)", () => {
    it("別サーバーの guild_id ではコマンドがエフェメラルな拒否文言になり、トークンも発行されない", async () => {
      const created = await createEvent({ title: "他サーバー拒否テスト" });
      await setEventStartsAtOffset(created.slug, -3600);
      const eventId = await findEventIdBySlug(created.slug);

      const response = await postInteraction(openCommandBody(eventId, OTHER_GUILD_ID));
      expect(response.status).toBe(200);
      const body = (await response.json()) as MessageResponseBody;
      expect(body.data.content).toBe("このサーバーでは使えません");
      expect(body.data.flags).toBe(68);
      expect(body.data.allowed_mentions).toEqual({ parse: [] });
      expect(await countDiscordLinkRowsForEvent(eventId)).toBe(0);
    });

    it("guild_id が無い(DM)場合も同様に拒否され、オートコンプリートは空配列を返す", async () => {
      const created = await createEvent({ title: "DM拒否テスト" });
      await setEventStartsAtOffset(created.slug, -3600);
      const eventId = await findEventIdBySlug(created.slug);

      const commandResponse = await postInteraction(openCommandBody(eventId, null));
      expect(commandResponse.status).toBe(200);
      const commandBody = (await commandResponse.json()) as MessageResponseBody;
      expect(commandBody.data.content).toBe("このサーバーでは使えません");
      expect(await countDiscordLinkRowsForEvent(eventId)).toBe(0);

      const autocompleteResponse = await postInteraction(autocompleteBody("", null));
      expect(autocompleteResponse.status).toBe(200);
      expect(await autocompleteResponse.json()).toEqual({
        type: 8,
        data: { choices: [] },
      });
    });
  });

  describe("/bandoff open", () => {
    it("発行したリンクは応答URLのフラグメントのトークンで消費でき、D1には平文トークンが残らない", async () => {
      const created = await createEvent({ title: "オープンコマンド成功テスト" });
      await setEventStartsAtOffset(created.slug, -3600);
      const eventId = await findEventIdBySlug(created.slug);

      const response = await postInteraction(openCommandBody(eventId));
      expect(response.status).toBe(200);
      const body = (await response.json()) as MessageResponseBody;
      expect(body.data.flags).toBe(68);
      expect(body.data.allowed_mentions).toEqual({ parse: [] });
      expect(body.data.content).toContain("オープンコマンド成功テスト");
      expect(body.data.content).toContain("10分間・1回だけ有効");
      const token = extractFragmentToken(body);

      // D1 には平文トークンが残らない(ハッシュのみ)。
      const db = createDb(env.DB);
      const rows = await db
        .select()
        .from(discordLink)
        .where(eq(discordLink.eventId, eventId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tokenHash).not.toBe(token);

      const consumeResponse = await consumeDiscordLink(
        createTestClient(),
        created.slug,
        token,
      );
      expect(consumeResponse.status).toBe(200);
      expect(await consumeResponse.json()).toEqual({ redirect: `/e/${created.slug}/` });
    });

    it("形式が不正・存在しないイベントIDはどちらも同じ文言になる", async () => {
      const invalidFormat = await postInteraction(openCommandBody("not-a-uuid"));
      expect(invalidFormat.status).toBe(200);
      const invalidFormatBody = (await invalidFormat.json()) as MessageResponseBody;
      expect(invalidFormatBody.data.content).toBe(
        "このイベントは Discord から開けません",
      );

      const nonexistentId = await postInteraction(
        openCommandBody("00000000-0000-4000-8000-000000000000"),
      );
      expect(nonexistentId.status).toBe(200);
      const nonexistentBody = (await nonexistentId.json()) as MessageResponseBody;
      expect(nonexistentBody.data.content).toBe(
        "このイベントは Discord から開けません",
      );
    });

    it("discordEnabled オフ・開始から24時間超のイベントも同じ文言になる", async () => {
      const disabled = await createEvent({
        title: "無効イベント",
        discordEnabled: false,
      });
      await setEventStartsAtOffset(disabled.slug, -3600);
      const disabledId = await findEventIdBySlug(disabled.slug);
      const disabledResponse = await postInteraction(openCommandBody(disabledId));
      const disabledBody = (await disabledResponse.json()) as MessageResponseBody;
      expect(disabledBody.data.content).toBe("このイベントは Discord から開けません");

      const stale = await createEvent({ title: "24時間超イベント" });
      await setEventStartsAtOffset(stale.slug, -90000);
      const staleId = await findEventIdBySlug(stale.slug);
      const staleResponse = await postInteraction(openCommandBody(staleId));
      const staleBody = (await staleResponse.json()) as MessageResponseBody;
      expect(staleBody.data.content).toBe("このイベントは Discord から開けません");
    });

    it("発行のたびに期限切れの行が掃除される", async () => {
      const created = await createEvent({ title: "期限切れ掃除テスト" });
      await setEventStartsAtOffset(created.slug, -3600);
      const eventId = await findEventIdBySlug(created.slug);
      const expiredToken = await issueTestDiscordLink(created.slug, {
        expiresInSeconds: -100,
      });
      const expiredHash = await sha256Hex(expiredToken);
      expect(await countDiscordLinkRowsForEvent(eventId)).toBe(1);

      const response = await postInteraction(openCommandBody(eventId));
      expect(response.status).toBe(200);

      const db = createDb(env.DB);
      const rows = await db
        .select()
        .from(discordLink)
        .where(eq(discordLink.eventId, eventId));
      expect(rows).toHaveLength(1);
      expect(rows.some((row) => row.tokenHash === expiredHash)).toBe(false);
    });
  });

  describe("/bandoff list", () => {
    it("参加中フラグ・本文・ボタンが正しく組み立てられ、ボタン押下でリンクが発行される", async () => {
      const joinedEvent = await createEvent({ title: "参加中イベント" });
      await setEventStartsAtOffset(joinedEvent.slug, -3600);
      const joinedEventId = await findEventIdBySlug(joinedEvent.slug);

      const notJoinedEvent = await createEvent({ title: "未参加イベント" });
      await setEventStartsAtOffset(notJoinedEvent.slug, -7200);
      const notJoinedEventId = await findEventIdBySlug(notJoinedEvent.slug);

      // 参加中イベントに、実行者の Discord ID を持つ participant を作る。
      const db = createDb(env.DB);
      await db.insert(participantTable).values({
        id: crypto.randomUUID(),
        eventId: joinedEventId,
        displayName: "参加者A",
        instruments: [],
        tokenHash: await sha256Hex(crypto.randomUUID()),
        recoveryKeyHash: await sha256Hex(crypto.randomUUID()),
        discordUserId: null,
        createdAt: Math.floor(Date.now() / 1000),
      });
      const participantRow = (
        await db
          .select()
          .from(participantTable)
          .where(
            and(
              eq(participantTable.eventId, joinedEventId),
              eq(participantTable.displayName, "参加者A"),
            ),
          )
      )[0];
      if (!participantRow) throw new Error("participant not found");
      const linked = await linkDiscordUser(db, {
        eventId: joinedEventId,
        participantId: participantRow.id,
        discordUserId: USER_ID,
      });
      expect(linked).toBe(true);

      const response = await postInteraction(listCommandBody());
      expect(response.status).toBe(200);
      const body = (await response.json()) as MessageResponseBody;
      expect(body.data.flags).toBe(68);
      expect(body.data.allowed_mentions).toEqual({ parse: [] });
      expect(body.data.content).toContain("**参加中イベント** (参加中)");
      expect(body.data.content).toContain("**未参加イベント**");
      expect(body.data.content).not.toContain("未参加イベント** (参加中)");

      const rows = body.data.components as { components: { custom_id?: string }[] }[];
      const customIds = rows.flatMap((row) => row.components.map((c) => c.custom_id));
      expect(customIds).toContain(`open:${joinedEventId}`);
      expect(customIds).toContain(`open:${notJoinedEventId}`);

      // ボタン押下(MESSAGE_COMPONENT)で /bandoff open と同じリンク発行処理になる。
      const pressResponse = await postInteraction(
        componentBody(`open:${notJoinedEventId}`),
      );
      expect(pressResponse.status).toBe(200);
      const pressBody = (await pressResponse.json()) as MessageResponseBody;
      expect(pressBody.data.content).toContain("未参加イベント");
      expect(pressBody.data.content).toContain("10分間・1回だけ有効");
    });
  });

  describe("/bandoff new", () => {
    it("/new へのリンクを返し、discord_link には何も書き込まない", async () => {
      const before = await countDiscordLinkRowsTotal();
      const response = await postInteraction(newCommandBody());
      expect(response.status).toBe(200);
      const body = (await response.json()) as MessageResponseBody;
      expect(body.data.content).toBe("新しいオフ会を作成するページです");
      const rows = body.data.components as { components: { url?: string }[] }[];
      expect(rows[0]?.components[0]?.url).toBe("http://localhost/new");
      expect(await countDiscordLinkRowsTotal()).toBe(before);
    });
  });

  describe("オートコンプリート", () => {
    it("discordEnabled オフのイベントは候補に出ない", async () => {
      const created = await createEvent({
        title: "AC-MARKER-disabled オフ会",
        discordEnabled: false,
      });
      await setEventStartsAtOffset(created.slug, -3600);
      const response = await postInteraction(autocompleteBody("AC-MARKER-disabled"));
      const body = (await response.json()) as { data: { choices: unknown[] } };
      expect(body.data.choices).toEqual([]);
    });

    it("締切(closed)のイベントは候補に含まれる", async () => {
      const created = await createEvent({ title: "AC-MARKER-closed オフ会" });
      await setEventStartsAtOffset(created.slug, -3600);
      await closeEvent(created.slug);
      const eventId = await findEventIdBySlug(created.slug);
      const response = await postInteraction(autocompleteBody("AC-MARKER-closed"));
      const body = (await response.json()) as {
        data: { choices: { value: string }[] };
      };
      expect(body.data.choices.map((c) => c.value)).toEqual([eventId]);
    });

    it("value はイベントIDであり、slug を含まない", async () => {
      const created = await createEvent({ title: "AC-MARKER-idcheck オフ会" });
      await setEventStartsAtOffset(created.slug, -3600);
      const eventId = await findEventIdBySlug(created.slug);
      const response = await postInteraction(autocompleteBody("AC-MARKER-idcheck"));
      const body = (await response.json()) as {
        data: { choices: { name: string; value: string }[] };
      };
      expect(body.data.choices).toHaveLength(1);
      expect(body.data.choices[0]?.value).toBe(eventId);
      expect(body.data.choices[0]?.value).not.toBe(created.slug);
      expect(body.data.choices[0]?.name).not.toContain(created.slug);
    });

    it("候補は最大25件に切り詰められる", async () => {
      // `listDiscordCandidateEvents` の `LIMIT 25` は SQL 側(タイトルの
      // 目印で絞り込む前)にかかるため、他のテストが作った候補イベントに
      // 押し出されないよう、このテストの26件を他のどの候補よりも
      // 十分過去(ただし86400秒以内)の `starts_at` にして、常にこの
      // 26件だけが昇順の先頭を占めるようにする。
      for (let i = 0; i < 26; i++) {
        const created = await createEvent({ title: `AC-MARKER-cap オフ会${i}` });
        await setEventStartsAtOffset(created.slug, -(80000 + i));
      }
      const response = await postInteraction(autocompleteBody("AC-MARKER-cap"));
      const body = (await response.json()) as { data: { choices: unknown[] } };
      expect(body.data.choices).toHaveLength(25);
    });

    it("境界: 開始からちょうど86400秒経過は含み、86401秒経過は含まない", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const fixedNow = 2000000000;
      vi.setSystemTime(new Date(fixedNow * 1000));

      const withinBoundary = await createEvent({ title: "AC-MARKER-boundary 境界内" });
      await setEventStartsAt(withinBoundary.slug, fixedNow - 86400);
      const withinBoundaryId = await findEventIdBySlug(withinBoundary.slug);

      const pastBoundary = await createEvent({ title: "AC-MARKER-boundary 境界外" });
      await setEventStartsAt(pastBoundary.slug, fixedNow - 86401);

      const response = await postInteraction(autocompleteBody("AC-MARKER-boundary"));
      const body = (await response.json()) as {
        data: { choices: { value: string }[] };
      };
      expect(body.data.choices.map((c) => c.value)).toEqual([withinBoundaryId]);
    });
  });

  describe("ログに秘密情報が出ない", () => {
    it("console.warn / console.error の引数に Discord ID・発行したトークンの実値が含まれない", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const created = await createEvent({ title: "ログ確認用イベント" });
      await setEventStartsAtOffset(created.slug, -3600);
      const eventId = await findEventIdBySlug(created.slug);

      // 正常な open 実行(トークンが発行される)。
      const openResponse = await postInteraction(openCommandBody(eventId));
      const openBody = (await openResponse.json()) as MessageResponseBody;
      const token = extractFragmentToken(openBody);

      // 署名不正(401、reason だけがログに出る)。
      await postInteraction({ type: 1 }, { signature: "not-hex" });

      const allArgs = [...warnSpy.mock.calls, ...errorSpy.mock.calls]
        .map((call) => JSON.stringify(call))
        .join("\n");
      expect(allArgs).not.toContain(token);
      expect(allArgs).not.toContain(USER_ID);
      expect(allArgs).not.toContain(eventId);
      expect(allArgs).not.toContain(created.slug);

      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });
});
