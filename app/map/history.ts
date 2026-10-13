/**
 * The Map's place in the address bar: `/?path=src/vs&page=2`. Every move to another folder or page goes into the
 * browser's history, so Back returns to the previous folder (owner review), and a reload or a pasted link opens the
 * same place. The page is counted from 1 for people and from 0 inside the app; the slashes of a path stay readable.
 */
export type MapPlace = { path: string; page: number };

const encodePath = (folderPath: string): string => encodeURIComponent(folderPath).replaceAll("%2F", "/");

export function mapUrl(folderPath: string, page: number): string {
    const params = [
        ...(folderPath === "" ? [] : [`path=${encodePath(folderPath)}`]),
        ...(page > 0 ? [`page=${page + 1}`] : []),
    ];
    return params.length === 0 ? "/" : `/?${params.join("&")}`;
}

/** The place a query string names; anything it can't read is the first page of the root. */
export function placeFromSearch(search: string): MapPlace {
    const params = new URLSearchParams(search);
    const page = params.get("page") ?? "";
    return { path: params.get("path") ?? "", page: /^\d+$/.test(page) && Number(page) >= 1 ? Number(page) - 1 : 0 };
}
