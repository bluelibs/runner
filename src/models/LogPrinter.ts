import { safeStringify } from "./utils/safeStringify";

const ansiRegex =
  /[][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
function stripAnsi(str: string): string {
  return str.replace(ansiRegex, "");
}

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
  message: unknown;
  timestamp: Date;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  data?: Record<string, unknown>;
  context?: Record<string, unknown>;
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
    if (options.strategy === "plain") {
      this.colors = LogPrinter.NO_COLORS;
    } else {
      const base =
        options.useColors || options.colorTheme ? COLORS : LogPrinter.NO_COLORS;
      this.colors = { ...base, ...(options.colorTheme || {}) };
    }
  }

  public print(log: PrintableLog): void {
    if (this.strategy === "json") {
      LogPrinter.writers.log(safeStringify(this.normalizeForJson(log)));
      return;
    }

    if (this.strategy === "json_pretty") {
      LogPrinter.writers.log(safeStringify(this.normalizeForJson(log), 2));
      return;
    }

    // Pretty, multi-line output
    const { level, source, message, timestamp, error, data, context } = log;

    const timePart = this.formatTime(timestamp);
    const levelPart = this.formatLevel(level);
    const sourcePart = this.formatSource(source);

    const headerLine = [timePart, levelPart, sourcePart]
      .filter(Boolean)
      .join(" ");

    const messageString = this.formatMessage(message);
    const messageLines = messageString.split("\n");

    const output: string[] = [headerLine];

    const timePartLength = stripAnsi(timePart).length;
    const levelPartLength = stripAnsi(levelPart).length;
    // Indentation is length of time + space + level + space
    const indentation = " ".repeat(timePartLength + 1 + levelPartLength + 1);

    if (message) {
      output.push(...messageLines.map((line) => `${indentation}${line}`));
    }

    const errorLines = this.formatError(error);
    const dataLines = this.formatData(data);
    const contextLines = this.formatContext(context);

    const detailsExist =
      errorLines.length > 0 || dataLines.length > 0 || contextLines.length > 0;

    if (detailsExist) {
      output.push(""); // Add a space before details
    }

    output.push(...errorLines, ...dataLines, ...contextLines);

    if (detailsExist) {
      output.push(""); // Add a space after for readability
    }

    const writer = this.pickWriter(level);
    output.forEach((line) => writer(line));
    // New line for readability especially in console
    writer("");
  }

  private pickWriter(level: LogLevels) {
    const toError =
      level === "warn" || level === "error" || level === "critical";
    if (toError && typeof LogPrinter.writers.error === "function") {
      return (msg: string) => LogPrinter.writers.error!(msg);
    }
    return (msg: string) => LogPrinter.writers.log(msg);
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
    return `${this.colors.cyan}${source}${this.colors.reset}`;
  }

  private formatMessage(message: unknown): string {
    if (typeof message === "object" && message !== null) {
      return safeStringify(message, 2);
    }
    return String(message);
  }

  private formatError(
    error: PrintableLog["error"],
    indentation = "  ",
  ): string[] {
    if (!error) return [];
    const lines: string[] = [];
    lines.push(
      `${indentation}${this.colors.gray}╰─${this.colors.reset} ${this.colors.error}Error: ${error.name}: ${error.message}${this.colors.reset}`,
    );
    if (error.stack) {
      const frames = error.stack.split("\n").slice(1); // slice(1) to skip the error message line
      frames.forEach((frame) => {
        const cleaned = frame.trim().replace(/^at /, "");
        lines.push(
          `${indentation}   ${this.colors.gray}↳${this.colors.reset} ${this.colors.dim}${cleaned}${this.colors.reset}`,
        );
      });
    }
    return lines;
  }

  private formatData(
    data?: Record<string, unknown>,
    indentation = "  ",
  ): string[] {
    if (!data || Object.keys(data).length === 0) return [];
    const lines: string[] = [];
    const formatted = safeStringify(data, 2, { maxDepth: 3 }).split("\n");
    lines.push(
      `${indentation}${this.colors.gray}╰─${this.colors.reset} ${this.colors.cyan}Data:${this.colors.reset}`,
    );
    formatted.forEach((line) => {
      // Keep data lines non-padded to save horizontal space
      lines.push(`${indentation}${this.colors.dim}${line}${this.colors.reset}`);
    });
    return lines;
  }

  private formatContext(
    context?: Record<string, unknown>,
    indentation = "  ",
  ): string[] {
    if (!context) return [];
    const { source: _source, ...filtered } = context;
    if (Object.keys(filtered).length === 0) return [];
    const lines: string[] = [];
    const formatted = safeStringify(filtered, 2, { maxDepth: 3 }).split("\n");
    lines.push(
      `${indentation}${this.colors.gray}╰─${this.colors.reset} ${this.colors.blue}Context:${this.colors.reset}`,
    );
    formatted.forEach((line) => {
      // Keep context lines non-padded to save horizontal space
      lines.push(`${indentation}${this.colors.dim}${line}${this.colors.reset}`);
    });
    return lines;
  }

  private normalizeForJson(log: PrintableLog): PrintableLog {
    const normalized = { ...log };
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

  private static readonly DEFAULT_WRITERS = {
    log: (msg: string) => {
      if (typeof console !== "undefined" && typeof console.log === "function") {
        console.log(msg);
      }
    },
    error: (msg: string) => {
      if (
        typeof console !== "undefined" &&
        typeof console.error === "function"
      ) {
        console.error(msg);
      }
    },
  };

  private static writers: {
    log: (msg: string) => void;
    error?: (msg: string) => void;
  } = { ...LogPrinter.DEFAULT_WRITERS };

  public static setWriters(
    writers: Partial<{
      log: (msg: string) => void;
      error?: (msg: string) => void;
    }>,
  ) {
    LogPrinter.writers = { ...LogPrinter.writers, ...writers };
  }

  public static resetWriters() {
    LogPrinter.writers = { ...LogPrinter.DEFAULT_WRITERS };
  }
}
