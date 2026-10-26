import { describeAdapterConformance } from "../../../../test/helpers/adapter-conformance";
import { pythonRepoTruth } from "../../../../test/helpers/python-repo-truth";
import { pythonAdapter } from "./index";

// The conformance kit's checks K1–K13 on test/fixtures/python-repo against its hand-derived truth (the E4 plan's Task P5).
describeAdapterConformance(pythonAdapter, { name: "python-repo", truth: pythonRepoTruth });
