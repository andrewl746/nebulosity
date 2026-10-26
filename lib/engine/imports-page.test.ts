import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { copyFixture } from "../../test/helpers/fixture";
import { indexRepository } from "../index/pipeline";
import { applyFileChanges } from "../index/update";
import { BadInputError } from "./errors";
import { cachedReach, importsPage, parseImportsQuery, setCacheLimitsForTests, type ImportsQuery } from "./imports-page";
import { PathNotFoundError } from "./level";
import { reach } from "./reach";

/** A query with the route's defaults, and what a test changes. */
function q(overrides: Partial<ImportsQuery> & { path: string }): ImportsQuery {
    return { direction: "dependents", transitive: false, limit: 50, offset: 0, ...overrides };
}

/** The fixture's dependents of src/core/log.ts, in reach() order: three at distance 1, then 2, 2, 2, 3 (the plan's ground truth). */
const LOG_DEPENDENTS = [
    { path: "src/app/main.ts", distance: 1 },
    { path: "src/core/index.ts", distance: 1 },
    { path: "src/index.ts", distance: 1 },
    { path: "src/util/strings.ts", distance: 2 },
    { path: "src/app/view.tsx", distance: 2 },
    { path: "scripts/build.js", distance: 2 },
    { path: "src/util/strings.test.ts", distance: 3 },
];

describe("importsPage — the fixture (API_CONTRACTS.md §19)", () => {
    it("pages the dependents of src/core/log.ts", () => {
        const root = copyFixture();
        indexRepository(root);
        const answer = reach(root, "src/core/log.ts", "dependents");
        expect(importsPage(answer, q({ path: "src/core/log.ts" }))).toEqual({
            path: "src/core/log.ts", kind: "file", direction: "dependents", transitive: false,
            files: [
                { path: "src/app/main.ts", distance: 1 },
                { path: "src/core/index.ts", distance: 1 },
                { path: "src/index.ts", distance: 1 },
            ],
            direct: 3, total: 3, offset: 0, indexVersion: answer.indexVersion,
        });
    });

    it("transitive pages: limit 2, offset 2", () => {
        const root = copyFixture();
        indexRepository(root);
        const answer = reach(root, "src/core/log.ts", "dependents");
        expect(importsPage(answer, q({ path: "src/core/log.ts", transitive: true, limit: 2, offset: 2 }))).toMatchObject({
            files: [{ path: "src/index.ts", distance: 1 }, { path: "src/util/strings.ts", distance: 2 }],
            total: 7, direct: 3, offset: 2, transitive: true,
        });
        expect(importsPage(answer, q({ path: "src/core/log.ts", transitive: false, limit: 2, offset: 2 })))
            .toMatchObject({ files: [{ path: "src/index.ts", distance: 1 }], total: 3, direct: 3, offset: 2 });
    });

    it("a page past the end is empty, not an error", () => {
        const root = copyFixture();
        indexRepository(root);
        const answer = reach(root, "src/core/log.ts", "dependents");
        expect(importsPage(answer, q({ path: "src/core/log.ts", offset: 10 }))).toMatchObject({ files: [], total: 3, direct: 3, offset: 10 });
    });

    it("the whole transitive list, nearest first, when the limit allows", () => {
        const root = copyFixture();
        indexRepository(root);
        const answer = reach(root, "src/core/log.ts", "dependents");
        expect(importsPage(answer, q({ path: "src/core/log.ts", transitive: true })).files).toEqual(LOG_DEPENDENTS);
    });

    it("dependencies of src/app/main.ts, transitive", () => {
        const root = copyFixture();
        indexRepository(root);
        const answer = reach(root, "src/app/main.ts", "dependencies");
        expect(importsPage(answer, q({ path: "src/app/main.ts", direction: "dependencies", transitive: true }))).toMatchObject({
            direction: "dependencies",
            files: [
                { path: "src/core/log.ts", distance: 1 },
                { path: "src/util/strings.ts", distance: 1 },
                { path: "src/app/view.tsx", distance: 1 },
                { path: "src/core/index.ts", distance: 2 },
            ],
            direct: 3, total: 4,
        });
    });

    it("a folder: dependents of src/util, transitive", () => {
        const root = copyFixture();
        indexRepository(root);
        const answer = reach(root, "src/util", "dependents");
        expect(importsPage(answer, q({ path: "src/util", transitive: true }))).toMatchObject({
            kind: "folder",
            files: [
                { path: "src/app/main.ts", distance: 1 },
                { path: "src/app/view.tsx", distance: 2 },
                { path: "src/index.ts", distance: 2 },
                { path: "scripts/build.js", distance: 2 },
            ],
            direct: 1, total: 4,
        });
    });

    it("nothing imports scripts/build.js", () => {
        const root = copyFixture();
        indexRepository(root);
        const answer = reach(root, "scripts/build.js", "dependents");
        expect(importsPage(answer, q({ path: "scripts/build.js", transitive: true }))).toMatchObject({ files: [], direct: 0, total: 0 });
    });

    it("transitive adds nothing when the only importer is imported by no one: dependents of src/index.ts", () => {
        const root = copyFixture();
        indexRepository(root);
        const answer = reach(root, "src/index.ts", "dependents");
        expect(importsPage(answer, q({ path: "src/index.ts", transitive: true }))).toMatchObject({
            files: [{ path: "scripts/build.js", distance: 1 }], direct: 1, total: 1,
        });
    });
});

describe("cachedReach", () => {
    it("a repeat is the cached answer", () => {
        const root = copyFixture();
        indexRepository(root);
        const first = cachedReach(root, "src/core/log.ts", "dependents");
        expect(cachedReach(root, "src/core/log.ts", "dependents")).toBe(first);
        // the other direction is another answer: log.ts imports nothing
        const other = cachedReach(root, "src/core/log.ts", "dependencies");
        expect(other).not.toBe(first);
        expect(other.reached).toEqual([]);
        expect(first.reached).toEqual(LOG_DEPENDENTS);
    });

    it("answers again once the index version moves", () => {
        const root = copyFixture();
        indexRepository(root);
        const before = cachedReach(root, "src/util/strings.ts", "dependents");
        expect(before.direct).toBe(2);   // main.ts and strings.test.ts
        expect(cachedReach(root, "src/util/strings.ts", "dependents")).toBe(before);
        fs.appendFileSync(path.join(root, "scripts", "build.js"), '\nrequire("../src/util/strings");\n');
        applyFileChanges(root, ["scripts/build.js"]);
        const after = cachedReach(root, "src/util/strings.ts", "dependents");
        expect(after).not.toBe(before);
        expect(after.direct).toBe(3);
        expect(after.indexVersion).toBeGreaterThan(before.indexVersion);
    });

    // The bounds are lowered through the test seam; the fixture's answers are the plan's ground truth: log.ts has 7
    // dependents and no dependencies, and main.ts has 4 dependencies (above).
    it("starts over once one version holds as many answers as its bound (Task 2's deferred minor)", () => {
        const restore = setCacheLimitsForTests({ answers: 2 });
        try{
            const root = copyFixture();
            indexRepository(root);
            const logDependents = cachedReach(root, "src/core/log.ts", "dependents");
            const logDependencies = cachedReach(root, "src/core/log.ts", "dependencies");
            // two kept: the bound
            expect(cachedReach(root, "src/core/log.ts", "dependents")).toBe(logDependents);
            expect(cachedReach(root, "src/core/log.ts", "dependencies")).toBe(logDependencies);
            // a third empties the cache, and is kept alone
            const main = cachedReach(root, "src/app/main.ts", "dependencies");
            expect(cachedReach(root, "src/app/main.ts", "dependencies")).toBe(main);
            expect(cachedReach(root, "src/core/log.ts", "dependents")).not.toBe(logDependents);
        } finally{
            restore();
        }
    });

    it("bounds the files one version's answers list too, and starts over when an answer would pass it (PR #10 review, 7)", () => {
        const restore = setCacheLimitsForTests({ entries: 10 });
        try{
            const root = copyFixture();
            indexRepository(root);
            const log = cachedReach(root, "src/core/log.ts", "dependents");          // 7 files kept
            expect(cachedReach(root, "src/core/log.ts", "dependents")).toBe(log);
            const main = cachedReach(root, "src/app/main.ts", "dependencies");       // 7 + 4 > 10: the cache starts over with main's 4
            expect(cachedReach(root, "src/app/main.ts", "dependencies")).toBe(main);
            const again = cachedReach(root, "src/core/log.ts", "dependents");        // dropped, so asked again: 4 + 7 > 10, over again
            expect(again).not.toBe(log);
            expect(again.reached).toEqual(LOG_DEPENDENTS);
            expect(cachedReach(root, "src/app/main.ts", "dependencies")).not.toBe(main);
        } finally{
            restore();
        }
    });

    it("never keeps an answer that alone lists more files than the bound, and keeps what's there", () => {
        const restore = setCacheLimitsForTests({ entries: 6 });
        try{
            const root = copyFixture();
            indexRepository(root);
            const main = cachedReach(root, "src/app/main.ts", "dependencies");       // 4 files kept
            const log = cachedReach(root, "src/core/log.ts", "dependents");          // 7 > 6: answered, not kept
            const again = cachedReach(root, "src/core/log.ts", "dependents");
            expect(again).not.toBe(log);
            expect(again).toEqual(log);
            expect(cachedReach(root, "src/app/main.ts", "dependencies")).toBe(main);
        } finally{
            restore();
        }
    });

    it("throws for the repo and for a path nothing is indexed at, every time", () => {
        const root = copyFixture();
        indexRepository(root);
        expect(() => cachedReach(root, "", "dependents")).toThrow(BadInputError);
        expect(() => cachedReach(root, "", "dependents")).toThrow(BadInputError);
        expect(() => cachedReach(root, "src/nope.ts", "dependents")).toThrow(PathNotFoundError);
        expect(() => cachedReach(root, "src/nope.ts", "dependents")).toThrow(PathNotFoundError);
    });
});

describe("parseImportsQuery", () => {
    it("the defaults", () => {
        expect(parseImportsQuery(new URLSearchParams("path=src/core/log.ts"))).toEqual({
            path: "src/core/log.ts", direction: "dependents", transitive: false, limit: 50, offset: 0,
        });
    });

    it("normalizes the path as everywhere else", () => {
        expect(parseImportsQuery(new URLSearchParams("path=./src/core/log.ts"))).toMatchObject({ path: "src/core/log.ts" });
    });

    it("transitive is true for 'true' and false for anything else", () => {
        expect(parseImportsQuery(new URLSearchParams("path=a&transitive=true"))).toMatchObject({ transitive: true });
        expect(parseImportsQuery(new URLSearchParams("path=a&transitive=false"))).toMatchObject({ transitive: false });
        expect(parseImportsQuery(new URLSearchParams("path=a&transitive=1"))).toMatchObject({ transitive: false });
        expect(parseImportsQuery(new URLSearchParams("path=a&transitive=yes"))).toMatchObject({ transitive: false });
    });

    it("takes both directions, a limit of 1 to 500, and an offset from 0", () => {
        expect(parseImportsQuery(new URLSearchParams("path=a&direction=dependencies"))).toMatchObject({ direction: "dependencies" });
        expect(parseImportsQuery(new URLSearchParams("path=a&limit=500"))).toMatchObject({ limit: 500 });
        expect(parseImportsQuery(new URLSearchParams("path=a&limit=1"))).toMatchObject({ limit: 1 });
        expect(parseImportsQuery(new URLSearchParams("path=a&offset=0&limit=7"))).toMatchObject({ offset: 0, limit: 7 });
        expect(parseImportsQuery(new URLSearchParams("path=a&offset=120"))).toMatchObject({ offset: 120 });
    });

    it("takes a path of 1,024 characters", () => {
        expect(parseImportsQuery(new URLSearchParams({ path: "a".repeat(1024) }))).toMatchObject({ path: "a".repeat(1024) });
    });

    it("refuses what §19 lists under 400", () => {
        const refused = [
            "",                                       // no path
            "path=",                                  // the repo itself
            "path=.",                                 // also the repo
            "path=../x",                              // could leave the repo
            `path=${"a".repeat(1025)}`,               // more than 1,024 characters
            "path=a&direction=sideways",
            "path=a&limit=0",
            "path=a&limit=501",
            "path=a&limit=abc",
            "path=a&limit=2.5",
            "path=a&offset=-1",
            "path=a&offset=x",
        ];
        for (const query of refused){
            const result = parseImportsQuery(new URLSearchParams(query));
            expect("error" in result, query.slice(0, 40)).toBe(true);
        }
    });
});
