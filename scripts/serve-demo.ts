/**
 * npm run serve-demo [-- --port 3200]
 *
 * Serves the built static demo (out/) on 127.0.0.1, to look at before deploying and to measure S3 on. "/" and any
 * query string serve index.html; files resolve inside out/ only.
 */
import fs from "fs";
import http from "http";
import path from "path";
import { nebulosityPath } from "../lib/home";

const TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
    ".svg": "image/svg+xml", ".ico": "image/x-icon", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};
const root = nebulosityPath("out");
const portFlag = process.argv.indexOf("--port");
const port = portFlag === -1 ? 3200 : Number(process.argv[portFlag + 1]);

http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const wanted = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const file = path.join(root, wanted);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()){
        response.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
        return;
    }
    response.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(response);
}).listen(port, "127.0.0.1", () => console.log(`[serve-demo] http://127.0.0.1:${port}/  (out/)`));
