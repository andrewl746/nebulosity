import { trim } from "./strings";

export function first(items: string[]): string {
    return trim(items[0] ?? "");
}
