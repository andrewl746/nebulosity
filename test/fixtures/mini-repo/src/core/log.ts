/** Writes a message. */
export function log(message: string): void { console.log(message); }

export class Logger {
    info(message: string): void { log(message); }
    private warn(message: string): void { log("warn: " + message); }
}

export const banner = "import fake from './not-real'";
