/**
 * The top-level names of Python's standard library (the pre-ship pass's Task P, ruling R4). An absolute import whose
 * first segment is one of these never resolves to a repo file (resolve.ts): `import logging` is the standard library's
 * logging even when a repo keeps its own `tests/logging.py` in a root, so that file can't capture every importer's
 * logging (the E4 Python review's M6, second half). It's a fixed list, never read at run time: nothing here runs Python.
 *
 * The cost, accepted by R4: a repo whose own top-level module really does shadow a standard-library name at run time
 * (its root first on sys.path) loses those edges. That's rare, because such a repo breaks its own imports of the real
 * module.
 */

/**
 * CPython 3.14.3's `sys.stdlib_module_names`, read once on 2026-10-25 with
 * `python -I -c "import sys; print('\n'.join(sorted(sys.stdlib_module_names)))"`: 297 names. Python's docs say the set
 * "is the same on all platforms" (msvcrt and winreg are in it on Linux too), lists only top-level packages (email, not
 * email.mime) and excludes the test modules, so a repo's own `test/` package still resolves.
 */
const CPYTHON_3_14: readonly string[] = [
    "__future__", "_abc", "_aix_support", "_android_support", "_apple_support", "_ast", "_ast_unparse", "_asyncio",
    "_bisect", "_blake2", "_bz2", "_codecs", "_codecs_cn", "_codecs_hk", "_codecs_iso2022", "_codecs_jp", "_codecs_kr",
    "_codecs_tw", "_collections", "_collections_abc", "_colorize", "_compat_pickle", "_contextvars", "_csv", "_ctypes",
    "_curses", "_curses_panel", "_datetime", "_dbm", "_decimal", "_elementtree", "_frozen_importlib",
    "_frozen_importlib_external", "_functools", "_gdbm", "_hashlib", "_heapq", "_hmac", "_imp", "_interpchannels",
    "_interpqueues", "_interpreters", "_io", "_ios_support", "_json", "_locale", "_lsprof", "_lzma", "_markupbase",
    "_md5", "_multibytecodec", "_multiprocessing", "_opcode", "_opcode_metadata", "_operator", "_osx_support",
    "_overlapped", "_pickle", "_posixshmem", "_posixsubprocess", "_py_abc", "_py_warnings", "_pydatetime",
    "_pydecimal", "_pyio", "_pylong", "_pyrepl", "_queue", "_random", "_remote_debugging", "_scproxy", "_sha1",
    "_sha2", "_sha3", "_signal", "_sitebuiltins", "_socket", "_sqlite3", "_sre", "_ssl", "_stat", "_statistics",
    "_string", "_strptime", "_struct", "_suggestions", "_symtable", "_sysconfig", "_thread", "_threading_local",
    "_tkinter", "_tokenize", "_tracemalloc", "_types", "_typing", "_uuid", "_warnings", "_weakref", "_weakrefset",
    "_winapi", "_wmi", "_zoneinfo", "_zstd", "abc", "annotationlib", "antigravity", "argparse", "array", "ast",
    "asyncio", "atexit", "base64", "bdb", "binascii", "bisect", "builtins", "bz2", "cProfile", "calendar", "cmath",
    "cmd", "code", "codecs", "codeop", "collections", "colorsys", "compileall", "compression", "concurrent",
    "configparser", "contextlib", "contextvars", "copy", "copyreg", "csv", "ctypes", "curses", "dataclasses",
    "datetime", "dbm", "decimal", "difflib", "dis", "doctest", "email", "encodings", "ensurepip", "enum", "errno",
    "faulthandler", "fcntl", "filecmp", "fileinput", "fnmatch", "fractions", "ftplib", "functools", "gc",
    "genericpath", "getopt", "getpass", "gettext", "glob", "graphlib", "grp", "gzip", "hashlib", "heapq", "hmac",
    "html", "http", "idlelib", "imaplib", "importlib", "inspect", "io", "ipaddress", "itertools", "json", "keyword",
    "linecache", "locale", "logging", "lzma", "mailbox", "marshal", "math", "mimetypes", "mmap", "modulefinder",
    "msvcrt", "multiprocessing", "netrc", "nt", "ntpath", "nturl2path", "numbers", "opcode", "operator", "optparse",
    "os", "pathlib", "pdb", "pickle", "pickletools", "pkgutil", "platform", "plistlib", "poplib", "posix", "posixpath",
    "pprint", "profile", "pstats", "pty", "pwd", "py_compile", "pyclbr", "pydoc", "pydoc_data", "pyexpat", "queue",
    "quopri", "random", "re", "readline", "reprlib", "resource", "rlcompleter", "runpy", "sched", "secrets", "select",
    "selectors", "shelve", "shlex", "shutil", "signal", "site", "smtplib", "socket", "socketserver", "sqlite3",
    "sre_compile", "sre_constants", "sre_parse", "ssl", "stat", "statistics", "string", "stringprep", "struct",
    "subprocess", "symtable", "sys", "sysconfig", "syslog", "tabnanny", "tarfile", "tempfile", "termios", "textwrap",
    "this", "threading", "time", "timeit", "tkinter", "token", "tokenize", "tomllib", "trace", "traceback",
    "tracemalloc", "tty", "turtle", "turtledemo", "types", "typing", "unicodedata", "unittest", "urllib", "uuid",
    "venv", "warnings", "wave", "weakref", "webbrowser", "winreg", "winsound", "wsgiref", "xml", "xmlrpc", "zipapp",
    "zipfile", "zipimport", "zlib", "zoneinfo",
];

/**
 * The top-level modules removed since 3.10: code written for an older Python still imports them, and they were the
 * standard library's then, never the repo's. 29 names, each group checked against its source on 2026-10-25.
 */
const REMOVED_SINCE_3_10: readonly string[] = [
    // 3.10: https://docs.python.org/3/whatsnew/3.10.html, "Removed", names formatter and parser. symbol isn't named
    // there: its removal is bpo-40939 in the 3.10.0a1 changelog ("Remove the remaining files from the old parser and the
    // symbol module", CPython commit 314858e, 2020-06-20); Lib/symbol.py is on CPython's 3.9 branch, not on 3.10's.
    "formatter", "parser", "symbol",
    // 3.11: https://docs.python.org/3/whatsnew/3.11.html, "Removed" ("Removed the binhex module, deprecated in Python 3.9").
    "binhex",
    // 3.12: https://docs.python.org/3/whatsnew/3.12.html, "Removed": asynchat, asyncore and smtpd on PEP 594's schedule,
    // distutils by PEP 632, and imp.
    "asynchat", "asyncore", "distutils", "imp", "smtpd",
    // 3.13: https://docs.python.org/3/whatsnew/3.13.html, "Removed Modules And APIs": PEP 594's 19 "dead batteries", and
    // lib2to3 with the 2to3 program.
    "aifc", "audioop", "cgi", "cgitb", "chunk", "crypt", "imghdr", "lib2to3", "mailcap", "msilib", "nis", "nntplib",
    "ossaudiodev", "pipes", "sndhdr", "spwd", "sunau", "telnetlib", "uu", "xdrlib",
    // 3.14 removed no top-level module (https://docs.python.org/3/whatsnew/3.14.html, "Removed").
];

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Every top-level standard-library name: 3.14's and the removed ones, 326 in all, in code-unit order. */
export const STDLIB_MODULES: ReadonlySet<string> = new Set([...CPYTHON_3_14, ...REMOVED_SINCE_3_10].sort(byCodeUnit));

/** Whether a dotted module name (`logging`, `logging.handlers`, `email.utils`) starts with a standard-library name. */
export function isStdlibModule(dotted: string): boolean {
    const dot = dotted.indexOf(".");
    return STDLIB_MODULES.has(dot === -1 ? dotted : dotted.slice(0, dot));
}
