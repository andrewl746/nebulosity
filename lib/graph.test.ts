import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveSegments, radialPosition, resolveImport, classifyFile, toFlowGraph } from "./graph";
import { extractImports, scanProject } from "./scan"
import fs from "fs";

// P0 F1 testing
describe("resolveSegments (F1)", () => {
    it("resolve a single relative path", () => {
        expect(resolveSegments("app", "./components/GraphCanvas")).toBe("app/components/GraphCanvas");
    });

    it("handle multiple .. segments (pop, pop, push, push)", () => {
        expect(resolveSegments("app/components", "../../lib/graph")).toBe("lib/graph");
    });

    it("climb up and back down into a sibling folder", () => {
        expect(resolveSegments("lib", "../app/page")).toBe("app/page");
    });

    it("silently drop any extra .. past the root", () => {
        expect(resolveSegments("app", "../../../x")).toBe("x");
    });

    it("produce a phantom leading slash for a root-level importer", () => {
        expect(resolveSegments("", "./x")).toBe("/x");
    });
});

describe("radialPosition", () => {
    it("0, 10", () => {
        expect(radialPosition(0, 10)).toEqual({x: 0, y: 0});
    });

    it("1, 10", () => {
        expect(radialPosition(1, 10)).toEqual({x: 208, y: 120});
    });

    it("2, 10", () => {
        expect(radialPosition(2, 10)).toEqual({x: 0, y: 240});
    });

    it("4, 10", () => {
        expect(radialPosition(4, 10)).toEqual({x: -208, y: -120});
    });

    it("6, 10", () => {
        expect(radialPosition(6, 10)).toEqual({x: 208, y: -120});
    });

    it("7, 10", () => {
        expect(radialPosition(7, 10)).toEqual({x: 480, y: 0});
    });

    it("9, 10", () => {
        expect(radialPosition(9, 10)).toEqual({x: -240, y: -416});
    });

    it("19, 30", () => {
        expect(radialPosition(19, 30)).toEqual({x: 691, y: 203});
    });
});

describe("resolveImport", () => {
    it("no extension appended (toFlowGraph's job now)", () => {
        expect(resolveImport("app/page.tsx", "./components/GraphCanvas")).toBe("app/components/GraphCanvas");
    });

    it("alias strip only", () => {
        expect(resolveImport("app/components/GraphCanvas.tsx", "@/lib/graph", { "@/": "" })).toBe("lib/graph");
    });

    it("no /index.ts fallback anymore (toFlowGraph's job now)", () => {
        expect(resolveImport("lib/graph.ts", "./utils")).toBe("lib/utils");
    });

    it("bare specifier (npm package)", () => {
        expect(resolveImport("app/page.tsx", "react")).toBe(null);
    });

    it("return a base path unconditionally and no longer detects a nonexistent file (toFlowGraph's job now)", () => {
        expect(resolveImport("lib/graph.ts", "./missing")).toBe("lib/missing");
    });
});

describe("extractImports", () => {
    it("check if a basic import can be extracted", () => {
        expect(extractImports(`import x from "./a"`)).toEqual(["./a"]);
    });

    it("check if it can handle more than one import", () => {
        expect(extractImports(`import x from "./a"; import b from "./b"`)).toEqual(["./a", "./b"]);
    });

    it("multi-line import (W1)", () => {
        expect(extractImports(`import {\n  A,\n  B,\n} from "./multi"`)).toEqual(["./multi"]);
    });

    it("side-effect import (W2)", () => {
        expect(extractImports(`import "./globals.css"`)).toEqual(["./globals.css"]);
    });

    it("re-export (W2)", () => {
        expect(extractImports(`export {x} from "./y"`)).toEqual(["./y"]);
    });

    it("dynamic import (W2)", () => {
        expect(extractImports(`const m = await import("./dyn")`)).toEqual(["./dyn"]);
    });

    it("comment stripped", () => {
        expect(extractImports(`// import ghost from "./ghost"`)).toEqual([]);
    });

    it("string-literal false positive - known gap until AST (ADR-003)", () => { // import string that doesn't actually import anything
        expect(extractImports(`const s = "import x from './fake'";`)).toEqual(["./fake"]);
    });
});

describe("classifyFile", () => {
    it("check if it's a component", () => {
        expect(classifyFile("a.tsx")).toBe("component");
    });

    it("check if it's a component", () => {
        expect(classifyFile("a.jsx")).toBe("component");
    });

    it("check if it's a module", () => {
        expect(classifyFile("a.ts")).toBe("module");
    });

    it("check if it's a module", () => {
        expect(classifyFile("a.js")).toBe("module");
    });
});

describe("toFlowGraph", () => {
    it("build nodes and edges from a small file list", () => {
        const result = toFlowGraph([
            { id: "app/page.tsx", imports: ["./components/GraphCanvas", "react"] },
            { id: "app/components/GraphCanvas.tsx", imports: ["@/lib/graph"] },
            { id: "lib/graph.ts", imports: [] }
        ], "", { "@/": "" });

        expect(result.nodes).toEqual([
            { id: "app/page.tsx", type: "file", position: { x: 0, y: 0 }, data: { fileName: "page.tsx", dir: "app", kind: "component" } },
            { id: "app/components/GraphCanvas.tsx", type: "file", position: { x: 0, y: 240 }, data: { fileName: "GraphCanvas.tsx", dir: "app/components", kind: "component" } },
            { id: "lib/graph.ts", type: "file", position: { x: 0, y: -240 }, data: { fileName: "graph.ts", dir: "lib", kind: "module" } }
        ]);
        
        // only look at source and target by stripping away the rest
        expect(result.edges.map((e) => ({ source: e.source, target: e.target}))).toEqual([
            { source: "app/page.tsx", target: "app/components/GraphCanvas.tsx" },
            { source: "app/components/GraphCanvas.tsx", target: "lib/graph.ts" }
        ]);
    });

    it("NodeNext: a .js specifier resolves to the .ts source (F6)", () => {
        const result = toFlowGraph([
            { id: "app/a.ts", imports: ["./b.js"] },
            { id: "app/b.ts", imports: [] }
        ]);

        expect(result.edges.map((e) => ({ source: e.source, target: e.target }))).toEqual([
            { source: "app/a.ts", target: "app/b.ts" }
        ]);
    });
});

// P0 F2 testing
describe("scanProject (F2)", () => {
    it("save the real function", () => {
        const realReadFileSync = fs.readFileSync;

        vi.spyOn(fs, "readFileSync").mockImplementation((path) => { // the fake function
            if (String(path).includes("graph.ts")){
                throw new Error("simulated unreadable file");
            }

            return realReadFileSync(path, "utf-8");
        });
        
        // local variables made during the test
        const { files, warnings } = scanProject();

        // if you don't include the return statement then it'll always return false
        expect(files.some((x) => { return x.id.includes("graph.ts") })).toBe(false);
        expect(warnings.some((x) => { return x.path.includes("graph.ts")})).toBe(true);
        expect(files.some((x) => { return x.id.includes("scan.ts")})).toBe(true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    })
});

// P0 F4 testing
describe("scanProject (F4)", () => {
    it("check if deduping works", () => {
        const { files } = scanProject(process.cwd(), ["app", "app/components"]);
        const fileSet: Set<string> = new Set(files.map((f) => f.id));
        
        expect(files.length).toBe(fileSet.size);
    });

    it("check if files are sorted by id", () => {
        const { files } = scanProject(process.cwd(), ["app", "app/components"]);
        const filesSorted = [...files].sort((a, b) => a.id.localeCompare(b.id)); // spread operator vital for copying "files"
        
        expect(files).toEqual(filesSorted);
    });
});