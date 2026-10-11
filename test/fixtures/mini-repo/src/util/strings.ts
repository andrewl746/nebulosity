import { log } from "../core";

export const shout = (s: string): string => {
    log(s);
    return s.toUpperCase();
};
