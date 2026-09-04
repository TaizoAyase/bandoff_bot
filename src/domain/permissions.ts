/**
 * 仕様 4章(権限表)を DB に触れない純関数で表現する。
 * ルート・ミドルウェアは「事実」(誰が・何に対して)を集めてここに渡し、
 * 結果だけを見て許可/拒否とメッセージを決める。
 *
 * フェーズ1・M2 では `canAddSong` / `canJoinAs` / `canLeave` のみを実装する。
 * 残りの権限(曲削除・Take・Slot 関連・イベント編集など)は M3 で追加する。
 */

/** 操作しようとしている「今の人」の最小限の事実。 */
export interface Actor {
  participantId: string | null;
  isOrganizer: boolean;
}

export type PermissionResult = { ok: true } | { ok: false; message: string };

const OK: PermissionResult = { ok: true };

/**
 * 曲の登録。参加者登録済み(organizer フラグの有無を問わない)であれば可。
 * 仕様 114〜116行目: 参加者○・主催者○。ただし organizer フラグのみで
 * participant を持たない cookie(合言葉共有で後から入った人)は登録を要求する
 * (計画「採用する既定値」52行目)。
 */
export function canAddSong(actor: Actor): PermissionResult {
  if (actor.participantId) {
    return OK;
  }
  return { ok: false, message: "参加登録すると曲を追加できます" };
}

/**
 * 枠へのエントリー。自分自身へのエントリーは常に可。
 * 主催者は `targetParticipantId` を自分以外に指定して代理エントリーできる
 * (仕様 122〜123行目「他人のエントリー: 主催者のみ○」)。
 */
export function canJoinAs(actor: Actor, targetParticipantId: string): PermissionResult {
  if (actor.participantId === targetParticipantId) {
    return OK;
  }
  if (actor.isOrganizer) {
    return OK;
  }
  return { ok: false, message: "他の人の代わりにエントリーする権限がありません" };
}

/**
 * 枠からの辞退。自分のエントリーは常に可。他人のエントリーは主催者のみ可
 * (仕様 122行目)。
 */
export function canLeave(
  actor: Actor,
  assignmentParticipantId: string,
): PermissionResult {
  if (actor.participantId === assignmentParticipantId) {
    return OK;
  }
  if (actor.isOrganizer) {
    return OK;
  }
  return { ok: false, message: "他の人のエントリーを辞退させる権限がありません" };
}
