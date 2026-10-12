import { nebulosityPath } from "../lib/home";

/** tsx doesn't read .env.local the way Next does, and that's where ANTHROPIC_API_KEY lives. */
export function loadLocalEnv(): void {
    try{
        process.loadEnvFile(nebulosityPath(".env.local"));
    } catch{
        // no .env.local: the key may still come from the shell
    }
}

/** Summaries need a key. Without one the stage reports "off", and everything else still works. */
export function hasAnthropicKey(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
}
