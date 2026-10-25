import { describe, expect, it } from "vitest";
import { isStdlibModule, STDLIB_MODULES } from "./stdlib";

// The standard-library list (the pre-ship pass's Task P): CPython 3.14.3's sys.stdlib_module_names (297 names, read
// once) and the 29 top-level modules removed since 3.10, as the plan lists them.

const REMOVED = [
    "formatter", "parser", "symbol",                                       // 3.10
    "binhex",                                                              // 3.11
    "asynchat", "asyncore", "distutils", "imp", "smtpd",                   // 3.12
    "aifc", "audioop", "cgi", "cgitb", "chunk", "crypt", "imghdr", "lib2to3", "mailcap", "msilib", "nis", "nntplib",
    "ossaudiodev", "pipes", "sndhdr", "spwd", "sunau", "telnetlib", "uu", "xdrlib",   // 3.13
];

describe("python's standard-library names", () => {
    it("holds 3.14's 297 names and the 29 removed since 3.10, once each, in code-unit order", () => {
        expect(REMOVED).toHaveLength(29);
        expect(STDLIB_MODULES.size).toBe(326);
        const names = [...STDLIB_MODULES];
        expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
        expect(names.slice(0, 3)).toEqual(["__future__", "_abc", "_aix_support"]);
        expect(names.at(-1)).toBe("zoneinfo");
    });

    it("has every removed module, and the 3.14 ones the fixture and Django import", () => {
        for (const name of REMOVED) expect(STDLIB_MODULES.has(name), name).toBe(true);
        for (const name of ["logging", "email", "os", "sys", "json", "typing", "importlib", "xml", "concurrent", "cProfile"]){
            expect(STDLIB_MODULES.has(name), name).toBe(true);
        }
        // listed on every platform, as sys.stdlib_module_names is
        for (const name of ["msvcrt", "winreg", "posix", "pwd"]) expect(STDLIB_MODULES.has(name), name).toBe(true);
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
        expect(isStdlibModule("distutils.core")).toBe(true);   // removed in 3.12, still the standard library's
        expect(isStdlibModule("test.support")).toBe(false);
        expect(isStdlibModule("shop.logging")).toBe(false);
        expect(isStdlibModule("loggingx")).toBe(false);
        expect(isStdlibModule("")).toBe(false);
    });
});
