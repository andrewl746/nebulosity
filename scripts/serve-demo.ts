/**
 * npm run serve-demo [-- --port 3200]
 *
 * Serves the built static demo (out/) on 127.0.0.1, to look at before deploying and to measure S3 on. "/" and any
 * query string serve index.html; files resolve inside out/ only (resolve-request.ts). A request it can't make sense
 * of gets a 400 and a file it can't read a 500: neither stops the server.
 */
import fs from "fs";
import http from "http";
import path from "path";
import { nebulosityPath } from "../lib/home";
import { resolveRequest } from "./resolve-request";

const TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
    ".svg": "image/svg+xml", ".ico": "image/x-icon", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};
const root = nebulosityPath("out");
const portFlag = process.argv.indexOf("--port");
const port = portFlag === -1 ? 3200 : Number(process.argv[portFlag + 1]);
if (!Number.isInteger(port) || port < 1 || port > 65535){
    console.error("usage: npm run serve-demo [-- --port 3200]");
    process.exit(1);
}
if (!fs.existsSync(path.join(root, "index.html"))){
    console.error(`[serve-demo] ${path.join(root, "index.html")} doesn't exist: run npm run build-demo first.`);
    process.exit(1);
}

function reply(response: http.ServerResponse, status: number, text: string): void {
    if (response.headersSent) return;
    response.writeHead(status, { "Content-Type": "text/plain" }).end(text);
}

const server = http.createServer((request, response) => {
    const file = resolveRequest(request.url ?? "/", root);
    if (file === "bad"){
        reply(response, 400, "bad request");
        return;
    }
    try{
        if (file === null || !fs.existsSync(file) || !fs.statSync(file).isFile()){
            reply(response, 404, "not found");
            return;
        }
        const stream = fs.createReadStream(file);
        // the status goes out once the file is open, so a file that can't be opened can still get a 500
        stream.on("open", () => response.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" }));
        stream.on("error", () => {
            if (response.headersSent) response.destroy();
            else reply(response, 500, "could not read the file");
        });
        response.on("close", () => stream.destroy());
        stream.pipe(response);
    } catch{
        reply(response, 500, "server error");
    }
});
server.on("error", (err: NodeJS.ErrnoException) => {
    console.error(err.code === "EADDRINUSE" ? `[serve-demo] port ${port} is already in use: pick another with --port.` : `[serve-demo] ${err.message}`);
    process.exit(1);
});
server.listen(port, "127.0.0.1", () => console.log(`[serve-demo] http://127.0.0.1:${port}/  (out/)`));
