import { Hono } from "hono";
import { createEvent } from "../db/queries/events";
import { DEFAULT_WORKSPACE_ID } from "../domain/constants";
import { sha256Hex } from "../domain/crypto";
import {
  newAccessKey,
  newId,
  newSlug,
  newToken,
  normalizeAccessKey,
} from "../domain/ids";
import { parseInstrumentsInput } from "../domain/instruments";
import { buildPasteText } from "../domain/paste-text";
import { validateNewEventForm } from "../domain/validation";
import type { AppEnv } from "../env";
import { setSession } from "../middleware/session";
import { emptyNewEventFormValues, NewEventPage } from "../views/pages/new-event";
import { WelcomePage } from "../views/pages/welcome";
import { renderPage } from "../views/render";
import { formString } from "./form";

/** `/new`(イベント作成)を担当するルート。`index.ts` から `/` にマウントする。 */
export const rootApp = new Hono<AppEnv>({ strict: false });

rootApp.get("/new", (c) =>
  renderPage(
    c,
    NewEventPage({ values: emptyNewEventFormValues, instruments: "", errors: {} }),
  ),
);

rootApp.post("/new", async (c) => {
  const body = await c.req.parseBody();
  const input = {
    title: formString(body.title),
    region: formString(body.region),
    startsDate: formString(body.startsDate),
    startsTime: formString(body.startsTime),
    durationMinutes: formString(body.durationMinutes),
    place: formString(body.place),
    notes: formString(body.notes),
    joinCode: formString(body.joinCode),
    organizerDisplayName: formString(body.organizerDisplayName),
  };
  const organizerInstrumentsRaw = formString(body.organizerInstruments);

  const result = validateNewEventForm(input);
  if (!result.ok) {
    return renderPage(
      c,
      NewEventPage({
        values: input,
        instruments: organizerInstrumentsRaw,
        errors: result.errors,
      }),
      400,
    );
  }

  const db = c.get("db");
  const now = Math.floor(Date.now() / 1000);
  const eventId = newId();
  const slug = newSlug();
  const organizerParticipantId = newId();
  const organizerKey = newAccessKey();
  const organizerKeyHash = await sha256Hex(normalizeAccessKey(organizerKey));
  const token = newToken();
  const tokenHash = await sha256Hex(token);
  const recoveryKey = newAccessKey();
  const recoveryKeyHash = await sha256Hex(normalizeAccessKey(recoveryKey));
  const organizerInstruments = parseInstrumentsInput(organizerInstrumentsRaw);

  await createEvent(db, {
    eventId,
    workspaceId: DEFAULT_WORKSPACE_ID,
    slug,
    title: result.value.title,
    region: result.value.region,
    startsAt: result.value.startsAt,
    durationMinutes: result.value.durationMinutes,
    place: result.value.place,
    notes: result.value.notes,
    joinCode: result.value.joinCode,
    organizerKeyHash,
    organizerParticipantId,
    organizerDisplayName: result.value.organizerDisplayName,
    organizerInstruments,
    organizerTokenHash: tokenHash,
    organizerRecoveryKeyHash: recoveryKeyHash,
    now,
  });

  await setSession(c, slug, {
    e: eventId,
    p: organizerParticipantId,
    o: true,
    iat: now,
  });

  const origin = new URL(c.req.url).origin;
  const pasteText = buildPasteText(
    origin,
    slug,
    result.value.title,
    result.value.startsAt,
    result.value.durationMinutes,
    result.value.place,
    result.value.joinCode,
  );

  return renderPage(
    c,
    WelcomePage({ slug, token, recoveryKey, pasteText, organizerKey }),
  );
});
