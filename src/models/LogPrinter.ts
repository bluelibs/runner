import { safeStringify } from "./utils/safeStringify";
export type PrintStrategy = "pretty" | "plain" | "json" | "json_pretty";

export type LogLevels =
  | "trace"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "critical";

export interface PrintableLog {
  level: LogLevels;
  source?: string;
  message: any;
  timestamp: Date;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  data?: Record<string, any>;
  context?: Record<string, any>;
}

export type ColorTheme = {
  trace: string;
  debug: string;
  info: string;
  warn: string;
  error: string;
  critical: string;
  reset: string;
  bold: string;
  dim: string;
  blue: string;
  cyan: string;
  gray: string;
};

const COLORS: Readonly<ColorTheme> = {
  trace: "\x1b[90m",
  debug: "\x1b[36m",
  info: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
  critical: "\x1b[35m",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
} as const;

const ICONS = {
  trace: "○",
  debug: "◆",
  info: "●",
  warn: "▲",
  error: "✕",
  critical: "█",
} as const;

export class LogPrinter {
  private strategy: PrintStrategy;
  private colors: ColorTheme;

  constructor(options: {
    strategy: PrintStrategy;
    useColors: boolean;
    colorTheme?: Partial<ColorTheme>;
  }) {
    this.strategy = options.strategy;
    // For 'plain', force no ANSI colors regardless of options
    if (options.strategy === "plain") {
      this.colors = LogPrinter.NO_COLORS;
    } else {
      // If a custom colorTheme is provided, prefer starting from the colored theme
      // so that overrides augment ANSI-enabled defaults even when useColors=false.
      // This allows tests or consumers to opt-in per-key colors via colorTheme.
      const base =
        options.useColors || options.colorTheme ? COLORS : LogPrinter.NO_COLORS;
      this.colors = { ...base, ...(options.colorTheme || {}) };
    }
  }

  public print(log: PrintableLog): void {
    if (this.strategy === "json") {
      // Compact JSON line
      LogPrinter.writers.log(safeStringify(this.normalizeForJson(log)));
      return;
    }

    if (this.strategy === "json_pretty") {
      // Pretty JSON
      LogPrinter.writers.log(safeStringify(this.normalizeForJson(log), 2));
      return;
    }

    // Default: pretty
    const { level, source, message, timestamp, error, data, context } = log;
    const mainLine = [
      this.formatTime(timestamp),
      this.formatLevel(level),
      this.formatSource(source),
      this.formatMessage(message),
    ]
      .filter(Boolean)
      .join(" ");

    const output: string[] = [mainLine];
    const errorLines = this.formatError(error);
    const dataLines = this.formatData(data);
    const contextLines = this.formatContext(context);
    if (errorLines.length || dataLines.length || contextLines.length) {
      output.push(...errorLines, ...dataLines, ...contextLines);
      output.push("");
    }
    const writer = this.pickWriter(level);
    output.forEach((line) => writer(line));
  }

  private pickWriter(level: LogLevels) {
    const toError =
      level === "warn" || level === "error" || level === "critical";
    if (toError && typeof LogPrinter.writers.error === "function") {
      return (msg: any) => LogPrinter.writers.error!(msg);
    }
    return (msg: any) => LogPrinter.writers.log(msg);
  }

  private formatTime(timestamp: Date): string {
    const time = timestamp.toISOString().slice(11, 19);
    const ms = timestamp.getMilliseconds().toString().padStart(3, "0");
    return `${this.colors.gray}${time}.${ms}${this.colors.reset}`;
  }

  private formatLevel(level: string): string {
    const color = this.colors[level as keyof typeof COLORS] || this.colors.info;
    const icon = ICONS[level as keyof typeof ICONS] || "●";
    const label = level.toUpperCase().padEnd(7);
    return `${color}${icon} ${this.colors.bold}${label}${this.colors.reset}`;
  }

  private formatSource(source?: string): string {
    if (!source) return "";
    return `${this.colors.blue}[${source}]${this.colors.reset} `;
  }

  private formatMessage(message: any): string {
    if (typeof message === "object") {
      const json = safeStringify(message, 2);
      const padding = " ".repeat(37);
      return json
        .split("\n")
        .map((line: string, i: number) =>
          i === 0 ? line : `${padding}${line}`,
        )
        .join("\n");
    }
    return String(message);
  }

  private formatError(error: PrintableLog["error"]): string[] {
    if (!error) return [];
    const lines: string[] = [];
    lines.push(
      `    ${this.colors.gray}╰─${this.colors.reset} ${this.colors.error}${error.name}: ${error.message}${this.colors.reset}`,
    );
    if (error.stack) {
      const frames = error.stack.split("\n");
      frames.forEach((frame) => {
        const cleaned = frame.trim().replace(/^at /, "");
        lines.push(
          `       ${this.colors.gray}↳${this.colors.reset} ${this.colors.dim}${cleaned}${this.colors.reset}`,
        );
      });
    }
    return lines;
  }

  private formatData(data?: Record<string, any>): string[] {
    if (!data || Object.keys(data).length === 0) return [];
    const lines: string[] = [];
    const formatted = safeStringify(data, 2, { maxDepth: 3 }).split("\n");
    lines.push(
      `    ${this.colors.gray}╰─${this.colors.reset} ${this.colors.cyan}data:${this.colors.reset}`,
    );
    formatted.forEach((line) => {
      lines.push(`       ${this.colors.dim}${line}${this.colors.reset}`);
    });
    return lines;
  }

  private formatContext(context?: Record<string, any>): string[] {
    if (!context) return [];
    const filtered = { ...context };
    delete (filtered as any).source;
    if (Object.keys(filtered).length === 0) return [];
    const lines: string[] = [];
    const formatted = safeStringify(filtered, 2, { maxDepth: 3 }).split("\n");
    lines.push(
      `    ${this.colors.gray}╰─${this.colors.reset} ${this.colors.blue}context:${this.colors.reset}`,
    );
    formatted.forEach((line) => {
      lines.push(`       ${this.colors.dim}${line}${this.colors.reset}`);
    });
    return lines;
  }

  private normalizeForJson(log: PrintableLog) {
    const normalized: any = { ...log };
    if (typeof log.message === "object") {
      const text = safeStringify(log.message);
      try {
        normalized.message = JSON.parse(text);
      } catch {
        normalized.message = text;
      }
    }
    return normalized;
  }

  // Intentionally no private stringify; reuse shared util for consistency

  private static NO_COLORS: ColorTheme = {
    trace: "",
    debug: "",
    info: "",
    warn: "",
    error: "",
    critical: "",
    reset: "",
    bold: "",
    dim: "",
    blue: "",
    cyan: "",
    gray: "",
  } as const;

  private static writers: {
    log: (msg: any) => void;
    error?: (msg: any) => void;
  } = {
    // eslint-disable-next-line no-console
    log: (msg: any) => console.log(msg),
    // eslint-disable-next-line no-console
    error: (msg: any) => console.error?.(msg),
  };

  public static setWriters(
    writers: Partial<{ log: (msg: any) => void; error?: (msg: any) => void }>,
  ) {
    LogPrinter.writers = { ...LogPrinter.writers, ...writers };
  }

  public static resetWriters() {
    // eslint-disable-next-line no-console
    LogPrinter.writers = {
      log: (msg: any) => console.log(msg),
      error: (msg: any) => console.error?.(msg),
    };
  }
}
