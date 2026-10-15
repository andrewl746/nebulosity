export async function load(dev: boolean): Promise<unknown> {
    let url: string;
    if (dev) url = "./main.js";
    else url = new URL("app/main.js", import.meta.url).href;
    return import(url);
}
