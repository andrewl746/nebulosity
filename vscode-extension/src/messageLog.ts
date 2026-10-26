/**
 * The record of the bridge's messages that the integration tests and benchmarks read (NebulosityApi's `sent` and
 * `received`, V1.8 plan Task 8). `waitFor` hears only messages added after it's called. A test starts the wait, then
 * the action, then awaits it, so a message an earlier step already got (a file followed in a first pass) can't satisfy
 * it at once (Plan Review #1, I15).
 */

type Waiter<T> = { offer(message: T): void };

export class MessageLog<T> {
    /** Every message, in the order added. */
    readonly all: T[] = [];
    private waiters: Waiter<T>[] = [];

    add(message: T): void {
        this.all.push(message);
        // a copy: a waiter that settles takes itself out of the list while it's walked
        for (const waiter of [...this.waiters]) waiter.offer(message);
    }

    /** The first message added from now on that `pred` accepts; rejects when none comes in `timeoutMs`. */
    waitFor(pred: (message: T) => boolean, timeoutMs: number): Promise<T> {
        return new Promise((resolve, reject) => {
            const settle = (): void => {
                clearTimeout(timer);
                this.waiters = this.waiters.filter((w) => w !== waiter);
            };
            const waiter: Waiter<T> = {
                offer: (message) => {
                    let match: boolean;
                    try{
                        match = pred(message);
                    } catch (err){
                        // the test's own predicate broke: its wait fails, and the other waiters still hear the message
                        settle();
                        reject(err instanceof Error ? err : new Error(String(err)));
                        return;
                    }
                    if (!match) return;
                    settle();
                    resolve(message);
                },
            };
            const timer = setTimeout(() => {
                settle();
                reject(new Error(`No matching message came in ${timeoutMs} ms.`));
            }, timeoutMs);
            this.waiters.push(waiter);
        });
    }
}
