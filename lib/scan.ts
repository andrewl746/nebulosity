import fs from "fs";
import path from "path";
import { normalizeSlashes } from "./graph"
import type { ScannedFile } from "./graph";

export const IGNORE_LIST = ["node_modules", ".next", ".git", "scripts"];
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs"]

type warning = {
  path: string; 
  error: string;
}

type result = {
  files: ScannedFile[];
  warnings: warning[];
}

const IMPORT_PATTERNS = [
  /(?:import|export)\b[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
  /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g
];

export function readTsconfigAliases(rootDir: string = process.cwd()): Record<string, string> {
  const aliases: Record<string, string> = {};

  try{
    const raw = fs.readFileSync(path.join(rootDir, "tsconfig.json"), "utf-8");
    const paths = JSON.parse(raw)?.compilerOptions?.paths ?? {};

    for (const [pattern, targets] of Object.entries(paths)){
      const target = Array.isArray(targets) ? targets[0] : undefined;
      if (typeof target !== "string") continue;

      const prefix = pattern.replace(/\*$/, ""); // "@/*" → "@/"
      const replacement = target.replace(/^\.\//, "").replace(/\*$/, ""); // "./*" → ""
      aliases[prefix] = replacement;
    }
  } catch{

  }

  return aliases;
}

function stripComments(src: string): string{
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")  // remove block comments  /* ... */
    .replace(/\/\/.*/g, "");           // remove line comments   // ...
}

export function extractImports(fileContent: string): string[] {
  const source = stripComments(fileContent);
  const imports: string[] = [];
  let match;

  for (const pattern of IMPORT_PATTERNS){
    while ((match = pattern.exec(source)) !== null){
      imports.push(match[1]);
    }
  }

  return imports;
}

/**
 * Walks the given directories and returns one ScannedFile per source file,
 * with ids relative to rootDir.
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
        const id = normalizeSlashes(path.relative(rootDir, fullPath));
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
          imports: extractImports(content)
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
