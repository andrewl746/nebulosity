import path from "path";
import { describe as group, expect, it } from "vitest";
import { describe } from "./describe";
import { overview } from "./overview";
import { indexRepository } from "../index/pipeline";

const root = path.join(__dirname, "..", "..", "test", "fixtures", "arch-repo");
indexRepository(root);

group("docs in describe (ADR-054)", () => {
    it("lists the docs linked to a folder or the folders above it, applies first", () => {
        expect(describe(root, "src/editor/common").docs).toEqual([
            { path: ".github/instructions/editor.instructions.md", title: "Editor rules", reason: { kind: "applies", target: "src/editor", detail: "src/editor/**", count: 1 } },
            { path: "docs/architecture.md", title: "Architecture", reason: { kind: "mentions", target: "src/editor/common", count: 1 } },
        ]);
    });

    it("puts a folder's own README first, and a doc named for architecture before an equal one", () => {
        expect(describe(root, "src/app").docs?.map((d) => d.path)).toEqual(["src/app/README.md", "docs/architecture.md", "README.md"]);
    });

    it("shows each doc by its strongest link: the folder's README before the doc's mention of the file", () => {
        expect(describe(root, "src/app/loader.ts").docs?.[0]).toEqual(
            { path: "src/app/README.md", title: "The app", reason: { kind: "readme", target: "src/app", count: 1 } });
    });

    it("leaves docs out where none is linked", () => {
        expect(describe(root, "tools").docs).toBeUndefined();
    });
});

group("docs to read first, in overview", () => {
    it("the root README, then docs named for architecture, then docs that apply to folders", () => {
        expect(overview(root).docs).toEqual([
            { path: "README.md", title: "arch-repo" },
            { path: "docs/architecture.md", title: "Architecture" },
            { path: ".github/instructions/editor.instructions.md", title: "Editor rules", reason: { kind: "applies", target: "src/editor", detail: "src/editor/**", count: 1 } },
        ]);
    });
});
