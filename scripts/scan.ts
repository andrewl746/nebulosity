import fs from "fs";
import path from "path";

const IGNORE_LIST = ["node_modules", ".next", ".git", "scripts"]

type FileNode = {
    id: string;
    imports: string[];
}

const foundFiles: FileNode[] = [];

const importRegex = /import\s+.*?from\s+['"](.+?)['"]/g;

function extractImports(fileContent: string): string[] {
    const imports: string[] = [];
    let match;

    while ((match = importRegex.exec(fileContent)) !== null){
        imports.push(match[1]);
    }

    return imports;
}

function scanDirectory(folderPath: string): void {
    const items = fs.readdirSync(folderPath, { withFileTypes: true });

    for (const item of items){
        if (IGNORE_LIST.includes(item.name)){
            continue;
        }

        const fullPath = path.join(folderPath, item.name);

        if (item.isDirectory()){
            scanDirectory(fullPath);
        } else{
            if (fullPath.endsWith(".ts") || fullPath.endsWith(".tsx") || fullPath.endsWith(".js") || fullPath.endsWith(".jsx")){
                const content = fs.readFileSync(fullPath, "utf-8");
                const imports = extractImports(content);

                foundFiles.push({
                    id: fullPath,
                    imports: imports
                })
            }
        }
    }
}

scanDirectory(path.join(process.cwd(), "app"));

console.log(`Found ${foundFiles.length} files:`);
console.log(JSON.stringify(foundFiles));