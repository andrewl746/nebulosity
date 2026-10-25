import { describeAdapterConformance } from "../../../../test/helpers/adapter-conformance";
import { csharpRepoTruth } from "../../../../test/helpers/csharp-repo-truth";
import { csharpAdapter } from ".";

// The kit's K1–K13 on the C# adapter, against test/fixtures/csharp-repo's hand-derived truth.
describeAdapterConformance(csharpAdapter, { name: "csharp-repo", truth: csharpRepoTruth });
