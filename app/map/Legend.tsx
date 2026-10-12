/**
 * What the lines and colors mean (VISUAL_REFRESH.md §4: "label the relationship"), said once in a corner instead of on
 * every line. It never takes a click from the boxes under it.
 */
export default function Legend(){
    return (
        <div aria-label="Legend" className="pointer-events-none absolute bottom-4 left-4 z-[5] space-y-1 rounded-lg border border-hairline bg-panel px-3 py-2 text-[12px] text-text-2">
            <Row glyph={<Arrow color="var(--neutral-edge)" />}>A → B: A imports B</Row>
            <Row glyph={<Arrow color="var(--select)" />}>The selected box and its links</Row>
            <Row glyph={<span className="block h-3 w-3 rounded-sm outline-2 outline-agent" />}>What Claude Code is touching</Row>
        </div>
    );
}

function Row({ glyph, children }: { glyph: React.ReactNode; children: React.ReactNode }){
    return (
        <div className="flex items-center gap-2">
            <span aria-hidden className="flex w-6 justify-center">{glyph}</span>
            <span>{children}</span>
        </div>
    );
}

function Arrow({ color }: { color: string }){
    return (
        <svg width="24" height="8" viewBox="0 0 24 8" style={{ color }}>
            <line x1="0" y1="4" x2="18" y2="4" stroke="currentColor" strokeWidth="1.5" />
            <path d="M17 0.5 L24 4 L17 7.5 Z" fill="currentColor" />
        </svg>
    );
}
