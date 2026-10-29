import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import type { LevelResponse, MapEdge, MapNode } from "@/lib/contracts";
import { drawnAt, endsOf, headsOf, routeFaults, widthsOf } from "@/scripts/route-faults";
import { edgeKey, isBusyLevel, mapEmphasis } from "./emphasis";
import { BOX_HEIGHT, BOX_WIDTH, layoutLevel, type Position } from "./levelLayout";
import { headRooms, longestSideMiddle, nextRoutes, placeCounts, roundedPath, routeEdges, type Point } from "./routes";
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

    it("puts a line's hover sentence, when it has no count placed, in the middle of its longest side", () => {
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

describe("a line that appears joins its group's lane and track where they're drawn, and moves none", () => {
    it("joins a line that appears to the track its box's lines are on, and moves none", () => {
        // a → t carries 100 imports (6 px), b → t 1, under 2% of it, so hidden at rest. t's head is sized for a → t's 6 px,
        // half 8.4 and 12.2 long, so the track can sink no lower than 120 - 12.2 - 3 - 8 = 96.8: it's at 88, the middle.
        // Hovering b draws b → t: t's point is a → t's, 252, and b → t's run from 388 to 252 joins a → t's track at 88,
        // reaching past it from 252 to 388, where nothing else runs
        const positions = at({ a: { x: 0, y: 0 }, b: { x: 272, y: 0 }, t: { x: 136, y: 120 } });
        const edges = [weighed("a", "t", 100), weighed("b", "t", 1)];
        const rest = routeEdges(positions, edges, new Set(["a->t"]));
        const hovered = nextRoutes(positions, edges, rest, rest, new Set(["a->t", "b->t"]));
        expect(hovered.get("a->t")).toBe(rest.get("a->t"));
        expect(hovered.get("b->t")).toEqual([{ x: 388, y: 56 }, { x: 388, y: 88 }, { x: 252, y: 88 }, { x: 252, y: 120 }]);
    });

    it("keeps a line that appears off its box's lane where joining it would wiggle, and joins t's track", () => {
        // s (middle -136) → m1 → t and m2 → t carry 100 each (6 px), s → t carries 1, hidden at rest. At rest m1 → t goes
        // down the lane 28 px left of m1, m2 and t (-144), its runs at 208 and 328, and s → m1 runs at 88.
        // Hovering s draws s → t (1 px). t's lane at -144 is within reach, but s's point is kept at -136, an 8 px step:
        // no join. Its own lane, clear of every lane and of the kept ports at -136 and 0 by (6 + 1) / 2 + 8 = 11.5, is
        // -155.5, a 19.5 px wiggle from -136, so settle moves the lane to 24 px from it, -160, clear of -144 by 16.
        // s → m1 runs between neighbouring rows, so its one run is in m1's group, not s's (R4). s's leaving group has no
        // kept run in that channel, so s → t's first run goes round s → m1's at 88 by 11.5, to 76.5 (a tie with 99.5 goes
        // to the smaller). It joins t's track at 328 (from -144 to -160)
        const positions = at({ s: { x: -252, y: 0 }, m1: { x: -116, y: 120 }, m2: { x: -116, y: 240 }, t: { x: -116, y: 360 } });
        const edges = [weighed("s", "m1", 100), weighed("m1", "t", 100), weighed("m2", "t", 100), weighed("s", "t", 1)];
        const rest = routeEdges(positions, edges, new Set(["s->m1", "m1->t", "m2->t"]));
        expect(rest.get("m1->t")).toEqual([{ x: 0, y: 176 }, { x: 0, y: 208 }, { x: -144, y: 208 }, { x: -144, y: 328 }, { x: 0, y: 328 }, { x: 0, y: 360 }]);
        const hovered = nextRoutes(positions, edges, rest, rest, new Set(["s->m1", "m1->t", "m2->t", "s->t"]));
        for (const [key, route] of rest) expect(hovered.get(key), key).toBe(route);
        expect(hovered.get("s->t")).toEqual([{ x: -136, y: 56 }, { x: -136, y: 76.5 }, { x: -160, y: 76.5 }, { x: -160, y: 328 }, { x: 0, y: 328 }, { x: 0, y: 360 }]);
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

type State = [string | null, string | null];
type Step = { drawn: Set<string>; routes: Map<string, Point[]> };

/**
 * The Map's lines through a run of states, as MapCanvas draws them: the lines drawn at rest routed once, which come
 * first, and then each state's routes from the last one's (nextRoutes). Each state is what's selected and what's
 * hovered, with the `pinned` boxes lit throughout (Claude Code's or the editor's), whose lines rest leaves out as
 * MapCanvas's does, and a busy level's lines quiet.
 */
function drive(positions: Map<string, Position>, edges: MapEdge[], states: State[], pinned: ReadonlySet<string> = new Set()): Step[] {
    const boxes = [...positions.keys()];
    const drawnIn = (selected: string | null, hovered: string | null, lit: ReadonlySet<string>): Set<string> => {
        const tones = mapEmphasis(boxes, edges, selected, hovered, { strongOnly: true, quietLines: isBusyLevel(edges.length), pinned: lit }).edges;
        return new Set(edges.map(edgeKey).filter((key) => tones.get(key) !== "hidden"));
    };
    const drawn = drawnIn(null, null, new Set());
    const rest = routeEdges(positions, edges, drawn);
    let before = rest;
    return [{ drawn, routes: rest }, ...states.map(([selected, hovered]) => {
        const drawn = drawnIn(selected, hovered, pinned);
        before = nextRoutes(positions, edges, rest, before, drawn);
        return { drawn, routes: before };
    })];
}

/** The lines drawn in a step and the one before that haven't the very route they had. */
function moved(steps: readonly Step[]): string[] {
    return steps.flatMap((step, i) => (i === 0 ? [] : [...step.drawn].filter((key) => steps[i - 1].drawn.has(key) && step.routes.get(key) !== steps[i - 1].routes.get(key)).map((key) => `${key} at step ${i}`)));
}

/** The lines through a box at each step. */
function throughBoxes(steps: readonly Step[], positions: ReadonlyMap<string, Position>): string[] {
    return steps.flatMap((step, i) => [...step.routes].flatMap(([key, points]) => [...positions]
        .filter(([, box]) => points.slice(1).some((q, p) => crossesInside(points[p], q, box))).map(([path]) => `${key} through ${path} at step ${i}`)));
}

/** Each step's faults by the merge-aware rules (route-faults.ts). */
function faultsOver(steps: readonly Step[], edges: MapEdge[]): string[] {
    const [widths, ends, heads] = [widthsOf(edges), endsOf(edges), headsOf(edges)];
    return steps.flatMap((step, i) => Object.values(routeFaults(step.routes, widths, ends, heads)).flat().map((f) => `${f.kind} at step ${i}: ${f.lines.join(" and ")}, ${f.detail}`));
}

/** `selected` selected, then each other box hovered and clicked, and the selection clicked again. */
const selectionWalk = (boxes: readonly string[], selected: string): State[] =>
    [[selected, null], ...boxes.filter((b) => b !== selected).flatMap((b): State[] => [[selected, b], [b, null], [selected, null]])];

describe("a line never moves while it's drawn (the owner, 2026-10-27: hovering a box rearranged the lines)", () => {
    const boxes = [...EDITOR.keys()];

    it("keeps every route a level was given when it's routed again with them all kept", () => {
        const routes = routeEdges(VS, VS_LINES, VS_AT_REST);
        const again = routeEdges(VS, VS_LINES, VS_AT_REST, routes);
        for (const [key, route] of routes) expect(again.get(key), key).toBe(route);
    });

    it("hovering standalone on src/vs/editor draws its four weak lines and moves none of the nine already there", () => {
        const [rest, hovered] = drive(EDITOR, EDITOR_LINES, [[null, "standalone"]]);
        expect(rest.drawn.size).toBe(9);
        expect(hovered.drawn.size).toBe(13);
        for (const [key, route] of rest.routes) expect(hovered.routes.get(key), key).toBe(route);
    });

    // every box hovered from rest, every box selected and then every other hovered, and a click on the hovered box
    const walks: [string, State[]][] = [
        ["hovering each box in turn", boxes.flatMap((b): State[] => [[null, b], [null, null]])],
        ...boxes.map((s): [string, State[]] => [`with ${s} selected, hovering each other box and clicking it`, selectionWalk(boxes, s)]),
    ];
    for (const [name, states] of walks){
        it(`src/vs/editor, ${name}: a drawn line keeps its route, none crosses a box, and no step has a fault`, () => {
            const steps = drive(EDITOR, EDITOR_LINES, states);
            expect(moved(steps)).toEqual([]);
            expect(throughBoxes(steps, EDITOR)).toEqual([]);
            expect(faultsOver(steps, EDITOR_LINES)).toEqual([]);
        });
    }

    // src/vs's six wiggles into amdX.ts, down a lane boxed in 19 px from its held point, are a fault no move fixes
    // (PR #16), so only the moves are held here, and check-routes counts its faults
    for (const s of VS.keys()){
        it(`src/vs, with ${s} selected, hovering each other box and clicking it: a drawn line keeps its route`, () => {
            expect(moved(drive(VS, VS_LINES, selectionWalk([...VS.keys()], s)))).toEqual([]);
        });
    }

    it("editor.json with contrib lit at rest, hovering each box: nothing drawn moves", () => {
        // lit at rest, contrib's lines are routed around the rest routes as a hover's are (MapCanvas). The 9 strong lines,
        // then contrib's two weak ones too, editor.api.ts's 1 import and standalone's 6, under 2% of the 1,368 heaviest
        const [positions, edges] = fixture("editor");
        const steps = drive(positions, edges, [[null, null], ...[...positions.keys()].flatMap((b): State[] => [[null, b], [null, null]])], new Set(["src/vs/editor/contrib"]));
        expect([steps[0].drawn.size, steps[1].drawn.size]).toEqual([9, 11]);
        expect(moved(steps)).toEqual([]);
    });

    it("agenthost.json, a busy level, its first 8 linked boxes each selected and each box it has a line to hovered: nothing drawn moves", () => {
        // a busy level's lines are quiet, so nothing is drawn at rest and every line drawn comes from the selection
        const [positions, edges, level] = fixture("agenthost");
        const linked = level.nodes.map((n) => n.path).filter((box) => edges.some((e) => e.source !== e.target && (e.source === box || e.target === box)));
        const states = linked.slice(0, 8).flatMap((s): State[] => {
            const near = new Set(edges.flatMap((e) => (e.source === e.target ? [] : e.source === s ? [e.target] : e.target === s ? [e.source] : [])));
            return [[s, null], ...[...near].flatMap((b): State[] => [[s, b], [s, null]]), [null, null]];
        });
        const steps = drive(positions, edges, states);
        expect(steps[0].drawn.size).toBe(0);
        expect(moved(steps)).toEqual([]);
    });
});

describe("placeCounts: a count says whose it is, and overlaps nothing but its own line (the owner, 2026-10-28)", () => {
    const size = { width: 30, height: 18 };

    it("puts each count on a stretch its line has to itself, not on the run two lines share", () => {
        // a and b leave one point and run right together to x 100; a turns down there, b runs on to x 300 and turns down
        const a: Point[] = [{ x: 0, y: 0 }, { x: 0, y: 20 }, { x: 100, y: 20 }, { x: 100, y: 200 }];
        const b: Point[] = [{ x: 0, y: 0 }, { x: 0, y: 20 }, { x: 300, y: 20 }, { x: 300, y: 200 }];
        const at = placeCounts(new Map([["a", a], ["b", b]]), new Map([["a", 2], ["b", 2]]), new Map([["a", size], ["b", size]]), []);
        // a's own stretch is its drop at x 100, b's the rest of its run (100 to 300) or its drop at x 300
        expect(at.get("a")!.x).toBe(100);
        const pb = at.get("b")!;
        expect(pb.x === 300 || (pb.y === 20 && pb.x > 100 + size.width / 2)).toBe(true);
    });

    it("moves a count along its line off a place another line crosses", () => {
        // a long drop at x 0, crossed at its middle (y 100) by a run along y 100
        const a: Point[] = [{ x: 0, y: 0 }, { x: 0, y: 200 }];
        const b: Point[] = [{ x: -50, y: 100 }, { x: 50, y: 100 }];
        const at = placeCounts(new Map([["a", a], ["b", b]]), new Map([["a", 1], ["b", 1]]), new Map([["a", size]]), []);
        const p = at.get("a")!;
        expect(p.x).toBe(0);
        expect(Math.abs(p.y - 100)).toBeGreaterThan(size.height / 2 + 1);
    });

    it("keeps two counts apart, moving the second along its line", () => {
        // a and b are drops 24 px apart, each 100 long, so 82 of room. a goes first (ties by key) at its middle, 9 + 41 = 50,
        // and its 30 px label reaches 15 px, short of b's line and its room at 21.5. b's middle, (24, 50), meets a's
        // label grown by 3 px each side (|dx| 24 × 2 = 48 < 66, |dy| 0 < 42), and so do 0.3 (33.6) and 0.7 (66.4), each
        // 16.4 off (32.8 < 42). 0.15 is 9 + 12.3 = 21.3, 28.7 off (57.4 ≥ 42), so b goes there
        const a: Point[] = [{ x: 0, y: 0 }, { x: 0, y: 100 }];
        const b: Point[] = [{ x: 24, y: 0 }, { x: 24, y: 100 }];
        const at = placeCounts(new Map([["a", a], ["b", b]]), new Map([["a", 1], ["b", 1]]), new Map([["a", size], ["b", size]]), []);
        expect(at.get("a")).toEqual({ x: 0, y: 50 });
        expect(at.get("b")!.x).toBe(24);
        expect(at.get("b")!.y).toBeCloseTo(21.3, 9);
    });

    it("keeps a count off a box", () => {
        // a box 60 x 20 centred on (0, 50) sits across a's drop. The middle (50), 0.3 (33.6) and 0.7 (66.4) are each under
        // 19 off its centre (|dy| × 2 < 18 + 20 = 38). 0.15 is 21.3, 28.7 off (57.4 ≥ 38)
        const a: Point[] = [{ x: 0, y: 0 }, { x: 0, y: 100 }];
        const box = { x: 0, y: 50, width: 60, height: 20 };
        const at = placeCounts(new Map([["a", a]]), new Map([["a", 1]]), new Map([["a", size]]), [box]);
        expect(at.get("a")!.x).toBe(0);
        expect(at.get("a")!.y).toBeCloseTo(21.3, 9);
    });

    it("leaves out a count with nowhere clear (the owner, 2026-10-28: never overlap with anything)", () => {
        // drops 10 px apart. A 30 px label reaches 15 px from its line, past the other line's edge and room at 7.5 px, at
        // every height the two share, so neither count has a clear place
        const a: Point[] = [{ x: 0, y: 0 }, { x: 0, y: 100 }];
        const b: Point[] = [{ x: 10, y: 0 }, { x: 10, y: 100 }];
        const at = placeCounts(new Map([["a", a], ["b", b]]), new Map([["a", 1], ["b", 1]]), new Map([["a", size], ["b", size]]), []);
        expect(at.size).toBe(0);
    });

    it("keeps a kept count where it is while nothing runs into it", () => {
        // placed afresh, a would take its middle (0, 100). Kept at (0, 63.6) and clear, it stays
        const a: Point[] = [{ x: 0, y: 0 }, { x: 0, y: 200 }];
        const at = placeCounts(new Map([["a", a]]), new Map([["a", 1]]), new Map([["a", size]]), [], new Map([["a", { x: 0, y: 63.6 }]]));
        expect(at.get("a")).toEqual({ x: 0, y: 63.6 });
    });

    it("moves a kept count that a new line runs into", () => {
        // kept at a's middle (0, 100), and b now runs across at y 100 (97.5 to 102.5 with its room). The middle is taken,
        // the 0.3 try is 9 + 54.6 = 63.6, clear of b
        const a: Point[] = [{ x: 0, y: 0 }, { x: 0, y: 200 }];
        const b: Point[] = [{ x: -50, y: 100 }, { x: 50, y: 100 }];
        const at = placeCounts(new Map([["a", a], ["b", b]]), new Map([["a", 1], ["b", 1]]), new Map([["a", size]]), [], new Map([["a", { x: 0, y: 100 }]]));
        expect(at.get("a")!.x).toBe(0);
        expect(at.get("a")!.y).toBeCloseTo(63.6, 9);
    });

    it("keeps a count off an arrowhead passed with the boxes, its own line's included (review: 3,652 hid editor's head)", () => {
        // a drops 80 into a box at y 80, whose head of width 1 (half 4.5, length 7) is the rect MapCanvas passes: centred
        // on (0, 80 - 3 - 3.5 = 73.5), 9 + 4 = 13 by 7 + 4 = 11. A label 30 x 18 meets it where |y - 73.5| < (18 + 11) / 2
        // = 14.5, so below y 59. a's room is 80 - 18 = 62, so the tries are 0.5 at 9 + 31 = 40, 0.3 at 27.6, 0.7 at 52.4,
        // 0.15 at 18.3, 0.85 at 61.7, 0 at 9 and 1 at 71. Runs across at y 24 and 48 (5 tall with their room) take
        // each place within 11.5 of them: 18.3 and 27.6 from 24, 40 and 52.4 from 48. Without the head a takes 0.85,
        // 61.7. The head takes 61.7 (11.8 off it) and 71, so a takes the next clear try, 0, at 9 (15 off the run at 24)
        const a: Point[] = [{ x: 0, y: 0 }, { x: 0, y: 80 }];
        const across = (y: number): Point[] => [{ x: -50, y }, { x: 50, y }];
        const head = { x: 0, y: 73.5, width: 13, height: 11 };
        const routes = new Map([["a", a], ["b", across(24)], ["c", across(48)]]);
        const widths = new Map([["a", 1], ["b", 1], ["c", 1]]);
        expect(placeCounts(routes, widths, new Map([["a", size]]), []).get("a")!.y).toBeCloseTo(61.7, 9);
        const at = placeCounts(routes, widths, new Map([["a", size]]), [head]);
        expect(at.get("a")!.x).toBe(0);
        expect(at.get("a")!.y).toBeCloseTo(9, 9);
        // with the run at y 20 instead, 9 is 11 off it, under 11.5, so every clear try is on the head and a is left out
        const crowded = new Map([["a", a], ["b", across(20)], ["c", across(48)]]);
        expect(placeCounts(crowded, widths, new Map([["a", size]]), []).get("a")!.y).toBeCloseTo(61.7, 9);
        expect(placeCounts(crowded, widths, new Map([["a", size]]), [head]).has("a")).toBe(false);
    });
});

describe("headRooms: the room a count keeps off each drawn arrowhead", () => {
    it("gives one rect for each box a drawn line arrives at, around its one head and grown by 2 px each side", () => {
        // the page's heaviest is 16, so t's head is sized for a's 6 px (b's 2 is 1 + 5 × ln 2 / ln 16 = 2.25): half
        // 0.9 × 6 + 3 = 8.4, length 1.2 × 6 + 5 = 12.2. Its lines end at (10, 100), so the head runs from 3 above that
        // (the tip's gap) 12.2 up: centred on y 100 - 3 - 6.1 = 90.9, 2 × 8.4 + 4 = 20.8 by 12.2 + 4 = 16.2. u's line of
        // 1 has the least head, half 4.5 and length 7: centred on (100, 200 - 3 - 3.5 = 193.5), 13 by 11. d -> v isn't
        // drawn, so v has none
        const edges: MapEdge[] = [weighed("a", "t", 16), weighed("b", "t", 2), weighed("c", "u", 1), weighed("d", "v", 4)];
        const routes = new Map<string, Point[]>([
            ["a->t", [{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 10, y: 50 }, { x: 10, y: 100 }]],
            ["b->t", [{ x: 20, y: 0 }, { x: 20, y: 50 }, { x: 10, y: 50 }, { x: 10, y: 100 }]],
            ["c->u", [{ x: 100, y: 0 }, { x: 100, y: 200 }]],
        ]);
        const rooms = headRooms(routes, edges);
        expect(rooms).toHaveLength(2);
        const [t, u] = rooms;
        expect([t.x, t.y, t.width, t.height].map((v) => +v.toFixed(9))).toEqual([10, 90.9, 20.8, 16.2]);
        expect([u.x, u.y, u.width, u.height].map((v) => +v.toFixed(9))).toEqual([100, 193.5, 13, 11]);
    });
});
