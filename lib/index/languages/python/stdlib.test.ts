import { describe, expect, it } from "vitest";
import { isStdlibModule, STDLIB_MODULES } from "./stdlib";

// The standard-library list (the pre-ship pass's Task P, ruling R13): every public name standard on every Python from
// 3.10 to 3.14, plus 3.14's private ones. That's CPython 3.14.3's sys.stdlib_module_names (297 names, read once) minus
// the three public top-level modules added after 3.10 (tomllib in 3.11; annotationlib and compression in 3.14).

/** Removed since 3.10: on a current Python nothing in the standard library has these names, so they aren't listed. */
const REMOVED = [
    "formatter", "parser", "symbol",                                       // 3.10
    "binhex",                                                              // 3.11
    "asynchat", "asyncore", "distutils", "imp", "smtpd",                   // 3.12
    "aifc", "audioop", "cgi", "cgitb", "chunk", "crypt", "imghdr", "lib2to3", "mailcap", "msilib", "nis", "nntplib",
    "ossaudiodev", "pipes", "sndhdr", "spwd", "sunau", "telnetlib", "uu", "xdrlib",   // 3.13
];

/** Added after 3.10: on 3.10 a repo's own module can have these names. */
const ADDED_AFTER_3_10 = ["tomllib", "annotationlib", "compression"];

describe("python's standard-library names", () => {
    it("holds 3.14's 297 names less the 3 added after 3.10, once each, in code-unit order", () => {
        expect(STDLIB_MODULES.size).toBe(294);
        const names = [...STDLIB_MODULES];
        expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
        expect(names.slice(0, 3)).toEqual(["__future__", "_abc", "_aix_support"]);
        expect(names.at(-1)).toBe("zoneinfo");
    });

    it("has the names the fixture and Django import, on every platform", () => {
        for (const name of ["logging", "email", "os", "sys", "json", "typing", "importlib", "xml", "concurrent", "cProfile", "secrets", "code"]){
            expect(STDLIB_MODULES.has(name), name).toBe(true);
        }
        // listed on every platform, as sys.stdlib_module_names is
        for (const name of ["msvcrt", "winreg", "posix", "pwd"]) expect(STDLIB_MODULES.has(name), name).toBe(true);
    });

    it("leaves out the modules removed since 3.10 and those added after it", () => {
        expect(REMOVED).toHaveLength(29);
        for (const name of [...REMOVED, ...ADDED_AFTER_3_10]) expect(STDLIB_MODULES.has(name), name).toBe(false);
    });

    it("leaves out the test package, __main__, submodules and third-party names", () => {
        for (const name of ["test", "__main__", "email.utils", "os.path", "setuptools", "pip", "requests", "django", "typing_extensions", "Logging"]){
            expect(STDLIB_MODULES.has(name), name).toBe(false);
        }
    });

    it("isStdlibModule reads a dotted name's first segment", () => {
        expect(isStdlibModule("logging")).toBe(true);
        expect(isStdlibModule("logging.handlers")).toBe(true);
        expect(isStdlibModule("email.mime.text")).toBe(true);
        expect(isStdlibModule("distutils.core")).toBe(false);   // removed in 3.12
        expect(isStdlibModule("tomllib")).toBe(false);          // added in 3.11
        expect(isStdlibModule("test.support")).toBe(false);
        expect(isStdlibModule("shop.logging")).toBe(false);
        expect(isStdlibModule("loggingx")).toBe(false);
        expect(isStdlibModule("")).toBe(false);
    });
});
