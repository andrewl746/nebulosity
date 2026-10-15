export class DisposableStore {
    add<T>(thing: T): T {
        return thing;
    }
}

export class Disposable {
    protected _register<T>(thing: T): T {
        return thing;
    }
}
