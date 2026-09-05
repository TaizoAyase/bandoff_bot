import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { errorResponse } from "../views/pages/error";

/**
 * 有効な viewer(イベントと一致する署名 cookie を持つ)を要求する。
 * 無ければ合言葉入力画面へ誘導する。
 */
export const requireViewer: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("viewer")) {
    const slug = c.get("event")?.slug ?? "";
    return c.redirect(`/e/${slug}/join`, 303);
  }
  await next();
};

/**
 * 登録済み participant であることを要求する。
 * viewer だが未登録の場合は登録画面へ誘導する。
 */
export const requireParticipant: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("viewer")?.participant) {
    const slug = c.get("event")?.slug ?? "";
    return c.redirect(`/e/${slug}/register`, 303);
  }
  await next();
};

/**
 * 主催者フラグを要求する。無ければ、主催者ログインへのリンク付きの
 * 汎用エラーページを 403 で返す。
 */
export const requireOrganizer: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("viewer")?.isOrganizer) {
    const slug = c.get("event")?.slug ?? "";
    return errorResponse(c, 403, "主催者のみ操作できます", {
      backHref: `/e/${slug}/organizer/login`,
      backLabel: "主催者ログインへ",
    });
  }
  await next();
};

/**
 * closed のイベントでは、主催者以外の書き込みを 403 にする。
 * まだ participant を持たない viewer(未登録者の新規登録・エントリー)も
 * 対象に含める。organizer は常に通す。
 */
export const requireOpenForParticipants: MiddlewareHandler<AppEnv> = async (
  c,
  next,
) => {
  const event = c.get("event");
  const viewer = c.get("viewer");
  if (event?.status === "closed" && !viewer?.isOrganizer) {
    return c.text("Forbidden", 403);
  }
  await next();
};
