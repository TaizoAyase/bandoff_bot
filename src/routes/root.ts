import { Hono } from "hono";
import { countEventsCreatedSince, createEvent } from "../db/queries/events";
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
import { buildNewEventContent } from "../domain/notify-event";
import { buildPasteText } from "../domain/paste-text";
import {
  isNewEventNotifyRateLimited,
  NEW_EVENT_NOTIFY_WINDOW_SECONDS,
} from "../domain/rate-limit";
import { validateNewEventForm } from "../domain/validation";
import type { AppEnv } from "../env";
import { setSession } from "../middleware/session";
import { scheduleNotification } from "../notify/schedule";
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
    // チェックボックスは未チェックだとキー自体が送られてこない
    // (「キーが無い = オフ」、計画6章)。
    discordEnabled: formString(body.discordEnabled) === "on",
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
    discordEnabled: result.value.discordEnabled,
    now,
  });

  // 荒らし対策として、直近1時間にサイト全体で作られたイベントが上限を
  // 超えたら通知だけを省く(イベント作成自体は常に成功させる、計画3章)。
  scheduleNotification(c, async () => {
    const since = now - NEW_EVENT_NOTIFY_WINDOW_SECONDS;
    const recentCount = await countEventsCreatedSince(db, since);
    if (isNewEventNotifyRateLimited(recentCount)) {
      console.warn("discord notify skipped", { reason: "new event rate limit" });
      return null;
    }
    // コマンド有効(2章: DISCORD_PUBLIC_KEY / DISCORD_GUILD_ID が両方設定
    // されている)かつこのイベントが discordEnabled のときだけ、
    // 「/bandoff open で開けます」の1行を足す(計画7章)。
    const commandsEnabled =
      Boolean(c.env.DISCORD_PUBLIC_KEY) && Boolean(c.env.DISCORD_GUILD_ID);
    return buildNewEventContent({
      title: result.value.title,
      organizerDisplayName: result.value.organizerDisplayName,
      region: result.value.region,
      startsAt: result.value.startsAt,
      durationMinutes: result.value.durationMinutes,
      place: result.value.place,
      discordOpenAvailable: result.value.discordEnabled && commandsEnabled,
    });
  });

  // 新規作成は未ログイン状態からの操作なので、紐付け待ちは付けない
  // (計画5-1)。
  await setSession(c, slug, {
    e: eventId,
    p: organizerParticipantId,
    o: true,
    iat: now,
    pendingDiscord: null,
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
