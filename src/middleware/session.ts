import { eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { participant as participantTable } from "../db/schema";
import { isValidDiscordSnowflake } from "../domain/discord";
import { LIMITS } from "../domain/validation";
import type { AppEnv, PendingDiscordLink } from "../env";

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
  /**
   * 保留中の Discord 紐付け候補のユーザー ID。無ければキー自体を省略する
   * (旧 cookie との互換のため、存在チェックは `in` で行う)。
   */
  d?: string;
  /** 上記に対応する、発行時点での既定表示名ヒント。 */
  dn?: string;
}

export type SetSessionInput = Omit<SessionPayload, "v" | "iat" | "d" | "dn"> &
  Partial<Pick<SessionPayload, "iat">> & {
    /**
     * 保留中の Discord 紐付け候補。呼び出しのたびに明示させることで、
     * 「引き継ぐ/消す」の書き漏らしを防ぐ(計画5-1)。引き継ぐ場合は
     * 現在の `viewer?.pendingDiscord ?? null` をそのまま渡すこと。
     */
    pendingDiscord: PendingDiscordLink | null;
  };

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
    ...(payload.pendingDiscord
      ? { d: payload.pendingDiscord.userId, dn: payload.pendingDiscord.nameHint }
      : {}),
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

  const pendingDiscord: PendingDiscordLink | null =
    payload.d !== undefined ? { userId: payload.d, nameHint: payload.dn ?? "" } : null;

  c.set("viewer", {
    participant: resolvedParticipant,
    isOrganizer: payload.o,
    pendingDiscord,
  });
  await next();
};

function parsePayload(raw: string): SessionPayload | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (
      typeof data !== "object" ||
      data === null ||
      !("v" in data) ||
      !("e" in data) ||
      !("p" in data) ||
      !("o" in data) ||
      !("iat" in data) ||
      (data as { v: unknown }).v !== 1 ||
      typeof (data as { e: unknown }).e !== "string" ||
      (typeof (data as { p: unknown }).p !== "string" &&
        (data as { p: unknown }).p !== null) ||
      typeof (data as { o: unknown }).o !== "boolean" ||
      typeof (data as { iat: unknown }).iat !== "number"
    ) {
      return null;
    }

    // `d`/`dn` は後から追加したキーなので、無い旧 cookie は引き続き有効と
    // 扱う。ただしキーがあるのに形式が不正なら cookie 全体を無効にする
    // (計画5-1)。
    if ("d" in data) {
      const d = (data as { d: unknown }).d;
      if (typeof d !== "string" || !isValidDiscordSnowflake(d)) {
        return null;
      }
    }
    if ("dn" in data) {
      const dn = (data as { dn: unknown }).dn;
      if (typeof dn !== "string" || dn.length > LIMITS.DISPLAY_NAME_MAX) {
        return null;
      }
    }

    return data as SessionPayload;
  } catch {
    return null;
  }
}
