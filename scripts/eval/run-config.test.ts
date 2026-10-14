import { describe, expect, it } from "vitest";
import { findLeak, leakNeedles } from "../../lib/demo/privacy";
import { childEnv, claudeArgs, parsePorcelain, runName, schedule, scrub } from "./run-config";

describe("claudeArgs", () => {
    it("pins the model and effort, drops user settings, allows read-only tools, and differs between arms only in the MCP config", () => {
        const mcp = { empty: "E.json", nebulosity: "N.json" };
        const a = claudeArgs("baseline", mcp);
        const b = claudeArgs("nebulosity", mcp);
        expect(a.filter((x, i) => x !== b[i])).toEqual(["E.json"]);
        expect(b.filter((x, i) => x !== a[i])).toEqual(["N.json"]);
        expect(a.slice(0, 6)).toEqual(["-p", "--output-format", "stream-json", "--verbose", "--model", "claude-sonnet-5-5"]);
        for (const pair of [["--effort", "medium"], ["--setting-sources", "project,local"], ["--permission-mode", "dontAsk"], ["--permission-prompts", "none"]]){
            expect(a[a.indexOf(pair[0]) + 1]).toBe(pair[1]);
        }
        expect(a).toContain("--strict-mcp-config");
        expect(a).toContain("--no-session-persistence");
        expect(a[a.indexOf("--disallowedTools") + 1]).toBe("Edit,Write,NotebookEdit,WebFetch,WebSearch,Skill,PowerShell,Monitor");
    });
});

describe("childEnv", () => {
    it("strips what would bill an API key or override a pin, in any case, and sets the eval's pins", () => {
        const env = childEnv({ PATH: "p", Anthropic_Api_Key: "sk", ANTHROPIC_AUTH_TOKEN: "t", CLAUDE_CODE_EFFORT_LEVEL: "low", ENABLE_TOOL_SEARCH: "auto" },
            { gitBash: "C:/Git/bin/bash.exe", toolSearch: true });
        expect(env).toEqual({
            PATH: "p", CLAUDE_CODE_GIT_BASH_PATH: "C:/Git/bin/bash.exe", CLAUDE_CODE_USE_POWERSHELL_TOOL: "0", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
            ENABLE_CLAUDEAI_MCP_SERVERS: "false", DISABLE_AUTOUPDATER: "1", NEBULOSITY_LIVE: "off",
        });
        expect(childEnv({}, { gitBash: "b", toolSearch: false }).ENABLE_TOOL_SEARCH).toBe("false");
        expect(childEnv({}, { gitBash: "b", toolSearch: true, configDir: "C:/eval-cfg" }).CLAUDE_CONFIG_DIR).toBe("C:/eval-cfg");
    });
});

describe("schedule", () => {
    it("runs each question in both arms, alternating which arm goes first by question and by repeat", () => {
        expect(schedule(["q1", "q2"], 2).map(runName)).toEqual([
            "q1-baseline-1", "q1-nebulosity-1", "q2-nebulosity-1", "q2-baseline-1",
            "q1-nebulosity-2", "q1-baseline-2", "q2-baseline-2", "q2-nebulosity-2",
        ]);
        expect(runName({ question: "cl2", arm: "nebulosity", repeat: 1, toolSearch: false })).toBe("cl2-nebulosity-upfront-1");
    });
});

describe("parsePorcelain and scrub", () => {
    it("lists what git status says changed", () => {
        expect(parsePorcelain(" M src/a.ts\n?? new.txt\n")).toEqual(["src/a.ts", "new.txt"]);
        expect(parsePorcelain("")).toEqual([]);
    });

    it("replaces every spelling of a folder, the deepest first, keeping JSON valid", () => {
        const text = '{"cwd":"C:\\\\Users\\\\Ann\\\\code\\\\vscode","x":"c:/users/ann/code/vscode/src/a.ts","y":"/c/Users/Ann/tmp"}';
        const out = scrub(text, [{ folder: "C:/Users/Ann", with: "~" }, { folder: "C:/Users/Ann/code/vscode", with: "<vscode>" }]);
        expect(out).toBe('{"cwd":"<vscode>","x":"<vscode>/src/a.ts","y":"~/tmp"}');
        expect(JSON.parse(out)).toEqual({ cwd: "<vscode>", x: "<vscode>/src/a.ts", y: "~/tmp" });
    });

    it("also replaces a path escaped twice, one with mixed separators, and one with only its colon encoded, so findLeak finds nothing after", () => {
        // four backslashes stand for one separator in JSON inside JSON; the others are one real backslash each at runtime
        const four = "\\".repeat(4);
        const ann = [{ folder: "C:/Users/Ann", with: "~" }];
        const needles = leakNeedles({ folders: ["C:/Users/Ann"] });
        const cases: [string, string][] = [
            [`C:${four}Users${four}Ann${four}x`, `~${four}x`],
            ["C:\\Users/Ann/y", "~/y"],
            ["C%3A%2FUsers%2FAnn", "~"],
            ["file:///c%3A/Users/Ann/z", "file:///~/z"],
            ["/c/Users\\Ann/q", "~/q"],
        ];
        for (const [text, want] of cases){
            const out = scrub(text, ann);
            expect(out).toBe(want);
            expect(findLeak(out, needles)).toBeNull();
        }
        // the deepest folder goes first in this pass too, so a mixed path inside both keeps the deeper name
        const both = [{ folder: "C:/Users/Ann", with: "~" }, { folder: "C:/Users/Ann/code/vscode", with: "<vscode>" }];
        expect(scrub("C:\\Users/Ann/code/vscode/x", both)).toBe("<vscode>/x");
    });
});
