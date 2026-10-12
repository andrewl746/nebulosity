import StarField from "./components/StarField";
import MapView from "./map/MapView";

export default function Home(){
    // A server component: the static backdrop. The Map loads its data in the browser, through app/map/api.ts.
    return (
        <div className="relative h-dvh w-full overflow-hidden bg-[#06070B]">
            {/* Distant nebula: a soft radial glow behind everything */}
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_60%_40%,rgba(126,58,242,0.14),transparent_70%)]"
            />
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_35%_30%_at_75%_65%,rgba(88,28,135,0.10),transparent_70%)]"
            />
            <StarField />
            <MapView />
        </div>
    );
}
