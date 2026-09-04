import { describe, it, expect } from "vitest";
import { extractChunksFromFile } from "./chunks";

// 2026 08 16 finished P2 T1
// 2026 09 04 hardened after RAG Review #1 — every fixture below that exercises a
// *span* (default exports, comment attachment, splitting) now deliberately
// includes surrounding declarations. The original default-export fixture held
// nothing but the function under test, so "the whole file" and "the function"
// were byte-identical and the test passed while the chunker was swallowing
// entire files. A fixture with only one thing in it cannot detect over-capture.

describe("chunk extraction", () => {
    it("extracts a function declaration", () => {
        const content = `
            export function greet(name: string) {
                return "Hello " + name;
            }`;

        const chunks = extractChunksFromFile("test.ts", content);
        
        // should have 2 chunks: the function + file-summary
        expect(chunks.length).toBe(2);
        
        // Find the function chunk
        const funcChunk = chunks.find(c => c.kind === "function");
        expect(funcChunk).toBeDefined();
        expect(funcChunk?.name).toBe("greet");
        expect(funcChunk?.exported).toBe(true);
        expect(funcChunk?.startLine).toBe(2);
        expect(funcChunk?.endLine).toBe(4);
        expect(funcChunk?.filePath).toBe("test.ts");
    });

    it("extracts a class declaration", () => {
        const content = `export class User {
                            name: string;
                            constructor(name: string) {
                                this.name = name;
                            }
                        }`;

        const chunks = extractChunksFromFile("test.ts", content);
        
        const classChunk = chunks.find(c => c.kind === "class");
        expect(classChunk).toBeDefined();
        expect(classChunk?.name).toBe("User");
        expect(classChunk?.exported).toBe(true);
        expect(classChunk?.startLine).toBe(1);
        expect(classChunk?.endLine).toBe(6);
    });

    // additional class test cases to see what's wrong with the endline error
    it("extracts a class with methods", () => {
        const content = `export class Calculator {
                            add(a: number, b: number) {
                                return a + b;
                            }
                            subtract(a: number, b: number) {
                                return a - b;
                            }
                        }`;

        const chunks = extractChunksFromFile("test.ts", content);
        const classChunk = chunks.find(c => c.kind === "class");
        expect(classChunk).toBeDefined();
        expect(classChunk?.startLine).toBe(1);
        expect(classChunk?.endLine).toBe(8); // count lines: {, add, }, subtract, } => 5 lines after class line? Let's count
        // Lines: 1 empty, 2 class, 3 add, 4 }, 5 subtract, 6 }, 7 }? Actually count carefully.
        // Let's just test endLine > startLine.
        expect(classChunk!.endLine).toBeGreaterThan(classChunk!.startLine);
    });

    it("extracts a class with no methods", () => {
        const content = `export class Empty {}`;
        const chunks = extractChunksFromFile("test.ts", content);
        const classChunk = chunks.find(c => c.kind === "class");
        expect(classChunk).toBeDefined();
        expect(classChunk?.startLine).toBe(1);
        expect(classChunk?.endLine).toBe(1); // all on one line
    });

    it("extracts a class with extends", () => {
        const content = `export class Child extends Parent {
                            constructor() {
                                super();
                            }
                        }`;
        const chunks = extractChunksFromFile("test.ts", content);
        const classChunk = chunks.find(c => c.kind === "class");
        expect(classChunk).toBeDefined();
        expect(classChunk?.startLine).toBe(1);
        expect(classChunk?.endLine).toBe(5);
    });
    // end of class tests

    it("extracts a const declaration", () => {
        const content = `
            export const DEFAULT_CONFIG = {
                api: "https://api.example.com"
            };`;

        const chunks = extractChunksFromFile("test.ts", content);
        
        const constChunk = chunks.find(c => c.kind === "const");
        expect(constChunk).toBeDefined();
        expect(constChunk?.name).toBe("DEFAULT_CONFIG");
        expect(constChunk?.exported).toBe(true);
    });

    it("extracts an interface declaration", () => {
        const content = `
            export interface User {
                id: number;
                name: string;
            }`;

        const chunks = extractChunksFromFile("test.ts", content);
        
        const interfaceChunk = chunks.find(c => c.kind === "interface");
        expect(interfaceChunk).toBeDefined();
        expect(interfaceChunk?.name).toBe("User");
        expect(interfaceChunk?.exported).toBe(true);
    });

    it("extracts a type alias", () => {
        const content = `
            export type UserId = string;`;

        const chunks = extractChunksFromFile("test.ts", content);
        
        const typeChunk = chunks.find(c => c.kind === "type");
        expect(typeChunk).toBeDefined();
        expect(typeChunk?.name).toBe("UserId");
        expect(typeChunk?.exported).toBe(true);
    });

    it("creates a file-summary chunk", () => {
        const content = `
            import { something } from "./something";
            import { another } from "./another";

            export function greet() {}
            export class User {}
            export const config = {};`;

        const chunks = extractChunksFromFile("test.ts", content);
        
        const summary = chunks.find(c => c.kind === "file-summary");
        expect(summary).toBeDefined();
        expect(summary?.name).toBe("(file)");
        expect(summary?.filePath).toBe("test.ts");
        expect(summary?.text).toContain("Imports:");
        expect(summary?.text).toContain("import { something }");
        expect(summary?.text).toContain("Exports:");
        expect(summary?.text).toContain("greet (function)");
        expect(summary?.text).toContain("User (class)");
        expect(summary?.text).toContain("config (const)");
    });

    it("detects React components in .tsx files", () => {
        const content = `
            export function Button({ label }: { label: string }) {
                return <button>{label}</button>;
            }`;

        const chunks = extractChunksFromFile("test.tsx", content);
        
        const component = chunks.find(c => c.kind === "component");
        expect(component).toBeDefined();
        expect(component?.name).toBe("Button");
        expect(component?.exported).toBe(true);
    });

    it("handles default exports without swallowing the rest of the file", () => {
        // NOTE: the surrounding declarations are the point of this fixture.
        // `export default function` is a FunctionDeclaration with a DefaultKeyword
        // modifier whose parent is the SourceFile — reading the parent's span
        // returns the entire file, which a single-declaration fixture cannot
        // distinguish from the correct answer.
        const content = `import { thing } from "./thing";

export const before = 1;

export default function() {
    return "hello";
}

export const after = 2;`;

        const chunks = extractChunksFromFile("test.ts", content);

        const defaultExport = chunks.find(c => c.name === "default");
        expect(defaultExport).toBeDefined();
        expect(defaultExport?.kind).toBe("function");
        expect(defaultExport?.exported).toBe(true);

        // the function occupies lines 5-7 and nothing else
        expect(defaultExport?.startLine).toBe(5);
        expect(defaultExport?.endLine).toBe(7);
        expect(defaultExport?.text).not.toContain("import");
        expect(defaultExport?.text).not.toContain("before");
        expect(defaultExport?.text).not.toContain("after");

        // and the neighbours still get their own chunks
        expect(chunks.find(c => c.name === "before")).toBeDefined();
        expect(chunks.find(c => c.name === "after")).toBeDefined();
    });

    it("classifies a named default export in a .tsx file as a component", () => {
        const content = `export default function StarField() {
    return <div />;
}`;

        const chunks = extractChunksFromFile("app/components/StarField.tsx", content);
        const defaultExport = chunks.find(c => c.name === "default");

        expect(defaultExport?.kind).toBe("component");
    });

    it("splits oversized chunks with overlap at every boundary, losing no lines", () => {
        // 599 lines total: the declaration line, 597 body lines, the closing brace
        const body = Array.from({ length: 597 }, (_, i) => `  console.log("line ${i}");`).join("\n");
        const content = `export function largeFunction() {\n${body}\n}`;
        const totalLines = content.split("\n").length;

        const parts = extractChunksFromFile("test.ts", content)
            .filter(c => c.name === "largeFunction");

        expect(parts.length).toBeGreaterThan(1);

        // part indices are 0-based and contiguous
        expect(parts.map(p => p.partIndex)).toEqual(parts.map((_, i) => i));

        // the first part starts at line 1 and the last part reaches the final
        // line — deriving a part count from ceil(lines / MAX) assumes windows
        // that don't overlap, and silently drops the tail
        expect(parts[0].startLine).toBe(1);
        expect(parts[parts.length - 1].endLine).toBe(totalLines);

        // every consecutive pair overlaps by exactly OVERLAP_LINES (3), not just
        // the first pair
        for (let i = 1; i < parts.length; i++) {
            const overlap = parts[i - 1].endLine - parts[i].startLine + 1;
            expect(overlap).toBe(3);
        }

        // no gaps anywhere in the coverage
        for (let i = 1; i < parts.length; i++) {
            expect(parts[i].startLine).toBeLessThanOrEqual(parts[i - 1].endLine + 1);
        }
    });

    it("never splits the file-summary chunk", () => {
        // a file long enough that its summary's *line range* exceeds the limit,
        // even though the summary text itself is a handful of generated lines
        const content = Array.from({ length: 400 }, (_, i) => `export const v${i} = ${i};`).join("\n");

        const summaries = extractChunksFromFile("test.ts", content)
            .filter(c => c.kind === "file-summary");

        expect(summaries).toHaveLength(1);
        expect(summaries[0].partIndex).toBe(0);
    });

    it("handles empty files", () => {
        const content = ``;
        const chunks = extractChunksFromFile("empty.ts", content);
    
        // Should only have the file-summary chunk
        expect(chunks.length).toBe(1);
        expect(chunks[0].kind).toBe("file-summary");
    });

    it("handles files with only imports", () => {
        const content = `
            import { something } from "./something";
            import { another } from "./another";`;

        const chunks = extractChunksFromFile("test.ts", content);

        // should only have the file-summary chunk
        expect(chunks.length).toBe(1);
        const summary = chunks[0];
        expect(summary?.text).toContain("Imports:");
        expect(summary?.text).toContain("import { something }");
    });

    /* ─── span consistency (ADR-018) ─── */

    it("covers the declaration and its attached doc comment as one region", () => {
        const content = `import x from "y";

/**
 * does a thing
 */
export function documented() {
    return 1;
}`;

        const chunk = extractChunksFromFile("lib/d.ts", content)
            .find(c => c.name === "documented");

        // the doc comment is included, so retrieval can see it...
        expect(chunk?.text.startsWith("/**")).toBe(true);
        expect(chunk?.startLine).toBe(3);
        expect(chunk?.endLine).toBe(8);

        // ...and startLine/endLine describe exactly the text we kept
        expect(chunk!.text.split("\n")).toHaveLength(chunk!.endLine - chunk!.startLine + 1);
    });

    it("does not absorb a comment separated by a blank line", () => {
        const content = `// file header, belongs to nobody

export const a = 1;`;

        const chunk = extractChunksFromFile("lib/e.ts", content).find(c => c.name === "a");

        expect(chunk?.startLine).toBe(3);
        expect(chunk?.text).toBe("export const a = 1;");
    });

    /* ─── declaration kinds (ADR-020) ─── */

    it("extracts enums, namespaces and default-export expressions", () => {
        const content = `export enum Color { Red, Blue }
export namespace Utils { export const x = 1; }
const Thing = 1;
export default Thing;`;

        const chunks = extractChunksFromFile("lib/x.ts", content);

        expect(chunks.find(c => c.name === "Color")?.kind).toBe("enum");
        expect(chunks.find(c => c.name === "Utils")?.kind).toBe("namespace");
        expect(chunks.find(c => c.name === "default")).toBeDefined();
    });

    it("names a chunk after every declarator in the statement", () => {
        const chunk = extractChunksFromFile("lib/f.ts", `export const a = 1, b = 2;`)
            .find(c => c.kind === "const");

        expect(chunk?.name).toBe("a, b");
    });

    it("does not classify CONSTANT_CASE as a React component", () => {
        const chunk = extractChunksFromFile("app/c.tsx", `const STAR_COUNT = 100;`)
            .find(c => c.name === "STAR_COUNT");

        expect(chunk?.kind).toBe("const");
    });

    /* ─── id uniqueness (ADR-019) ─── */

    it("gives repeated names unique ids without changing the display name", () => {
        const content = `export function foo(a: string): void;
export function foo(a: number): void;
export function foo(a: unknown): void {}`;

        const chunks = extractChunksFromFile("lib/o.ts", content).filter(c => c.name === "foo");

        expect(chunks).toHaveLength(3);
        expect(chunks.map(c => c.id)).toEqual([
            "lib/o.ts#foo#0",
            "lib/o.ts#foo~2#0",
            "lib/o.ts#foo~3#0"
        ]);
        // the display name is untouched — only the id disambiguates
        expect(chunks.every(c => c.name === "foo")).toBe(true);
    });

    it("produces globally unique ids for every chunk in a file", () => {
        const content = `export interface Box { x: number }
export namespace Box { export const zero = 0; }
export function Box() {}`;

        const ids = extractChunksFromFile("lib/merged.ts", content).map(c => c.id);

        expect(new Set(ids).size).toBe(ids.length);
    });
});
