import { Hono } from "hono";
import { countRecentFailures, recordFailure } from "../db/queries/auth-failures";
import { updateEvent } from "../db/queries/events";
import { listParticipantsForExport } from "../db/queries/participants";
import { loadEventTree } from "../db/queries/songs";
import { sha256Hex, timingSafeEqual } from "../domain/crypto";
import { normalizeAccessKey } from "../domain/ids";
import { buildEventEditedContent } from "../domain/notify-event";
import { buildPasteText } from "../domain/paste-text";
import { canEditEvent } from "../domain/permissions";
import { isRateLimited, RATE_LIMIT_WINDOW_SECONDS } from "../domain/rate-limit";
import { toJstDateString, toJstTimeString } from "../domain/time";
import { validateEventEditForm } from "../domain/validation";
import type { AppEnv } from "../env";
import { requireOrganizer, requireViewer } from "../middleware/guards";
import { setSession } from "../middleware/session";
import { scheduleNotification } from "../notify/schedule";
import { errorResponse, notFoundResponse } from "../views/pages/error";
import { OrganizerPage } from "../views/pages/organizer";
import { OrganizerLoginPage } from "../views/pages/organizer-login";
import { OrganizerLoginDonePage } from "../views/pages/organizer-login-done";
import { renderPage } from "../views/render";
import { actorFromViewer } from "./actor";
import { clientIp } from "./auth";
import { formString } from "./form";

/** 主催者ログイン・イベント編集・エクスポート。 */
export const organizerApp = new Hono<AppEnv>({ strict: false });

organizerApp.get("/organizer/login", requireViewer, async (c) => {
  const event = c.get("event");
  const viewer = c.get("viewer");
  if (!event || !viewer) {
    return notFoundResponse(c);
  }
  if (viewer.isOrganizer) {
    return c.redirect(`/e/${event.slug}/organizer`, 303);
  }
  return renderPage(c, OrganizerLoginPage({ slug: event.slug }));
});

organizerApp.post("/organizer/login", requireViewer, async (c) => {
  const event = c.get("event");
  const viewer = c.get("viewer");
  if (!event || !viewer) {
    return notFoundResponse(c);
  }

  const db = c.get("db");
  const ip = clientIp(c);
  const now = Math.floor(Date.now() / 1000);
  const since = now - RATE_LIMIT_WINDOW_SECONDS;

  const counts = await countRecentFailures(db, event.id, ip, since);
  if (isRateLimited(counts)) {
    return renderPage(
      c,
      OrganizerLoginPage({
        slug: event.slug,
        error: "試行回数が多すぎます。しばらくしてから再試行してください",
      }),
      429,
    );
  }

  const body = await c.req.parseBody();
  const organizerKeyInput = formString(body.organizerKey);
  const ok = timingSafeEqual(
    await sha256Hex(normalizeAccessKey(organizerKeyInput)),
    event.organizerKeyHash,
  );
  if (!ok) {
    await recordFailure(db, event.id, ip, "organizer_key", now);
    return renderPage(
      c,
      OrganizerLoginPage({ slug: event.slug, error: "主催者キーが違います" }),
      401,
    );
  }

  await setSession(c, event.slug, {
    e: event.id,
    p: viewer.participant?.id ?? null,
    o: true,
    iat: now,
  });
  return renderPage(
    c,
    OrganizerLoginDonePage({
      slug: event.slug,
      organizerKey: organizerKeyInput.trim(),
    }),
  );
});

organizerApp.post("/organizer/logout", requireOrganizer, async (c) => {
  const event = c.get("event");
  const viewer = c.get("viewer");
  if (!event || !viewer) {
    return notFoundResponse(c);
  }
  await setSession(c, event.slug, {
    e: event.id,
    p: viewer.participant?.id ?? null,
    o: false,
  });
  return c.redirect(`/e/${event.slug}/`, 303);
});

organizerApp.get("/organizer", requireOrganizer, async (c) => {
  const event = c.get("event");
  if (!event) {
    return notFoundResponse(c);
  }
  const origin = new URL(c.req.url).origin;
  const pasteText = buildPasteText(
    origin,
    event.slug,
    event.title,
    event.startsAt,
    event.durationMinutes,
    event.place,
    event.joinCode,
  );
  return renderPage(
    c,
    OrganizerPage({
      slug: event.slug,
      values: {
        title: event.title,
        region: event.region,
        startsDate: toJstDateString(event.startsAt),
        startsTime: toJstTimeString(event.startsAt),
        durationMinutes:
          event.durationMinutes === null ? "" : String(event.durationMinutes),
        place: event.place,
        notes: event.notes ?? "",
        status: event.status,
      },
      errors: {},
      joinCode: event.joinCode,
      pasteText,
    }),
  );
});

organizerApp.post("/organizer/event", requireOrganizer, async (c) => {
  const event = c.get("event");
  const viewer = c.get("viewer");
  if (!event || !viewer) {
    return notFoundResponse(c);
  }
  if (!canEditEvent(actorFromViewer(viewer)).ok) {
    return errorResponse(c, 403, "主催者のみイベント情報を編集できます");
  }

  const body = await c.req.parseBody();
  const input = {
    title: formString(body.title),
    region: formString(body.region),
    startsDate: formString(body.startsDate),
    startsTime: formString(body.startsTime),
    durationMinutes: formString(body.durationMinutes),
    place: formString(body.place),
    notes: formString(body.notes),
    status: formString(body.status),
  };

  const result = validateEventEditForm(input);
  if (!result.ok) {
    const origin = new URL(c.req.url).origin;
    const pasteText = buildPasteText(
      origin,
      event.slug,
      event.title,
      event.startsAt,
      event.durationMinutes,
      event.place,
      event.joinCode,
    );
    return renderPage(
      c,
      OrganizerPage({
        slug: event.slug,
        values: input,
        errors: result.errors,
        joinCode: event.joinCode,
        pasteText,
      }),
      400,
    );
  }

  const db = c.get("db");
  const now = Math.floor(Date.now() / 1000);
  // 通知の「変更前」は更新前にここで確定させる(event は更新前の値のまま)。
  const before = {
    title: event.title,
    region: event.region,
    startsAt: event.startsAt,
    durationMinutes: event.durationMinutes,
    place: event.place,
    notes: event.notes ?? "",
    status: event.status,
  };
  const after = result.value;

  await updateEvent(db, event.id, { ...result.value, updatedAt: now });

  scheduleNotification(c, async () => buildEventEditedContent({ before, after }));

  return c.redirect(`/e/${event.slug}/organizer`, 303);
});

organizerApp.get("/export.json", requireOrganizer, async (c) => {
  const event = c.get("event");
  if (!event) {
    return notFoundResponse(c);
  }
  const db = c.get("db");
  // 取りやめ・削除済みの参加者も `leftAt` 付きで含める(計画4-2)。
  // 曲の `proposedBy` 等が参照しているため、バックアップとして参照先を
  // 欠かさないための例外。
  const participants = await listParticipantsForExport(db, event.id);
  const songs = await loadEventTree(db, event.id);

  // join_code と organizer_key_hash(合言葉・主催者キーのハッシュ)は含めない。
  // participants / songs はそれぞれ token_hash・recovery_key_hash を持たない
  // 形で既に取得している(listParticipantsForExport / loadEventTree を参照)。
  const data = {
    event: {
      id: event.id,
      workspaceId: event.workspaceId,
      slug: event.slug,
      title: event.title,
      region: event.region,
      startsAt: event.startsAt,
      durationMinutes: event.durationMinutes,
      place: event.place,
      notes: event.notes,
      status: event.status,
      organizerParticipantId: event.organizerParticipantId,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    },
    participants,
    songs,
  };

  const filename = `bandoff-${event.slug.slice(0, 8)}.json`;
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
});
