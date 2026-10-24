/**
 * Which port the Map is on (V1.8 plan P2): the `nebulosity.port` setting, else the port `nebulosity map --print-port`
 * prints (the one the Map was last started on, from the data folder's config), else the Map's own default.
 */

/** `nebulosity map`'s default port. */
export const DEFAULT_PORT = 3000;

/**
 * `nebulosity map --print-port`'s output read as a port: one whole number from 1 to 65535 on its own line, with the
 * whitespace and the line ending around it (`\r\n` on Windows) trimmed. Anything else is null, so a warning or an error
 * printed to stdout is never mistaken for a port.
 */
export function parsePrintedPort(stdout: string): number | null {
    const text = stdout.trim();
    // no m flag: ^ and $ are the ends of the whole output, so a second line refuses it
    if (!/^\d+$/.test(text)) return null;
    const port = Number(text);
    return port >= 1 && port <= 65_535 ? port : null;
}

/** The setting wins (null or undefined when it isn't set), then the printed port, then the default. */
export function choosePort(setting: number | null | undefined, printed: number | null): number {
    return setting ?? printed ?? DEFAULT_PORT;
}
