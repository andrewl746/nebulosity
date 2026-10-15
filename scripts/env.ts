import { dataPath, nebulosityPath } from "../lib/home";
import { summariesEnabled } from "../lib/index/summarize/env";

/** tsx doesn't read .env.local the way Next does, and that's where ANTHROPIC_API_KEY lives. */
export function loadLocalEnv(): void {
    // a checkout's key sits in the checkout, an installed copy's in the user's data folder; each is read when it exists
    for (const file of [nebulosityPath(".env.local"), dataPath(".env.local")]){
        try{
            process.loadEnvFile(file);
        } catch{
            // no .env.local here: the key may still come from the shell
        }
    }
}

/** Summaries need a key. Without one the stage reports "off", and everything else still works. */
export function hasAnthropicKey(): boolean {
    return summariesEnabled();
}
