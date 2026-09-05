import { Hono } from "hono";
import {
  findParticipantAssignmentInTake,
  findSlotWithContext,
  joinSlot,
  leaveSlot,
} from "../db/queries/assignments";
import { findParticipantById } from "../db/queries/participants";
import {
  countSongs,
  createSong,
  deleteSong,
  findSongContext,
  updateSong,
} from "../db/queries/songs";
import { onEntryChanged } from "../domain/hooks";
import { DEFAULT_SLOTS } from "../domain/instruments";
import {
  canAddSong,
  canDeleteSong,
  canEditSong,
  canJoinAs,
  canLeave,
} from "../domain/permissions";
import { LIMITS, validateSongForm, validateSongSlots } from "../domain/validation";
import type { AppEnv } from "../env";
import {
  requireOpenForParticipants,
  requireParticipant,
  requireViewer,
} from "../middleware/guards";
import { ConfirmJoinPage } from "../views/pages/confirm";
import { errorResponse, notFoundResponse } from "../views/pages/error";
import { SongEditPage } from "../views/pages/song-edit";
import { emptySongFormValues, SongFormPage } from "../views/pages/song-form";
import { TakenPage } from "../views/pages/taken";
import { renderPage } from "../views/render";
import { actorFromViewer } from "./actor";
import { formString, formStringArray } from "./form";

/** 曲登録と、枠へのエントリー・辞退。 */
export const songsApp = new Hono<AppEnv>({ strict: false });

songsApp.get("/songs/new", requireViewer, requireParticipant, async (c) => {
  const event = c.get("event");
  const viewer = c.get("viewer");
  if (!event || !viewer) {
    return notFoundResponse(c);
  }
  if (!canAddSong(actorFromViewer(viewer)).ok) {
    return c.text("Forbidden", 403);
  }
  return renderPage(
    c,
    SongFormPage({
      slug: event.slug,
      values: emptySongFormValues,
      instruments: DEFAULT_SLOTS,
      errors: {},
    }),
  );
});

songsApp.post(
  "/songs",
  requireViewer,
  requireParticipant,
  requireOpenForParticipants,
  async (c) => {
    const event = c.get("event");
    const viewer = c.get("viewer");
    if (!event || !viewer?.participant) {
      return notFoundResponse(c);
    }
    if (!canAddSong(actorFromViewer(viewer)).ok) {
      return c.text("Forbidden", 403);
    }
    const db = c.get("db");

    const existingCount = await countSongs(db, event.id);
    if (existingCount >= LIMITS.MAX_SONGS_PER_EVENT) {
      return renderPage(
        c,
        SongFormPage({
          slug: event.slug,
          values: emptySongFormValues,
          instruments: DEFAULT_SLOTS,
          errors: { title: `曲は${LIMITS.MAX_SONGS_PER_EVENT}曲までです` },
        }),
        400,
      );
    }

    const body = await c.req.parseBody({ all: true });
    const input = {
      title: formString(body.title),
      artist: formString(body.artist),
      refUrl: formString(body.refUrl),
      songKey: formString(body.songKey),
      notes: formString(body.notes),
    };
    const rawInstruments = formStringArray(body.instrument);

    const formResult = validateSongForm(input);
    const slotsResult = validateSongSlots(rawInstruments);

    if (!formResult.ok || !slotsResult.ok) {
      const errors: Record<string, string> = {
        ...(formResult.ok ? {} : formResult.errors),
        ...(slotsResult.ok ? {} : slotsResult.errors),
      };
      return renderPage(
        c,
        SongFormPage({
          slug: event.slug,
          values: input,
          instruments: rawInstruments.length > 0 ? rawInstruments : DEFAULT_SLOTS,
          errors,
        }),
        400,
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const { songId } = await createSong(db, {
      eventId: event.id,
      title: formResult.value.title,
      artist: formResult.value.artist,
      refUrl: formResult.value.refUrl,
      songKey: formResult.value.songKey,
      notes: formResult.value.notes,
      proposedBy: viewer.participant.id,
      instruments: slotsResult.value,
      now,
    });

    return c.redirect(`/e/${event.slug}/#song-${songId}`, 303);
  },
);

songsApp.get("/songs/:id/edit", requireViewer, async (c) => {
  const event = c.get("event");
  const viewer = c.get("viewer");
  if (!event || !viewer) {
    return notFoundResponse(c);
  }
  const db = c.get("db");
  const songId = c.req.param("id");
  const context = await findSongContext(db, songId);
  if (!context || context.eventId !== event.id) {
    return notFoundResponse(c);
  }
  if (!canEditSong(actorFromViewer(viewer), { proposedBy: context.proposedBy }).ok) {
    return errorResponse(c, 403, "曲を登録した本人か主催者のみ編集できます");
  }
  return renderPage(
    c,
    SongEditPage({
      slug: event.slug,
      songId,
      values: {
        title: context.title,
        artist: context.artist ?? "",
        refUrl: context.refUrl ?? "",
        songKey: context.songKey ?? "",
        notes: context.notes ?? "",
      },
      errors: {},
    }),
  );
});

songsApp.post("/songs/:id", requireViewer, requireOpenForParticipants, async (c) => {
  const event = c.get("event");
  const viewer = c.get("viewer");
  if (!event || !viewer) {
    return notFoundResponse(c);
  }
  const db = c.get("db");
  const songId = c.req.param("id");
  const context = await findSongContext(db, songId);
  if (!context || context.eventId !== event.id) {
    return notFoundResponse(c);
  }
  const permission = canEditSong(actorFromViewer(viewer), {
    proposedBy: context.proposedBy,
  });
  if (!permission.ok) {
    return errorResponse(c, 403, permission.message);
  }

  const body = await c.req.parseBody();
  const input = {
    title: formString(body.title),
    artist: formString(body.artist),
    refUrl: formString(body.refUrl),
    songKey: formString(body.songKey),
    notes: formString(body.notes),
  };
  const result = validateSongForm(input);
  if (!result.ok) {
    return renderPage(
      c,
      SongEditPage({ slug: event.slug, songId, values: input, errors: result.errors }),
      400,
    );
  }

  await updateSong(db, songId, result.value);
  return c.redirect(`/e/${event.slug}/#song-${songId}`, 303);
});

songsApp.post(
  "/songs/:id/delete",
  requireViewer,
  requireOpenForParticipants,
  async (c) => {
    const event = c.get("event");
    const viewer = c.get("viewer");
    if (!event || !viewer) {
      return notFoundResponse(c);
    }
    const db = c.get("db");
    const songId = c.req.param("id");
    const context = await findSongContext(db, songId);
    if (!context || context.eventId !== event.id) {
      return notFoundResponse(c);
    }
    const permission = canDeleteSong(actorFromViewer(viewer), {
      proposedBy: context.proposedBy,
      isEmpty: !context.hasAnyAssignment,
    });
    if (!permission.ok) {
      return errorResponse(c, 403, permission.message);
    }

    await deleteSong(db, songId);
    return c.redirect(`/e/${event.slug}/`, 303);
  },
);

songsApp.post("/slots/:id/join", async (c) => {
  const event = c.get("event");
  const viewer = c.get("viewer");
  if (!event) {
    return notFoundResponse(c);
  }
  if (!viewer) {
    return c.redirect(`/e/${event.slug}/join`, 303);
  }

  // closed かどうかは、未登録 viewer を登録画面へ誘導するより先に判定する。
  // 順序を逆にすると「+参加」→ 登録 → 同一リクエストでのエントリーという
  // 経路から closed の書き込み制限を迂回できてしまう。
  if (event.status === "closed" && !viewer.isOrganizer) {
    return c.text("Forbidden", 403);
  }

  const slotId = c.req.param("id");
  const body = await c.req.parseBody();
  const requestedTargetId = formString(body.participantId);
  // 代理エントリー(主催者が participantId を指定)でなければ、自分自身が
  // 対象になる。organizer フラグのみで participant を持たない cookie の場合、
  // 代理指定がなければ「自分」が存在しないため register へ誘導する。
  const targetParticipantId = requestedTargetId || viewer.participant?.id;

  if (!targetParticipantId) {
    return c.redirect(
      `/e/${event.slug}/register?slot=${encodeURIComponent(slotId)}`,
      303,
    );
  }

  const db = c.get("db");
  const context = await findSlotWithContext(db, slotId);
  if (!context || context.song.eventId !== event.id) {
    return notFoundResponse(c);
  }

  const permission = canJoinAs(actorFromViewer(viewer), targetParticipantId);
  if (!permission.ok) {
    return c.text("Forbidden", 403);
  }

  const targetParticipant =
    viewer.participant && targetParticipantId === viewer.participant.id
      ? viewer.participant
      : await findParticipantById(db, targetParticipantId);
  if (!targetParticipant || targetParticipant.eventId !== event.id) {
    return c.text("Bad Request", 400);
  }

  const confirmed = formString(body.confirm) === "1";
  if (!confirmed) {
    const existing = await findParticipantAssignmentInTake(
      db,
      context.take.id,
      targetParticipantId,
    );
    if (existing) {
      return renderPage(
        c,
        ConfirmJoinPage({
          slug: event.slug,
          slotId,
          targetParticipantId,
          message: `同じ曲の別のパート(${existing.instrument})に既に入っています。${context.slot.instrument} にも入りますか？`,
        }),
      );
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const result = await joinSlot(db, {
    slotId,
    participantId: targetParticipantId,
    now,
  });
  if (result.kind === "taken") {
    return renderPage(c, TakenPage({ slug: event.slug }), 409);
  }

  onEntryChanged({
    type: "join",
    eventId: event.id,
    participantId: targetParticipant.id,
    participantName: targetParticipant.displayName,
    songTitle: context.song.title,
    slotLabel: context.slot.instrument,
  });

  return c.redirect(`/e/${event.slug}/?notice=joined#song-${context.song.id}`, 303);
});

songsApp.post("/slots/:id/leave", async (c) => {
  const event = c.get("event");
  const viewer = c.get("viewer");
  if (!event) {
    return notFoundResponse(c);
  }
  if (!viewer) {
    return c.redirect(`/e/${event.slug}/join`, 303);
  }
  // organizer フラグのみで participant を持たない cookie は、他人の
  // エントリーを代理で辞退させられる(canLeave が isOrganizer を許可する)ため、
  // ここでは register へ誘導しない。
  if (!viewer.participant && !viewer.isOrganizer) {
    return c.redirect(`/e/${event.slug}/register`, 303);
  }
  if (event.status === "closed" && !viewer.isOrganizer) {
    return c.text("Forbidden", 403);
  }

  const db = c.get("db");
  const slotId = c.req.param("id");
  const context = await findSlotWithContext(db, slotId);
  if (!context || context.song.eventId !== event.id) {
    return notFoundResponse(c);
  }
  if (!context.assignment) {
    // 既に空(二重送信など)。曲一覧に戻すだけで十分。
    return c.redirect(`/e/${event.slug}/?notice=left#song-${context.song.id}`, 303);
  }

  const permission = canLeave(
    actorFromViewer(viewer),
    context.assignment.participantId,
  );
  if (!permission.ok) {
    return c.text("Forbidden", 403);
  }

  await leaveSlot(db, slotId);

  onEntryChanged({
    type: "leave",
    eventId: event.id,
    participantId: context.assignment.participantId,
    participantName: context.assignment.participantName,
    songTitle: context.song.title,
    slotLabel: context.slot.instrument,
  });

  return c.redirect(`/e/${event.slug}/?notice=left#song-${context.song.id}`, 303);
});
