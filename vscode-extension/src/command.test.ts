import { describe, expect, it } from "vitest";
import { findOnPath, nebulosityLaunch, withArgs } from "./command";

const none = (): boolean => false;

describe("findOnPath (Review Focus 3)", () => {
    it("tries each PATHEXT entry on Windows", () => {
        expect(findOnPath("nebulosity", { Path: "C:\\a;C:\\npm", PATHEXT: ".EXE;.CMD" }, "win32", (p) => p === "C:\\npm\\nebulosity.CMD"))
            .toBe("C:\\npm\\nebulosity.CMD");
    });

    it("takes the bare name elsewhere", () => {
        expect(findOnPath("nebulosity", { PATH: "/usr/bin:/home/u/.npm/bin" }, "linux", (p) => p === "/home/u/.npm/bin/nebulosity"))
            .toBe("/home/u/.npm/bin/nebulosity");
    });

    it("never takes the bare name on Windows (npm's sh shim sits beside the .cmd)", () => {
        expect(findOnPath("nebulosity", { Path: "C:\\npm", PATHEXT: ".EXE;.CMD" }, "win32", (p) => p === "C:\\npm\\nebulosity")).toBeNull();
    });

    it("reads PATH in any case on Windows, a quoted entry, and PATHEXT's default", () => {
        expect(findOnPath("nebulosity", { PATH: '"C:\\Program Files\\nodejs";C:\\npm' }, "win32", (p) => p === "C:\\npm\\nebulosity.CMD"))
            .toBe("C:\\npm\\nebulosity.CMD");
        expect(findOnPath("nebulosity", { PATH: '"C:\\Program Files\\nodejs";C:\\npm' }, "win32", (p) => p === "C:\\Program Files\\nodejs\\nebulosity.EXE"))
            .toBe("C:\\Program Files\\nodejs\\nebulosity.EXE");
    });

    it("gives null when nothing is found", () => {
        expect(findOnPath("nebulosity", { Path: "C:\\a;C:\\npm", PATHEXT: ".EXE;.CMD" }, "win32", none)).toBeNull();
        expect(findOnPath("nebulosity", { PATH: "/usr/bin:/home/u/.npm/bin" }, "linux", none)).toBeNull();
    });
});

describe("nebulosityLaunch (the setting, else what PATH gave)", () => {
    it("runs a .cmd from PATH through the shell on Windows", () => {
        expect(nebulosityLaunch("", "C:\\npm\\nebulosity.CMD", "win32", none)).toEqual({ command: "C:\\npm\\nebulosity.CMD", args: [], shell: true });
    });

    it("runs a checkout's bin/nebulosity.mjs with node", () => {
        expect(nebulosityLaunch("C:/Users/A B/Nebulosity/bin/nebulosity.mjs", null, "win32", none))
            .toEqual({ command: "node", args: ["C:/Users/A B/Nebulosity/bin/nebulosity.mjs"], shell: true });
    });

    it("runs the command itself on macOS and Linux", () => {
        expect(nebulosityLaunch("", "/usr/local/bin/nebulosity", "darwin", none)).toEqual({ command: "/usr/local/bin/nebulosity", args: [], shell: false });
    });

    it("gives null with neither a setting nor PATH", () => {
        expect(nebulosityLaunch("", null, "linux", none)).toBeNull();
    });

    it("turns the extensionless shim named in the setting into its .cmd on Windows, or refuses it", () => {
        expect(nebulosityLaunch("C:\\npm\\nebulosity", null, "win32", (p) => p === "C:\\npm\\nebulosity.cmd"))
            .toEqual({ command: "C:\\npm\\nebulosity.cmd", args: [], shell: true });
        expect(nebulosityLaunch("C:\\npm\\nebulosity", null, "win32", none)).toBeNull();
    });
});

describe("withArgs (quoting for cmd.exe, only when the launch goes through the shell)", () => {
    it("quotes an argument with a space", () => {
        expect(withArgs({ command: "node", args: ["C:/Users/A B/x.mjs"], shell: true }, ["map", "--port", "3125"]).args)
            .toEqual(['"C:/Users/A B/x.mjs"', "map", "--port", "3125"]);
    });

    it("quotes a command path with a space", () => {
        expect(withArgs({ command: "C:\\Users\\Ann Lee\\AppData\\Roaming\\npm\\nebulosity.CMD", args: [], shell: true }, ["map"]).command)
            .toBe('"C:\\Users\\Ann Lee\\AppData\\Roaming\\npm\\nebulosity.CMD"');
    });

    it("quotes cmd.exe's own characters, keeps a trailing backslash inside the quotes, and keeps an empty argument", () => {
        expect(withArgs({ command: "node", args: [], shell: true }, ["a&b", "(x)", "^", "C:\\Users\\Ann Lee\\data\\", ""]).args)
            .toEqual(['"a&b"', '"(x)"', '"^"', '"C:\\Users\\Ann Lee\\data\\\\"', '""']);
    });

    it("leaves the space unquoted without the shell", () => {
        expect(withArgs({ command: "C:\\Users\\Ann Lee\\AppData\\Roaming\\npm\\nebulosity.CMD", args: [], shell: false }, ["map"]).command)
            .toBe("C:\\Users\\Ann Lee\\AppData\\Roaming\\npm\\nebulosity.CMD");
    });
});
