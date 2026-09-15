import { describe, expect, it } from "vitest";
import { isValidDiscordSnowflake } from "../../src/domain/discord";

describe("isValidDiscordSnowflake", () => {
  it("accepts a typical 18-digit snowflake", () => {
    expect(isValidDiscordSnowflake("123456789012345678")).toBe(true);
  });

  it("accepts the shortest (1 digit) and longest (20 digit) forms", () => {
    expect(isValidDiscordSnowflake("1")).toBe(true);
    expect(isValidDiscordSnowflake("1".repeat(20))).toBe(true);
  });

  it("rejects 21 or more digits", () => {
    expect(isValidDiscordSnowflake("1".repeat(21))).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidDiscordSnowflake("")).toBe(false);
  });

  it("rejects non-digit characters", () => {
    expect(isValidDiscordSnowflake("12345abc")).toBe(false);
    expect(isValidDiscordSnowflake("-123456789012345678")).toBe(false);
    expect(isValidDiscordSnowflake("123456789012345678.0")).toBe(false);
  });

  it("rejects surrounding whitespace", () => {
    expect(isValidDiscordSnowflake(" 123456789012345678")).toBe(false);
    expect(isValidDiscordSnowflake("123456789012345678 ")).toBe(false);
  });
});
