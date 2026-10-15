import { first } from "../../base/common/arrays";
import { StorageView } from "../browser/storageView";

export class Storage {
    readonly view = new StorageView();
    readonly firstKey = first(["a"]);
}
