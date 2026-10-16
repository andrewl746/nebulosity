/**
 * Eval #3's prompts for the call kinds and the tasks (D2 of V1.7's plan, pinned): a stem naming the type, the method and
 * the declaring file in backticks; the kind's call rule; a task's tests rule; and the scope sentence (every VS Code call
 * question counts only files under src/ or a folder inside it, R-R). The runner appends the format line and the rules
 * sentence. Pure; imports nothing.
 */
export type CallKind = "callers" | "breaks" | "adopt" | "injects" | "task";
export type PromptTarget = { type: string; file: string; member?: string; within?: string };

export const TESTS_RULE = "A test file should run if it is among the files to change or directly imports one of them, counting imports by this rule: any import, export … from, side-effect import, import() or require() statement that refers to the file counts, type-only imports included. A test file has a folder named test, tests or __tests__ on its path, or .test. or .spec. in its name.";

/** D2's call rule for a kind, with the type and the method in backticks. */
export function callRule(kind: CallKind, type: string, member?: string): string {
    const t = `\`${type}\``;
    if (kind === "injects"){
        return `Count a file if it receives ${t} through a constructor parameter typed ${t}, a field decorated \`@inject(${type})\`, or a call that asks a service container or hook for it (\`get(${type})\`, \`getOptional(${type})\`, \`useService(${type})\`, \`useServiceOptional(${type})\` or \`useServices({ ${type} })\`); test files count.`;
    }
    const calls = `Count a file if it calls \`${member}\` on a value whose type is ${t}, a type that extends ${t}, or a class that implements ${t} (directly or through a base class)`;
    if (kind === "callers" || kind === "adopt") return `${calls}; test files count.`;
    return `${calls}, or if it declares ${t}, a type that extends ${t}, a class that implements ${t} or a class that extends \`mock<${type}>()\`, where that declaration defines \`${member}\`; test files count.`;
}

/** A call or task question's whole prompt, before the format line. `change` is an adopt's or a task's change, in its source's words. */
export function callPrompt(kind: CallKind, target: PromptTarget, change?: string): string {
    const { type, file, member, within } = target;
    if (kind !== "injects" && member === undefined) throw new Error(`a ${kind} question needs a member`);
    if (kind === "adopt" && change === undefined) throw new Error("an adopt question needs the change, in its source's words");
    const where = `(\`${type}\` is declared in \`${file}\`)`;
    const method = `\`${type}.${member}\``;
    const stem = kind === "callers" ? `List every file that calls ${method} ${where}.`
        : kind === "breaks" ? `If the signature of ${method} changes ${where}, which files have to change? List them.`
        : kind === "adopt" ? `${change} List every file with a call to ${method} that would have to adopt it ${where}.`
        : kind === "injects" ? `List every file that has \`${type}\` injected ${where}.`
        : `I'm changing the signature of ${method} ${where}${change === undefined ? "." : `: ${change}`} Plan it: which files will I have to change, and which tests should I run?`;
    const rules = kind === "task" ? `${callRule(kind, type, member)} ${TESTS_RULE}` : callRule(kind, type, member);
    const scope = within === undefined ? "" : ` Count only files under ${within}/${kind === "task" ? ", in both lists" : ""}.`;
    return `${stem} ${rules}${scope}`;
}
