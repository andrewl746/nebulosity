import MapView from "./map/MapView";
import { MIN_HEIGHT, MIN_WIDTH } from "./map/narrow";

export default function Home(){
    // A server component: a flat canvas (VISUAL_REFRESH.md §3). The Map loads its data in the browser, through app/map/api.ts.
    // It fills the window down to the floor (narrow.ts); below it, it keeps that size and the page scrolls. It fills the
    // body's column rather than 100dvh: a sideways scrollbar takes height from the window, and 100dvh would then scroll
    // down by the scrollbar's height too.
    return (
        <div data-testid="map-root" style={{ minWidth: MIN_WIDTH, minHeight: MIN_HEIGHT }} className="relative w-full flex-1 overflow-hidden bg-canvas">
            <MapView />
        </div>
    );
}
