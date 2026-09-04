import { describe, expect, it } from "vitest";
import { canAddSong, canJoinAs, canLeave } from "../../src/domain/permissions";

describe("canAddSong", () => {
  it.each([
    { actor: { participantId: "p1", isOrganizer: false }, expected: true },
    { actor: { participantId: "p1", isOrganizer: true }, expected: true },
    { actor: { participantId: null, isOrganizer: false }, expected: false },
    { actor: { participantId: null, isOrganizer: true }, expected: false },
  ])(
    "participantId=$actor.participantId isOrganizer=$actor.isOrganizer -> $expected",
    ({ actor, expected }) => {
      expect(canAddSong(actor).ok).toBe(expected);
    },
  );
});

describe("canJoinAs", () => {
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
      expected: true,
    },
    {
      actor: { participantId: null, isOrganizer: false },
      target: "p2",
      expected: false,
    },
  ])("actor=$actor target=$target -> $expected", ({ actor, target, expected }) => {
    expect(canJoinAs(actor, target).ok).toBe(expected);
  });
});

describe("canLeave", () => {
  it.each([
    {
      actor: { participantId: "p1", isOrganizer: false },
      assignmentParticipantId: "p1",
      expected: true,
    },
    {
      actor: { participantId: "p1", isOrganizer: false },
      assignmentParticipantId: "p2",
      expected: false,
    },
    {
      actor: { participantId: "p1", isOrganizer: true },
      assignmentParticipantId: "p2",
      expected: true,
    },
  ])(
    "actor=$actor assignmentParticipantId=$assignmentParticipantId -> $expected",
    ({ actor, assignmentParticipantId, expected }) => {
      expect(canLeave(actor, assignmentParticipantId).ok).toBe(expected);
    },
  );

  it("returns a Japanese message when denied", () => {
    const result = canLeave({ participantId: "p1", isOrganizer: false }, "p2");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message.length).toBeGreaterThan(0);
    }
  });
});
