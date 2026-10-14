import { describe, expect, it } from "vitest";
import { editorLink, githubLink } from "./links";

describe("source links", () => {
    it("opens the editor in the app", () => {
        expect(editorLink({ repo: "C:/r", path: "x.ts" })).toBe("vscode://file/C:/r/x.ts");
        expect(editorLink({ repo: "C:/r", path: "x.ts" }, 3)).toBe("vscode://file/C:/r/x.ts:3");
    });

    it("opens GitHub at the indexed commit in the demo, with the lines, each path segment encoded", () => {
        const source = { owner: "microsoft", name: "vscode", commit: "cc3fec88abc" };
        expect(githubLink(source, "src/vs/base/common/lifecycle.ts", { start: 4, end: 7 }))
            .toBe("https://github.com/microsoft/vscode/blob/cc3fec88abc/src/vs/base/common/lifecycle.ts#L4-L7");
        expect(githubLink(source, "a.ts", { start: 9, end: 9 })).toBe("https://github.com/microsoft/vscode/blob/cc3fec88abc/a.ts#L9");
        expect(githubLink(source, "my docs/c#d.ts")).toBe("https://github.com/microsoft/vscode/blob/cc3fec88abc/my%20docs/c%23d.ts");
    });
});
