import { describe, expect, it } from "vitest";
import { isTestPath } from "../../discover";
import { exclusionFor, isManifestPath, rulesFor } from "../rules";
import { javaRules } from "./rules";

describe("Java's rules", () => {
    it("claims .java, case-sensitively, as the language java", () => {
        expect(rulesFor("src/main/java/a/B.java")?.id).toBe("java");
        expect(rulesFor("src/main/java/a/B.JAVA")).toBeNull();
        expect(rulesFor("src/main/java/a/B.javax")).toBeNull();
        expect(javaRules.languageOf("a/B.java")).toBe("java");
    });

    it("counts *Test.java as a test, and not a name that only starts or contains Test", () => {
        expect(javaRules.isTest("src/main/java/a/WidgetTest.java")).toBe(true);
        expect(javaRules.isTest("src/main/java/a/TestWidget.java")).toBe(false);
        expect(javaRules.isTest("src/main/java/a/Contest.java")).toBe(false);   // lower-case "test"
    });

    it("counts *Tests.java as a test, and not *Testss.java", () => {
        expect(javaRules.isTest("a/WidgetTests.java")).toBe(true);
        expect(javaRules.isTest("a/WidgetTestss.java")).toBe(false);
    });

    it("counts *IT.java as a test, case-sensitively (Audit.java and Unit.java aren't)", () => {
        expect(javaRules.isTest("a/WidgetIT.java")).toBe(true);
        expect(javaRules.isTest("a/Audit.java")).toBe(false);
        expect(javaRules.isTest("a/Unit.java")).toBe(false);
    });

    it("counts *TestCase.java as a test, and not *TestCases.java", () => {
        expect(javaRules.isTest("a/WidgetTestCase.java")).toBe(true);
        expect(javaRules.isTest("a/WidgetTestCases.java")).toBe(false);
    });

    it("reads only the file name: a folder named like a test doesn't make a test", () => {
        expect(javaRules.isTest("a/WidgetTest/Helper.java")).toBe(false);
    });

    it("leaves src/test/ to the shared folder rule", () => {
        expect(isTestPath("app/src/test/java/a/Fixture.java")).toBe(true);
        expect(javaRules.isTest("app/src/test/java/a/Fixture.java")).toBe(false);
        expect(isTestPath("app/src/main/java/a/Fixture.java")).toBe(false);
    });

    it("counts pom.xml, build.gradle(.kts) and settings.gradle(.kts) anywhere as manifests", () => {
        for (const m of ["pom.xml", "app/pom.xml", "build.gradle", "tools/build.gradle.kts", "settings.gradle", "settings.gradle.kts"]){
            expect(javaRules.manifest.test(m), m).toBe(true);
            expect(isManifestPath(m), m).toBe(true);
        }
        for (const m of ["pom.xml.bak", "app/my-pom.xml", "build.gradle.kts.orig", "gradle.properties", "app/build.gradle.ts"]){
            expect(javaRules.manifest.test(m), m).toBe(false);
        }
    });

    it("leaves out target/ beside each pom.xml, and nothing else", () => {
        const excluded = javaRules.excluded(["app/pom.xml", "pom.xml"]);
        expect(excluded("target/generated/A.java")).toBe(true);
        expect(excluded("app/target/classes/A.java")).toBe(true);
        expect(excluded("app/src/main/java/A.java")).toBe(false);
        expect(excluded("lib/target/A.java")).toBe(false);          // no pom.xml in lib/
        expect(excluded("app/src/target/A.java")).toBe(false);      // not beside the pom
        expect(excluded("app/targets/A.java")).toBe(false);
    });

    it("leaves out build/ and .gradle/ beside a build.gradle(.kts), and .gradle/ beside a settings.gradle(.kts)", () => {
        const excluded = javaRules.excluded(["settings.gradle.kts", "tools/build.gradle", "web/build.gradle.kts"]);
        expect(excluded("tools/build/generated/A.java")).toBe(true);
        expect(excluded("tools/.gradle/8.10/A.java")).toBe(true);
        expect(excluded("web/build/A.java")).toBe(true);
        expect(excluded(".gradle/A.java")).toBe(true);
        expect(excluded("build/A.java")).toBe(false);               // a settings file alone has no build/ rule
        expect(excluded("tools/src/main/java/A.java")).toBe(false);
        expect(excluded("other/build/A.java")).toBe(false);
    });

    it("leaves out nothing without a manifest", () => {
        expect(javaRules.excluded([])("target/A.java")).toBe(false);
        expect(javaRules.excluded(["package.json", "go.mod"])("target/A.java")).toBe(false);
    });

    it("excludes only Java's own files through the registry", () => {
        const exclude = exclusionFor(["app/pom.xml"]);
        expect(exclude("app/target/A.java")).toBe(true);
        expect(exclude("app/target/a.ts")).toBe(false);   // TypeScript's file: Java's rule doesn't reach it
    });
});
