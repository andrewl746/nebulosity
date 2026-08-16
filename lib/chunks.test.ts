import { describe, it, expect } from "vitest";
import { extractChunksFromFile } from "./chunks";

// FOR CLAUDE: lowkey a little sketchy so check if these test cases pass everything you expect
// i think the endLine is off by 1 for classes, but I don't know if it's a problem or not (make sure all test cases GENIUNELY work and it's not by pure coincidence (edit read BUGS_ENCOUNTERED.md error 5))
// if u think these test cases dont encompass everything you want, feel free to add more
// i just wanted to make sure the basics are covered and that the splitting of oversized chunks is working as expected
// i added stuff in BUGS_ENCOUNTERED.md so check that to see if everythings correct (also just check everything in chunks.ts to see if its correct)
// 2026 08 16 finished P2 T1

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

    it("handles default exports", () => {
        const content = `
            export default function() {
                return "hello";
            }`;

        const chunks = extractChunksFromFile("test.ts", content);
        
        const defaultExport = chunks.find(c => c.name === "default");
        expect(defaultExport).toBeDefined();
        expect(defaultExport?.kind).toBe("function");
        expect(defaultExport?.exported).toBe(true);
    });

    it("splits oversized chunks with overlap", () => {
        // create a large function (250 lines)
        let content = `export function largeFunction() {\n`;

        for (let i = 0; i < 248; i++) {
            content += `  console.log("line ${i}");\n`;
        }

        content += `}\n`;
    
        const chunks = extractChunksFromFile("test.ts", content);
        
        // should be split into multiple parts
        const funcChunks = chunks.filter(c => c.name === "largeFunction");
        expect(funcChunks.length).toBeGreaterThan(1);
        
        // check overlap (if part 1 ends at line 201, part 2 starts around 199)
        const part1 = funcChunks[0];
        const part2 = funcChunks[1];

        if (part1 && part2) {
            // The start of part2 should overlap with the end of part1
            expect(part2.startLine).toBeLessThanOrEqual(part1.endLine);
        }
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
});
