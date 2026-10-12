/**
 * Runs fn over items with at most `limit` calls in flight at once, keeping results in input
 * order. The regular API is rate limited, and a wave can hold up to 99 requests.
 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;

    // each worker takes the next unclaimed index; claiming is synchronous, so no two take the same one
    const worker = async (): Promise<void> => {
        while (next < items.length){
            const index = next++;
            results[index] = await fn(items[index]);
        }
    };

    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}
