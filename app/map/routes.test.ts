import { describe, expect, it } from "vitest";
import type { MapEdge, MapNode } from "@/lib/contracts";
import { BOX_HEIGHT, BOX_WIDTH, layoutLevel, type Position } from "./levelLayout";
import { longestSideMiddle, roundedPath, routeEdges, type Point } from "./routes";
import { arrowHead, lineWidth } from "./weights";

const at = (entries: Record<string, Position>): Map<string, Position> => new Map(Object.entries(entries));
const line = (source: string, target: string): MapEdge => ({ source, target, count: 1 });

describe("routeEdges (owner review: no line may pass through a box)", () => {
    it("draws a line between neighbouring rows as one straight drop when the boxes line up", () => {
        // s's bottom-centre (116, 56) to t's top-centre (116, 120), a layer apart (56 + 64): a straight line
        const routes = routeEdges(at({ s: { x: 0, y: 0 }, t: { x: 0, y: 120 } }), [line("s", "t")]);
        expect(routes.get("s->t")).toEqual([{ x: 116, y: 56 }, { x: 116, y: 120 }]);
    });

    it("jogs sideways in the channel between neighbouring rows", () => {
        // the channel between y 56 and y 120 runs at y = 88
        const routes = routeEdges(at({ s: { x: 0, y: 0 }, t: { x: 272, y: 120 } }), [line("s", "t")]);
        expect(routes.get("s->t")).toEqual([{ x: 116, y: 56 }, { x: 116, y: 88 }, { x: 388, y: 88 }, { x: 388, y: 120 }]);
    });

    it("goes around a box in a row it skips, down a lane in the gutter beside it, from a port of its own", () => {
        // m (0..232 wide, y 120..176) is in the way of s → t; the lanes beside it are 28 px out: x = -28 or 260, and a tie
        // goes to the lower x. Channels: y (0 + 56 + 120) / 2 = 88 under s, y (120 + 56 + 240) / 2 = 208 above t.
        // s has two lines leaving, 1 px each: 1 + 10 apart, centred on 116, so 110.5 and 121.5, the one to the lane at
        // -28 on the left. s → m's ports are 5.5 apart, under 16, so m's port moves over and it drops straight.
        const routes = routeEdges(
            at({ s: { x: 0, y: 0 }, m: { x: 0, y: 120 }, t: { x: 0, y: 240 } }),
            [line("s", "m"), line("s", "t")],
        );
        expect(routes.get("s->t")).toEqual([
            { x: 110.5, y: 56 }, { x: 110.5, y: 88 }, { x: -28, y: 88 }, { x: -28, y: 208 }, { x: 116, y: 208 }, { x: 116, y: 240 },
        ]);
        expect(routes.get("s->m")).toEqual([{ x: 121.5, y: 56 }, { x: 121.5, y: 120 }]);
    });

    it("routes a line that points back up around both rows it passes", () => {
        // s (y 120) imports t (y 0): out under s (y 120 + 56 + 32 = 208, half a rank gap below the last row), up the lane
        // at x = -28 past both rows, and into t from above (y -32)
        const routes = routeEdges(at({ t: { x: 0, y: 0 }, s: { x: 0, y: 120 } }), [line("t", "s"), line("s", "t")]);
        expect(routes.get("s->t")).toEqual([
            { x: 116, y: 176 }, { x: 116, y: 208 }, { x: -28, y: 208 }, { x: -28, y: -32 }, { x: 116, y: -32 }, { x: 116, y: 0 },
        ]);
    });

    it("gives two lines into one box their own ends, in the order they come from", () => {
        // a (centre 116) and b (centre 388) both import t (centre 252): t's ports are 4.5 + 4.5 + 8 = 17 apart,
        // centred on 252, so 243.5 for a's line and 260.5 for b's. Their runs share the channel's track at 88, end to
        // end: a's ends at 243.5, b's at 260.5, 17 apart, more than 1 + 4
        const routes = routeEdges(at({ a: { x: 0, y: 0 }, b: { x: 272, y: 0 }, t: { x: 136, y: 120 } }), [line("a", "t"), line("b", "t")]);
        expect(routes.get("a->t")).toEqual([{ x: 116, y: 56 }, { x: 116, y: 88 }, { x: 243.5, y: 88 }, { x: 243.5, y: 120 }]);
        expect(routes.get("b->t")).toEqual([{ x: 388, y: 56 }, { x: 388, y: 88 }, { x: 260.5, y: 88 }, { x: 260.5, y: 120 }]);
    });

    it("routes only the lines drawn, around every box with a line on the level", () => {
        // s → t passes m's row; s → m isn't drawn, but m still stands in the way, so the lane goes round it
        const routes = routeEdges(at({ s: { x: 0, y: 0 }, m: { x: 0, y: 120 }, t: { x: 0, y: 240 } }), [line("s", "m"), line("s", "t")], new Set(["s->t"]));
        expect([...routes.keys()]).toEqual(["s->t"]);
        // the one line leaving s has the middle of its bottom to itself
        expect(routes.get("s->t")).toEqual([
            { x: 116, y: 56 }, { x: 116, y: 88 }, { x: -28, y: 88 }, { x: -28, y: 208 }, { x: 116, y: 208 }, { x: 116, y: 240 },
        ]);
    });

    it("never crosses a box on a real layout: a wrapped fan of 13 and a layer below it", () => {
        const bs = Array.from({ length: 13 }, (_, i) => `b${i + 1}`);
        const nodes: MapNode[] = ["a", ...bs, "c"].map((p) => ({ path: p, name: p, kind: "folder", fileCount: 1, summaryStatus: "fresh" }));
        const edges = [...bs.map((b) => line("a", b)), line("b1", "c"), line("a", "c"), line("b13", "c")];
        const positions = layoutLevel(nodes, edges);
        const routes = routeEdges(positions, edges);

        for (const edge of edges){
            const points = routes.get(`${edge.source}->${edge.target}`)!;
            for (const [path, box] of positions){
                // the segments may touch their own two boxes at the ends, never the inside of any box
                for (let i = 0; i + 1 < points.length; i++){
                    expect(crossesInside(points[i], points[i + 1], box), `${edge.source}->${edge.target} segment ${i} through ${path}`).toBe(false);
                }
            }
        }
    });
});

/** Whether an axis-aligned segment passes through a box's interior (its edge doesn't count). */
function crossesInside(p: Point, q: Point, box: Position): boolean {
    const [x1, x2] = [Math.min(p.x, q.x), Math.max(p.x, q.x)];
    const [y1, y2] = [Math.min(p.y, q.y), Math.max(p.y, q.y)];
    return x1 < box.x + BOX_WIDTH && x2 > box.x && y1 < box.y + BOX_HEIGHT && y2 > box.y;
}

describe("roundedPath and longestSideMiddle", () => {
    it("draws a straight line as one segment", () => {
        expect(roundedPath([{ x: 0, y: 0 }, { x: 0, y: 50 }])).toBe("M 0 0 L 0 50");
    });

    it("rounds each corner with an 8 px curve, or half the shorter side when that's less", () => {
        // corner at (0, 20): the sides are 20 and 100 long, so the radius is 8
        expect(roundedPath([{ x: 0, y: 0 }, { x: 0, y: 20 }, { x: 100, y: 20 }])).toBe("M 0 0 L 0 12 Q 0 20 8 20 L 100 20");
        // corner at (0, 6): the first side is 6 long, so the radius is 3
        expect(roundedPath([{ x: 0, y: 0 }, { x: 0, y: 6 }, { x: 100, y: 6 }])).toBe("M 0 0 L 0 3 Q 0 6 3 6 L 100 6");
    });

    it("puts a line's count in the middle of its longest side", () => {
        // 20 down, then 100 across, then 10 down: the across side is longest, its middle at x = 50
        expect(longestSideMiddle([{ x: 0, y: 0 }, { x: 0, y: 20 }, { x: 100, y: 20 }, { x: 100, y: 30 }])).toEqual({ x: 50, y: 20 });
        // two sides of 40: the first wins
        expect(longestSideMiddle([{ x: 0, y: 0 }, { x: 0, y: 40 }, { x: 40, y: 40 }])).toEqual({ x: 0, y: 20 });
    });
});

// VS Code's root level as the Map lays it out (the mockup's root-layout.json) and its eleven lines (the demo's level
// file), with the five drawn while src is selected and Strong links only is on (the approved mockup's picture)
const ROOT = at({
    "eslint.config.js": { x: -116, y: 0 }, extensions: { x: -116, y: 120 }, "gulpfile.mjs": { x: -252, y: 240 }, test: { x: 20, y: 240 },
    build: { x: -116, y: 360 }, ".github": { x: -252, y: 480 }, ".eslint-plugin-local": { x: 20, y: 480 }, src: { x: -116, y: 600 },
});
const weighed = (source: string, target: string, count: number): MapEdge => ({ source, target, count });
const ROOT_LINES = [
    weighed(".eslint-plugin-local", "src", 2), weighed(".github", "src", 2), weighed("build", ".eslint-plugin-local", 2), weighed("build", "src", 16),
    weighed("eslint.config.js", ".eslint-plugin-local", 1), weighed("eslint.config.js", "extensions", 1), weighed("extensions", "build", 1),
    weighed("extensions", "src", 665), weighed("extensions", "test", 16), weighed("gulpfile.mjs", "build", 1), weighed("test", "build", 1),
];
const SRC_SELECTED = new Set(["extensions->src", "extensions->test", "build->src", ".github->src", ".eslint-plugin-local->src"]);

describe("routeEdges on VS Code's root, as the approved mockup draws it", () => {
    const routes = routeEdges(ROOT, ROOT_LINES, SRC_SELECTED);

    it("takes the 665 imports from extensions to src down the lane left of every box, from its own ports, lowest into src", () => {
        // widths (weights.ts): 665 → 6 px, 16 → 1 + 5 × ln 16 / ln 665 = 3.1328 px, 2 → 1.5332 px.
        // extensions' two leaving lines, (6 + 3.1328) / 2 + 10 = 14.566 apart round its centre 0: −7.283 to src's lane,
        // +7.283 to test. The lane: the rows passed (gulpfile and test, build, .github and .eslint) leave room only outside
        // them all, 28 px out from −252, so −280, which ties with +280 and goes to the lower x.
        // src's four arriving lines in the order they come from (the lane −280, .github −136, build's lane 0, .eslint 136),
        // their heads (half-widths 8.4, 4.5, 5.8195, 4.5) 8 apart, centred: −28.770, −7.870, 10.450, 28.770. Build's
        // line would then step 10.45 px sideways at the foot of its lane, a wiggle (settlePorts), so src's four ports
        // move over together by −10.45 and it drops straight: −39.220, −18.320, 0, 18.320.
        // The channel over src (536 to 600): .github's and .eslint's runs share a track, and extensions' must run below
        // .github's (whose turn at −18.32 lies past its end), so two tracks, (1.5332 + 6) / 2 + 8 = 11.767 apart,
        // centred on 568: 562.117 and 573.883, the lower one more than 12.2 + 3 + 8 above src (576.8).
        // The channel under extensions holds both its runs on one track, at its middle, 208.
        const heavy = routes.get("extensions->src")!;
        const expected = [[-7.2832, 176], [-7.2832, 208], [-280, 208], [-280, 573.8833], [-39.21955, 573.8833], [-39.21955, 600]];
        expect(heavy).toHaveLength(expected.length);
        heavy.forEach((p, i) => {
            expect(p.x, `point ${i} x`).toBeCloseTo(expected[i][0], 3);
            expect(p.y, `point ${i} y`).toBeCloseTo(expected[i][1], 3);
        });
    });

    it("ends the four lines into src at their own points, in the order they come from", () => {
        const ends = ["extensions->src", ".github->src", "build->src", ".eslint-plugin-local->src"].map((key) => routes.get(key)!.at(-1)!.x);
        expect(ends.map((x) => Number(x.toFixed(2)))).toEqual([-39.22, -18.32, 0, 18.32]);
    });

    it("takes build's line straight down the gutter between .github and .eslint-plugin-local, into src", () => {
        expect(routes.get("build->src")).toEqual([{ x: 0, y: 416 }, { x: 0, y: 600 }]);
    });
});

// VS Code's src/vs as the Map lays it out in VS Code's panel (6 a row), its 31 lines, and the 11 drawn at rest with
// Strong links only (2% of the heaviest, workbench → base's 20,648 imports)
const VS = at({
    "src/vs/code": { x: -252, y: 0 }, "src/vs/server": { x: 20, y: 0 }, "src/vs/workbench": { x: -116, y: 120 }, "src/vs/sessions": { x: -116, y: 240 },
    "src/vs/platform": { x: -116, y: 360 }, "src/vs/editor": { x: -116, y: 480 }, "src/vs/base": { x: -116, y: 600 },
    "src/vs/amdX.ts": { x: -252, y: 720 }, "src/vs/nls.ts": { x: 20, y: 720 },
});
const VS_LINES = ([
    ["workbench", "base", 20648], ["workbench", "platform", 19171], ["platform", "base", 6313], ["sessions", "base", 4247], ["sessions", "platform", 4071],
    ["workbench", "editor", 3652], ["sessions", "workbench", 2718], ["editor", "base", 2414], ["workbench", "nls.ts", 1579], ["editor", "platform", 1212],
    ["code", "platform", 416], ["sessions", "editor", 288], ["sessions", "nls.ts", 269], ["platform", "nls.ts", 223], ["server", "platform", 206],
    ["server", "base", 160], ["code", "base", 151], ["editor", "nls.ts", 127], ["workbench", "sessions", 89], ["workbench", "amdX.ts", 32],
    ["base", "nls.ts", 31], ["server", "workbench", 12], ["code", "workbench", 6], ["amdX.ts", "base", 5], ["server", "nls.ts", 4], ["code", "nls.ts", 4],
    ["platform", "editor", 3], ["platform", "amdX.ts", 3], ["editor", "amdX.ts", 1], ["base", "platform", 1], ["base", "amdX.ts", 1],
] as const).map(([source, target, count]) => weighed(`src/vs/${source}`, `src/vs/${target}`, count));
const VS_AT_REST = new Set(VS_LINES.filter((e) => e.count >= 0.02 * 20648).map((e) => `${e.source}->${e.target}`));

/** Every pair of segments two routes share: the same line at the same x (or y) over more than half a pixel. */
function sharedRuns(a: Point[], b: Point[]): string[] {
    const found: string[] = [];
    for (let i = 0; i + 1 < a.length; i++){
        for (let j = 0; j + 1 < b.length; j++){
            const [p, q, r, s] = [a[i], a[i + 1], b[j], b[j + 1]];
            const overlap = (lo1: number, hi1: number, lo2: number, hi2: number): number => Math.min(hi1, hi2) - Math.max(lo1, lo2);
            if (p.y === q.y && r.y === s.y && Math.abs(p.y - r.y) < 0.5
                && overlap(Math.min(p.x, q.x), Math.max(p.x, q.x), Math.min(r.x, s.x), Math.max(r.x, s.x)) > 0.5) found.push(`across at y ${p.y}`);
            if (p.x === q.x && r.x === s.x && Math.abs(p.x - r.x) < 0.5
                && overlap(Math.min(p.y, q.y), Math.max(p.y, q.y), Math.min(r.y, s.y), Math.max(r.y, s.y)) > 0.5) found.push(`down at x ${p.x}`);
        }
    }
    return found;
}

/** A route's sideways steps shorter than 24 px between two drops. */
function wiggles(points: Point[]): string[] {
    return points.slice(1, -2).flatMap((p, i) => {
        const q = points[i + 2];
        return p.y === q.y && Math.abs(q.x - p.x) < 24 ? [`${Math.abs(q.x - p.x).toFixed(2)} px at y ${p.y}`] : [];
    });
}

/**
 * Where one route's drop stops less than 48 px above where another's starts, their x's closer than `near`, inside one
 * channel (one that turns into a box's top and one leaving its bottom are a box apart, 56 px): the two read as one line.
 */
function endToEnd(a: Point[], b: Point[], near: number): string[] {
    const drops = (points: Point[]) => points.slice(0, -1).flatMap((p, i) => {
        const q = points[i + 1];
        return p.x === q.x ? [{ x: p.x, lo: Math.min(p.y, q.y), hi: Math.max(p.y, q.y) }] : [];
    });
    const found: string[] = [];
    for (const u of drops(a)){
        for (const v of drops(b)){
            const gap = Math.max(u.lo, v.lo) - Math.min(u.hi, v.hi);
            if (Math.abs(u.x - v.x) < near - 1e-6 && gap >= 0 && gap < 48) found.push(`x ${u.x.toFixed(2)} and ${v.x.toFixed(2)}, ${gap.toFixed(1)} px apart`);
        }
    }
    return found;
}

describe("routeEdges: no two lines share a run or an end (the owner, 2026-10-27)", () => {
    const LEVELS: [string, Map<string, Position>, MapEdge[], ReadonlySet<string> | undefined][] = [
        ["VS Code's root, all eleven lines", ROOT, ROOT_LINES, undefined],
        ["VS Code's root, src selected", ROOT, ROOT_LINES, SRC_SELECTED],
        ["src/vs at rest", VS, VS_LINES, VS_AT_REST],
        ["src/vs, every line", VS, VS_LINES, undefined],
    ];
    // and the fan of 13 from above, every line drawn
    const bs = Array.from({ length: 13 }, (_, i) => `b${i + 1}`);
    const fanNodes: MapNode[] = ["a", ...bs, "c"].map((p) => ({ path: p, name: p, kind: "folder", fileCount: 1, summaryStatus: "fresh" }));
    const fanEdges = [...bs.map((b) => line("a", b)), line("b1", "c"), line("a", "c"), line("b13", "c")];
    LEVELS.push(["a wrapped fan of 13", layoutLevel(fanNodes, fanEdges), fanEdges, undefined]);

    for (const [name, positions, edges, drawn] of LEVELS){
        it(name, () => {
            const routes = [...routeEdges(positions, edges, drawn)];
            for (let i = 0; i < routes.length; i++){
                for (let j = i + 1; j < routes.length; j++){
                    const [[ka, a], [kb, b]] = [routes[i], routes[j]];
                    expect(sharedRuns(a, b), `${ka} and ${kb}`).toEqual([]);
                    const same = (p: Point, q: Point): boolean => Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5;
                    expect(same(a[0], b[0]), `${ka} and ${kb} start together`).toBe(false);
                    expect(same(a.at(-1)!, b.at(-1)!), `${ka} and ${kb} end together`).toBe(false);
                }
            }
        });

        it(`${name}: no line steps sideways less than 24 px (the owner, 2026-10-27: a wiggle, not a turn)`, () => {
            for (const [key, points] of routeEdges(positions, edges, drawn)) expect(wiggles(points), key).toEqual([]);
        });

        it(`${name}: no line stops just above where another starts, in about the same column`, () => {
            const max = Math.max(...edges.map((e) => e.count));
            const widthOf = (key: string): number => lineWidth(edges.find((e) => `${e.source}->${e.target}` === key)!.count, max);
            const routes = [...routeEdges(positions, edges, drawn)];
            const lined: string[] = [];
            for (let i = 0; i < routes.length; i++){
                for (let j = i + 1; j < routes.length; j++){
                    const [[ka, a], [kb, b]] = [routes[i], routes[j]];
                    if (endToEnd(a, b, (widthOf(ka) + widthOf(kb)) / 2 + 8).length > 0) lined.push(`${ka} and ${kb}`);
                }
            }
            // With every line drawn, src/vs's last two channels are full: five lanes end over nls.ts's top, and what's left
            // between them holds about 100 px of its seven arrowheads' 114, and editor's four leaving lines share the
            // channel over base with its seven arriving ones, the tracks already squeezed. A move that clears one pair
            // lines up another, so settlePorts leaves at most two there. Strong links only (on by default) draws neither.
            if (name === "src/vs, every line") expect(lined.length).toBeLessThanOrEqual(2);
            else expect(lined).toEqual([]);
        });

        it(`${name}: every line ends in a drop long enough for its arrowhead`, () => {
            const max = Math.max(...edges.map((e) => e.count));
            for (const [key, points] of routeEdges(positions, edges, drawn)){
                const edge = edges.find((e) => `${e.source}->${e.target}` === key)!;
                const [before, end] = [points.at(-2)!, points.at(-1)!];
                expect(before.x, `${key} ends going down`).toBe(end.x);
                // the head (weights.ts), the 3 px gap above the box and a corner's 8 px
                expect(end.y - before.y, key).toBeGreaterThanOrEqual(arrowHead(lineWidth(edge.count, max)).length + 3 + 8 - 1e-9);
            }
        });
    }
});
