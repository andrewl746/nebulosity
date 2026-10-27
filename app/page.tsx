import MapView from "./map/MapView";

export default function Home(){
    // A server component: a flat canvas (VISUAL_REFRESH.md §3). The Map loads its data in the browser, through app/map/api.ts.
    // It fills the window at any size (app/map/shell.ts); in a window shorter than its least height it keeps that height
    // and the page scrolls down. Nothing in it is wider than the window, so the page never scrolls sideways.
    return (
        <div data-testid="map-root" className="relative flex w-full flex-1 flex-col bg-canvas">
            <MapView />
        </div>
    );
}
