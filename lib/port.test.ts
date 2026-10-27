import net from "net";
import { afterEach, describe, expect, it } from "vitest";
import { listenError } from "./port";

/** A server listening on 127.0.0.1, on a port the system picked: what another app holding the Map's port looks like. */
function holdPort(): Promise<{ port: number; server: net.Server }> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve({ port: (server.address() as net.AddressInfo).port, server }));
    });
}

const close = (server: net.Server): Promise<void> => new Promise((resolve) => server.close(() => resolve()));

describe("listenError (a failed nebulosity map used to save its port anyway)", () => {
    const held: net.Server[] = [];
    afterEach(async () => {
        await Promise.all(held.splice(0).map(close));
    });

    it("says EADDRINUSE for a port another server listens on", async () => {
        const { port, server } = await holdPort();
        held.push(server);
        expect((await listenError(port))?.code).toBe("EADDRINUSE");
    });

    it("is null for a free port, and leaves it free", async () => {
        const { port, server } = await holdPort();
        await close(server);
        expect(await listenError(port)).toBeNull();
        // the probe closed its own listen: the port can be taken again at once
        const again = net.createServer();
        held.push(again);
        await new Promise<void>((resolve, reject) => {
            again.once("error", reject);
            again.listen(port, "127.0.0.1", () => resolve());
        });
    });
});
