import { env } from "cloudflare:test";
import { asc, eq } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { event as eventTable, slot, song, take } from "../src/db/schema";
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
  /** 現在 jar に保持している Cookie ヘッダの値。 */
  cookieHeader(): string | undefined;
}

/**
 * cookie jar 付きの `app.request` ラッパを作る。
 * `post()` は CSRF 対策(Origin 検査)を通すため Origin ヘッダを自動で付ける。
 */
export function createTestClient(): TestClient {
  const jar = new Map<string, string>();

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
    const response = await app.request(path, { ...init, headers }, env);
    absorbSetCookies(response);
    return response;
  }

  function get(path: string, init: RequestInit = {}): Promise<Response> {
    return request(path, { ...init, method: "GET" });
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
    let finalBody: BodyInit | undefined;
    if (
      body === undefined ||
      typeof body === "string" ||
      body instanceof URLSearchParams ||
      body instanceof FormData
    ) {
      finalBody = body;
    } else {
      finalBody = new URLSearchParams(body);
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/x-www-form-urlencoded");
      }
    }
    return request(path, { ...init, method: "POST", headers, body: finalBody });
  }

  return { request, get, post, cookieHeader };
}

function extractDataAttr(html: string, attr: string): string | null {
  const match = new RegExp(`${attr}="([^"]*)"`).exec(html);
  return match?.[1] ?? null;
}

export interface CreateEventOptions {
  title?: string;
  region?: string;
  startsAt?: string;
  place?: string;
  notes?: string;
  joinCode?: string;
  organizerPassword?: string;
  organizerDisplayName?: string;
  organizerInstruments?: string;
}

export interface CreatedEvent {
  /** イベント作成に使ったクライアント。主催者 cookie(o:true)を持つ。 */
  client: TestClient;
  slug: string;
  joinCode: string;
  organizerPassword: string;
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
  const values = {
    title: options.title ?? "テストオフ会",
    region: options.region ?? "東京",
    startsAt: options.startsAt ?? "2026-09-05T19:00",
    place: options.place ?? "スタジオA",
    notes: options.notes ?? "",
    joinCode: options.joinCode ?? "himitsu",
    organizerPassword: options.organizerPassword ?? "hunter2",
    organizerDisplayName: options.organizerDisplayName ?? "主催者",
    organizerInstruments: options.organizerInstruments ?? "Gt",
  };
  const response = await client.post("/new", values);
  const html = await response.text();
  const slug = extractDataAttr(html, "data-slug");
  const token = extractDataAttr(html, "data-token");
  const recoveryKey = extractDataAttr(html, "data-recovery-key");
  if (!slug || !token || !recoveryKey) {
    throw new Error(
      `createEvent: failed to parse welcome page (status=${response.status})`,
    );
  }
  return {
    client,
    slug,
    joinCode: values.joinCode,
    organizerPassword: values.organizerPassword,
    token,
    recoveryKey,
    response,
    html,
  };
}

/**
 * 合言葉で `/e/:slug/join` に POST し、viewer cookie を持つクライアントを返す。
 * `client` を渡さなければ新しいクライアント(cookie なし)を使う。
 */
export async function joinAsViewer(
  slug: string,
  joinCode: string,
  client: TestClient = createTestClient(),
): Promise<TestClient> {
  const response = await client.post(`/e/${slug}/join`, { joinCode });
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
  const response = await client.post(`/e/${slug}/participants`, body);
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
  return client.post(`/e/${slug}/songs`, params);
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

/** `/e/:slug/organizer/login` に POST して主催者フラグを立てる。 */
export async function loginAsOrganizer(
  client: TestClient,
  slug: string,
  organizerPassword: string,
): Promise<Response> {
  return client.post(`/e/${slug}/organizer/login`, { password: organizerPassword });
}

/** イベントの `status` を直接 "closed" に更新する(DB を直接操作)。 */
export async function closeEvent(slug: string): Promise<void> {
  const db = createDb(env.DB);
  await db
    .update(eventTable)
    .set({ status: "closed" })
    .where(eq(eventTable.slug, slug));
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
