import { log } from "../core/log";
import { render } from "./view";
import { shout } from "../util/strings.js";

export function main(): void {
    log(shout("main"));
    render();
}
