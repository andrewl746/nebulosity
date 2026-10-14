import {
    DEMO_FORMAT_VERSION, type DemoDescribeBundle, type DemoManifest, type DemoPageIndex, type DemoSearchIndex,
    type DescribeResponse, type IndexEventMap, type LevelResponse, type RepoList, type SourceResponse, type SummarizeResponse,
} from "@/lib/contracts";
import { buildStaticSearch, searchStatic, type StaticSearch } from "@/lib/engine/staticSearch";
import type { GitHubSource, MapApi } from "./api";
import { ApiError } from "./apiError";
import { boxToward, bundleIdFor, clampPage, describeFile, indexManifest, levelFile, pageCountOf, pageHolding, pagesFile, type DemoIndex } from "./demoData";

/** Describe bundles kept in memory; a visitor rarely opens more folders than this. */
const MAX_BUNDLES = 100;
const notIndexed = (targetPath: string): ApiError => new ApiError(404, "NOT_FOUND", `Nothing is indexed at "${targetPath}".`);
const notInDemo = (what: string): ApiError => new ApiError(404, "NOT_FOUND", `${what} isn't part of the static demo; it needs Nebulosity running on your machine.`);

/**
 * The Map's transport in the static demo (ADR-049): the same calls as the server's API, answered from the exported
 * files (API_CONTRACTS.md §18). What needs a server (summarize, re-index, switching repos, the source viewer) refuses.
 * Shared files (the manifest, bundles, the search index) are fetched once and kept, without a caller's abort signal,
 * so one caller giving up doesn't fail the next.
 */
export function createStaticApi(base: string = "/demo/", fetcher: typeof fetch = (...args) => fetch(...args)): MapApi & { github(): Promise<GitHubSource | null> } {
    let manifest: Promise<DemoIndex> | null = null;
    let searchIndex: Promise<StaticSearch> | null = null;
    const bundles = new Map<number, Promise<DemoDescribeBundle>>();

    async function file<T>(rel: string, signal?: AbortSignal): Promise<T> {
        let response: Response;
        try{
            response = await fetcher(base + rel, { signal });
        } catch (err){
            if (err instanceof DOMException && err.name === "AbortError") throw err;
            throw new ApiError(0, "NETWORK", "The demo's data didn't load. Check the connection and reload.");
        }
        if (response.status === 404) throw new ApiError(404, "NOT_FOUND", `The demo has no ${rel}.`);
        if (!response.ok) throw new ApiError(response.status, "INTERNAL", `The demo's ${rel} didn't load (HTTP ${response.status}).`);
        return (await response.json()) as T;
    }

    const index = (): Promise<DemoIndex> => (manifest ??= file<DemoManifest>("manifest.json").then((m) => {
        if (m.format !== DEMO_FORMAT_VERSION){
            throw new ApiError(500, "INTERNAL", `This demo's data is format ${m.format}, and this page reads format ${DEMO_FORMAT_VERSION}. Reload the page.`);
        }
        return indexManifest(m);
    }).catch((err: unknown) => {
        manifest = null;
        throw err;
    }));

    return {
        async level(folderPath: string, page: number = 0, signal?: AbortSignal, focus?: string): Promise<LevelResponse> {
            const at = await index();
            const id = at.ids.get(folderPath);
            if (id === undefined) throw notIndexed(folderPath);
            const count = pageCountOf(at, id);
            let wanted = clampPage(page, count);
            // the page holding the focus wins, as on the server; a focus outside this folder is ignored
            const box = focus === undefined ? null : boxToward(folderPath, focus);
            if (box !== null && count > 1) wanted = pageHolding(await file<DemoPageIndex>(pagesFile(id), signal), box) ?? wanted;
            return file<LevelResponse>(levelFile(id, wanted), signal);
        },
        async describe(targetPath: string): Promise<DescribeResponse> {
            const id = bundleIdFor(await index(), targetPath);
            if (id === null) throw notIndexed(targetPath);
            let bundle = bundles.get(id);
            if (bundle === undefined){
                bundle = file<DemoDescribeBundle>(describeFile(id));
                bundles.set(id, bundle);
                bundle.catch(() => bundles.delete(id));
                if (bundles.size > MAX_BUNDLES) bundles.delete(bundles.keys().next().value!);
            }
            const answer = (await bundle)[targetPath];
            if (answer === undefined) throw notIndexed(targetPath);
            return answer;
        },
        async search(query: string, limit: number) {
            const at = await index();
            searchIndex ??= file<DemoSearchIndex>("search.json").then(buildStaticSearch).catch((err: unknown) => {
                searchIndex = null;
                throw err;
            });
            return searchStatic(await searchIndex, query, { limit, repoName: at.manifest.repo });
        },
        async status() {
            return (await index()).manifest.status;
        },
        async source(): Promise<SourceResponse> {
            throw notInDemo("The source viewer");
        },
        async summarize(): Promise<SummarizeResponse> {
            throw notInDemo("Summarizing");
        },
        async repos(): Promise<RepoList> {
            const m = (await index()).manifest;
            return { active: m.repo, repos: [{ root: m.repo, name: m.repo, indexedAt: null, ...(m.remote ? { remote: m.remote } : {}) }] };
        },
        async setActiveRepo(): Promise<RepoList> {
            throw notInDemo("Switching repos");
        },
        async reindex(): Promise<IndexEventMap["done"]> {
            throw notInDemo("Re-indexing");
        },
        async github(): Promise<GitHubSource | null> {
            const m = (await index()).manifest;
            return m.remote && m.commit ? { owner: m.remote.owner, name: m.remote.name, commit: m.commit } : null;
        },
    };
}
