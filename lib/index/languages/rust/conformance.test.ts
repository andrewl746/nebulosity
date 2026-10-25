import { describeAdapterConformance } from "../../../../test/helpers/adapter-conformance";
import { rustRepoTruth } from "../../../../test/helpers/rust-repo-truth";
import { rustAdapter } from "./index";

// The adapter conformance kit (K1–K13, Task F) on the rust-repo fixture and its hand-derived truth.
describeAdapterConformance(rustAdapter, { name: "rust-repo", truth: rustRepoTruth });
