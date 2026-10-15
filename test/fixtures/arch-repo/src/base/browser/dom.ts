import { trim } from "../common/strings";

export function el(tag: string): string {
    return `<${trim(tag)}>`;
}
