import MapView from "./map/MapView";

export default function Home(){
    // A server component: a flat canvas (VISUAL_REFRESH.md §3). The Map loads its data in the browser, through app/map/api.ts.
    return (
        <div className="relative h-dvh w-full overflow-hidden bg-canvas">
            <MapView />
        </div>
    );
}
