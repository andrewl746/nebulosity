/**
 * The checks the extension's readers share: the Map's answers (serverCheck.ts, syncRules.ts) and the webview's messages
 * (fromWebview.ts, webview/relay.ts) come from another program, so every field is checked before it's read. Pure, and
 * free of Node and DOM types, so the webview's bundle can take it too.
 */

/** A stored repo-relative path's longest spelling (API_CONTRACTS §19 and §20). */
export const MAX_PATH_LENGTH = 1_024;

/** An object that isn't an array or null: a JSON object, or a message's body. */
export const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Any object but null, arrays included. Only the relay reads with it, as it always has: it passes the Map's messages on
 * to the extension, whose fromWebview.ts checks them again with isObject.
 */
export const isObjectLike = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
