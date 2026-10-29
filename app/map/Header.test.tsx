import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The header as the server draws it in the browser, the demo and VS Code's panel. The demo is mode.ts's DEMO, read from
 * NEXT_PUBLIC_NEBULOSITY_DEMO when the module loads, so each draw loads the header afresh. The breadcrumb is a stand-in
 * with Breadcrumb's own label.
 */
async function header({ embedded = false, demo = false, canGoBack = false } = {}): Promise<string> {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_NEBULOSITY_DEMO", demo ? "1" : "0");
    const { default: Header } = await import("./Header");
    return renderToStaticMarkup(
        <Header crumb={<nav aria-label="Where you are" />} onSearch={() => {}} onHelp={() => {}} embedded={embedded} canGoBack={canGoBack} />,
    );
}

/** The Back button's opening tag. */
const backOf = (html: string): string => {
    const tag = /<button[^>]*data-testid="back"[^>]*>/.exec(html);
    if (tag === null) throw new Error("no Back in the header");
    return tag[0];
};
const at = (html: string, needle: string): number => {
    const i = html.indexOf(needle);
    if (i < 0) throw new Error(`no ${needle} in the header`);
    return i;
};
const BACK = 'data-testid="back"';
const CRUMB = 'aria-label="Where you are"';
const LOGO = 'src="/icon.svg"';
const DIVIDER = 'aria-hidden="true" class="h-4 w-px';
/** Nothing but Back's own icon and its closing tag lies between its opening tag and the breadcrumb's. */
const nextToCrumb = (html: string): boolean => /^[^<]*><svg[^]*<\/svg><\/button><nav $/.test(html.slice(at(html, BACK), at(html, CRUMB)));

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("the header's Back (the owner's pick, 2026-10-29: the same Back in the browser, the demo and the panel)", () => {
    it("sits after the logo and its divider in the browser, right before the breadcrumb", async () => {
        const html = await header();
        expect(at(html, LOGO)).toBeLessThan(at(html, DIVIDER));
        expect(at(html, DIVIDER)).toBeLessThan(at(html, BACK));
        expect(nextToCrumb(html)).toBe(true);
    });

    it("sits there in the demo too, after the logo that links to nebulosity.ca", async () => {
        const html = await header({ demo: true });
        expect(at(html, 'href="https://nebulosity.ca"')).toBeLessThan(at(html, BACK));
        expect(at(html, DIVIDER)).toBeLessThan(at(html, BACK));
        expect(nextToCrumb(html)).toBe(true);
    });

    it("comes first in VS Code's panel, which has no logo, and still right before the breadcrumb", async () => {
        const html = await header({ embedded: true });
        expect(html).not.toContain(LOGO);
        expect(html).not.toContain(DIVIDER);
        expect(html.indexOf("<button")).toBe(html.indexOf(backOf(html)));
        expect(nextToCrumb(html)).toBe(true);
    });

    it("is the same button in all three", async () => {
        for (const canGoBack of [false, true]){
            const browser = backOf(await header({ canGoBack }));
            expect(backOf(await header({ demo: true, canGoBack }))).toBe(browser);
            expect(backOf(await header({ embedded: true, canGoBack }))).toBe(browser);
        }
    });

    it("is greyed out with none of the Map's own steps behind it, and live with one", async () => {
        const off = backOf(await header());
        expect(off).toMatch(/ disabled=""/);
        expect(off).toContain('title="Back (nothing to go back to yet)"');
        const on = backOf(await header({ canGoBack: true }));
        expect(on).not.toMatch(/ disabled=""/);
        expect(on).toContain('title="Back to where you were"');
    });

    it("never gives way as the window narrows, while the logo and its divider go under 360 px", async () => {
        for (const html of [await header(), await header({ demo: true }), await header({ embedded: true })]){
            expect(backOf(html)).not.toMatch(/hidden/);
        }
        const html = await header();
        expect(html).toMatch(/<span class="flex shrink-0 items-center gap-2 max-\[360px\]:hidden"><img [^>]*src="\/icon.svg"/);
        expect(html).toContain(`${DIVIDER} shrink-0 bg-divider max-[360px]:hidden"`);
    });
});
