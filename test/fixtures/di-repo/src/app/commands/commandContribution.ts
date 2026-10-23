import { inject } from "../../platform/instantiation/instantiation";
import { CommandRegistry } from "./commandRegistry";

export class CommandContribution {
    @inject(CommandRegistry) protected readonly commands!: CommandRegistry;

    constructor(@inject(CommandRegistry) private readonly registry: CommandRegistry) {}

    start(): void {
        this.commands.register("a");
        this.registry.register("b");
    }
}
