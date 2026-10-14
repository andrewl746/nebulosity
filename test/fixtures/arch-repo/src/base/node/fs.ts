import { first } from "../common/arrays";

export function readFile(paths: string[]): string {
    return first(paths);
}
