/** What a promise was rejected with; a promise that resolves fails the test. */
export function rejectionOf(promise: Promise<unknown>): Promise<Error> {
    return promise.then(() => { throw new Error("expected a rejection"); }, (err: unknown) => err as Error);
}
