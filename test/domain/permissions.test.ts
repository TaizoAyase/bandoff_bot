import { describe, expect, it } from "vitest";
import {
  canAddSlot,
  canAddSong,
  canAddTake,
  canDeleteSlot,
  canDeleteSong,
  canDeleteTake,
  canEditEvent,
  canEditProfile,
  canEditSong,
  canJoinAs,
  canLeave,
  canLeaveAll,
  canRemoveParticipant,
  canWithdraw,
} from "../../src/domain/permissions";

// 仕様 4章(112〜124行目)の権限表をテーブル駆動で確認する。
describe("仕様 4章の権限表", () => {
  it.each([
    { label: "曲の登録: 参加者", actor: { participantId: "p1", isOrganizer: false } },
    { label: "曲の登録: 主催者", actor: { participantId: "p1", isOrganizer: true } },
  ])("$label -> ○", ({ actor }) => {
    expect(canAddSong(actor).ok).toBe(true);
  });

  it("曲の登録: 未登録者 -> ×", () => {
    expect(canAddSong({ participantId: null, isOrganizer: false }).ok).toBe(false);
    expect(canAddSong({ participantId: null, isOrganizer: true }).ok).toBe(false);
  });

  it.each([
    {
      label: "曲の削除: 登録者本人かつ空",
      actor: { participantId: "p1", isOrganizer: false },
      song: { proposedBy: "p1", isEmpty: true },
      expected: true,
    },
    {
      label: "曲の削除: 登録者本人だがエントリーあり",
      actor: { participantId: "p1", isOrganizer: false },
      song: { proposedBy: "p1", isEmpty: false },
      expected: false,
    },
    {
      label: "曲の削除: 他人が登録した曲",
      actor: { participantId: "p2", isOrganizer: false },
      song: { proposedBy: "p1", isEmpty: true },
      expected: false,
    },
    {
      label: "曲の削除: 主催者はエントリーがあっても○",
      actor: { participantId: "p2", isOrganizer: true },
      song: { proposedBy: "p1", isEmpty: false },
      expected: true,
    },
  ])("$label -> $expected", ({ actor, song, expected }) => {
    expect(canDeleteSong(actor, song).ok).toBe(expected);
  });

  it.each([
    { actor: { participantId: "p1", isOrganizer: false }, expected: true },
    { actor: { participantId: "p1", isOrganizer: true }, expected: true },
    { actor: { participantId: null, isOrganizer: false }, expected: false },
    { actor: { participantId: null, isOrganizer: true }, expected: false },
  ])("Takeの追加(全曲): $actor -> $expected", ({ actor, expected }) => {
    expect(canAddTake(actor).ok).toBe(expected);
  });

  it.each([
    {
      label: "Takeの削除: 参加者・全枠空・2件以上",
      actor: { participantId: "p1", isOrganizer: false },
      take: { allSlotsEmpty: true, takeCount: 2 },
      expected: true,
    },
    {
      label: "Takeの削除: 参加者・埋まっている枠あり",
      actor: { participantId: "p1", isOrganizer: false },
      take: { allSlotsEmpty: false, takeCount: 2 },
      expected: false,
    },
    {
      label: "Takeの削除: 主催者は埋まっていても○(2件以上なら)",
      actor: { participantId: "p1", isOrganizer: true },
      take: { allSlotsEmpty: false, takeCount: 2 },
      expected: true,
    },
    {
      label: "Takeの削除: 最後の1件は主催者でも×",
      actor: { participantId: "p1", isOrganizer: true },
      take: { allSlotsEmpty: true, takeCount: 1 },
      expected: false,
    },
    {
      label: "Takeの削除: 未登録者は空でも×",
      actor: { participantId: null, isOrganizer: false },
      take: { allSlotsEmpty: true, takeCount: 2 },
      expected: false,
    },
  ])("$label -> $expected", ({ actor, take, expected }) => {
    expect(canDeleteTake(actor, take).ok).toBe(expected);
  });

  it.each([
    { actor: { participantId: "p1", isOrganizer: false }, expected: true },
    { actor: { participantId: null, isOrganizer: false }, expected: false },
  ])("枠(Slot)の追加(全曲): $actor -> $expected", ({ actor, expected }) => {
    expect(canAddSlot(actor).ok).toBe(expected);
  });

  it.each([
    {
      label: "枠の削除: 参加者・空枠",
      actor: { participantId: "p1", isOrganizer: false },
      slot: { isEmpty: true },
      expected: true,
    },
    {
      label: "枠の削除: 参加者・埋まっている枠",
      actor: { participantId: "p1", isOrganizer: false },
      slot: { isEmpty: false },
      expected: false,
    },
    {
      label: "枠の削除: 主催者は埋まっていても○",
      actor: { participantId: "p1", isOrganizer: true },
      slot: { isEmpty: false },
      expected: true,
    },
    {
      label: "枠の削除: 未登録者は空枠でも×",
      actor: { participantId: null, isOrganizer: false },
      slot: { isEmpty: true },
      expected: false,
    },
  ])("$label -> $expected", ({ actor, slot, expected }) => {
    expect(canDeleteSlot(actor, slot).ok).toBe(expected);
  });

  it.each([
    {
      label: "自分のエントリー: 参加者が自分に対して",
      actor: { participantId: "p1", isOrganizer: false },
      target: "p1",
      expected: true,
    },
    {
      label: "他人のエントリー: 参加者は×",
      actor: { participantId: "p1", isOrganizer: false },
      target: "p2",
      expected: false,
    },
    {
      label: "他人のエントリー: 主催者は○",
      actor: { participantId: "p1", isOrganizer: true },
      target: "p2",
      expected: true,
    },
    {
      label: "他人のエントリー: 未登録の主催者フラグのみでも○",
      actor: { participantId: null, isOrganizer: true },
      target: "p2",
      expected: true,
    },
  ])("$label -> $expected", ({ actor, target, expected }) => {
    expect(canJoinAs(actor, target).ok).toBe(expected);
  });

  it.each([
    {
      label: "自分のエントリー(辞退): 参加者が自分に対して",
      actor: { participantId: "p1", isOrganizer: false },
      assignmentParticipantId: "p1",
      expected: true,
    },
    {
      label: "他人のエントリー(辞退): 参加者は×",
      actor: { participantId: "p1", isOrganizer: false },
      assignmentParticipantId: "p2",
      expected: false,
    },
    {
      label: "他人のエントリー(辞退): 主催者は○",
      actor: { participantId: "p1", isOrganizer: true },
      assignmentParticipantId: "p2",
      expected: true,
    },
  ])("$label -> $expected", ({ actor, assignmentParticipantId, expected }) => {
    expect(canLeave(actor, assignmentParticipantId).ok).toBe(expected);
  });

  it("返るメッセージは日本語(空文字列でない)", () => {
    const result = canLeave({ participantId: "p1", isOrganizer: false }, "p2");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it.each([
    {
      label: "参加者の全エントリー一括辞退: 主催者",
      actor: { participantId: "p1", isOrganizer: true },
      expected: true,
    },
    {
      label: "参加者の全エントリー一括辞退: 参加者は×",
      actor: { participantId: "p1", isOrganizer: false },
      expected: false,
    },
    {
      label: "参加者の全エントリー一括辞退: 未登録の主催者フラグのみでも○",
      actor: { participantId: null, isOrganizer: true },
      expected: true,
    },
  ])("$label -> $expected", ({ actor, expected }) => {
    expect(canLeaveAll(actor).ok).toBe(expected);
  });

  it.each([
    { actor: { participantId: "p1", isOrganizer: false }, expected: false },
    { actor: { participantId: "p1", isOrganizer: true }, expected: true },
    { actor: { participantId: null, isOrganizer: true }, expected: true },
  ])("イベント情報の編集: $actor -> $expected", ({ actor, expected }) => {
    expect(canEditEvent(actor).ok).toBe(expected);
  });
});

describe("canEditSong(登録者と主催者が編集可)", () => {
  it.each([
    {
      actor: { participantId: "p1", isOrganizer: false },
      song: { proposedBy: "p1" },
      expected: true,
    },
    {
      actor: { participantId: "p2", isOrganizer: false },
      song: { proposedBy: "p1" },
      expected: false,
    },
    {
      actor: { participantId: "p2", isOrganizer: true },
      song: { proposedBy: "p1" },
      expected: true,
    },
  ])("actor=$actor song=$song -> $expected", ({ actor, song, expected }) => {
    expect(canEditSong(actor, song).ok).toBe(expected);
  });
});

describe("canEditProfile(自分のみ、主催者フラグでの代理は不可)", () => {
  it.each([
    {
      actor: { participantId: "p1", isOrganizer: false },
      target: "p1",
      expected: true,
    },
    {
      actor: { participantId: "p1", isOrganizer: false },
      target: "p2",
      expected: false,
    },
    {
      actor: { participantId: "p1", isOrganizer: true },
      target: "p2",
      expected: false,
    },
    {
      actor: { participantId: null, isOrganizer: true },
      target: "p2",
      expected: false,
    },
  ])("actor=$actor target=$target -> $expected", ({ actor, target, expected }) => {
    expect(canEditProfile(actor, target).ok).toBe(expected);
  });
});

// 2026-09-15 追加分: 参加の取りやめ・主催者による参加者の削除の権限表。
describe("canWithdraw(参加の取りやめ、本人のみ・主催者本人は不可)", () => {
  it.each([
    {
      label: "本人による取りやめ",
      actor: { participantId: "p1", isOrganizer: false },
      target: { targetParticipantId: "p1", organizerParticipantId: "org" },
      expected: true,
    },
    {
      label: "他人の participant は取りやめられない",
      actor: { participantId: "p1", isOrganizer: false },
      target: { targetParticipantId: "p2", organizerParticipantId: "org" },
      expected: false,
    },
    {
      label: "主催者フラグのみでは他人を取りやめられない",
      actor: { participantId: null, isOrganizer: true },
      target: { targetParticipantId: "p2", organizerParticipantId: "org" },
      expected: false,
    },
    {
      label: "主催者本人の Participant は本人であっても不可",
      actor: { participantId: "org", isOrganizer: true },
      target: { targetParticipantId: "org", organizerParticipantId: "org" },
      expected: false,
    },
    {
      label: "organizerParticipantId が null なら保護対象がない",
      actor: { participantId: "p1", isOrganizer: false },
      target: { targetParticipantId: "p1", organizerParticipantId: null },
      expected: true,
    },
  ])("$label -> $expected", ({ actor, target, expected }) => {
    expect(canWithdraw(actor, target).ok).toBe(expected);
  });

  it("主催者本人の取りやめを拒否するメッセージは日本語", () => {
    const result = canWithdraw(
      { participantId: "org", isOrganizer: true },
      { targetParticipantId: "org", organizerParticipantId: "org" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("主催者は参加を取りやめられません");
    }
  });
});

describe("canRemoveParticipant(参加者の削除、主催者のみ・主催者本人は不可)", () => {
  it.each([
    {
      label: "主催者による他人の削除",
      actor: { participantId: "org", isOrganizer: true },
      target: { targetParticipantId: "p1", organizerParticipantId: "org" },
      expected: true,
    },
    {
      label: "主催者フラグのみ(未登録)でも○",
      actor: { participantId: null, isOrganizer: true },
      target: { targetParticipantId: "p1", organizerParticipantId: "org" },
      expected: true,
    },
    {
      label: "参加者は他人を削除できない",
      actor: { participantId: "p2", isOrganizer: false },
      target: { targetParticipantId: "p1", organizerParticipantId: "org" },
      expected: false,
    },
    {
      label: "参加者は自分自身も削除できない(canWithdrawとは別の操作)",
      actor: { participantId: "p1", isOrganizer: false },
      target: { targetParticipantId: "p1", organizerParticipantId: "org" },
      expected: false,
    },
    {
      label: "主催者本人の Participant は共同主催者でも削除できない",
      actor: { participantId: "p2", isOrganizer: true },
      target: { targetParticipantId: "org", organizerParticipantId: "org" },
      expected: false,
    },
    {
      label: "organizerParticipantId が null なら保護対象がない",
      actor: { participantId: "org", isOrganizer: true },
      target: { targetParticipantId: "p1", organizerParticipantId: null },
      expected: true,
    },
  ])("$label -> $expected", ({ actor, target, expected }) => {
    expect(canRemoveParticipant(actor, target).ok).toBe(expected);
  });

  it("主催者本人を削除しようとしたときのメッセージは日本語", () => {
    const result = canRemoveParticipant(
      { participantId: "org", isOrganizer: true },
      { targetParticipantId: "org", organizerParticipantId: "org" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("主催者本人は参加者から外せません");
    }
  });
});
