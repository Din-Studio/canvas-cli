// Echo gate for canvas data (B9-FX-15 / B11); re-exported by scene3d-text.mjs.

/**
 * Every line terminator Unicode / Python `splitlines` honours (LF, CR, VT, FF, FS, GS, RS, NEL,
 * U+2028, U+2029): the one class behind echoMessage's `⏎` and the CLI's single-line resend check.
 */
export declare const LINE_BREAK: RegExp;

/**
 * Canvas data echoed in a verbatim summary line: control characters, line / paragraph
 * separators, bidi controls and the invisible U+200B / U+2060 / U+FEFF become one space (a value
 * cannot add a line), capped at `max` code points (B9-FX-15).
 */
export declare function echoText(value: unknown, max?: number): string;

/**
 * Free text echoed as a whole field (`error.message`, a node's `lastError.message`): line breaks
 * ({@link LINE_BREAK}) print as `⏎`, other folded characters as a space, capped at `max` code
 * points (default 400; B11 fuzz). A value that itself starts with a forged next step still starts
 * with it: hosts label these fields.
 */
export declare function echoMessage(value: unknown, max?: number): string;

/**
 * Prose echoed on a line that also carries an argv (a card title in the stale-renders line):
 * {@link echoText}, minus shell quotes, backticks, `$` and backslashes, with every run of `-` not
 * preceded by a letter or digit printed as U+2010, so the value cannot add a `--json` /
 * `--approved` word or open a quote.
 */
export declare function echoProse(value: unknown, max?: number): string;

/** What an echoed URL prints when it is not echoable. */
export declare const URL_UNAVAILABLE: string;

/**
 * An echoed URL: only an http(s) URL equal to its own canonical form (no whitespace, control
 * characters or non-ASCII), at most 2048 characters; anything else prints {@link URL_UNAVAILABLE}.
 */
export declare function echoUrl(url: unknown): string;

/** What an echoed shot / card id prints when it is not echoable. */
export declare const ID_UNAVAILABLE: string;

/**
 * An echoed shot / card id: only the id grammar the page generates and accepts (`SCENE3D.idPattern`,
 * ASCII letters, digits and `_ . -`, at most 128); anything else prints {@link ID_UNAVAILABLE}, so a
 * value cannot carry a forged next step on its own line (B11-F2-2).
 */
export declare function echoId(value: unknown): string;

/**
 * An echoed shot number: only an integer `n` prints as itself; anything else prints the shot id
 * through {@link echoId} (a stored `n` is collaborator-writable canvas data, B11-int review).
 */
export declare function echoShotN(n: unknown, shotId: unknown): string;
