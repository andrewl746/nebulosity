import { log } from "@arch/core/lib/log";

export function button(label: string): string {
    log(label);
    return `[${label}]`;
}
