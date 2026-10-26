# java-repo

A hand-designed Java repo for the Java adapter's conformance test (lib/index/languages/java/, E4 plan Task J). Its
ground truth is test/helpers/java-repo-truth.ts, derived by hand from these files: change a file here and re-derive the
truth by hand.

- A Maven root (`pom.xml`) with modules `lib/` and `app/`, and a Gradle module `tools/` (`build.gradle.kts`).
- Left out: `app/target/` (beside `app/pom.xml`) and `tools/.gradle/` (beside `tools/build.gradle.kts`).
- `com.example.Sample` is declared twice, in `app/src/test/java` and `lib/src/test/java`: each module's tests reach their
  own, and `tools/` reaches neither.
- `app/src/main/java/com/example/app/Broken.java` has a syntax error.
- The code doesn't need to compile; it only needs to be read.
