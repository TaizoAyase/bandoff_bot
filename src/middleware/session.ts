import { eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { participant as participantTable } from "../db/schema";
import type { AppEnv } from "../env";

const COOKIE_NAME = "bandoff_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 180; // 180日

export interface SessionPayload {
  v: 1;
  /** event id */
  e: string;
  /** participant id(未登録の viewer は null) */
  p: string | null;
  /** 主催者フラグ */
  o: boolean;
  iat: number;
}

export type SetSessionInput = Omit<SessionPayload, "v" | "iat"> &
  Partial<Pick<SessionPayload, "iat">>;

function cookiePath(slug: string): string {
  return `/e/${slug}`;
}

function isHttps(c: Context): boolean {
  return new URL(c.req.url).protocol === "https:";
}

/**
 * イベントスコープの署名 cookie を設定する。
 * `Path=/e/{slug}`、httpOnly、SameSite=Lax、Max-Age 180日。
 * Secure は https のリクエストのときだけ付ける(ローカル http 開発を通すため)。
 */
export async function setSession(
  c: Context<AppEnv>,
  slug: string,
  payload: SetSessionInput,
): Promise<void> {
  const value: SessionPayload = {
    v: 1,
    e: payload.e,
    p: payload.p,
    o: payload.o,
    iat: payload.iat ?? Math.floor(Date.now() / 1000),
  };
  await setSignedCookie(c, COOKIE_NAME, JSON.stringify(value), c.env.SESSION_SECRET, {
    path: cookiePath(slug),
    httpOnly: true,
    sameSite: "Lax",
    maxAge: MAX_AGE_SECONDS,
    secure: isHttps(c),
  });
}

/** イベントスコープの署名 cookie を破棄する。 */
export function clearSession(c: Context<AppEnv>, slug: string): void {
  deleteCookie(c, COOKIE_NAME, { path: cookiePath(slug) });
}

/**
 * 署名 cookie を読み、`c.get("event")` と一致すれば `c.set("viewer", ...)` する。
 * cookie が無い・壊れている・署名が不正・イベントが一致しない・participant が
 * 見つからない場合は viewer を設定しない(エラーにはしない。書き込み要求の
 * 拒否は guards.ts が担当する)。
 */
export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const event = c.get("event");
  if (!event) {
    await next();
    return;
  }

  const raw = await getSignedCookie(c, c.env.SESSION_SECRET, COOKIE_NAME);
  if (!raw) {
    await next();
    return;
  }

  const payload = parsePayload(raw);
  if (!payload || payload.e !== event.id) {
    await next();
    return;
  }

  let resolvedParticipant = null;
  if (payload.p) {
    const rows = await c
      .get("db")
      .select()
      .from(participantTable)
      .where(eq(participantTable.id, payload.p))
      .limit(1);
    const found = rows[0] ?? null;
    // 取りやめ・削除済み(`left_at` あり)の participant は cookie が
    // 残っていても解決しない(計画4-2)。viewer 自体は残すので、
    // 主催者フラグでの合言葉閲覧は続けられる。
    resolvedParticipant =
      found && found.eventId === event.id && found.leftAt === null ? found : null;
  }

  c.set("viewer", { participant: resolvedParticipant, isOrganizer: payload.o });
  await next();
};

function parsePayload(raw: string): SessionPayload | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (
      typeof data === "object" &&
      data !== null &&
      "v" in data &&
      "e" in data &&
      "p" in data &&
      "o" in data &&
      "iat" in data &&
      (data as { v: unknown }).v === 1 &&
      typeof (data as { e: unknown }).e === "string" &&
      (typeof (data as { p: unknown }).p === "string" ||
        (data as { p: unknown }).p === null) &&
      typeof (data as { o: unknown }).o === "boolean" &&
      typeof (data as { iat: unknown }).iat === "number"
    ) {
      return data as SessionPayload;
    }
    return null;
  } catch {
    return null;
  }
}
