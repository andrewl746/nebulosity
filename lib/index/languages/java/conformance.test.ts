import { describeAdapterConformance } from "../../../../test/helpers/adapter-conformance";
import { javaRepoTruth } from "../../../../test/helpers/java-repo-truth";
import { javaAdapter } from ".";

// K1–K13 (test/helpers/adapter-conformance.ts) against test/fixtures/java-repo's hand-derived truth
describeAdapterConformance(javaAdapter, { name: "java-repo", truth: javaRepoTruth });
