export interface ServiceIdentifier<T> {
    (...args: any[]): void;
    type: T;
}

export function createDecorator<T>(serviceId: string): ServiceIdentifier<T> {
    return function () {
        void serviceId;
    } as unknown as ServiceIdentifier<T>;
}

export interface ServicesAccessor {
    get<T>(id: ServiceIdentifier<T>): T;
    getOptional<T>(id: ServiceIdentifier<T>): T | undefined;
}

export function registerSingleton<T>(id: ServiceIdentifier<T>, ctor: new (...args: any[]) => T): void {
    void id;
    void ctor;
}

export function inject(id: unknown): (target: object, key?: string | symbol, index?: number) => void {
    return () => {
        void id;
    };
}
