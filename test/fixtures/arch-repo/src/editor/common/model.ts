import { Tokens } from "./tokens";
import { Storage } from "../../platform/common/storage";

export class TextModelHandle {
    readonly tokens = new Tokens();
    readonly storage = new Storage();
}
