import fs from "fs";
import path from "path";
import { makeTempDir } from "./temp";

/** test/fixtures/mini-repo: the hand-designed repo whose ground truth is in the V1.1 plan. */
export const FIXTURE = path.resolve("test/fixtures/mini-repo");

/** test/fixtures/arch-repo: the hand-designed repo whose ground truth is in the V1.6 plan (workspaces, docs, architecture). */
export const ARCH_FIXTURE = path.resolve("test/fixtures/arch-repo");

/** test/fixtures/di-repo: the hand-designed repo whose ground truth is in the V1.7 plan (calls through injected services). */
export const DI_FIXTURE = path.resolve("test/fixtures/di-repo");

/** A private copy of a fixture (the mini-repo unless another is named), for tests that index or edit it. Deleted when the test ends. */
export function copyFixture(fixture: string = FIXTURE): string {
    const dir = makeTempDir("neb-fixture-");
    fs.cpSync(fixture, dir, { recursive: true });
    return dir;
}
