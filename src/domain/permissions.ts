/**
 * 仕様 4章(権限表)を DB に触れない純関数で表現する。
 * ルート・ミドルウェアは「事実」(誰が・何に対して)を集めてここに渡し、
 * 結果だけを見て許可/拒否とメッセージを決める。
 */

/** 操作しようとしている「今の人」の最小限の事実。 */
export interface Actor {
  participantId: string | null;
  isOrganizer: boolean;
}

export type PermissionResult = { ok: true } | { ok: false; message: string };

const OK: PermissionResult = { ok: true };

/**
 * 登録済み participant であることだけを要求する操作の共通判定。
 * organizer フラグのみで participant を持たない cookie(合言葉共有で後から
 * 入った人)は対象外(計画「採用する既定値」52行目)。
 */
function requireRegisteredParticipant(
  actor: Actor,
  actionLabel: string,
): PermissionResult {
  if (actor.participantId) {
    return OK;
  }
  return { ok: false, message: `参加登録すると${actionLabel}できます` };
}

/** 曲の登録。仕様 114〜116行目: 参加者○・主催者○。 */
export function canAddSong(actor: Actor): PermissionResult {
  return requireRegisteredParticipant(actor, "曲を追加");
}

/** Take の追加(全曲)。仕様: 参加者○(全曲)・主催者○。 */
export function canAddTake(actor: Actor): PermissionResult {
  return requireRegisteredParticipant(actor, "Take を追加");
}

/** 枠(Slot)の追加(全曲)。仕様: 参加者○(全曲)・主催者○。 */
export function canAddSlot(actor: Actor): PermissionResult {
  return requireRegisteredParticipant(actor, "枠を追加");
}

export interface SongOwnership {
  /** 曲を登録した participant の id。 */
  proposedBy: string;
  /** 曲内のどの Slot にも誰もエントリーしていないか。 */
  isEmpty: boolean;
}

/**
 * 曲の削除。仕様: 参加者は「自分が登録した曲かつ誰もエントリーしていない
 * 場合のみ」・主催者は常に○。
 */
export function canDeleteSong(actor: Actor, song: SongOwnership): PermissionResult {
  if (actor.isOrganizer) {
    return OK;
  }
  if (actor.participantId && actor.participantId === song.proposedBy && song.isEmpty) {
    return OK;
  }
  return {
    ok: false,
    message: "自分が登録し、誰もエントリーしていない曲のみ削除できます",
  };
}

/**
 * 曲情報の編集。仕様書には明記がないが、計画「確定した決定事項」で
 * 「曲情報は登録者と主催者が編集可」と定めている。
 */
export function canEditSong(
  actor: Actor,
  song: { proposedBy: string },
): PermissionResult {
  if (actor.isOrganizer) {
    return OK;
  }
  if (actor.participantId && actor.participantId === song.proposedBy) {
    return OK;
  }
  return { ok: false, message: "曲を登録した本人か主催者のみ編集できます" };
}

export interface TakeDeletion {
  /** この Take 内の全 Slot が空か。 */
  allSlotsEmpty: boolean;
  /** この曲が持つ Take の総数。 */
  takeCount: number;
}

/**
 * Take の削除。仕様: 参加者は「中の全Slotが空の場合のみ」・主催者は常に○。
 * ただし Take が1件だけのときは(曲が枠ゼロになるのを防ぐため)主催者でも
 * 削除できない(計画「採用する既定値」47行目)。
 */
export function canDeleteTake(actor: Actor, take: TakeDeletion): PermissionResult {
  if (take.takeCount <= 1) {
    return { ok: false, message: "最後の1回は削除できません" };
  }
  if (actor.isOrganizer) {
    return OK;
  }
  if (actor.participantId && take.allSlotsEmpty) {
    return OK;
  }
  return { ok: false, message: "中の枠がすべて空のときのみ削除できます" };
}

export interface SlotDeletion {
  /** この Slot が空(誰もエントリーしていない)か。 */
  isEmpty: boolean;
}

/**
 * 枠の削除。仕様: 参加者は「空の枠のみ(全曲)」・主催者は「○(埋まっていても)」。
 */
export function canDeleteSlot(actor: Actor, slot: SlotDeletion): PermissionResult {
  if (actor.isOrganizer) {
    return OK;
  }
  if (actor.participantId && slot.isEmpty) {
    return OK;
  }
  return { ok: false, message: "空の枠のみ削除できます" };
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

/**
 * 参加者の全エントリーの一括辞退。仕様書には明記がないが、他人のエントリーの
 * 辞退(`canLeave`)と同様に主催者のみ可とする(計画バッチA-3)。
 */
export function canLeaveAll(actor: Actor): PermissionResult {
  if (actor.isOrganizer) {
    return OK;
  }
  return { ok: false, message: "参加者の全エントリーを辞退させる権限がありません" };
}

/** イベント情報の編集。仕様 124行目: 参加者×・主催者○。 */
export function canEditEvent(actor: Actor): PermissionResult {
  if (actor.isOrganizer) {
    return OK;
  }
  return { ok: false, message: "主催者のみイベント情報を編集できます" };
}

/**
 * 自分のプロフィール(表示名・持ち込み楽器)の編集。自分自身のみ
 * (計画「確定した決定事項」28行目「参加者は自分の表示名・持ち込み楽器を編集可」)。
 * 主催者フラグによる代理編集は対象外。
 */
export function canEditProfile(
  actor: Actor,
  targetParticipantId: string,
): PermissionResult {
  if (actor.participantId && actor.participantId === targetParticipantId) {
    return OK;
  }
  return { ok: false, message: "自分のプロフィールのみ編集できます" };
}

export interface ParticipantProtection {
  /** 取りやめ・削除の対象にしようとしている participant の id。 */
  targetParticipantId: string;
  /** 対象イベントの主催者本人の participant id(仕様上 null もあり得る)。 */
  organizerParticipantId: string | null;
}

/**
 * 主催者本人の Participant を保護対象として扱う(仕様3章「主催者は
 * 必ず参加者を兼ねる」)。`organizerParticipantId` が null(スキーマ上は
 * 許容)のイベントには保護対象がない。
 */
function isOrganizersOwnParticipant(target: ParticipantProtection): boolean {
  return (
    target.organizerParticipantId !== null &&
    target.targetParticipantId === target.organizerParticipantId
  );
}

/**
 * 参加の取りやめ(本人)。自分の Participant のみ可。主催者本人の
 * Participant は本人であっても取りやめられない(計画3章)。
 */
export function canWithdraw(
  actor: Actor,
  target: ParticipantProtection,
): PermissionResult {
  if (isOrganizersOwnParticipant(target)) {
    return { ok: false, message: "主催者は参加を取りやめられません" };
  }
  if (actor.participantId && actor.participantId === target.targetParticipantId) {
    return OK;
  }
  return { ok: false, message: "自分の参加のみ取りやめられます" };
}

/**
 * 主催者による参加者の削除。主催者本人の Participant は削除できない
 * (計画3章)。主催者キーを共有された共同主催者が自分自身の Participant を
 * 外すのは可(その participant が `organizerParticipantId` と一致しない限り)。
 */
export function canRemoveParticipant(
  actor: Actor,
  target: ParticipantProtection,
): PermissionResult {
  if (isOrganizersOwnParticipant(target)) {
    return { ok: false, message: "主催者本人は参加者から外せません" };
  }
  if (actor.isOrganizer) {
    return OK;
  }
  return { ok: false, message: "主催者のみ参加者を削除できます" };
}
