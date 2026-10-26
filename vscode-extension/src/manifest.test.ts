import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * The manifest's settings scopes (V1.8 Final Review #1, finding 3a). `nebulosity.command` names a program the extension
 * spawns, and `nebulosity.port` says where the Map is. A cloned repo's `.vscode/settings.json` must not choose either, so
 * both are scope "machine": VS Code reads them only from the user's settings (or a remote machine's), and ignores them in
 * a workspace or folder. "machine-overridable" would be wrong here: it is the scope that workspace and folder settings
 * CAN override (VS Code's contribution-points doc; its workbench lists it among the workspace and folder scopes).
 * `nebulosity.followEditor` is harmless in a workspace, so it keeps the default scope (window), which is no "scope" key.
 */
const MANIFEST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");

type Property = { scope?: string };
const properties = (): Record<string, Property> => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as { contributes: { configuration: { properties: Record<string, Property> } } };
    return manifest.contributes.configuration.properties;
};

describe("the manifest's settings scopes", () => {
    it("reads nebulosity.command only from user or machine settings, never a workspace's", () => {
        expect(properties()["nebulosity.command"]?.scope).toBe("machine");
    });

    it("reads nebulosity.port only from user or machine settings, never a workspace's", () => {
        expect(properties()["nebulosity.port"]?.scope).toBe("machine");
    });

    it("leaves nebulosity.followEditor with no scope, so a workspace may set it", () => {
        const followEditor = properties()["nebulosity.followEditor"];
        expect(followEditor).toBeDefined();
        expect(followEditor).not.toHaveProperty("scope");
    });
});
