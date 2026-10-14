import path from "path";

/**
 * Which file a request for the static demo asks for (serve-demo.ts). `rawUrl` is the request target as it came off the
 * wire; `root` is out/, with no trailing separator. Returns the file's path inside the root, null when the path
 * leaves the root or is the root itself (answer 404), or "bad" when it isn't a path at all: a malformed % escape, a NUL,
 * or a target not starting with "/" (answer 400). It doesn't look at the disk.
 *
 * The query string is dropped, "/" is index.html, and a backslash counts as a slash, because path.join on Windows
 * would treat it as one: "/%5c..%5c" must not walk out of the root there.
 */
export function resolveRequest(rawUrl: string, root: string): string | null | "bad" {
    if (!rawUrl.startsWith("/")) return "bad";
    let decoded: string;
    try{
        decoded = decodeURIComponent(rawUrl.split(/[?#]/, 1)[0]);
    } catch{
        return "bad";
    }
    if (decoded.includes("\0")) return "bad";
    const wanted = decoded.replace(/\\/g, "/");
    const file = path.join(root, wanted === "/" ? "/index.html" : wanted);
    return file.startsWith(root + path.sep) ? file : null;
}
