import { describeAdapterConformance } from "../../../../test/helpers/adapter-conformance";
import { goRepoTruth } from "../../../../test/helpers/go-repo-truth";
import { goAdapter } from "./index";

// the conformance kit's checks K1–K13 against test/fixtures/go-repo's hand-derived truth
describeAdapterConformance(goAdapter, { name: "go-repo", truth: goRepoTruth });
