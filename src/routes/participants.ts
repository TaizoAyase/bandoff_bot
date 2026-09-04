import { Hono } from "hono";
import { findSlotWithContext, joinSlot } from "../db/queries/assignments";
import { createParticipant, findByDisplayName } from "../db/queries/participants";
import { sha256Hex } from "../domain/crypto";
import { onEntryChanged } from "../domain/hooks";
import { newId, newRecoveryKey, newToken, normalizeRecoveryKey } from "../domain/ids";
import { parseInstrumentsInput } from "../domain/instruments";
import { buildPasteText } from "../domain/paste-text";
import { validateParticipantForm } from "../domain/validation";
import type { AppEnv } from "../env";
import { requireOpenForParticipants, requireViewer } from "../middleware/guards";
import { setSession } from "../middleware/session";
import { RegisterPage } from "../views/pages/register";
import { WelcomePage } from "../views/pages/welcome";
import { renderPage } from "../views/render";
import { formString } from "./form";

/** 参加者登録(`/register`、`/participants`)。 */
export const participantsApp = new Hono<AppEnv>({ strict: false });

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
    const recoveryKey = newRecoveryKey();
    const recoveryKeyHash = await sha256Hex(normalizeRecoveryKey(recoveryKey));
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
    const pasteText = buildPasteText(origin, event.slug, event.title, event.joinCode);

    return renderPage(
      c,
      WelcomePage({ slug: event.slug, token, recoveryKey, pasteText, entryResult }),
    );
  },
);
