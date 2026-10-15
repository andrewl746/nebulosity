import { TaskRunner } from "./taskRunner";

export interface ITaskHost {
    runner: TaskRunner;
}

function makeRunner(): TaskRunner {
    return new TaskRunner();
}

async function makePair(): Promise<[string, TaskRunner]> {
    return ["pair", makeRunner()];
}

export async function runAll(host: ITaskHost): Promise<string> {
    const { runner } = host;
    const [, paired] = await makePair();
    return host.runner.run("a") + runner.run("b") + makeRunner().run("c") + paired.run("d");
}

export class TaskPanel {
    private readonly runner = new TaskRunner();

    refresh(): () => string {
        const that = this;
        return function () {
            return that.runner.run("e");
        };
    }
}
