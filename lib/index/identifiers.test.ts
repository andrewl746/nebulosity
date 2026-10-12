import { describe, expect, it } from "vitest";
import { splitIdentifier } from "./identifiers";

describe("splitIdentifier", () => {
    it("splits camelCase and PascalCase", () => {
        expect(splitIdentifier("openEditor")).toBe("open editor");
        expect(splitIdentifier("ICodeEditorService")).toBe("i code editor service");
    });

    it("keeps acronyms together", () => {
        expect(splitIdentifier("HTMLParser")).toBe("html parser");
        expect(splitIdentifier("parseHTML")).toBe("parse html");
    });

    it("splits snake_case, kebab-case and $-prefixed names", () => {
        expect(splitIdentifier("get_editor_value")).toBe("get editor value");
        expect(splitIdentifier("$scope")).toBe("scope");
        expect(splitIdentifier("data-uri")).toBe("data uri");
    });

    it("keeps digits on the word they follow and leaves plain words alone", () => {
        expect(splitIdentifier("utf8Decode")).toBe("utf8 decode");
        expect(splitIdentifier("log")).toBe("log");
        expect(splitIdentifier("{ start }")).toBe("start");
    });
});
