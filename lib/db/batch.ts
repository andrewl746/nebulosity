import { getTableColumns, type Table } from "drizzle-orm";

/**
 * SQLite refuses any statement with more than 32,766 bound parameters, and Drizzle
 * turns one `.values([...])` call into one statement. Measured 2026-10-10: the old
 * saveScan threw "too many SQL variables" past 10,922 import rows (3 params each).
 * Every bulk write goes through here.
 */
export const SQLITE_MAX_PARAMS = 32_766;

/** Splits rows into batches whose total parameter count stays within maxParams. */
export function chunkRows<T>(rows: readonly T[], paramsPerRow: number, maxParams: number = SQLITE_MAX_PARAMS): T[][] {
    if (paramsPerRow < 1){
        throw new Error(`paramsPerRow must be >= 1, got ${paramsPerRow}`);
    }

    // Math.max(1, …): a row wider than the whole budget still goes out alone,
    // rather than the loop never advancing
    const size = Math.max(1, Math.floor(maxParams / paramsPerRow));
    const batches: T[][] = [];

    for (let i = 0; i < rows.length; i += size){
        batches.push(rows.slice(i, i + size));
    }

    return batches;
}

export function forEachBatch<T>(rows: readonly T[], paramsPerRow: number, write: (batch: T[]) => void): void {
    for (const batch of chunkRows(rows, paramsPerRow)){
        write(batch);
    }
}

/**
 * Parameters one inserted row can cost. Drizzle binds a value for every column,
 * including columns left to their defaults, so the honest per-row width is the
 * table's column count. The autoincrement id is rendered as a literal `null`,
 * which makes this an overestimate by one: safe, and simpler than special-casing it.
 */
export function columnCount(table: Table): number {
    return Object.keys(getTableColumns(table)).length;
}
