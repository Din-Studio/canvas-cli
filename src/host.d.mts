export declare class HostArgvError extends Error {
  readonly code: "SESSION_NOT_ALLOWED" | "INVALID_ARGV" | "INVALID_PAYLOAD";
  constructor(code: string, message: string);
}
/** 返回追加了 `--session <sessionId>` 的新 argv；argv 已含 `--session`（任何位置）或 sessionId 为空时抛 `SESSION_NOT_ALLOWED`。 */
export declare function injectSession(argv: readonly string[], sessionId: string): string[];

export type PayloadCommand = Record<string, unknown> & { type?: string };
export type ExtractedPayload =
  | { shape: "none"; command: string }
  | {
      shape: "json" | "stdin";
      command: string;
      params: Record<string, unknown>;
      commands: PayloadCommand[] | null;
    }
  | {
      shape: "file";
      command: string;
      params: Record<string, unknown>;
      commands: PayloadCommand[] | null;
      path: string;
    }
  | {
      shape: "text-file";
      command: string;
      fields: {
        nodeId: string;
        field: "prompt" | "content" | "title";
        text: string;
        expectSha: string;
        path: string;
      };
      commands: PayloadCommand[];
    }
  | {
      shape: "tags";
      command: string;
      fields: { nodeId: string; tags: string[] };
      commands: PayloadCommand[];
    }
  | { shape: "tidy"; command: string; commands: PayloadCommand[] };

export declare function extractPayload(
  argv: readonly string[],
  options: { readFile: (pathOrDash: string) => string | Promise<string> },
): Promise<ExtractedPayload>;
