import fs from "fs";
import path from "path";
import type { ScannedFile } from "./graph";

const IGNORE_LIST = ["node_modules", ".next", ".git", "scripts"];
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const importRegex = /import\s+.*?from\s+['"](.+?)['"]/g;

type warning = {
  path: string; 
  error: string;
}

type result = {
  files: ScannedFile[];
  warnings: warning[];
}

export function extractImports(fileContent: string): string[] {
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
): result {
  const found: ScannedFile[] = []; // a ScannedFile object includes a file's id and its imports
  const warnings: warning[] = [];
  const duplicateGuard: Set<string> = new Set();

  function walk(folderPath: string): void {
    let items: fs.Dirent[];

    try{
      items = fs.readdirSync(folderPath, { withFileTypes: true });
    } catch (err){
      warnings.push({ path: folderPath, error: err instanceof Error ? err.message : String(err) });
      return;
    }

    for (const item of items) {
      if (IGNORE_LIST.includes(item.name)) continue;

      const fullPath = path.join(folderPath, item.name);

      if (item.isDirectory()){
        walk(fullPath);
      } else if (SOURCE_EXTENSIONS.some((ext) => fullPath.endsWith(ext))){
        const id = path.relative(rootDir, fullPath);
        let content: string;

        if (duplicateGuard.has(id)){
          continue;
        } else{
          duplicateGuard.add(id);
        }

        try{
          content = fs.readFileSync(fullPath, "utf-8");
        } catch (err){
          warnings.push({ path: fullPath, error: err instanceof Error ? err.message : String(err) });
          continue;
        }

        found.push({
          id,
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

  return { files: found.sort((a, b) => a.id.localeCompare(b.id)), warnings };
}
