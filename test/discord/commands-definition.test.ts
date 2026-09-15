import { describe, expect, it } from "vitest";
import commands from "../../scripts/discord-commands.json";

/**
 * コマンド登録スクリプト(`scripts/register-discord-commands.mjs`)が PUT する
 * `scripts/discord-commands.json` の定義が、ルート側
 * (`src/routes/discord-interactions.ts`)が読み取るコマンド名・サブコマンド名・
 * オプション名とずれていないことを固定する(計画9章)。
 *
 * テストは vitest-pool-workers(Workers ランタイム)上で動き `node:fs` は
 * 使えない(`nodejs_compat` フラグを立てていない)ため、`resolveJsonModule`
 * (tsconfig.json)による静的 import でバンドル時に取り込む。
 */

// biome-ignore lint/suspicious/noExplicitAny: Discord API のコマンド定義 JSON の型はここでは検証対象外
type CommandOption = any;

function loadCommands(): CommandOption[] {
  return commands;
}

function findOption(options: CommandOption[], name: string): CommandOption | undefined {
  return options.find((option: CommandOption) => option.name === name);
}

describe("scripts/discord-commands.json", () => {
  it("トップレベルのコマンドは bandoff の1つだけ", () => {
    const commands = loadCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe("bandoff");
  });

  it("サブコマンドは open・list・new の3つ(ルート側の読み取りと一致)", () => {
    const [bandoff] = loadCommands();
    const subcommandNames = bandoff.options.map((option: CommandOption) => option.name);
    expect(subcommandNames.sort()).toEqual(["list", "new", "open"]);
    // type 1 = SUB_COMMAND(Discord API)。
    for (const option of bandoff.options) {
      expect(option.type).toBe(1);
    }
  });

  it("open は必須・autocomplete 付きの文字列オプション event を1つだけ持つ", () => {
    const [bandoff] = loadCommands();
    const open = findOption(bandoff.options, "open");
    expect(open).toBeDefined();
    expect(open.options).toHaveLength(1);
    const eventOption = findOption(open.options, "event");
    expect(eventOption).toBeDefined();
    // type 3 = STRING(Discord API)。
    expect(eventOption.type).toBe(3);
    expect(eventOption.required).toBe(true);
    expect(eventOption.autocomplete).toBe(true);
  });

  it("list・new はオプションを持たない", () => {
    const [bandoff] = loadCommands();
    const list = findOption(bandoff.options, "list");
    const newCommand = findOption(bandoff.options, "new");
    expect(list?.options ?? []).toHaveLength(0);
    expect(newCommand?.options ?? []).toHaveLength(0);
  });

  it("1サーバーだけで使える設定(contexts・integration_types)になっている", () => {
    const [bandoff] = loadCommands();
    // 0 = GUILD(contexts) / GUILD_INSTALL(integration_types)。
    expect(bandoff.contexts).toEqual([0]);
    expect(bandoff.integration_types).toEqual([0]);
  });

  it("すべての説明文が Discord の上限(100文字)以内", () => {
    const [bandoff] = loadCommands();
    expect(bandoff.description.length).toBeLessThanOrEqual(100);
    for (const option of bandoff.options) {
      expect(option.description.length).toBeLessThanOrEqual(100);
      for (const subOption of option.options ?? []) {
        expect(subOption.description.length).toBeLessThanOrEqual(100);
      }
    }
  });
});
