import { Hono } from "hono";
import {
  findSlotWithContext,
  joinSlot,
  leaveAllSlots,
} from "../db/queries/assignments";
import {
  createParticipant,
  findByDisplayName,
  findParticipantById,
  listParticipants,
} from "../db/queries/participants";
import { deriveMyAssignments, loadEventTree } from "../db/queries/songs";
import { sha256Hex } from "../domain/crypto";
import { onEntryChanged } from "../domain/hooks";
import { newAccessKey, newId, newToken, normalizeAccessKey } from "../domain/ids";
import { parseInstrumentsInput } from "../domain/instruments";
import { buildPasteText } from "../domain/paste-text";
import { canLeaveAll } from "../domain/permissions";
import { validateParticipantForm } from "../domain/validation";
import type { AppEnv } from "../env";
import {
  requireOpenForParticipants,
  requireOrganizer,
  requireViewer,
} from "../middleware/guards";
import { setSession } from "../middleware/session";
import { errorResponse, notFoundResponse } from "../views/pages/error";
import { ParticipantsPage, parseParticipantsNotice } from "../views/pages/participants";
import { RegisterPage } from "../views/pages/register";
import { WelcomePage } from "../views/pages/welcome";
import { renderPage } from "../views/render";
import { actorFromViewer } from "./actor";
import { formString } from "./form";

/** 参加者登録(`/register`、`/participants`)と参加者一覧(`/participants`)。 */
export const participantsApp = new Hono<AppEnv>({ strict: false });

participantsApp.get("/participants", requireViewer, async (c) => {
  const event = c.get("event");
  const viewer = c.get("viewer");
  if (!event || !viewer) {
    return notFoundResponse(c);
  }
  const db = c.get("db");
  const list = await listParticipants(db, event.id);
  // 一括辞退ボタンの表示可否・確認文言に使うエントリー一覧は、organizer の
  // ときだけ計算する(十数人規模のイベント想定なので都度計算でよい)。
  const songs = viewer.isOrganizer ? await loadEventTree(db, event.id) : [];
  const participants = list.map((p) => ({
    ...p,
    entries: viewer.isOrganizer ? deriveMyAssignments(songs, p.id) : [],
  }));
  return renderPage(
    c,
    ParticipantsPage({
      slug: event.slug,
      participants,
      isOrganizer: viewer.isOrganizer,
      notice: parseParticipantsNotice(c.req.query("notice")),
    }),
  );
});

participantsApp.post("/participants/:id/leave-all", requireOrganizer, async (c) => {
  const event = c.get("event");
  const viewer = c.get("viewer");
  if (!event || !viewer) {
    return notFoundResponse(c);
  }
  const db = c.get("db");
  const targetParticipantId = c.req.param("id");
  const target = await findParticipantById(db, targetParticipantId);
  if (!target || target.eventId !== event.id) {
    return notFoundResponse(c);
  }

  const permission = canLeaveAll(actorFromViewer(viewer));
  if (!permission.ok) {
    return errorResponse(c, 403, permission.message);
  }

  const songs = await loadEventTree(db, event.id);
  const entries = deriveMyAssignments(songs, targetParticipantId);

  await leaveAllSlots(db, { eventId: event.id, participantId: targetParticipantId });

  for (const entry of entries) {
    onEntryChanged({
      type: "leave",
      eventId: event.id,
      participantId: targetParticipantId,
      participantName: target.displayName,
      songTitle: entry.songTitle,
      slotLabel: entry.slotLabel,
    });
  }

  return c.redirect(`/e/${event.slug}/participants?notice=left-all`, 303);
});

participantsApp.get(
  "/register",
  requireViewer,
  requireOpenForParticipants,
  async (c) => {
    const event = c.get("event");
    const viewer = c.get("viewer");
    if (!event || !viewer) {
      return c.text("Not Found", 404);
    }
    if (viewer.participant) {
      return c.redirect(`/e/${event.slug}/`, 303);
    }
    const slot = c.req.query("slot") ?? "";
    return renderPage(
      c,
      RegisterPage({
        slug: event.slug,
        slot,
        values: { displayName: "" },
        instruments: "",
        errors: {},
        duplicateWarning: null,
      }),
    );
  },
);

participantsApp.post(
  "/participants",
  requireViewer,
  requireOpenForParticipants,
  async (c) => {
    const event = c.get("event");
    const viewer = c.get("viewer");
    if (!event || !viewer) {
      return c.text("Not Found", 404);
    }
    if (viewer.participant) {
      return c.redirect(`/e/${event.slug}/`, 303);
    }

    const db = c.get("db");
    const body = await c.req.parseBody();
    const slot = formString(body.slot);
    const displayNameRaw = formString(body.displayName);
    const instrumentsRaw = formString(body.instruments);
    const confirmed = formString(body.confirm) === "1";

    const result = validateParticipantForm({ displayName: displayNameRaw });
    if (!result.ok) {
      return renderPage(
        c,
        RegisterPage({
          slug: event.slug,
          slot,
          values: { displayName: displayNameRaw },
          instruments: instrumentsRaw,
          errors: result.errors,
          duplicateWarning: null,
        }),
        400,
      );
    }

    const existing = await findByDisplayName(db, event.id, result.value.displayName);
    if (existing && !confirmed) {
      return renderPage(
        c,
        RegisterPage({
          slug: event.slug,
          slot,
          values: { displayName: result.value.displayName },
          instruments: instrumentsRaw,
          errors: {},
          duplicateWarning: `「${result.value.displayName}」という表示名は既に使われています。自分自身であれば、そのまま登録できます。`,
        }),
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const participantId = newId();
    const token = newToken();
    const tokenHash = await sha256Hex(token);
    const recoveryKey = newAccessKey();
    const recoveryKeyHash = await sha256Hex(normalizeAccessKey(recoveryKey));
    const instruments = parseInstrumentsInput(instrumentsRaw);

    await createParticipant(db, {
      id: participantId,
      eventId: event.id,
      displayName: result.value.displayName,
      instruments,
      tokenHash,
      recoveryKeyHash,
      discordUserId: null,
      createdAt: now,
    });

    await setSession(c, event.slug, {
      e: event.id,
      p: participantId,
      o: viewer.isOrganizer,
    });

    let entryResult: string | undefined;
    if (slot) {
      const context = await findSlotWithContext(db, slot);
      if (context && context.song.eventId === event.id) {
        const joinResult = await joinSlot(db, { slotId: slot, participantId, now });
        if (joinResult.kind === "joined") {
          entryResult = `${context.slot.instrument} に入りました`;
          onEntryChanged({
            type: "join",
            eventId: event.id,
            participantId,
            participantName: result.value.displayName,
            songTitle: context.song.title,
            slotLabel: context.slot.instrument,
          });
        } else {
          entryResult = "先を越されました";
        }
      }
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
      WelcomePage({ slug: event.slug, token, recoveryKey, pasteText, entryResult }),
    );
  },
);
