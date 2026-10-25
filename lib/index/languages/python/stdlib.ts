/**
 * The top-level names that are Python's standard library on every Python from 3.10 to 3.14 (the pre-ship pass's Task P,
 * ruling R13, which amends R4). An absolute import whose first segment is one of these resolves only through the roots
 * that contain the importing file (resolve.ts), so a repo's `tests/logging.py` is reached by a test beside it but never
 * captures package code's `import logging` from another root (the E4 Python review's M6, second half). It's a fixed
 * list, never read at run time: nothing here runs Python.
 *
 * Why only names that are standard on every supported Python: a name that isn't the standard library's on one of them
 * can be the repo's own module there, so the repo's file may be the only thing such an import reaches. On 3.10 a repo
 * can keep its own `tomllib.py` (a backport), and on 3.12 its own `parser.py`, `imp.py` or `distutils/` shadows nothing
 * (the standard library has none). So the modules added after 3.10 are left out, and those removed since 3.10 are not
 * added. An import of a name on the list is still the repo's own when a root containing the importer holds it, as at
 * run time with that root first on sys.path: a flat script beside its `secrets.py`, CPython's `Lib/`, typeshed's
 * `stdlib/`.
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
 * The public top-level modules added after 3.10, from each version's What's New "New Modules" section (checked on
 * 2026-10-25): 3.11 adds tomllib (and the submodule wsgiref.types); 3.12 lists "None."; 3.13 adds only the submodule
 * dbm.sqlite3; 3.14 adds annotationlib and compression (and the submodules concurrent.interpreters and
 * string.templatelib). Private `_` modules added since (`_pyrepl`, `_colorize`, …) stay in: no repo's own module is
 * reached through them in practice, either way.
 */
const ADDED_AFTER_3_10: ReadonlySet<string> = new Set(["tomllib", "annotationlib", "compression"]);

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The standard library's top-level names on every Python from 3.10 to 3.14: 294, in code-unit order. */
export const STDLIB_MODULES: ReadonlySet<string> = new Set(CPYTHON_3_14.filter((name) => !ADDED_AFTER_3_10.has(name)).sort(byCodeUnit));

/** Whether a dotted module name (`logging`, `logging.handlers`, `email.utils`) starts with a standard-library name. */
export function isStdlibModule(dotted: string): boolean {
    const dot = dotted.indexOf(".");
    return STDLIB_MODULES.has(dot === -1 ? dotted : dotted.slice(0, dot));
}
