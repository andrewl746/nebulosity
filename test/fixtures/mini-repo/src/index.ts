import { main } from "./app/main";
import { log } from "@core/log";

export function start(): void {
    log("start");
    main();
}
