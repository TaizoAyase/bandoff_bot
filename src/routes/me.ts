import { Hono } from "hono";
import { findByDisplayName, updateProfile } from "../db/queries/participants";
import { deriveMyAssignments, loadEventTree } from "../db/queries/songs";
import { parseInstrumentsInput } from "../domain/instruments";
import { canEditProfile } from "../domain/permissions";
import { validateParticipantForm } from "../domain/validation";
import type { AppEnv } from "../env";
import {
  requireOpenForParticipants,
  requireParticipant,
  requireViewer,
} from "../middleware/guards";
import { setSession } from "../middleware/session";
import { errorResponse, notFoundResponse } from "../views/pages/error";
import { MePage } from "../views/pages/me";
import { SettingsPage } from "../views/pages/settings";
import { renderPage } from "../views/render";
import { actorFromViewer } from "./actor";
import { formString } from "./form";

/** 自分のエントリー一覧(`/me`)と設定(`/settings`)。 */
export const meApp = new Hono<AppEnv>({ strict: false });

meApp.get("/me", requireViewer, async (c) => {
  const event = c.get("event");
  const viewer = c.get("viewer");
  if (!event || !viewer) {
    return notFoundResponse(c);
  }
  const items = viewer.participant
    ? deriveMyAssignments(
        await loadEventTree(c.get("db"), event.id),
        viewer.participant.id,
      )
    : [];
  return renderPage(
    c,
    MePage({ slug: event.slug, isParticipant: Boolean(viewer.participant), items }),
  );
});

meApp.get("/settings", requireViewer, async (c) => {
  const event = c.get("event");
  const viewer = c.get("viewer");
  if (!event || !viewer) {
    return notFoundResponse(c);
  }
  return renderPage(
    c,
    SettingsPage({
      slug: event.slug,
      isParticipant: Boolean(viewer.participant),
      values: { displayName: viewer.participant?.displayName ?? "" },
      instruments: (viewer.participant?.instruments ?? []).join(", "),
      errors: {},
      duplicateWarning: null,
      updated: c.req.query("updated") === "1",
    }),
  );
});

meApp.post(
  "/settings/profile",
  requireViewer,
  requireParticipant,
  requireOpenForParticipants,
  async (c) => {
    const event = c.get("event");
    const viewer = c.get("viewer");
    if (!event || !viewer?.participant) {
      return notFoundResponse(c);
    }
    if (!canEditProfile(actorFromViewer(viewer), viewer.participant.id).ok) {
      return errorResponse(c, 403, "自分のプロフィールのみ編集できます");
    }

    const db = c.get("db");
    const body = await c.req.parseBody();
    const displayNameRaw = formString(body.displayName);
    const instrumentsRaw = formString(body.instruments);
    const confirmed = formString(body.confirm) === "1";

    const result = validateParticipantForm({ displayName: displayNameRaw });
    if (!result.ok) {
      return renderPage(
        c,
        SettingsPage({
          slug: event.slug,
          isParticipant: true,
          values: { displayName: displayNameRaw },
          instruments: instrumentsRaw,
          errors: result.errors,
          duplicateWarning: null,
          updated: false,
        }),
        400,
      );
    }

    // 表示名を変えていない場合、自分自身が重複相手として見つかってしまうため
    // 変更があるときだけ重複チェックする。
    if (result.value.displayName !== viewer.participant.displayName) {
      const existing = await findByDisplayName(db, event.id, result.value.displayName);
      if (existing && !confirmed) {
        return renderPage(
          c,
          SettingsPage({
            slug: event.slug,
            isParticipant: true,
            values: { displayName: result.value.displayName },
            instruments: instrumentsRaw,
            errors: {},
            duplicateWarning: `「${result.value.displayName}」という表示名は既に使われています。自分自身であれば、そのまま登録できます。`,
            updated: false,
          }),
        );
      }
    }

    const instruments = parseInstrumentsInput(instrumentsRaw);
    await updateProfile(db, viewer.participant.id, {
      displayName: result.value.displayName,
      instruments,
    });

    return c.redirect(`/e/${event.slug}/settings?updated=1`, 303);
  },
);

meApp.post("/settings/unbind", requireViewer, requireParticipant, async (c) => {
  const event = c.get("event");
  const viewer = c.get("viewer");
  if (!event || !viewer) {
    return notFoundResponse(c);
  }
  // 端末の紐付け解除は主催者フラグも含めて完全にこの端末を切り離す
  // (主催者キーも localStorage から消える。initSettingsPage を参照)。
  await setSession(c, event.slug, { e: event.id, p: null, o: false });
  return c.redirect(`/e/${event.slug}/`, 303);
});
