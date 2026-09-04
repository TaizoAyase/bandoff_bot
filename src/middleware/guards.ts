import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";

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

/** 主催者フラグを要求する。無ければ 403。 */
export const requireOrganizer: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("viewer")?.isOrganizer) {
    return c.text("Forbidden", 403);
  }
  await next();
};

/**
 * closed のイベントでは participant による書き込みを 403 にする。
 * organizer は常に通す。
 */
export const requireOpenForParticipants: MiddlewareHandler<AppEnv> = async (
  c,
  next,
) => {
  const event = c.get("event");
  const viewer = c.get("viewer");
  if (event?.status === "closed" && viewer?.participant && !viewer.isOrganizer) {
    return c.text("Forbidden", 403);
  }
  await next();
};
