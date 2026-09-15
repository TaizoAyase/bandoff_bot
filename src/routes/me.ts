import { Hono } from "hono";
import type { Db } from "../db/client";
import {
  findByDisplayName,
  unlinkDiscordUser,
  updateProfile,
  withdrawParticipant,
} from "../db/queries/participants";
import {
  deriveMyAssignments,
  loadEventTree,
  type MyAssignmentItem,
} from "../db/queries/songs";
import { parseInstrumentsInput } from "../domain/instruments";
import { buildParticipantWithdrawnContent } from "../domain/notify-participant";
import { canEditProfile, canWithdraw } from "../domain/permissions";
import { validateParticipantForm } from "../domain/validation";
import type { AppEnv, EventRow, Viewer } from "../env";
import {
  requireOpenForParticipants,
  requireParticipant,
  requireViewer,
} from "../middleware/guards";
import { setSession } from "../middleware/session";
import { scheduleNotification } from "../notify/schedule";
import { errorResponse, notFoundResponse } from "../views/pages/error";
import { MePage } from "../views/pages/me";
import { parseSettingsNotice, SettingsPage } from "../views/pages/settings";
import { WithdrawnPage } from "../views/pages/withdrawn";
import { renderPage } from "../views/render";
import { actorFromViewer } from "./actor";
import { formString } from "./form";

/** 自分のエントリー一覧(`/me`)と設定(`/settings`)。 */
export const meApp = new Hono<AppEnv>({ strict: false });

interface WithdrawCardProps {
  isOrganizersOwnParticipant: boolean;
  withdrawEntries: MyAssignmentItem[];
}

/**
 * 設定画面の「参加を取りやめる」カードに必要な props をまとめて計算する。
 * `/settings` の表示・`/settings/profile` の再表示(400・重複警告)の
 * 3箇所すべてから使う(計画7章「既存の /settings/profile の 400
 * 再表示なども props を満たすこと」)。
 */
async function loadWithdrawCardProps(
  db: Db,
  event: EventRow,
  viewer: Viewer,
): Promise<WithdrawCardProps> {
  if (!viewer.participant) {
    return { isOrganizersOwnParticipant: false, withdrawEntries: [] };
  }
  const isOrganizersOwnParticipant =
    event.organizerParticipantId === viewer.participant.id;
  if (isOrganizersOwnParticipant) {
    return { isOrganizersOwnParticipant, withdrawEntries: [] };
  }
  const songs = await loadEventTree(db, event.id);
  return {
    isOrganizersOwnParticipant,
    withdrawEntries: deriveMyAssignments(songs, viewer.participant.id),
  };
}

interface DiscordCardProps {
  discordLinked: boolean;
  showDiscordLinkHint: boolean;
}

/**
 * 設定画面の「Discord アカウント」カードに必要な props(計画5-6)。
 * `/settings` の表示・`/settings/profile` の再表示の3箇所すべてから使う
 * (`loadWithdrawCardProps` と同じ理由)。
 */
function discordCardProps(event: EventRow, viewer: Viewer): DiscordCardProps {
  const discordLinked = viewer.participant?.discordUserId != null;
  return {
    discordLinked,
    showDiscordLinkHint: !discordLinked && event.discordEnabled,
  };
}

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
  const db = c.get("db");
  const withdrawCard = await loadWithdrawCardProps(db, event, viewer);
  return renderPage(
    c,
    SettingsPage({
      slug: event.slug,
      isParticipant: Boolean(viewer.participant),
      values: { displayName: viewer.participant?.displayName ?? "" },
      instruments: (viewer.participant?.instruments ?? []).join(", "),
      errors: {},
      duplicateWarning: null,
      notice: parseSettingsNotice(c.req.query("notice")),
      ...discordCardProps(event, viewer),
      ...withdrawCard,
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
      const withdrawCard = await loadWithdrawCardProps(db, event, viewer);
      return renderPage(
        c,
        SettingsPage({
          slug: event.slug,
          isParticipant: true,
          values: { displayName: displayNameRaw },
          instruments: instrumentsRaw,
          errors: result.errors,
          duplicateWarning: null,
          ...discordCardProps(event, viewer),
          ...withdrawCard,
        }),
        400,
      );
    }

    // 表示名を変えていない場合、自分自身が重複相手として見つかってしまうため
    // 変更があるときだけ重複チェックする。
    if (result.value.displayName !== viewer.participant.displayName) {
      const existing = await findByDisplayName(db, event.id, result.value.displayName);
      if (existing && !confirmed) {
        const withdrawCard = await loadWithdrawCardProps(db, event, viewer);
        return renderPage(
          c,
          SettingsPage({
            slug: event.slug,
            isParticipant: true,
            values: { displayName: result.value.displayName },
            instruments: instrumentsRaw,
            errors: {},
            duplicateWarning: `「${result.value.displayName}」という表示名は既に使われています。自分自身であれば、そのまま登録できます。`,
            ...discordCardProps(event, viewer),
            ...withdrawCard,
          }),
        );
      }
    }

    const instruments = parseInstrumentsInput(instrumentsRaw);
    await updateProfile(db, viewer.participant.id, {
      displayName: result.value.displayName,
      instruments,
    });

    return c.redirect(`/e/${event.slug}/settings?notice=updated`, 303);
  },
);

/**
 * Discord 紐付けの解除(計画5-6)。cookie(ログイン状態・主催者フラグ)は
 * 変えない。`requireOpenForParticipants` は付けない(本人確認の設定であり
 * 登録・エントリーではないため、closed でも使える)。
 */
meApp.post("/settings/discord/unlink", requireViewer, requireParticipant, async (c) => {
  const event = c.get("event");
  const viewer = c.get("viewer");
  if (!event || !viewer?.participant) {
    return notFoundResponse(c);
  }
  const db = c.get("db");
  await unlinkDiscordUser(db, viewer.participant.id);
  return c.redirect(`/e/${event.slug}/settings?notice=discord-unlinked`, 303);
});

meApp.post("/settings/unbind", requireViewer, requireParticipant, async (c) => {
  const event = c.get("event");
  const viewer = c.get("viewer");
  if (!event || !viewer) {
    return notFoundResponse(c);
  }
  // 端末の紐付け解除は主催者フラグも含めて完全にこの端末を切り離す
  // (主催者キーも localStorage から消える。initSettingsPage を参照)。
  // Discord の紐付け待ちも一緒に消す(計画5-1)。
  await setSession(c, event.slug, {
    e: event.id,
    p: null,
    o: false,
    pendingDiscord: null,
  });
  return c.redirect(`/e/${event.slug}/`, 303);
});

meApp.post(
  "/settings/withdraw",
  requireViewer,
  requireParticipant,
  requireOpenForParticipants,
  async (c) => {
    const event = c.get("event");
    const viewer = c.get("viewer");
    if (!event || !viewer?.participant) {
      return notFoundResponse(c);
    }

    const permission = canWithdraw(actorFromViewer(viewer), {
      targetParticipantId: viewer.participant.id,
      organizerParticipantId: event.organizerParticipantId,
    });
    if (!permission.ok) {
      return errorResponse(c, 403, permission.message);
    }

    const db = c.get("db");
    const participantId = viewer.participant.id;
    const displayName = viewer.participant.displayName;
    // 通知用に、更新前(エントリー削除前)にエントリー一覧を取っておく
    // (計画5-1)。
    const songs = await loadEventTree(db, event.id);
    const entries = deriveMyAssignments(songs, participantId);

    const now = Math.floor(Date.now() / 1000);
    const withdrawn = await withdrawParticipant(db, {
      eventId: event.id,
      participantId,
      now,
    });

    // 共同主催者の主催者フラグは残す。端末の紐付け解除(unbind)とは違い、
    // 主催者権限は cookie 側の別の権限なので取りやめでは失わない(計画5-1)。
    // Discord の紐付け待ちは消す(参加していた participant 自体が
    // 無くなるため)。
    await setSession(c, event.slug, {
      e: event.id,
      p: null,
      o: viewer.isOrganizer,
      pendingDiscord: null,
    });

    // 更新件数が0(同時に二重送信された等で既に取りやめ済み)のときは
    // 通知を出さない(計画4-1: 通知の二重送信を防ぐ歯止め)。
    if (withdrawn) {
      scheduleNotification(c, async () =>
        buildParticipantWithdrawnContent({
          eventTitle: event.title,
          displayName,
          entries: entries.map((entry) => ({
            songTitle: entry.songTitle,
            takeOrdinal: entry.takeOrdinal,
            slotLabel: entry.slotLabel,
          })),
        }),
      );
    }

    return renderPage(c, WithdrawnPage({ slug: event.slug }));
  },
);
