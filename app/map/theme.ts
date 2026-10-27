/**
 * The Map's colors (the Workbench redesign, 2026-10-27). Every gray comes from a theme: inside VS Code's panel the
 * person's own (posted by the panel's relay, API_CONTRACTS §20's `nebulosity.theme`), in the browser and the demo a
 * fixed one, VS Code's Dark 2026. Purple only means something (the selection, what's linked to it, the one primary
 * button, the active tab, the logo), in the logo's own colors, a step darker on light themes so they keep their
 * contrast against white.
 *
 * `fromTheme` is the approved mockup's rule (mockup3.html, the owner's picks of 2026-10-27): each part is mixed from the
 * theme's background toward its text color by a set amount, strong enough that every box stands off any background.
 * Pure, so the rule is tested on its own, and app/globals.css holds its result for Dark 2026.
 */

/** Which kind of theme it is, as VS Code's webview says (`vscode-light`, `vscode-dark`, the two high contrast ones). */
export type ThemeKind = "dark" | "light" | "hc" | "hc-light";

/** A theme's colors, as the panel's relay reads them from VS Code's `--vscode-*` variables. Hex, `#rrggbb`. */
export type ThemeInput = {
    kind: ThemeKind;
    /** editor.background: under the Map. */
    editor: string;
    /** sideBar.background: the Map's panels (header, explorer, inspector, status bar). */
    side: string;
    /** A border the theme defines (its high contrast border, a widget's, the panel's), if it has one. */
    border?: string;
    /** foreground: names and headings. */
    fg: string;
    /** descriptionForeground: the quietest text, if the theme has one. */
    desc?: string;
    /** focusBorder: the keyboard focus ring, if the theme has one. */
    focus?: string;
};

/** Every token the Map draws with, by its CSS name (`--canvas`, …), each a `#rrggbb`, and `fade` a percentage. */
export type Palette = {
    canvas: string;
    panel: string;
    node: string;
    "node-sel": string;
    "row-sel": string;
    divider: string;
    border: string;
    "linked-border": string;
    text: string;
    "text-2": string;
    "text-3": string;
    "edge-dim": string;
    "edge-strong": string;
    "glyph-dim": string;
    "linked-glyph": string;
    accent: string;
    "on-accent": string;
    core: string;
    agent: string;
    danger: string;
    ok: string;
    focus: string;
    /** How much of its own color a box away from the selection keeps, mixed with the background: "50%". */
    fade: string;
};

/** VS Code's Dark 2026 (theme-defaults/themes/2026-dark.json), its default dark theme: the browser's and the demo's palette. */
export const DARK_2026: ThemeInput = { kind: "dark", editor: "#121314", side: "#191A1B", border: "#2A2B2C", fg: "#BFBFBF", desc: "#8C8C8C" };

const rgbOf = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const hexOf = (rgb: readonly number[]): string => "#" + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("").toUpperCase();

/** `a` moved `t` of the way to `b`, channel by channel in sRGB (CSS's `color-mix(in srgb, …)` does the same). */
export function mix(a: string, b: string, t: number): string {
    const [x, y] = [rgbOf(a), rgbOf(b)];
    return hexOf(x.map((v, i) => v + (y[i] - v) * t));
}

/**
 * A CSS color as `#rrggbb`, or null when it isn't one this reads: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` and
 * `rgba()`. A see-through color is laid over `under` first, since a box drawn in it would show what's behind it (VS
 * Code gives some borders as a gray with alpha).
 */
export function parseColor(value: string, under: string = "#000000"): string | null {
    const text = value.trim().toLowerCase();
    let rgba: number[] | null = null;
    const hex = /^#([0-9a-f]{3,8})$/.exec(text);
    if (hex && [3, 4, 6, 8].includes(hex[1].length)){
        const digits = hex[1].length <= 4 ? [...hex[1]].map((d) => d + d).join("") : hex[1];
        rgba = [0, 2, 4, 6].map((i) => (i < digits.length ? parseInt(digits.slice(i, i + 2), 16) : 255));
        rgba[3] /= 255;
    }
    const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+%?)\s*)?\)$/.exec(text);
    if (fn){
        const alpha = fn[4] === undefined ? 1 : fn[4].endsWith("%") ? parseFloat(fn[4]) / 100 : parseFloat(fn[4]);
        rgba = [Number(fn[1]), Number(fn[2]), Number(fn[3]), alpha];
    }
    if (rgba === null || rgba.some((v) => Number.isNaN(v))) return null;
    const [r, g, b, a] = rgba;
    const base = rgbOf(under);
    const alpha = Math.min(1, Math.max(0, a));
    return hexOf([r, g, b].map((v, i) => base[i] + (v - base[i]) * alpha));
}

/**
 * The Map's palette for a theme. On high contrast themes the boxes are drawn in the theme's own border color and a box
 * away from the selection keeps 70% of its color instead of 50%.
 */
export function fromTheme(t: ThemeInput): Palette {
    const light = t.kind === "light" || t.kind === "hc-light";
    const hc = t.kind === "hc" || t.kind === "hc-light";
    const bg = t.editor;
    const fg = t.fg;
    const accent = light ? "#9333EA" : "#A855F7";
    // how far each part is mixed from the background toward the text: boxes strong in every theme (the owner, 2026-10-27)
    const k = { node: light ? 0.05 : 0.09, line: light ? 0.28 : 0.3, linked: 0.75, edge: 0.3, glyph: light ? 0.4 : 0.45 };
    const line = mix(bg, fg, k.line);
    return {
        canvas: bg,
        panel: t.side,
        node: hc ? bg : mix(bg, fg, k.node),
        "node-sel": mix(bg, accent, light ? 0.1 : 0.16),
        "row-sel": mix(t.side, accent, light ? 0.12 : 0.18),
        divider: t.border ?? mix(bg, fg, 0.12),
        border: hc ? t.border ?? line : line,
        "linked-border": hc ? (light ? "#7E22CE" : "#C084FC") : mix(bg, accent, k.linked),
        text: fg,
        "text-2": mix(fg, bg, 0.22),
        "text-3": t.desc ?? mix(fg, bg, 0.3),
        "edge-dim": mix(bg, fg, hc ? 0.5 : k.edge),
        "edge-strong": light ? "#7E22CE" : "#E9D5FF",
        "glyph-dim": mix(bg, fg, hc ? 0.6 : k.glyph),
        "linked-glyph": light ? "#A855F7" : "#C084FC",
        accent,
        "on-accent": light ? "#FFFFFF" : "#120C1C",
        core: light ? accent : "#F0FDFF",
        // Claude Code's orange, errors, the indexed dot and the focus ring, each a step darker on light themes
        agent: light ? "#C2410C" : "#F08A4B",
        danger: light ? "#B91C1C" : "#F07A7A",
        ok: light ? "#0E7490" : "#5FC9D9",
        focus: t.focus ?? (light ? "#0E7490" : "#67E8F9"),
        fade: hc ? "70%" : "50%",
    };
}

/** Whether a theme kind is a light one: the syntax colors, the native scrollbars and React Flow's own parts follow it. */
export const isLightKind = (kind: ThemeKind): boolean => kind === "light" || kind === "hc-light";
