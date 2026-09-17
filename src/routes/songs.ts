import { Hono } from "hono";
import {
  findParticipantAssignmentInTake,
  findSlotLabelInfo,
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
import { DEFAULT_SLOTS } from "../domain/instruments";
import { buildSongAddedContent, buildSongEditedContent } from "../domain/notify-song";
import {
  canAddSong,
  canDeleteSong,
  canEditSong,
  canJoinAs,
  canLeave,
} from "../domain/permissions";
import { toScoreUrlInputs, zipScoreUrlRows } from "../domain/score-urls";
import {
  LIMITS,
  validateScoreUrls,
  validateSongForm,
  validateSongSlots,
} from "../domain/validation";
import type { AppEnv } from "../env";
import {
  requireOpenForParticipants,
  requireParticipant,
  requireViewer,
} from "../middleware/guards";
import { notifyEntryChanged } from "../notify/entry-changed";
import { scheduleNotification } from "../notify/schedule";
import { ConfirmJoinPage } from "../views/pages/confirm";
import { errorResponse, notFoundResponse } from "../views/pages/error";
import { SongEditPage } from "../views/pages/song-edit";
import { emptySongFormValues, SongFormPage } from "../views/pages/song-form";
import { TakenPage } from "../views/pages/taken";
import { renderPage } from "../views/render";
import { actorFromViewer } from "./actor";
import { formString, formStringArray, formStringArrayPositional } from "./form";

/** 曲登録と、枠へのエントリー・辞退。 */
export const songsApp = new Hono<AppEnv>({ strict: false });

songsApp.get(
  "/songs/new",
  requireViewer,
  requireParticipant,
  requireOpenForParticipants,
  async (c) => {
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
        scoreUrls: [],
        errors: {},
      }),
    );
  },
);

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
          scoreUrls: [],
          errors: { title: `曲は${LIMITS.MAX_SONGS_PER_EVENT}曲までです` },
        }),
        400,
      );
    }

    // 同名フィールドが複数来るパート構成(instrument)と譜面URL(scoreUrl)・
    // 譜面の名前(scoreUrlLabel)を拾うため { all: true } が必須。付け忘れると
    // 同名フィールドは最後の1件だけが残り、枠も譜面URLも黙って1件しか登録
    // されなくなる(formString は配列が来ても先頭を取るだけなので、他フィールド
    // への影響はない)。
    // さらに scoreUrl と scoreUrlLabel は行ごとに必ず両方送られる前提で、
    // n番目同士を同じ行として位置合わせしている(フォーム側は常に両方の
    // <input> をレンダリングする。src/views/components/score-url-fields.tsx 参照)。
    const body = await c.req.parseBody({ all: true });
    const input = {
      title: formString(body.title),
      artist: formString(body.artist),
      refUrl: formString(body.refUrl),
      songKey: formString(body.songKey),
      notes: formString(body.notes),
    };
    const rawInstruments = formStringArray(body.instrument);
    const rawScoreUrlRows = zipScoreUrlRows(
      formStringArrayPositional(body.scoreUrl),
      formStringArrayPositional(body.scoreUrlLabel),
    );

    const formResult = validateSongForm(input);
    const slotsResult = validateSongSlots(rawInstruments);
    const scoreUrlsResult = validateScoreUrls(rawScoreUrlRows);

    if (!formResult.ok || !slotsResult.ok || !scoreUrlsResult.ok) {
      const errors: Record<string, string> = {
        ...(formResult.ok ? {} : formResult.errors),
        ...(slotsResult.ok ? {} : slotsResult.errors),
        ...(scoreUrlsResult.ok ? {} : scoreUrlsResult.errors),
      };
      return renderPage(
        c,
        SongFormPage({
          slug: event.slug,
          values: input,
          instruments: rawInstruments.length > 0 ? rawInstruments : DEFAULT_SLOTS,
          scoreUrls: rawScoreUrlRows,
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
      scoreUrls: scoreUrlsResult.value,
      now,
    });

    const actorDisplayName = viewer.participant.displayName;
    scheduleNotification(c, async () =>
      buildSongAddedContent({
        eventTitle: event.title,
        actorDisplayName,
        title: formResult.value.title,
        artist: formResult.value.artist,
        instruments: slotsResult.value,
      }),
    );

    return c.redirect(`/e/${event.slug}/#song-${songId}`, 303);
  },
);

songsApp.get(
  "/songs/:id/edit",
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
    const permission = canEditSong(actorFromViewer(viewer));
    if (!permission.ok) {
      return errorResponse(c, 403, permission.message);
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
        scoreUrls: toScoreUrlInputs(context.scoreUrls),
        errors: {},
      }),
    );
  },
);

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
  const permission = canEditSong(actorFromViewer(viewer));
  if (!permission.ok) {
    return errorResponse(c, 403, permission.message);
  }

  // 同名フィールドが複数来る譜面URL(scoreUrl)と譜面の名前(scoreUrlLabel)を
  // 拾うため { all: true } が必須。付け忘れると同名フィールドは最後の1件だけが
  // 残り、譜面URLが黙って1本しか保存されなくなる(formString は配列が来ても
  // 先頭を取るだけなので、他フィールドへの影響はない)。
  // さらにこの2つは行ごとに必ず両方送られる前提で、n番目同士を同じ行として
  // 位置合わせしている(フォーム側は常に両方の <input> をレンダリングする。
  // src/views/components/score-url-fields.tsx 参照)。
  const body = await c.req.parseBody({ all: true });
  const input = {
    title: formString(body.title),
    artist: formString(body.artist),
    refUrl: formString(body.refUrl),
    songKey: formString(body.songKey),
    notes: formString(body.notes),
  };
  const rawScoreUrlRows = zipScoreUrlRows(
    formStringArrayPositional(body.scoreUrl),
    formStringArrayPositional(body.scoreUrlLabel),
  );
  const result = validateSongForm(input);
  const scoreUrlsResult = validateScoreUrls(rawScoreUrlRows);
  if (!result.ok || !scoreUrlsResult.ok) {
    const errors: Record<string, string> = {
      ...(result.ok ? {} : result.errors),
      ...(scoreUrlsResult.ok ? {} : scoreUrlsResult.errors),
    };
    return renderPage(
      c,
      SongEditPage({
        slug: event.slug,
        songId,
        values: input,
        scoreUrls: rawScoreUrlRows,
        errors,
      }),
      400,
    );
  }

  // 通知の「変更前」は更新前にここで確定させる。null と "" は同一視する
  // (計画のユーザー決定事項)ため、DB の null をここで "" に正規化しておく。
  const before = {
    title: context.title,
    artist: context.artist ?? "",
    refUrl: context.refUrl ?? "",
    songKey: context.songKey ?? "",
    notes: context.notes ?? "",
    scoreUrls: toScoreUrlInputs(context.scoreUrls),
  };
  const after = { ...result.value, scoreUrls: scoreUrlsResult.value };

  const now = Math.floor(Date.now() / 1000);
  await updateSong(db, songId, {
    ...result.value,
    scoreUrls: scoreUrlsResult.value,
    now,
  });

  scheduleNotification(c, async () =>
    buildSongEditedContent({
      eventTitle: event.title,
      actorDisplayName: viewer.participant?.displayName ?? null,
      before,
      after,
    }),
  );

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

  // UI(/me・参加者一覧)は `numberInstruments` で「Gt1」「Gt2」と採番済みの
  // ラベルを表示している。生の `context.slot.instrument` をそのまま流すと
  // 同じ楽器が複数枠あるとき Discord 側でどちらか分からなくなるため、
  // 通知も同じ採番済みラベル・回数表記に揃える。
  const labelInfo = await findSlotLabelInfo(db, context.song.id, slotId);
  notifyEntryChanged(c, [
    {
      type: "join",
      eventTitle: event.title,
      participantName: targetParticipant.displayName,
      songTitle: context.song.title,
      slotLabel: labelInfo?.slotLabel ?? context.slot.instrument,
      takeOrdinal: labelInfo?.takeOrdinal ?? null,
    },
  ]);

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

  // leaveSlot で Assignment が消える前に採番情報を取っておく必要はない
  // (ラベルは Slot の並びから決まり、Assignment の有無に依存しない)。
  const labelInfo = await findSlotLabelInfo(db, context.song.id, slotId);

  await leaveSlot(db, slotId);

  notifyEntryChanged(c, [
    {
      type: "leave",
      eventTitle: event.title,
      participantName: context.assignment.participantName,
      songTitle: context.song.title,
      slotLabel: labelInfo?.slotLabel ?? context.slot.instrument,
      takeOrdinal: labelInfo?.takeOrdinal ?? null,
    },
  ]);

  return c.redirect(`/e/${event.slug}/?notice=left#song-${context.song.id}`, 303);
});
