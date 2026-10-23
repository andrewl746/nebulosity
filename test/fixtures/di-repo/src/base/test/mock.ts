export function mock<T>(): new () => T {
    return function () {} as unknown as new () => T;
}
