import { describe, expect, it } from "vitest";
import {
  INTERACTION_TYPE,
  readCommandName,
  readCustomId,
  readFocusedOptionValue,
  readGuildId,
  readInteractionType,
  readMember,
  readStringOptionValue,
  readSubcommand,
} from "../../src/discord/interaction";

describe("readInteractionType", () => {
  it("reads a PING interaction", () => {
    expect(readInteractionType({ type: INTERACTION_TYPE.PING })).toBe(1);
  });

  it("returns null when missing or not a number", () => {
    expect(readInteractionType({})).toBeNull();
    expect(readInteractionType({ type: "1" })).toBeNull();
    expect(readInteractionType(null)).toBeNull();
    expect(readInteractionType("not an object")).toBeNull();
    expect(readInteractionType(undefined)).toBeNull();
  });
});

describe("readGuildId", () => {
  it("reads a guild id", () => {
    expect(readGuildId({ guild_id: "123456789012345678" })).toBe("123456789012345678");
  });

  it("returns null when absent (DM) or not a string", () => {
    expect(readGuildId({})).toBeNull();
    expect(readGuildId({ guild_id: 123 })).toBeNull();
    expect(readGuildId(null)).toBeNull();
  });
});

describe("readMember", () => {
  it("reads a full member with nick/global_name/username", () => {
    const member = readMember({
      member: {
        nick: "ニック",
        user: {
          id: "123456789012345678",
          global_name: "グローバル名",
          username: "user1",
        },
      },
    });
    expect(member).toEqual({
      discordUserId: "123456789012345678",
      nick: "ニック",
      globalName: "グローバル名",
      username: "user1",
    });
  });

  it("treats missing nick/global_name as null", () => {
    const member = readMember({
      member: { user: { id: "123456789012345678", username: "user1" } },
    });
    expect(member).toEqual({
      discordUserId: "123456789012345678",
      nick: null,
      globalName: null,
      username: "user1",
    });
  });

  it("returns null when member/user is missing", () => {
    expect(readMember({})).toBeNull();
    expect(readMember({ member: {} })).toBeNull();
    expect(readMember({ member: { user: {} } })).toBeNull();
  });

  it("returns null when the user id is not a valid snowflake", () => {
    expect(readMember({ member: { user: { id: "not-a-snowflake" } } })).toBeNull();
    expect(readMember({ member: { user: { id: 123 } } })).toBeNull();
  });
});

describe("readCommandName", () => {
  it("reads the top-level command name", () => {
    expect(readCommandName({ data: { name: "bandoff" } })).toBe("bandoff");
  });

  it("returns null when missing or not a string", () => {
    expect(readCommandName({})).toBeNull();
    expect(readCommandName({ data: {} })).toBeNull();
    expect(readCommandName({ data: { name: 1 } })).toBeNull();
  });
});

describe("readSubcommand", () => {
  it("reads the subcommand name and its options", () => {
    const sub = readSubcommand({
      data: {
        name: "bandoff",
        options: [
          {
            name: "open",
            options: [{ name: "event", type: 3, value: "abc", focused: true }],
          },
        ],
      },
    });
    expect(sub).toEqual({
      name: "open",
      options: [{ name: "event", type: 3, value: "abc", focused: true }],
    });
  });

  it("returns options as an empty array when the subcommand has none", () => {
    const sub = readSubcommand({
      data: { name: "bandoff", options: [{ name: "list" }] },
    });
    expect(sub).toEqual({ name: "list", options: [] });
  });

  it("returns null when there is no subcommand or the name is missing", () => {
    expect(readSubcommand({ data: { name: "bandoff" } })).toBeNull();
    expect(readSubcommand({ data: { name: "bandoff", options: [] } })).toBeNull();
    expect(readSubcommand({ data: { name: "bandoff", options: [{}] } })).toBeNull();
    expect(
      readSubcommand({ data: { name: "bandoff", options: "not an array" } }),
    ).toBeNull();
  });
});

describe("readStringOptionValue", () => {
  it("reads a matching string option", () => {
    const options = [{ name: "event", value: "abc" }];
    expect(readStringOptionValue(options, "event")).toBe("abc");
  });

  it("returns null when not found or not a string", () => {
    expect(readStringOptionValue([], "event")).toBeNull();
    expect(readStringOptionValue([{ name: "event", value: 1 }], "event")).toBeNull();
    expect(
      readStringOptionValue([{ name: "other", value: "abc" }], "event"),
    ).toBeNull();
  });
});

describe("readFocusedOptionValue", () => {
  it("reads the value of the focused option only", () => {
    const options = [
      { name: "event", value: "typing...", focused: true },
      { name: "other", value: "ignored", focused: false },
    ];
    expect(readFocusedOptionValue(options, "event")).toBe("typing...");
  });

  it("returns null when the option is not focused or missing", () => {
    expect(readFocusedOptionValue([{ name: "event", value: "x" }], "event")).toBeNull();
    expect(readFocusedOptionValue([], "event")).toBeNull();
    expect(
      readFocusedOptionValue([{ name: "event", value: 1, focused: true }], "event"),
    ).toBeNull();
  });
});

describe("readCustomId", () => {
  it("reads the custom_id", () => {
    expect(readCustomId({ data: { custom_id: "open:abc" } })).toBe("open:abc");
  });

  it("returns null when missing or not a string", () => {
    expect(readCustomId({})).toBeNull();
    expect(readCustomId({ data: {} })).toBeNull();
    expect(readCustomId({ data: { custom_id: 1 } })).toBeNull();
  });
});
