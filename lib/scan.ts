import "server-only";
import fs from "fs";
import path from "path";
import type { ScannedFile } from "./graph";

const IGNORE_LIST = ["node_modules", ".next", ".git", "scripts"];
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const importRegex = /import\s+.*?from\s+['"](.+?)['"]/g;

function extractImports(fileContent: string): string[] {
  const imports: string[] = [];
  let match;

  while ((match = importRegex.exec(fileContent)) !== null){
    imports.push(match[1]);
  }

  return imports;
}

/**
 * Reusable version of scripts/scan.ts — walks the given directories and
 * returns one ScannedFile per source file, with ids relative to rootDir.
 */
export function scanProject(
  rootDir: string = process.cwd(),
  dirs: string[] = ["app", "lib"],
): ScannedFile[] {
  const found: ScannedFile[] = [];

  function walk(folderPath: string): void {
    const items = fs.readdirSync(folderPath, { withFileTypes: true });

    for (const item of items) {
      if (IGNORE_LIST.includes(item.name)) continue;

      const fullPath = path.join(folderPath, item.name);

      if (item.isDirectory()){
        walk(fullPath);
      } else if (SOURCE_EXTENSIONS.some((ext) => fullPath.endsWith(ext))){
        const content = fs.readFileSync(fullPath, "utf-8");

        found.push({
          id: path.relative(rootDir, fullPath),
          imports: extractImports(content),
        });
      }
    }
  }

  for (const dir of dirs){
    const target = path.join(rootDir, dir);

    if (fs.existsSync(target)){
      walk(target);
    }
  }

  return found;
}
