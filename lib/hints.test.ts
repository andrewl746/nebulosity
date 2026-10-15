import path from "path";
import { describe, expect, it } from "vitest";
import { dataDir } from "./home";
import { commandHint, keyHint } from "./hints";

describe("what a message tells a user to run, installed or in a checkout (ADR-058)", () => {
    it("names the nebulosity command, and the npm script a checkout runs", () => {
        expect(commandHint("index", "<path-to-repo>")).toBe("nebulosity index <path-to-repo> (in a checkout: npm run index -- <path-to-repo>)");
        expect(commandHint("summarize", '"C:/repos/app" --release-batch b1'))
            .toBe('nebulosity summarize "C:/repos/app" --release-batch b1 (in a checkout: npm run summarize -- "C:/repos/app" --release-batch b1)');
    });

    it("says where the key goes: the environment, or the .env.local in the data folder", () => {
        expect(keyHint()).toBe(`set it in the environment, or put it in ${path.join(dataDir(), ".env.local")}`);
    });
});
