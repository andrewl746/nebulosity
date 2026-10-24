import { describe, expect, it } from "vitest";
import { followStep, historyStep, mapUrl, placeFromSearch } from "./history";

describe("the Map's place in the address bar (owner review: the browser's Back goes to the previous folder)", () => {
    it("writes the folder, and the page past the first counted from 1, readably", () => {
        expect(mapUrl("", 0)).toBe("/");
        expect(mapUrl("src/vs", 0)).toBe("/?path=src/vs");
        expect(mapUrl("src/vscode-dts", 1)).toBe("/?path=src/vscode-dts&page=2");
        expect(mapUrl("", 2)).toBe("/?page=3");
        expect(mapUrl("src/my dir#1", 0)).toBe("/?path=src/my%20dir%231");
    });

    it("reads them back, and anything it can't read as the first page of the root", () => {
        expect(placeFromSearch("?path=src/vs")).toEqual({ path: "src/vs", page: 0 });
        expect(placeFromSearch("?path=src/vscode-dts&page=2")).toEqual({ path: "src/vscode-dts", page: 1 });
        expect(placeFromSearch("?path=src/my%20dir%231")).toEqual({ path: "src/my dir#1", page: 0 });
        expect(placeFromSearch("")).toEqual({ path: "", page: 0 });
        expect(placeFromSearch("?page=0")).toEqual({ path: "", page: 0 });
        expect(placeFromSearch("?page=-2")).toEqual({ path: "", page: 0 });
        expect(placeFromSearch("?page=two")).toEqual({ path: "", page: 0 });
    });

    it("round-trips any place it writes", () => {
        for (const [path, page] of [["", 0], ["src", 3], ["a b/c#d", 1]] as const){
            expect(placeFromSearch(mapUrl(path, page).slice(1))).toEqual({ path, page });
        }
    });

    it("pushes a history entry only for a move to another place", () => {
        expect(historyStep("/?path=src", { path: "src/vs", page: 0 })).toBe("push");
        expect(historyStep("/?path=src/vs", { path: "src/vs", page: 1 })).toBe("push");
        expect(historyStep("/", { path: "src", page: 0 })).toBe("push");
    });

    it("leaves the address bar alone when it already says where the Map is", () => {
        expect(historyStep("/?path=src/vs", { path: "src/vs", page: 0 })).toBe("none");
        expect(historyStep("/", { path: "", page: 0 })).toBe("none");
        expect(historyStep("/?path=src/vscode-dts&page=2", { path: "src/vscode-dts", page: 1 })).toBe("none");
    });

    it("rewrites, not pushes, the same place spelled another way, so Back needs one press (deferred minor)", () => {
        // a pasted or typed link: escaped slashes, page 1 spelled out, an empty path; each names the place mapUrl writes
        // more plainly, and pushing the plain spelling would leave Back a step that goes nowhere
        expect(historyStep("/?path=src%2Fvs", { path: "src/vs", page: 0 })).toBe("replace");
        expect(historyStep("/?path=src/vs&page=1", { path: "src/vs", page: 0 })).toBe("replace");
        expect(historyStep("/?path=", { path: "", page: 0 })).toBe("replace");
        expect(historyStep("/?page=1&path=src", { path: "src", page: 0 })).toBe("replace");
    });

    it("keeps embed=vscode last in the address when embedded, so a reload inside the editor's panel stays embedded (P8)", () => {
        expect(mapUrl("src/vs", 1, true)).toBe("/?path=src/vs&page=2&embed=vscode");
        expect(mapUrl("", 0, true)).toBe("/?embed=vscode");
        expect(mapUrl("src", 0, true)).toBe("/?path=src&embed=vscode");
        expect(mapUrl("src/vs", 1)).toBe("/?path=src/vs&page=2");           // the browser Map never has the flag
    });

    it("reads the place past the embed flag", () => {
        expect(placeFromSearch("?path=src&embed=vscode")).toEqual({ path: "src", page: 0 });
        expect(placeFromSearch("?embed=vscode")).toEqual({ path: "", page: 0 });
    });

    it("an embedded address that already says where the Map is is left alone; one without the flag is rewritten", () => {
        expect(historyStep("/?embed=vscode", { path: "", page: 0 }, true)).toBe("none");
        expect(historyStep("/?path=src&page=2&embed=vscode", { path: "src", page: 1 }, true)).toBe("none");
        expect(historyStep("/?embed=vscode", { path: "", page: 0 })).toBe("replace");
        expect(historyStep("/", { path: "", page: 0 }, true)).toBe("replace");
        expect(historyStep("/?path=src", { path: "src", page: 0 }, true)).toBe("replace");
        expect(historyStep("/?embed=vscode&path=src", { path: "src", page: 0 }, true)).toBe("replace");
        expect(historyStep("/?path=src&embed=vscode", { path: "src/vs", page: 0 }, true)).toBe("push");
    });

    it("followStep: a follow never pushes", () => {
        expect(followStep("push", "replace")).toBe("replace");
        expect(followStep("none", "replace")).toBe("none");
        expect(followStep("replace", "replace")).toBe("replace");
        expect(followStep("push", "push")).toBe("push");
        expect(followStep("none", "push")).toBe("none");
        expect(followStep("replace", "push")).toBe("replace");
    });
});
