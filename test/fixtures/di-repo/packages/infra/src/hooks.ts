type Ctor<T> = new (...args: any[]) => T;
type Uncapitalized<S extends string> = S extends `${infer F}${infer R}` ? `${Lowercase<F>}${R}` : S;

export function useService<T>(id: Ctor<T>): T {
    return new id();
}

export function useServiceOptional<T>(id: Ctor<T>): T | null {
    return useService(id);
}

export function useServices<T extends Record<string, Ctor<unknown>>>(ids: T): { [K in keyof T as Uncapitalized<K & string>]: InstanceType<T[K]> } {
    return ids as never;
}
