import { describeAdapterConformance } from "./adapter-conformance";
import { toyAdapter } from "./toy-adapter";
import { toyRepoTruth } from "./toy-repo-truth";

// The kit on the toy language: what every language task's conformance.test.ts does with its own adapter and fixture.
describeAdapterConformance(toyAdapter, { name: "toy-repo", truth: toyRepoTruth });
