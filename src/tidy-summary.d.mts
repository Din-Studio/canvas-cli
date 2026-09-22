/** One `apply.tidied[]` / `tidy.tidied[]` entry. */
export interface CanvasTidyRun {
  readonly command: number;
  readonly moved: number;
  readonly resized: number;
  readonly strays: readonly string[];
}

/**
 * `tidied[]` rendered as one text line per entry, strays named.
 *
 * The page puts this string in `apply.tidySummary` on BOTH paths (`apply` with
 * a `tidy` command in the batch, and the CLI's `tidy`), and the CLI only falls
 * back to computing it for an older page. A host that surfaces prose rather
 * than JSON pastes this instead of re-implementing the wording — "applied 1
 * command" with no numbers in it is the failure this exists to prevent.
 */
export declare function formatTidySummary(tidied: readonly CanvasTidyRun[]): string;
