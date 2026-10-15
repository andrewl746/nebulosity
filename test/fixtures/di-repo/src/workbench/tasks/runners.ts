import { TaskRunner } from "./taskRunner";

export class LoggingRunner extends TaskRunner {
    override run(name: string): string {
        return super.run(`log:${name}`);
    }
}

export function makeRunners(): TaskRunner[] {
    class TwiceRunner extends TaskRunner {
        twice(name: string): string {
            return this.run(name) + this.run(name);
        }
    }
    const quiet = new class extends TaskRunner {}();
    quiet.run("quiet");
    return [new TwiceRunner(), quiet];
}
