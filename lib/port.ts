import net from "net";

/**
 * Why a server can't listen on 127.0.0.1:<port> right now (EADDRINUSE when another app or a running Map holds it), or
 * null when it can. It makes the same listen `next start -H 127.0.0.1 -p <port>` makes, and closes it at once, so
 * `nebulosity map` can refuse a port before saving it: a start that fails mustn't move the port that live events,
 * show_on_map and the VS Code extension follow.
 */
export function listenError(port: number): Promise<NodeJS.ErrnoException | null> {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once("error", (err: NodeJS.ErrnoException) => resolve(err));
        server.listen(port, "127.0.0.1", () => server.close(() => resolve(null)));
    });
}
