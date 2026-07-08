import fs from "fs";
import path from "path";

const IGNORE_LIST = ["node_modules", ".next", ".git", "scripts"]

const foundFiles: string[] = [];

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
                foundFiles.push(fullPath);
            }
        }
    }
}

scanDirectory(path.join(process.cwd(), "app"));

console.log(`Found ${foundFiles.length} files:`);
console.log(foundFiles);