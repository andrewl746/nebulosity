/**
 * C#'s generic arity in a name (the pre-ship pass, Task C): the CLR's backtick form, so `Box<T>` declares Box`1 and
 * `Box<int, string>` names Box`2, while a name with no type parameters or arguments has no suffix and reads as it
 * always did. C# tells `Box`, `Box<T>` and `Box<T, U>` apart by their arity (each can live in its own file), so a
 * reference carries it to find the right one. Pure string functions: parse.ts and scan.ts write names this way;
 * resolve.ts and the pure rules (rules.ts, which load no parser) read them.
 */

const TICK = "`";
/** Every arity in a dotted name: A.Outer`1.Inner`2 has two. No C# identifier holds a backtick, so nothing else matches. */
const EVERY_ARITY = /`\d+/g;
/** The last segment's arity, at the name's end. */
const LAST_ARITY = /`\d+$/;

/** A name with its arity: Box and 1 give Box`1; an arity of 0 leaves the name as it is. */
export function withArity(name: string, arity: number): string {
    return arity === 0 ? name : `${name}${TICK}${arity}`;
}

/** A name with every arity taken out, as the source writes it without its type arguments: A.Outer`1.Inner`2 → A.Outer.Inner. */
export function withoutArity(name: string): string {
    return name.includes(TICK) ? name.replace(EVERY_ARITY, "") : name;
}

/** The last segment's arity split off: A.Marker`1 → [A.Marker, `1]; a name without one → [name, ""]. */
export function splitArity(name: string): [string, string] {
    const match = LAST_ARITY.exec(name);
    return match === null ? [name, ""] : [name.slice(0, match.index), match[0]];
}
