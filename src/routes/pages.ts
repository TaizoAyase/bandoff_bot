import { Hono } from "hono";
import { loadEventTree } from "../db/queries/songs";
import type { AppEnv } from "../env";
import { requireViewer } from "../middleware/guards";
import { SongListItems } from "../views/components/song-list-items";
import { parseSongListNotice, SongListPage } from "../views/pages/song-list";
import { renderPage } from "../views/render";

/** 曲一覧(メイン画面)とポーリング用の HTML 断片。 */
export const pagesApp = new Hono<AppEnv>({ strict: false });

pagesApp.get("/", requireViewer, async (c) => {
  const event = c.get("event");
  const viewer = c.get("viewer");
  if (!event || !viewer) {
    return c.text("Not Found", 404);
  }
  const db = c.get("db");
  const songs = await loadEventTree(db, event.id);
  return renderPage(
    c,
    SongListPage({
      slug: event.slug,
      songs,
      currentParticipantId: viewer.participant?.id ?? null,
      notice: parseSongListNotice(c.req.query("notice")),
    }),
  );
});

/**
 * 曲一覧の HTML 断片(`#song-list` の中身のみ)。ポーリングから叩かれる。
 * `requireViewer` は使わない(303 リダイレクトではなく401を返すため)。
 */
pagesApp.get("/fragments/songs", async (c) => {
  const event = c.get("event");
  const viewer = c.get("viewer");
  if (!event) {
    return c.text("Not Found", 404);
  }
  if (!viewer) {
    return c.text("Unauthorized", 401);
  }
  const db = c.get("db");
  const songs = await loadEventTree(db, event.id);
  const body = await SongListItems({
    slug: event.slug,
    songs,
    currentParticipantId: viewer.participant?.id ?? null,
  });
  return c.html(body, 200, { "Cache-Control": "no-store" });
});
