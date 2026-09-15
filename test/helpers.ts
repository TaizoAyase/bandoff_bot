import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { asc, eq } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { discordLink, event as eventTable, slot, song, take } from "../src/db/schema";
import { sha256Hex } from "../src/domain/crypto";
import app from "../src/index";

const ORIGIN = "http://localhost";

export type PostBody =
  | string
  | URLSearchParams
  | FormData
  | Record<string, string>
  | undefined;

export interface TestClient {
  /** cookie jar を維持したまま任意のメソッドでリクエストする。 */
  request(path: string, init?: RequestInit): Promise<Response>;
  /** GET リクエスト。 */
  get(path: string, init?: RequestInit): Promise<Response>;
  /** POST リクエスト。Origin ヘッダを自動で付与する。 */
  post(path: string, body?: PostBody, init?: RequestInit): Promise<Response>;
  /**
   * ブラウザの `<form method="post">` によるナビゲーションを模した POST。
   * `Referrer-Policy: no-referrer` の下では Origin が `null` になり、
   * 代わりに `Sec-Fetch-Site: same-origin` が送られる(実ブラウザの挙動)。
   */
  postAsBrowserForm(
    path: string,
    body?: PostBody,
    init?: RequestInit,
  ): Promise<Response>;
  /** 現在 jar に保持している Cookie ヘッダの値。 */
  cookieHeader(): string | undefined;
  /**
   * 直近のリクエストに使った `ExecutionContext`。`waitUntil()` された
   * Promise(Discord 通知の fire-and-forget 送信など)の完了を
   * `waitOnExecutionContext` で待ちたいテストのために公開する。
   * 一度もリクエストしていない場合は `undefined`。
   */
  lastExecutionContext(): ExecutionContext | undefined;
}

/**
 * cookie jar 付きの `app.request` ラッパを作る。
 * `post()` は CSRF 対策(Origin 検査)を通すため Origin ヘッダを自動で付ける。
 */
export function createTestClient(): TestClient {
  const jar = new Map<string, string>();
  let lastCtx: ExecutionContext | undefined;

  function cookieHeader(): string | undefined {
    if (jar.size === 0) {
      return undefined;
    }
    return Array.from(jar.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  function absorbSetCookies(response: Response): void {
    for (const raw of response.headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(";");
      if (!pair) continue;
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((attr) => /^\s*max-age=0\s*$/i.test(attr));
      if (expired) {
        jar.delete(name);
      } else {
        jar.set(name, value);
      }
    }
  }

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const cookie = cookieHeader();
    if (cookie) {
      headers.set("cookie", cookie);
    }
    // 本物の Workers ランタイムと同様に `executionCtx` を渡す。渡さないと
    // `c.executionCtx` が throw し、`waitUntil()` を使うフック(Discord 通知
    // など)がテストから検証できない。
    const ctx = createExecutionContext();
    lastCtx = ctx;
    const response = await app.request(path, { ...init, headers }, env, ctx);
    absorbSetCookies(response);
    // `waitUntil()` された Promise(Discord 通知の fire-and-forget 送信など)
    // をここで待ち切っておく。呼び出し側が明示的に `flushNotifications`
    // 相当を呼ばなくても、次のリクエストを送る時点で前のリクエストの通知が
    // 必ず完了済みになる(未完了なら 0 件、というテストの取りこぼしを防ぐ)。
    // 保留中の Promise が無ければ安価な no-op。
    await waitOnExecutionContext(ctx);
    return response;
  }

  function get(path: string, init: RequestInit = {}): Promise<Response> {
    return request(path, { ...init, method: "GET" });
  }

  function buildPostBody(body: PostBody, headers: Headers): BodyInit | undefined {
    if (
      body === undefined ||
      typeof body === "string" ||
      body instanceof URLSearchParams ||
      body instanceof FormData
    ) {
      return body;
    }
    const finalBody = new URLSearchParams(body);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/x-www-form-urlencoded");
    }
    return finalBody;
  }

  function post(
    path: string,
    body?: PostBody,
    init: RequestInit = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    if (!headers.has("origin")) {
      headers.set("origin", ORIGIN);
    }
    const finalBody = buildPostBody(body, headers);
    return request(path, { ...init, method: "POST", headers, body: finalBody });
  }

  function postAsBrowserForm(
    path: string,
    body?: PostBody,
    init: RequestInit = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("origin", "null");
    headers.set("sec-fetch-site", "same-origin");
    const finalBody = buildPostBody(body, headers);
    return request(path, { ...init, method: "POST", headers, body: finalBody });
  }

  function lastExecutionContext(): ExecutionContext | undefined {
    return lastCtx;
  }

  return {
    request,
    get,
    post,
    postAsBrowserForm,
    cookieHeader,
    lastExecutionContext,
  };
}

function extractDataAttr(html: string, attr: string): string | null {
  const match = new RegExp(`${attr}="([^"]*)"`).exec(html);
  return match?.[1] ?? null;
}

export interface CreateEventOptions {
  title?: string;
  region?: string;
  /** `<input type="date" name="startsDate">` の値。省略時は "2026-09-05"。 */
  startsDate?: string;
  /** `<select name="startsTime">` の値。省略時は "19:00"。 */
  startsTime?: string;
  /** `<select name="durationMinutes">` の値。省略時は送らない(未設定扱い)。 */
  durationMinutes?: string;
  place?: string;
  notes?: string;
  joinCode?: string;
  organizerDisplayName?: string;
  organizerInstruments?: string;
  /** true の場合、`postAsBrowserForm` でブラウザのフォーム送信を模す。 */
  useBrowserForm?: boolean;
  /**
   * Discord の /bandoff コマンドから開けるようにするか。省略時は
   * `/new` の既定値(オン)に合わせて true として送信する
   * (チェックボックスは false のときキー自体を送らない)。
   */
  discordEnabled?: boolean;
}

export interface CreatedEvent {
  /** イベント作成に使ったクライアント。主催者 cookie(o:true)を持つ。 */
  client: TestClient;
  slug: string;
  joinCode: string;
  /** 主催者キー(平文)。作成直後の welcome ページから取得する。 */
  organizerKey: string;
  /** 主催者の端末トークン(平文)。 */
  token: string;
  /** 主催者の復帰キー(平文)。 */
  recoveryKey: string;
  /** POST /new のレスポンス(welcome ページ)。 */
  response: Response;
  html: string;
}

/**
 * POST /new でイベントを作成する。返る `client` は主催者 cookie を持つ。
 */
export async function createEvent(
  options: CreateEventOptions = {},
): Promise<CreatedEvent> {
  const client = createTestClient();
  const values: {
    title: string;
    region: string;
    startsDate: string;
    startsTime: string;
    durationMinutes: string;
    place: string;
    notes: string;
    joinCode: string;
    organizerDisplayName: string;
    organizerInstruments: string;
    discordEnabled?: string;
  } = {
    title: options.title ?? "テストオフ会",
    region: options.region ?? "東京",
    startsDate: options.startsDate ?? "2026-09-05",
    startsTime: options.startsTime ?? "19:00",
    durationMinutes: options.durationMinutes ?? "",
    place: options.place ?? "スタジオA",
    notes: options.notes ?? "",
    joinCode: options.joinCode ?? "himitsu",
    organizerDisplayName: options.organizerDisplayName ?? "主催者",
    organizerInstruments: options.organizerInstruments ?? "Gt",
  };
  // チェックボックスは未チェックだとキー自体が送られてこないため、
  // オフにしたいときだけキーを省く(既定はオン、`/new` と同じ挙動)。
  if (options.discordEnabled ?? true) {
    values.discordEnabled = "on";
  }
  const submit = options.useBrowserForm ? client.postAsBrowserForm : client.post;
  const response = await submit("/new", values);
  const html = await response.text();
  const slug = extractDataAttr(html, "data-slug");
  const token = extractDataAttr(html, "data-token");
  const recoveryKey = extractDataAttr(html, "data-recovery-key");
  const organizerKey = extractDataAttr(html, "data-organizer-key");
  if (!slug || !token || !recoveryKey || !organizerKey) {
    throw new Error(
      `createEvent: failed to parse welcome page (status=${response.status})`,
    );
  }
  return {
    client,
    slug,
    joinCode: values.joinCode,
    organizerKey,
    token,
    recoveryKey,
    response,
    html,
  };
}

/**
 * 合言葉で `/e/:slug/join` に POST し、viewer cookie を持つクライアントを返す。
 * `client` を渡さなければ新しいクライアント(cookie なし)を使う。
 * `useBrowserForm` を true にすると `postAsBrowserForm` でブラウザのフォーム
 * 送信を模す。
 */
export async function joinAsViewer(
  slug: string,
  joinCode: string,
  client: TestClient = createTestClient(),
  useBrowserForm = false,
): Promise<TestClient> {
  const submit = useBrowserForm ? client.postAsBrowserForm : client.post;
  const response = await submit(`/e/${slug}/join`, { joinCode });
  if (response.status !== 303) {
    throw new Error(`joinAsViewer failed with status ${response.status}`);
  }
  return client;
}

export interface RegisterParticipantOptions {
  displayName?: string;
  instruments?: string;
  slot?: string;
  confirm?: boolean;
  /** true の場合、`postAsBrowserForm` でブラウザのフォーム送信を模す。 */
  useBrowserForm?: boolean;
}

/** `/e/:slug/participants` に POST して参加者登録する。 */
export async function registerParticipant(
  client: TestClient,
  slug: string,
  options: RegisterParticipantOptions = {},
): Promise<{ response: Response; html: string }> {
  const body: Record<string, string> = {
    displayName: options.displayName ?? "山田",
    instruments: options.instruments ?? "",
    slot: options.slot ?? "",
  };
  if (options.confirm) {
    body.confirm = "1";
  }
  const submit = options.useBrowserForm ? client.postAsBrowserForm : client.post;
  const response = await submit(`/e/${slug}/participants`, body);
  const html = await response.text();
  return { response, html };
}

export interface CreateSongOptions {
  title?: string;
  artist?: string;
  refUrl?: string;
  songKey?: string;
  notes?: string;
  instruments?: string[];
  /** true の場合、`postAsBrowserForm` でブラウザのフォーム送信を模す。 */
  useBrowserForm?: boolean;
}

/** `/e/:slug/songs` に POST して曲を登録する(participant の client で呼ぶこと)。 */
export async function createSong(
  client: TestClient,
  slug: string,
  options: CreateSongOptions = {},
): Promise<Response> {
  const instruments = options.instruments ?? ["Gt", "Gt", "Ba", "Dr", "Vo"];
  const params = new URLSearchParams();
  params.set("title", options.title ?? "テスト曲");
  params.set("artist", options.artist ?? "");
  params.set("refUrl", options.refUrl ?? "");
  params.set("songKey", options.songKey ?? "");
  params.set("notes", options.notes ?? "");
  for (const instrument of instruments) {
    params.append("instrument", instrument);
  }
  const submit = options.useBrowserForm ? client.postAsBrowserForm : client.post;
  return submit(`/e/${slug}/songs`, params);
}

/**
 * イベント内の最初の曲・Take1 の枠 id を sort_order 順にすべて取得する。
 * join/leave のテストで枠 id が必要なときに使う。
 */
export async function findFirstSongSlotIds(slug: string): Promise<string[]> {
  const { takeId } = await findFirstSongAndTakeId(slug);
  const db = createDb(env.DB);
  const slotRows = await db
    .select()
    .from(slot)
    .where(eq(slot.takeId, takeId))
    .orderBy(asc(slot.sortOrder));
  return slotRows.map((s) => s.id);
}

/** イベント内の最初の曲の id と、その Take1 の id を取得する。 */
export async function findFirstSongAndTakeId(
  slug: string,
): Promise<{ songId: string; takeId: string }> {
  const db = createDb(env.DB);
  const eventRows = await db.select().from(eventTable).where(eq(eventTable.slug, slug));
  const eventId = eventRows[0]?.id;
  if (!eventId) {
    throw new Error(`findFirstSongAndTakeId: event not found for slug ${slug}`);
  }
  const songRows = await db
    .select()
    .from(song)
    .where(eq(song.eventId, eventId))
    .orderBy(asc(song.createdAt), asc(song.id));
  const songId = songRows[0]?.id;
  if (!songId) {
    throw new Error("findFirstSongAndTakeId: no song found for event");
  }
  const takeRows = await db
    .select()
    .from(take)
    .where(eq(take.songId, songId))
    .orderBy(asc(take.sortOrder), asc(take.id));
  const takeId = takeRows[0]?.id;
  if (!takeId) {
    throw new Error("findFirstSongAndTakeId: no take found for song");
  }
  return { songId, takeId };
}

/** `POST /songs` のリダイレクト先(`/e/:slug/#song-{id}`)から曲 id を取り出す。 */
export function extractSongId(response: Response): string {
  const location = response.headers.get("location") ?? "";
  const match = /#song-(.+)$/.exec(location);
  const id = match?.[1];
  if (!id) {
    throw new Error(`extractSongId: could not parse song id from "${location}"`);
  }
  return id;
}

/**
 * `/e/:slug/organizer/login` に POST して主催者フラグを立てる。
 * 成功時は login-done ページ(200、`data-organizer-key` を含む)が返る。
 */
export async function loginAsOrganizer(
  client: TestClient,
  slug: string,
  organizerKey: string,
): Promise<Response> {
  return client.post(`/e/${slug}/organizer/login`, { organizerKey });
}

/** イベントの `status` を直接 "closed" に更新する(DB を直接操作)。 */
export async function closeEvent(slug: string): Promise<void> {
  const db = createDb(env.DB);
  await db
    .update(eventTable)
    .set({ status: "closed" })
    .where(eq(eventTable.slug, slug));
}

/**
 * イベントの `starts_at` を直接 DB に書き込む(DB を直接操作)。
 * `datetime-local` 時代に作られた15分刻みでない値(旧データ)を
 * 再現するために使う。
 */
export async function setEventStartsAt(slug: string, startsAt: number): Promise<void> {
  const db = createDb(env.DB);
  await db.update(eventTable).set({ startsAt }).where(eq(eventTable.slug, slug));
}

/**
 * イベントの `starts_at` を「実行時の現在時刻から `offsetSeconds` 秒」に
 * 設定する(DB を直接操作)。`createEvent()` の既定の開催日は固定値
 * (`2026-09-05`)のため、Discord 候補イベント(`isPast24h` が false、
 * 計画4-4)のテストでは、実行時の「現在」から見て24時間以内とは限らない。
 * 戻り値は実際に設定した `starts_at`(呼び出し側で境界計算に使える)。
 */
export async function setEventStartsAtOffset(
  slug: string,
  offsetSeconds: number,
): Promise<number> {
  const startsAt = Math.floor(Date.now() / 1000) + offsetSeconds;
  await setEventStartsAt(slug, startsAt);
  return startsAt;
}

/** `/e/:slug/songs/:id/takes` に POST して Take を追加する。 */
export function createTake(
  client: TestClient,
  slug: string,
  songId: string,
): Promise<Response> {
  return client.post(`/e/${slug}/songs/${songId}/takes`);
}

export interface CreateSlotOptions {
  instrument?: string;
  note?: string;
}

export interface IssueTestDiscordLinkOptions {
  /** Discord のユーザー ID(スノーフレーク)。省略時は固定のテスト用 ID。 */
  discordUserId?: string;
  displayNameHint?: string;
  /** 有効期限までの秒数。省略時は600秒(計画2章の既定)。 */
  expiresInSeconds?: number;
  /** 使用済みにする場合の使用日時(秒)。省略時は未使用。 */
  usedAt?: number;
}

/**
 * `discord_link` に1行を直接 INSERT してテスト用の1回限りリンクを発行する。
 * 発行コマンド(`/bandoff open` 等、Interactions エンドポイント)は
 * Stage 3 で実装するため、ここでは D1 に直接書き込んで模す。
 * 返り値は平文トークン(`/e/:slug/discord` への POST に使う)。
 */
export async function issueTestDiscordLink(
  slug: string,
  options: IssueTestDiscordLinkOptions = {},
): Promise<string> {
  const db = createDb(env.DB);
  const eventRows = await db.select().from(eventTable).where(eq(eventTable.slug, slug));
  const eventId = eventRows[0]?.id;
  if (!eventId) {
    throw new Error(`issueTestDiscordLink: event not found for slug ${slug}`);
  }
  const token = crypto.randomUUID();
  const tokenHash = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1000);
  await db.insert(discordLink).values({
    tokenHash,
    eventId,
    discordUserId: options.discordUserId ?? "100000000000000001",
    displayNameHint: options.displayNameHint ?? "Discordニックネーム",
    expiresAt: now + (options.expiresInSeconds ?? 600),
    usedAt: options.usedAt ?? null,
  });
  return token;
}

/**
 * `/e/:slug/discord` にトークンを JSON で POST する
 * (クライアント JS の `fetch` を模す)。
 */
export function consumeDiscordLink(
  client: TestClient,
  slug: string,
  token: string,
): Promise<Response> {
  return client.post(`/e/${slug}/discord`, JSON.stringify({ token }), {
    headers: { "content-type": "application/json" },
  });
}

/** `/e/:slug/takes/:id/slots` に POST して枠を追加する。 */
export function createSlot(
  client: TestClient,
  slug: string,
  takeId: string,
  options: CreateSlotOptions = {},
): Promise<Response> {
  return client.post(`/e/${slug}/takes/${takeId}/slots`, {
    instrument: options.instrument ?? "Cho",
    note: options.note ?? "",
  });
}
