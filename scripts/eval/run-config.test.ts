import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { findLeak, leakNeedles } from "../../lib/demo/privacy";
import {
    QUESTION_ORDER, attemptsSoFar, childEnv, claudeArgs, devMismatch, devSchedule, formatLine, isStripped, parseArms, parsePorcelain, promptFor, rawFileName, repeatProblem, rulesSentence, runName, schedule, scratchFolder, singleQuestionIds,
    scratchRule, scrub, sessionArgs, statusArgs, statusDifference, utilizationCheck,
} from "./run-config";

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

    it("strips every variable of the Claude Code session that launches the runner (CLAUDE*, ANTHROPIC_*, MCP_*, in any case), keeps the rest, then sets the pins", () => {
        const base = {
            CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", MCP_CONNECTION_NONBLOCKING: "true", ANTHROPIC_BASE_URL: "http://x",
            claude_code_child_session: "1", USERPROFILE: "C:/Users/Ann", PATH: "p",
        };
        const pins = {
            CLAUDE_CODE_GIT_BASH_PATH: "b", CLAUDE_CODE_USE_POWERSHELL_TOOL: "0", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
            ENABLE_CLAUDEAI_MCP_SERVERS: "false", DISABLE_AUTOUPDATER: "1", NEBULOSITY_LIVE: "off",
        };
        expect(childEnv(base, { gitBash: "b", toolSearch: true })).toEqual({ USERPROFILE: "C:/Users/Ann", PATH: "p", ...pins });
        // a pin's name inside a stripped namespace is stripped from the base first, so the pin's value wins
        expect(childEnv({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0", ENABLE_CLAUDEAI_MCP_SERVERS: "true" }, { gitBash: "b", toolSearch: true })).toEqual(pins);
    });

    it("knows which names it strips", () => {
        for (const name of ["CLAUDECODE", "claude_code_child_session", "CLAUDE_AGENT_SDK_VERSION", "ANTHROPIC_BASE_URL", "mcp_connection_nonblocking", "ENABLE_TOOL_SEARCH", "CLAUDE_CODE_USE_FOUNDRY"]){
            expect(isStripped(name), name).toBe(true);
        }
        for (const name of ["PATH", "USERPROFILE", "APPDATA", "HOME", "NEBULOSITY_LIVE", "ENABLE_CLAUDEAI_MCP_SERVERS", "DISABLE_AUTOUPDATER"]){
            expect(isStripped(name), name).toBe(false);
        }
    });
});

describe("schedule", () => {
    it("runs each question in three arms, alternating which of A and B goes first by question and by repeat, the up-front run after the pair", () => {
        expect(schedule(["q1", "q2"], 2).map(runName)).toEqual([
            "q1-baseline-1", "q1-nebulosity-1", "q1-nebulosity-upfront-1", "q2-nebulosity-1", "q2-baseline-1", "q2-nebulosity-upfront-1",
            "q1-nebulosity-2", "q1-baseline-2", "q1-nebulosity-upfront-2", "q2-baseline-2", "q2-nebulosity-2", "q2-nebulosity-upfront-2",
        ]);
        expect(runName({ question: "cl2", arm: "nebulosity", repeat: 1, toolSearch: false })).toBe("cl2-nebulosity-upfront-1");
    });

    it("takes which arm goes first from a question's place in the whole list, so choosing some questions changes no arm order", () => {
        const all = ["q1", "q2", "q3"];
        // q2 is at index 1: (1 + repeat - 1) % 2 is 1 for repeat 1 (nebulosity first) and 0 for repeat 2 (baseline first)
        expect(schedule(["q2"], 2, all).map(runName)).toEqual([
            "q2-nebulosity-1", "q2-baseline-1", "q2-nebulosity-upfront-1", "q2-baseline-2", "q2-nebulosity-2", "q2-nebulosity-upfront-2",
        ]);
        // q3 is at index 2 and q1 at index 0: both even, so baseline first at repeat 1, in the order asked
        expect(schedule(["q3", "q1"], 1, all).map(runName)).toEqual([
            "q3-baseline-1", "q3-nebulosity-1", "q3-nebulosity-upfront-1", "q1-baseline-1", "q1-nebulosity-1", "q1-nebulosity-upfront-1",
        ]);
        expect(() => schedule(["q9"], 1, all)).toThrow(/q9/);
    });

    it("gives the pilot the arm order the full run will give BP4, CL2 and CN3 (D2's order puts them at indexes 3, 6 and 12)", () => {
        expect(QUESTION_ORDER).toHaveLength(15);
        expect(["bp4", "cl2", "cn3"].map((id) => QUESTION_ORDER.indexOf(id))).toEqual([3, 6, 12]);
        expect(schedule(["bp4", "cl2", "cn3"], 1, QUESTION_ORDER).map(runName)).toEqual([
            "bp4-nebulosity-1", "bp4-baseline-1", "bp4-nebulosity-upfront-1", "cl2-baseline-1", "cl2-nebulosity-1", "cl2-nebulosity-upfront-1",
            "cn3-baseline-1", "cn3-nebulosity-1", "cn3-nebulosity-upfront-1",
        ]);
    });

    it("plans CL1 and CL2 over two repeats as twelve runs: cl1 (place 5) B first at repeat 1, cl2 (place 6) A first, both flipped at repeat 2", () => {
        expect(schedule(["cl1", "cl2"], 2, QUESTION_ORDER).map(runName)).toEqual([
            "cl1-nebulosity-1", "cl1-baseline-1", "cl1-nebulosity-upfront-1", "cl2-baseline-1", "cl2-nebulosity-1", "cl2-nebulosity-upfront-1",
            "cl1-baseline-2", "cl1-nebulosity-2", "cl1-nebulosity-upfront-2", "cl2-nebulosity-2", "cl2-baseline-2", "cl2-nebulosity-upfront-2",
        ]);
    });
});

describe("utilizationCheck", () => {
    const limits = { fiveHour: 0.9, sevenDay: 0.85 };

    it("lets a batch go on while both windows are under their thresholds", () => {
        expect(utilizationCheck({ fiveHour: 0.4, sevenDay: 0.6 }, limits, 1)).toEqual({ unwatched: 0, warning: null, stop: null, giveUp: null });
    });

    it("stops cleanly at a threshold, the 7-day window first, and counts a window at its threshold as past it", () => {
        expect(utilizationCheck({ fiveHour: 0.4, sevenDay: 0.85 }, limits, 0).stop).toBe("the 7-day window is at 0.85 (threshold 0.85)");
        expect(utilizationCheck({ fiveHour: 0.95, sevenDay: 0.5 }, limits, 0).stop).toBe("the 5-hour window is at 0.95 (threshold 0.9)");
        expect(utilizationCheck({ fiveHour: 0.95, sevenDay: 0.9 }, limits, 0).stop).toBe("the 7-day window is at 0.90 (threshold 0.85)");
        // one figure missing still leaves the other one watched
        expect(utilizationCheck({ fiveHour: null, sevenDay: 0.9 }, limits, 1)).toEqual({
            unwatched: 0, warning: null, stop: "the 7-day window is at 0.90 (threshold 0.85)", giveUp: null,
        });
    });

    it("warns when a run reports neither window, and gives up after two such runs in a row", () => {
        const none = { fiveHour: null, sevenDay: null };
        expect(utilizationCheck(none, limits, 0)).toEqual({
            unwatched: 1, stop: null, giveUp: null,
            warning: "WARNING: this run reported neither the 5-hour nor the 7-day window, so the thresholds are not being watched.",
        });
        const second = utilizationCheck(none, limits, 1);
        expect(second.unwatched).toBe(2);
        expect(second.giveUp).toBe("two runs in a row reported neither the 5-hour nor the 7-day window, so the thresholds can't be enforced");
    });
});

describe("rawFileName and attemptsSoFar", () => {
    it("names a raw transcript by run and start time (UTC), so a re-run keeps the earlier one", () => {
        const at = new Date("2026-10-14T06:07:08.123Z");
        expect(rawFileName("bp4-baseline-1", at, "jsonl")).toBe("bp4-baseline-1.20261014T060708.jsonl");
        expect(rawFileName("bp4-baseline-1", at, "stderr.txt")).toBe("bp4-baseline-1.20261014T060708.stderr.txt");
    });

    it("counts a run's earlier attempts by its transcripts only, never another run's whose name starts the same", () => {
        const files = [
            "bp4-nebulosity-1.20261014T060708.jsonl", "bp4-nebulosity-1.20261014T060708.stderr.txt", "bp4-nebulosity-1.20261014T071500.jsonl",
            "bp4-nebulosity-upfront-1.20261014T060708.jsonl", "bp4-nebulosity-11.20261014T060708.jsonl", "notes.txt",
        ];
        expect(attemptsSoFar("bp4-nebulosity-1", files)).toBe(2);
        expect(attemptsSoFar("bp4-nebulosity-upfront-1", files)).toBe(1);
        expect(attemptsSoFar("cl2-baseline-1", files)).toBe(0);
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

    it("also replaces Claude Code's project-folder name for a folder (C--Users-Ann-code-vscode), the deepest first, so findLeak finds nothing after", () => {
        const both = [{ folder: "C:/Users/Ann", with: "~" }, { folder: "C:/Users/Ann/code/vscode", with: "<vscode>" }];
        const out = scrub("projects/C--Users-Ann-code-vscode/memory and C--Users-Ann/x", both);
        expect(out).toBe("projects/<vscode>/memory and ~/x");
        expect(findLeak(out, leakNeedles({ folders: ["C:/Users/Ann", "C:/Users/Ann/code/vscode"] }))).toBeNull();
    });
});

describe("scripts allowed (Eval #2)", () => {
    const mcp = { empty: "e.json", nebulosity: "n.json" };

    it("allows node scripts and edits under the run's scratch folder when scripts are on, and denies edits otherwise", () => {
        const scratch = "C:/Users/Ann/Nebulosity/.nebulosity/eval2/scratch/vscode-cn1-baseline-1";
        const args = claudeArgs("baseline", mcp, undefined, { scratch });
        const allowed = args[args.indexOf("--allowedTools") + 1].split(",");
        expect(allowed).toContain("Bash(node:*)");
        expect(allowed).toContain("Edit(//c/Users/Ann/Nebulosity/.nebulosity/eval2/scratch/vscode-cn1-baseline-1/**)");
        expect(args[args.indexOf("--disallowedTools") + 1].split(",")).toEqual(["NotebookEdit", "WebFetch", "WebSearch", "Skill", "PowerShell", "Monitor"]);
        expect(args.slice(args.indexOf("--add-dir"), args.indexOf("--add-dir") + 2)).toEqual(["--add-dir", scratch]);
        expect(claudeArgs("baseline", mcp)).not.toContain("--add-dir");
    });

    it("writes a rule's absolute path as // and the path, with a Windows drive as its letter", () => {
        expect(scratchRule("C:/a b/scratch")).toBe("//c/a b/scratch/**");
        expect(scratchRule("/home/ann/scratch/")).toBe("//home/ann/scratch/**");
    });

    it("adds the owner's scratch sentence after the format line, naming the Write tool, node and node -e", () => {
        expect(promptFor({ prompt: "Q?", family: "chain" }, { chain: "End with ANSWER." }, "C:/s")).toBe(
            "Q?\n\nEnd with ANSWER.\n\nYou may write Node.js scripts in C:/s with the Write tool and run them with node (or run node -e); nowhere else, and don't change any file in the repository.");
        expect(promptFor({ prompt: "Q?", family: "chain" }, { chain: "End with ANSWER." })).toBe("Q?\n\nEnd with ANSWER.");
    });

    it("schedules two arms without the up-front run when asked, alternating which goes first over three repeats", () => {
        const runs = schedule(["a", "b"], 3, ["a", "b"], { upfront: false }).map(runName);
        expect(runs).toEqual([
            "a-baseline-1", "a-nebulosity-1", "b-nebulosity-1", "b-baseline-1",
            "a-nebulosity-2", "a-baseline-2", "b-baseline-2", "b-nebulosity-2",
            "a-baseline-3", "a-nebulosity-3", "b-nebulosity-3", "b-baseline-3",
        ]);
    });
});

describe("an opaque scratch folder (R6 as fixed)", () => {
    const mcp = { empty: "e.json", nebulosity: "n.json" };
    const question = { prompt: "Q?", family: "chain" };
    const formats = { chain: "End with ANSWER." };

    it("builds the folder from the system temp folder and a hex name, with forward slashes and no trailing slash", () => {
        expect(scratchFolder("C:\\Users\\Ann\\AppData\\Local\\Temp\\", "0a1b2c3d4e5f6071")).toBe("C:/Users/Ann/AppData/Local/Temp/eval-scratch/0a1b2c3d4e5f6071");
        expect(scratchFolder("/tmp", "ff")).toBe("/tmp/eval-scratch/ff");
    });

    it("gives both arms the same prompt, --add-dir and permission rules for the same scratch folder: only the MCP config differs", () => {
        const scratch = scratchFolder("C:/Temp", "0a1b2c3d4e5f6071");
        const a = claudeArgs("baseline", mcp, undefined, { scratch });
        const n = claudeArgs("nebulosity", mcp, undefined, { scratch });
        expect(a.filter((x, i) => x !== n[i])).toEqual(["e.json"]);
        expect(n.filter((x, i) => x !== a[i])).toEqual(["n.json"]);
        expect(a[a.indexOf("--add-dir") + 1]).toBe("C:/Temp/eval-scratch/0a1b2c3d4e5f6071");
        expect(a[a.indexOf("--allowedTools") + 1]).toContain("Edit(//c/Temp/eval-scratch/0a1b2c3d4e5f6071/**)");
        expect(promptFor(question, formats, scratch)).toContain("scripts in C:/Temp/eval-scratch/0a1b2c3d4e5f6071 with the Write tool");
        // neither the folder nor the prompt carries an arm or a run name
        expect(scratch).not.toMatch(/baseline|nebulosity/i);
    });

    it("scrubs a transcript's scratch folder to <scratch>, before the home folder becomes ~", () => {
        const scratch = "C:/Users/Ann/AppData/Local/Temp/eval-scratch/0a1b2c3d4e5f6071";
        const text = `{"cmd":"node ${scratch}/count.js","note":"home C:/Users/Ann/code"}`;
        expect(scrub(text, [{ folder: "C:/Users/Ann", with: "~" }, { folder: scratch, with: "<scratch>" }]))
            .toBe('{"cmd":"node <scratch>/count.js","note":"home ~/code"}');
    });
});

describe("the shell preset (ADR-057, amended 2026-10-15)", () => {
    const mcp = { empty: "E.json", nebulosity: "N.json" };
    const pins = { model: "claude-sonnet-5-5", effort: "medium", maxTurns: 80, maxBudgetUsd: 4, sessionMaxBudgetUsd: 10 };
    const scratch = "C:/Temp/eval-scratch/ab";
    const READ_ONLY = "Read,Grep,Glob,Agent,Bash(git grep:*),Bash(git ls-files:*),Bash(git log:*),Bash(git show:*),"
        + "Bash(rg:*),Bash(grep:*),Bash(ls:*),Bash(cat:*),Bash(head:*),Bash(tail:*),Bash(wc:*),Bash(sort:*),Bash(uniq:*),Bash(find:*),mcp__nebulosity";
    // Eval #2's A command, as its method in docs/EVAL_RESULTS.md prints it ("The command"), with this scratch folder
    const EVAL2_A = [
        "-p", "--output-format", "stream-json", "--verbose",
        "--model", "claude-sonnet-5-5", "--effort", "medium",
        "--max-turns", "80", "--max-budget-usd", "4",
        "--setting-sources", "project,local",
        "--strict-mcp-config", "--mcp-config", "E.json",
        "--permission-mode", "dontAsk", "--permission-prompts", "none",
        "--allowedTools", `${READ_ONLY},Bash(node:*),Edit(//c/Temp/eval-scratch/ab/**)`,
        "--disallowedTools", "NotebookEdit,WebFetch,WebSearch,Skill,PowerShell,Monitor",
        "--add-dir", "C:/Temp/eval-scratch/ab",
        "--no-session-persistence",
    ];

    it("unset, Eval #2's arguments are as they were, byte for byte, and Eval #1's too", () => {
        expect(claudeArgs("baseline", mcp, pins, { scratch })).toEqual(EVAL2_A);
        expect(claudeArgs("baseline", mcp, pins, { scratch, shell: undefined })).toEqual(EVAL2_A);
        // Eval #1: no scripts, so no node, no Edit rule, no --add-dir, and Edit and Write stay denied
        expect(claudeArgs("baseline", mcp, pins)).toEqual([
            "-p", "--output-format", "stream-json", "--verbose",
            "--model", "claude-sonnet-5-5", "--effort", "medium",
            "--max-turns", "80", "--max-budget-usd", "4",
            "--setting-sources", "project,local",
            "--strict-mcp-config", "--mcp-config", "E.json",
            "--permission-mode", "dontAsk", "--permission-prompts", "none",
            "--allowedTools", READ_ONLY,
            "--disallowedTools", "Edit,Write,NotebookEdit,WebFetch,WebSearch,Skill,PowerShell,Monitor",
            "--no-session-persistence",
        ]);
    });

    it("on, both arms allow cd and echo after the scripts rules, and still differ only in the MCP config", () => {
        const a = claudeArgs("baseline", mcp, pins, { scratch, shell: "compound" });
        const n = claudeArgs("nebulosity", mcp, pins, { scratch, shell: "compound" });
        const at = EVAL2_A.indexOf("--allowedTools") + 1;
        expect(a).toEqual(EVAL2_A.map((x, i) => (i === at ? `${READ_ONLY},Bash(node:*),Edit(//c/Temp/eval-scratch/ab/**),Bash(cd:*),Bash(echo:*)` : x)));
        expect(a.filter((x, i) => x !== n[i])).toEqual(["E.json"]);
        expect(n.filter((x, i) => x !== a[i])).toEqual(["N.json"]);
        // without scripts, the preset follows the read-only list
        const noScripts = claudeArgs("baseline", mcp, pins, { shell: "compound" });
        expect(noScripts[noScripts.indexOf("--allowedTools") + 1]).toBe(`${READ_ONLY},Bash(cd:*),Bash(echo:*)`);
    });

    it("a session gets the same rules", () => {
        const session = sessionArgs("baseline", mcp, pins, { scratch, shell: "compound" });
        expect(session[session.indexOf("--allowedTools") + 1]).toBe(`${READ_ONLY},Bash(node:*),Edit(//c/Temp/eval-scratch/ab/**),Bash(cd:*),Bash(echo:*)`);
    });
});

describe("sessionArgs", () => {
    const mcp = { empty: "E.json", nebulosity: "N.json" };
    const pins = { model: "claude-sonnet-5-5", effort: "medium", maxTurns: 80, maxBudgetUsd: 4, sessionMaxBudgetUsd: 10 };

    it("is claudeArgs with stream-json input and the replayed user messages, and the session's budget in place of a single run's", () => {
        const single = claudeArgs("nebulosity", mcp, pins);
        const session = sessionArgs("nebulosity", mcp, pins);
        expect(session.slice(-3)).toEqual(["--input-format", "stream-json", "--replay-user-messages"]);
        expect(session[session.indexOf("--max-budget-usd") + 1]).toBe("10");
        expect(single[single.indexOf("--max-budget-usd") + 1]).toBe("4");
        // nothing else differs
        expect(session.slice(0, -3).filter((x, i) => x !== single[i])).toEqual(["10"]);
    });

    it("keeps the scripts rules and still differs between arms only in the MCP config", () => {
        const a = sessionArgs("baseline", mcp, pins, { scratch: "C:/tmp/eval-scratch/ab" });
        const n = sessionArgs("nebulosity", mcp, pins, { scratch: "C:/tmp/eval-scratch/ab" });
        expect(a).toContain("--add-dir");
        expect(a.filter((x, i) => x !== n[i])).toEqual(["E.json"]);
    });

    it("uses the single-run budget when the pins name no session budget", () => {
        const session = sessionArgs("baseline", mcp, { ...pins, sessionMaxBudgetUsd: undefined });
        expect(session[session.indexOf("--max-budget-usd") + 1]).toBe("4");
    });
});

describe("session questions run only inside their sessions (Task 14)", () => {
    // a file as Eval #2's is laid out: single questions, a session's four, then more single questions
    const questions = [
        { id: "a-impact" }, { id: "a-cycle" },
        { id: "a-s1-impact", session: "a-s1" }, { id: "a-s1-chain", session: "a-s1" }, { id: "a-s1-cycle", session: "a-s1" }, { id: "a-s1-unused", session: "a-s1" },
        { id: "b-bp1" }, { id: "b-cn1" },
    ];

    it("schedules every single question and none of a session's, in the file's order", () => {
        expect(singleQuestionIds(questions, null)).toEqual(["a-impact", "a-cycle", "b-bp1", "b-cn1"]);
        // the full single schedule: 4 questions x 2 arms x 3 repeats, no session question among them
        const runs = schedule(singleQuestionIds(questions, null), 3, singleQuestionIds(questions, null), { upfront: false });
        expect(runs).toHaveLength(24);
        expect(runs.some((r) => r.question.includes("-s1-"))).toBe(false);
    });

    it("keeps the file's order for a pilot or --only list, whatever order it names them in", () => {
        expect(singleQuestionIds(questions, ["b-cn1", "a-impact"])).toEqual(["a-impact", "b-cn1"]);
    });

    it("refuses a session's question named as a single run, and an unknown id, each in a sentence", () => {
        expect(() => singleQuestionIds(questions, ["a-impact", "a-s1-chain"])).toThrow("a-s1-chain is a question of task session a-s1, asked only inside it (run it with --sessions --only a-s1)");
        expect(() => singleQuestionIds(questions, ["zz"])).toThrow("no such question: zz. The questions are a-impact, a-cycle, b-bp1, b-cn1");
    });
});

describe("the dev set (Task 13, R1)", () => {
    it("names a cycle question's file in its format line, in backticks, and leaves a line without <file> as it is", () => {
        const formats = { cycle: "End with ANSWER: none, or the cycle starting and ending with <file>, where each file imports the next.", list: "End with ANSWER: and the files." };
        expect(formatLine({ family: "cycle", file: "src/a.ts" }, formats)).toBe("End with ANSWER: none, or the cycle starting and ending with `src/a.ts`, where each file imports the next.");
        expect(formatLine({ family: "list" }, formats)).toBe("End with ANSWER: and the files.");
        // a file given to a line that doesn't name one changes nothing
        expect(formatLine({ family: "list", file: "src/a.ts" }, formats)).toBe("End with ANSWER: and the files.");
        expect(promptFor({ prompt: "Q?", family: "cycle", file: "src/a.ts" }, formats, "C:/s")).toBe(
            "Q?\n\nEnd with ANSWER: none, or the cycle starting and ending with `src/a.ts`, where each file imports the next.\n\nYou may write Node.js scripts in C:/s with the Write tool and run them with node (or run node -e); nowhere else, and don't change any file in the repository.");
    });

    it("refuses a format line that names <file> for a question that names none, and a family with no line", () => {
        const formats = { cycle: "starting and ending with <file>." };
        expect(() => formatLine({ family: "cycle" }, formats)).toThrow("its format line (cycle) names <file>, and the question names no file");
        expect(() => formatLine({ family: "chain" }, formats)).toThrow('"formats" has no line for its family chain');
    });

    it("runs each dev question once, in the arms asked: N alone by default, A and N alternating as schedule orders them", () => {
        const order = ["d1", "d2", "d3"];
        expect(devSchedule(["d1", "d2", "d3"], order, ["nebulosity"]).map(runName)).toEqual(["d1-nebulosity-1", "d2-nebulosity-1", "d3-nebulosity-1"]);
        // d1 at index 0 (A first), d2 at index 1 (N first), d3 at index 2 (A first), repeat 1
        expect(devSchedule(["d1", "d2", "d3"], order, ["baseline", "nebulosity"]).map(runName)).toEqual([
            "d1-baseline-1", "d1-nebulosity-1", "d2-nebulosity-1", "d2-baseline-1", "d3-baseline-1", "d3-nebulosity-1",
        ]);
        expect(devSchedule(["d2"], order, ["baseline"]).map(runName)).toEqual(["d2-baseline-1"]);
        expect(devSchedule(["d2"], order, ["nebulosity"]).every((r) => r.toolSearch && r.repeat === 1)).toBe(true);
    });

    it("reads --arms as the eval's arm names, each once", () => {
        expect(parseArms("nebulosity")).toEqual(["nebulosity"]);
        expect(parseArms(" baseline , nebulosity,baseline")).toEqual(["baseline", "nebulosity"]);
        expect(() => parseArms("upfront")).toThrow("--arms takes baseline and nebulosity, not upfront");
        expect(() => parseArms(" , ")).toThrow("--arms needs at least one arm");
    });

    it("names the questions on the wrong side of R1: unmarked ones in a dev run, dev ones in a real run", () => {
        const questions = [{ id: "d1", dev: true }, { id: "q1" }, { id: "q2", dev: false }, { id: "d2", dev: true }];
        expect(devMismatch(questions, true)).toEqual(["q1", "q2"]);
        expect(devMismatch(questions, false)).toEqual(["d1", "d2"]);
        expect(devMismatch([{ id: "d1", dev: true }], true)).toEqual([]);
    });
});

// ---- pre-freeze sweep B

describe("the harness's messages (sweep B, item 1)", () => {
    // a "${…}" inside a plain string prints the placeholder itself (run.ts once printed "already in ${P.name}/runs")
    it("no plain string literal in scripts/eval's sources holds a ${…} placeholder", () => {
        const dir = path.resolve("scripts", "eval");
        const found: string[] = [];
        for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))){
            const source = ts.createSourceFile(name, fs.readFileSync(path.join(dir, name), "utf8"), ts.ScriptTarget.Latest, true);
            const visit = (node: ts.Node): void => {
                if (ts.isStringLiteral(node) && /\$\{\w/.test(node.text)) found.push(`${name}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${node.getText()}`);
                ts.forEachChild(node, visit);
            };
            visit(source);
        }
        expect(found).toEqual([]);
    });
});

describe("repeatProblem (sweep B, item 2)", () => {
    it("refuses more repeats than the definition has, in a sentence, and accepts up to that many", () => {
        expect(repeatProblem(3, 2, "eval")).toBe("--repeat 3 asks for more repeats than eval/eval.json has: its repeats is 2, so --repeat takes 1 to 2.");
        expect(repeatProblem(2, 2, "eval")).toBeNull();
        expect(repeatProblem(1, 3, "eval2")).toBeNull();
        expect(repeatProblem(3, 3, "eval2")).toBeNull();
        expect(repeatProblem(null, 2, "eval")).toBeNull();
    });
});

describe("the checkout's status snapshot (sweep B, item 4)", () => {
    it("shows a new file inside a folder that was already untracked, so the after-run comparison sees it", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "eval-status-"));
        try{
            execFileSync("git", ["init", "-q", root]);
            fs.mkdirSync(path.join(root, "notes"));
            fs.writeFileSync(path.join(root, "notes", "a.txt"), "a");
            const lines = (): string[] => execFileSync("git", statusArgs(root), { encoding: "utf8" }).split(/\r?\n/).filter((l) => l.trim() !== "");
            const before = lines();
            expect(before).toEqual(["?? notes/a.txt"]);
            fs.writeFileSync(path.join(root, "notes", "b.txt"), "b");
            // without -uall both snapshots would be the one line "?? notes/", and the run's new file would go unseen
            expect(statusDifference(before, lines())).toEqual(["+ ?? notes/b.txt"]);
            fs.rmSync(path.join(root, "notes", "a.txt"));
            expect(statusDifference(before, lines())).toEqual(["+ ?? notes/b.txt", "- ?? notes/a.txt"]);
        } finally{
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe("Eval #3's rules sentence", () => {
    const RULES = "You're at the repository root, C:/Users/Ann/vscode, and every command runs from there: never use cd, not even into a subfolder or the scratch folder, and name paths from the root instead (git grep -n foo -- src/a src/b). Allowed: grep, rg, git grep, git ls-files, git log, git show, ls, cat, head, tail, wc, sort, uniq, find and node, alone or piped into one another. Refused: cd, shell loops (for, while), echo, sed, awk, cut, xargs, redirects, heredocs, tee, mkdir and any path with .. in it. To check many files or compute anything, write a Node.js script into C:/Users/Ann/AppData/Local/Temp/eval-scratch/0123456789abcdef with the Write tool (the folder exists) and run it with node and its full path, or use node -e. Don't change any file in the repository.";

    it("writes Eval #3's rules sentence, D2's, with both paths in drive-letter form", () => {
        expect(rulesSentence("C:/Users/Ann/vscode", "C:/Users/Ann/AppData/Local/Temp/eval-scratch/0123456789abcdef")).toBe(RULES);
    });

    it("ends a prompt with the rules sentence in place of the scripts sentence, when asked", () => {
        const scratch = "C:/Users/Ann/AppData/Local/Temp/eval-scratch/0123456789abcdef";
        expect(promptFor({ prompt: "Q?", family: "chain" }, { chain: "End with ANSWER." }, scratch, { repoRoot: "C:/Users/Ann/vscode" }))
            .toBe(`Q?\n\nEnd with ANSWER.\n\n${RULES}`);
        expect(promptFor({ prompt: "Q?", family: "chain" }, { chain: "End with ANSWER." }, scratch)).toBe(
            `Q?\n\nEnd with ANSWER.\n\nYou may write Node.js scripts in ${scratch} with the Write tool and run them with node (or run node -e); nowhere else, and don't change any file in the repository.`);
    });
});
