import { giveFileItsOwnDataFolder } from "./helpers/data-folder";

// vitest.config.ts runs this before every test file (ruling R26): see giveFileItsOwnDataFolder.
giveFileItsOwnDataFolder();
