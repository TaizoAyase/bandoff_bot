import { Hono } from "hono";
import {
  deleteSlot,
  findSlotLabelInfo,
  findSlotWithContext,
} from "../db/queries/assignments";
import {
  countSlots,
  countTakes,
  createSlot,
  createTakeFromFirst,
  deleteTake,
  findSongContext,
  findTakeOrdinal,
  findTakeWithContext,
} from "../db/queries/songs";
import { buildSlotAddedContent } from "../domain/notify-slot";
import { buildTakeAddedContent } from "../domain/notify-song";
import {
  canAddSlot,
  canAddTake,
  canDeleteSlot,
  canDeleteTake,
} from "../domain/permissions";
import { LIMITS, validateSlotForm } from "../domain/validation";
import type { AppEnv } from "../env";
import {
  requireOpenForParticipants,
  requireParticipant,
  requireViewer,
} from "../middleware/guards";
import { scheduleNotification } from "../notify/schedule";
import { errorResponse, notFoundResponse } from "../views/pages/error";
import { emptySlotFormValues, SlotFormPage } from "../views/pages/slot-form";
import { renderPage } from "../views/render";
import { actorFromViewer } from "./actor";
import { formString } from "./form";

/** Take・Slot の構造的な追加・削除(枠の構成そのものを増減する操作)。 */
export const takesApp = new Hono<AppEnv>({ strict: false });

takesApp.post(
  "/songs/:id/takes",
  requireViewer,
  requireParticipant,
  requireOpenForParticipants,
  async (c) => {
    const event = c.get("event");
    const viewer = c.get("viewer");
    if (!event || !viewer?.participant) {
      return notFoundResponse(c);
    }
    if (!canAddTake(actorFromViewer(viewer)).ok) {
      return errorResponse(c, 403, "Take を追加する権限がありません");
    }

    const db = c.get("db");
    const songId = c.req.param("id");
    const songContext = await findSongContext(db, songId);
    if (!songContext || songContext.eventId !== event.id) {
      return notFoundResponse(c);
    }

    const existingCount = await countTakes(db, songId);
    if (existingCount >= LIMITS.MAX_TAKES_PER_SONG) {
      return errorResponse(c, 400, `Take は${LIMITS.MAX_TAKES_PER_SONG}個までです`);
    }

    const now = Math.floor(Date.now() / 1000);
    const result = await createTakeFromFirst(db, {
      songId,
      createdBy: viewer.participant.id,
      now,
    });
    if (!result) {
      return notFoundResponse(c);
    }

    const actorDisplayName = viewer.participant.displayName;
    scheduleNotification(c, async () => {
      // 追加前の件数 + 1 は同時操作でずれるため使わず、DB から追加後の
      // 実際の順位を取り直す(計画参照)。
      const ordinal = await findTakeOrdinal(db, songId, result.takeId);
      if (ordinal === null) {
        return null;
      }
      return buildTakeAddedContent({
        eventTitle: event.title,
        actorDisplayName,
        songTitle: songContext.title,
        takeOrdinal: ordinal,
      });
    });

    return c.redirect(`/e/${event.slug}/#song-${songId}`, 303);
  },
);

takesApp.post(
  "/takes/:id/delete",
  requireViewer,
  requireOpenForParticipants,
  async (c) => {
    const event = c.get("event");
    const viewer = c.get("viewer");
    if (!event || !viewer) {
      return notFoundResponse(c);
    }

    const db = c.get("db");
    const takeId = c.req.param("id");
    const context = await findTakeWithContext(db, takeId);
    if (!context || context.song.eventId !== event.id) {
      return notFoundResponse(c);
    }

    const permission = canDeleteTake(actorFromViewer(viewer), {
      allSlotsEmpty: context.allSlotsEmpty,
      takeCount: context.takeCount,
    });
    if (!permission.ok) {
      return errorResponse(c, 403, permission.message);
    }

    await deleteTake(db, takeId);
    return c.redirect(`/e/${event.slug}/#song-${context.songId}`, 303);
  },
);

takesApp.get("/takes/:id/slots/new", requireViewer, requireParticipant, async (c) => {
  const event = c.get("event");
  const viewer = c.get("viewer");
  if (!event || !viewer) {
    return notFoundResponse(c);
  }
  if (!canAddSlot(actorFromViewer(viewer)).ok) {
    return errorResponse(c, 403, "枠を追加する権限がありません");
  }

  const db = c.get("db");
  const takeId = c.req.param("id");
  const context = await findTakeWithContext(db, takeId);
  if (!context || context.song.eventId !== event.id) {
    return notFoundResponse(c);
  }

  return renderPage(
    c,
    SlotFormPage({
      slug: event.slug,
      takeId,
      songTitle: context.song.title,
      values: emptySlotFormValues,
      errors: {},
    }),
  );
});

takesApp.post(
  "/takes/:id/slots",
  requireViewer,
  requireParticipant,
  requireOpenForParticipants,
  async (c) => {
    const event = c.get("event");
    const viewer = c.get("viewer");
    if (!event || !viewer?.participant) {
      return notFoundResponse(c);
    }
    if (!canAddSlot(actorFromViewer(viewer)).ok) {
      return errorResponse(c, 403, "枠を追加する権限がありません");
    }

    const db = c.get("db");
    const takeId = c.req.param("id");
    const context = await findTakeWithContext(db, takeId);
    if (!context || context.song.eventId !== event.id) {
      return notFoundResponse(c);
    }

    const existingCount = await countSlots(db, takeId);
    if (existingCount >= LIMITS.MAX_SLOTS_PER_TAKE) {
      return renderPage(
        c,
        SlotFormPage({
          slug: event.slug,
          takeId,
          songTitle: context.song.title,
          values: emptySlotFormValues,
          errors: { instrument: `枠は${LIMITS.MAX_SLOTS_PER_TAKE}個までです` },
        }),
        400,
      );
    }

    const body = await c.req.parseBody();
    const input = {
      instrument: formString(body.instrument),
      note: formString(body.note),
    };
    const result = validateSlotForm(input);
    if (!result.ok) {
      return renderPage(
        c,
        SlotFormPage({
          slug: event.slug,
          takeId,
          songTitle: context.song.title,
          values: input,
          errors: result.errors,
        }),
        400,
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const { slotId } = await createSlot(db, {
      takeId,
      instrument: result.value.instrument,
      note: result.value.note,
      createdBy: viewer.participant.id,
      now,
    });

    const actorDisplayName = viewer.participant.displayName;
    const note = result.value.note;
    scheduleNotification(c, async () => {
      // 同じ楽器が増えると Gt → Gt1/Gt2 に振り直されるため、追加後に
      // 実際のラベル・回数を求め直す(既存の join/leave 通知と同じ)。
      const labelInfo = await findSlotLabelInfo(db, context.songId, slotId);
      if (!labelInfo) {
        return null;
      }
      return buildSlotAddedContent({
        eventTitle: event.title,
        actorDisplayName,
        songTitle: context.song.title,
        takeOrdinal: labelInfo.takeOrdinal,
        slotLabel: labelInfo.slotLabel,
        note,
      });
    });

    return c.redirect(`/e/${event.slug}/#song-${context.song.id}`, 303);
  },
);

takesApp.post(
  "/slots/:id/delete",
  requireViewer,
  requireOpenForParticipants,
  async (c) => {
    const event = c.get("event");
    const viewer = c.get("viewer");
    if (!event || !viewer) {
      return notFoundResponse(c);
    }

    const db = c.get("db");
    const slotId = c.req.param("id");
    const context = await findSlotWithContext(db, slotId);
    if (!context || context.song.eventId !== event.id) {
      return notFoundResponse(c);
    }

    const permission = canDeleteSlot(actorFromViewer(viewer), {
      isEmpty: context.assignment === null,
    });
    if (!permission.ok) {
      return errorResponse(c, 403, permission.message);
    }

    await deleteSlot(db, slotId);
    return c.redirect(`/e/${event.slug}/#song-${context.song.id}`, 303);
  },
);
