import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import type { LevelResponse, MapEdge, MapNode } from "@/lib/contracts";
import { drawnAt, endsOf, headsOf, routeFaults, widthsOf } from "@/scripts/route-faults";
import { edgeKey, mapEmphasis } from "./emphasis";
import { BOX_HEIGHT, BOX_WIDTH, layoutLevel, type Position } from "./levelLayout";
import { longestSideMiddle, nextRoutes, roundedPath, routeEdges, type Point } from "./routes";
import { arrowHead, boxHeadWidths } from "./weights";

const at = (entries: Record<string, Position>): Map<string, Position> => new Map(Object.entries(entries));
const line = (source: string, target: string): MapEdge => ({ source, target, count: 1 });

// a wrapped fan of 13 and a layer below it
const bs = Array.from({ length: 13 }, (_, i) => `b${i + 1}`);
const fanNodes: MapNode[] = ["a", ...bs, "c"].map((p) => ({ path: p, name: p, kind: "folder", fileCount: 1, summaryStatus: "fresh" }));
const fanEdges = [...bs.map((b) => line("a", b)), line("b1", "c"), line("a", "c"), line("b13", "c")];

type Level = Pick<LevelResponse, "path" | "page" | "pageCount" | "nodes" | "edges">;
/** One of VS Code's levels (test/fixtures/map-levels), laid out as the Map lays it out. */
function fixture(name: string): [Map<string, Position>, MapEdge[], Level] {
    const level = JSON.parse(readFileSync(`test/fixtures/map-levels/${name}.json`, "utf8")) as Level;
    return [layoutLevel(level.nodes, level.edges), level.edges, level];
}

describe("routeEdges (owner review: no line may pass through a box)", () => {
    it("draws a line between neighbouring rows as one straight drop when the boxes line up", () => {
        // s's bottom-centre (116, 56) to t's top-centre (116, 120), a layer apart (56 + 64): a straight line
        const routes = routeEdges(at({ s: { x: 0, y: 0 }, t: { x: 0, y: 120 } }), [line("s", "t")]);
        expect(routes.get("s->t")).toEqual([{ x: 116, y: 56 }, { x: 116, y: 120 }]);
    });

    it("lines up a line's two points that are only a hairline apart, so it drops straight", () => {
        // t sits 0.3 px right of s, its middle 116.3 against s's 116. A step that small is no wiggle to settle, but drawn
        // it's a hairline jog, so t's point, which no kept line holds, takes s's x
        const routes = routeEdges(at({ s: { x: 0, y: 0 }, t: { x: 0.3, y: 120 } }), [line("s", "t")]);
        expect(routes.get("s->t")).toEqual([{ x: 116, y: 56 }, { x: 116, y: 120 }]);
    });

    it("jogs sideways in the channel between neighbouring rows", () => {
        // the channel between y 56 and y 120 runs at y = 88
        const routes = routeEdges(at({ s: { x: 0, y: 0 }, t: { x: 272, y: 120 } }), [line("s", "t")]);
        expect(routes.get("s->t")).toEqual([{ x: 116, y: 56 }, { x: 116, y: 88 }, { x: 388, y: 88 }, { x: 388, y: 120 }]);
    });

    it("starts a box's leaving lines from its bottom's middle, splitting where they part", () => {
        // s → m drops straight from 116 into m's middle. s → t goes round m: lanes 28 px out, -28 or 260, tie to the lower
        // x. Its runs at the channels' middles, 88 and 208. The fork at (116, 88), s → m going on through s's point, isn't
        // two lines in line
        const routes = routeEdges(at({ s: { x: 0, y: 0 }, m: { x: 0, y: 120 }, t: { x: 0, y: 240 } }), [line("s", "m"), line("s", "t")]);
        expect(routes.get("s->m")).toEqual([{ x: 116, y: 56 }, { x: 116, y: 120 }]);
        expect(routes.get("s->t")).toEqual([{ x: 116, y: 56 }, { x: 116, y: 88 }, { x: -28, y: 88 }, { x: -28, y: 208 }, { x: 116, y: 208 }, { x: 116, y: 240 }]);
    });

    it("routes a line that points back up around both rows it passes", () => {
        // s (y 120) imports t (y 0): out under s (y 120 + 56 + 32 = 208, half a rank gap below the last row), up the lane
        // at x = -28 past both rows, and into t from above (y -32)
        const routes = routeEdges(at({ t: { x: 0, y: 0 }, s: { x: 0, y: 120 } }), [line("t", "s"), line("s", "t")]);
        expect(routes.get("s->t")).toEqual([
            { x: 116, y: 176 }, { x: 116, y: 208 }, { x: -28, y: 208 }, { x: -28, y: -32 }, { x: 116, y: -32 }, { x: 116, y: 0 },
        ]);
    });

    it("ends two lines into one box at its middle, in one head, along one track", () => {
        // a (middle 116) and b (388) both import t (136..368, middle 252). One leaving point each, t's one arriving
        // point at its middle. One run for the two in the channel from y 56 to 120, its middle 88: no other track, and
        // it clears the head (7 + 3 + 8 above 120 is 102)
        const routes = routeEdges(at({ a: { x: 0, y: 0 }, b: { x: 272, y: 0 }, t: { x: 136, y: 120 } }), [line("a", "t"), line("b", "t")]);
        expect(routes.get("a->t")).toEqual([{ x: 116, y: 56 }, { x: 116, y: 88 }, { x: 252, y: 88 }, { x: 252, y: 120 }]);
        expect(routes.get("b->t")).toEqual([{ x: 388, y: 56 }, { x: 388, y: 88 }, { x: 252, y: 88 }, { x: 252, y: 120 }]);
    });

    it("takes lines into one box down one gutter along one lane", () => {
        // a → t passes b's and m's rows, b → t passes m's. a's lane goes first (a tie on their boxes' middles, by key),
        // 28 px out at -28. b's own lane would be there too, within 60 px and clear over its rows, so it joins.
        // a's run under a at 88, b's under b at 208, both into t along one track at 328, the middle of 296..360
        const routes = routeEdges(
            at({ a: { x: 0, y: 0 }, b: { x: 0, y: 120 }, m: { x: 0, y: 240 }, t: { x: 0, y: 360 } }),
            [line("a", "t"), line("b", "t"), line("b", "m")],
        );
        expect(routes.get("a->t")).toEqual([{ x: 116, y: 56 }, { x: 116, y: 88 }, { x: -28, y: 88 }, { x: -28, y: 328 }, { x: 116, y: 328 }, { x: 116, y: 360 }]);
        expect(routes.get("b->t")).toEqual([{ x: 116, y: 176 }, { x: 116, y: 208 }, { x: -28, y: 208 }, { x: -28, y: 328 }, { x: 116, y: 328 }, { x: 116, y: 360 }]);
        expect(routes.get("b->m")).toEqual([{ x: 116, y: 176 }, { x: 116, y: 240 }]);
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

describe("routeEdges on VS Code's root, src selected", () => {
    const routes = routeEdges(ROOT, ROOT_LINES, SRC_SELECTED);
    it("takes extensions → src down the lane left of every box", () => {
        // the rows passed (gulpfile.mjs and test, build, .github and .eslint-plugin-local) leave room only outside them all,
        // half of 6 px plus 16 from -252 and 252, then 28 out: -280 or 280, a tie to the lower x
        expect(routes.get("extensions->src")!.filter((p, i, all) => i > 0 && all[i - 1].x === p.x).some((p) => p.x === -280)).toBe(true);
    });
    it("ends the four lines into src at one point", () => {
        const ends = ["extensions->src", ".github->src", "build->src", ".eslint-plugin-local->src"].map((k) => routes.get(k)!.at(-1)!.x);
        expect(new Set(ends).size).toBe(1);
    });
    it("drops build's line straight down the gutter between .github and .eslint-plugin-local", () => {
        // build's middle is 0, so is src's, and the gutter between -20 and 20 holds a lane at its middle, 0
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

// the fixtures (test/fixtures/map-levels), laid out as the Map lays them out
describe("merged at rest: no faults by the merge-aware rules, one point a side, room for every head", () => {
    const cases: [string, Map<string, Position>, MapEdge[], ReadonlySet<string> | undefined][] = [
        ["VS Code's root, every line", ROOT, ROOT_LINES, undefined], ["the root, src selected", ROOT, ROOT_LINES, SRC_SELECTED],
        ["src/vs at rest", VS, VS_LINES, VS_AT_REST], ["src/vs, every line", VS, VS_LINES, undefined], ["a wrapped fan of 13", layoutLevel(fanNodes, fanEdges), fanEdges, undefined],
        ...["root", "vs", "editor", "basetest", "feedback"].map((name): [string, Map<string, Position>, MapEdge[], undefined] => {
            const [positions, edges] = fixture(name);
            return [`${name}.json, every line`, positions, edges, undefined];
        }),
    ];
    for (const [name, positions, edges, drawn] of cases){
        it(name, () => {
            const routes = routeEdges(positions, edges, drawn);
            const faults = routeFaults(routes, widthsOf(edges), endsOf(edges), headsOf(edges));
            expect(Object.fromEntries(Object.entries(faults).map(([k, v]) => [k, v.length]))).toEqual({ shared: 0, jog: 0, lined: 0, head: 0 });
            const by = (side: 0 | 1) => {
                const m = new Map<string, Set<number>>();
                for (const [k, r] of routes){
                    const box = edges.find((e) => edgeKey(e) === k)![side === 0 ? "source" : "target"];
                    m.set(box, (m.get(box) ?? new Set()).add(side === 0 ? r[0].x : r.at(-1)!.x));
                }
                return m;
            };
            for (const side of [0, 1] as const) for (const [box, xs] of by(side)) expect(xs.size, `${box}'s ${side === 0 ? "leaving" : "arriving"} point`).toBe(1);
            const heads = boxHeadWidths(edges);
            for (const [k, r] of routes){
                const target = edges.find((e) => edgeKey(e) === k)!.target;
                const [before, end] = [r.at(-2)!, r.at(-1)!];
                expect(before.x, `${k} ends going down`).toBe(end.x);
                // the box's head (weights.ts), the 3 px gap above the box and a corner's 8 px
                expect(end.y - before.y, k).toBeGreaterThanOrEqual(arrowHead(heads.get(target)!).length + 3 + 8 - 1e-9);
            }
        });
    }
    it("routes oss's two crossing trunks without lines that share no end on one drop", () => {
        const [positions, edges, oss] = fixture("oss");
        expect(routeFaults(routeEdges(positions, edges, drawnAt(oss)), widthsOf(edges), endsOf(edges), headsOf(edges)).shared).toEqual([]);
    });
});

// VS Code's src/vs/editor as the owner saw it in VS Code's panel (6 a row, Strong links only on), and its 20 lines:
// hovering standalone drew 4 more and moved 8 of the 9 already there
const EDITOR = at({
    "editor.main.ts": { x: -116, y: 0 }, "editor.api.ts": { x: -116, y: 120 }, standalone: { x: -252, y: 240 }, "editor.all.ts": { x: 20, y: 240 },
    contrib: { x: -116, y: 360 }, test: { x: -116, y: 480 }, "editor.worker.start.ts": { x: -252, y: 600 }, browser: { x: 20, y: 600 }, common: { x: -116, y: 720 },
});
const EDITOR_LINES = ([
    ["browser", "common", 590], ["contrib", "browser", 340], ["contrib", "common", 1368], ["contrib", "test", 95], ["editor.all.ts", "browser", 3],
    ["editor.all.ts", "common", 1], ["editor.all.ts", "contrib", 59], ["editor.api.ts", "common", 2], ["editor.api.ts", "contrib", 1],
    ["editor.api.ts", "standalone", 2], ["editor.main.ts", "editor.all.ts", 1], ["editor.main.ts", "editor.api.ts", 1], ["editor.main.ts", "standalone", 8],
    ["editor.worker.start.ts", "common", 2], ["standalone", "browser", 40], ["standalone", "common", 111], ["standalone", "contrib", 6],
    ["standalone", "test", 1], ["test", "browser", 73], ["test", "common", 460],
] as const).map(([source, target, count]) => weighed(source, target, count));

/**
 * The Map's lines through a run of states, as MapCanvas draws them: the lines drawn at rest routed once, and each
 * state's routes from the last one's (nextRoutes). Each state is what's selected and what's hovered.
 */
function drive(positions: Map<string, Position>, edges: MapEdge[], states: [string | null, string | null][]): { drawn: Set<string>; routes: Map<string, Point[]> }[] {
    const boxes = [...positions.keys()];
    const drawnIn = (selected: string | null, hovered: string | null): Set<string> => {
        const tones = mapEmphasis(boxes, edges, selected, hovered, { strongOnly: true }).edges;
        return new Set(edges.map(edgeKey).filter((key) => tones.get(key) !== "hidden"));
    };
    const rest = routeEdges(positions, edges, drawnIn(null, null));
    let before = rest;
    return states.map(([selected, hovered]) => {
        const drawn = drawnIn(selected, hovered);
        before = nextRoutes(positions, edges, rest, before, drawn);
        return { drawn, routes: before };
    });
}

describe("a line never moves while it's drawn (the owner, 2026-10-27: hovering a box rearranged the lines)", () => {
    const boxes = [...EDITOR.keys()];

    it("keeps every route a level was given when it's routed again with them all kept", () => {
        const routes = routeEdges(VS, VS_LINES, VS_AT_REST);
        const again = routeEdges(VS, VS_LINES, VS_AT_REST, routes);
        for (const [key, route] of routes) expect(again.get(key), key).toBe(route);
    });

    it("hovering standalone on src/vs/editor draws its four weak lines and moves none of the nine already there", () => {
        const [rest, hovered] = drive(EDITOR, EDITOR_LINES, [[null, null], [null, "standalone"]]);
        expect(rest.drawn.size).toBe(9);
        expect(hovered.drawn.size).toBe(13);
        for (const [key, route] of rest.routes) expect(hovered.routes.get(key), key).toBe(route);
    });

    // every box hovered from rest, every box selected and then every other hovered, and a click on the hovered box
    const walks: [string, [string | null, string | null][]][] = [
        ["hovering each box in turn", boxes.flatMap((b): [string | null, string | null][] => [[null, b], [null, null]])],
        ...boxes.map((s): [string, [string | null, string | null][]] => [`with ${s} selected, hovering each other box and clicking it`,
            [[s, null], ...boxes.filter((b) => b !== s).flatMap((b): [string | null, string | null][] => [[s, b], [b, null], [s, null]])]]),
    ];
    for (const [name, states] of walks){
        it(`src/vs/editor, ${name}: a drawn line keeps its route and none crosses a box`, () => {
            const steps = drive(EDITOR, EDITOR_LINES, states);
            steps.forEach((step, i) => {
                const last = steps[i - 1];
                if (last !== undefined){
                    for (const key of step.drawn) if (last.drawn.has(key)) expect(step.routes.get(key), `${key} at step ${i}`).toBe(last.routes.get(key));
                }
                for (const [key, points] of step.routes){
                    for (const [path, box] of EDITOR){
                        for (let p = 0; p + 1 < points.length; p++) expect(crossesInside(points[p], points[p + 1], box), `${key} through ${path} at step ${i}`).toBe(false);
                    }
                }
            });
        });
    }
});
