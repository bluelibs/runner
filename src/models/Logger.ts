import { globalEvents } from "../globals/globalEvents";
import { EventManager } from "./EventManager";

export type LogLevels =
  | "trace"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "critical";

export interface LogInfo {
  source?: string | symbol;
  error?: Error;
  data?: Record<string, any>;
  [key: string]: any;
}

export interface ILog {
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

// Constants extracted for cleanliness
const COLORS = {
  // Log levels
  trace: "\x1b[90m", // gray
  debug: "\x1b[36m", // cyan
  info: "\x1b[32m", // green
  warn: "\x1b[33m", // yellow
  error: "\x1b[31m", // red
  critical: "\x1b[35m", // magenta

  // Styling
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",

  // Additional colors
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

export type PrintStrategy = "pretty" | "json" | "json_pretty" | "none";
export class Logger {
  private printThreshold: LogLevels = "info";
  private printStrategy: PrintStrategy = "pretty";
  private bufferLogs: boolean = false;
  private buffer: ILog[] = [];
  private boundContext: Record<string, any> = {};
  private localListeners: Array<(log: ILog) => void | Promise<void>> = [];
  private isReady: boolean = false;

  public static Severity = {
    trace: 0,
    debug: 1,
    info: 2,
    warn: 3,
    error: 4,
    critical: 5,
  };

  constructor(
    options: {
      printThreshold: LogLevels;
      printStrategy: PrintStrategy;
      bufferLogs: boolean;
    },
    boundContext: Record<string, any> = {}
  ) {
    this.boundContext = { ...boundContext };
    this.printThreshold = options.printThreshold;
    this.printStrategy = options.printStrategy;
    this.bufferLogs = options.bufferLogs;
  }

  /**
   * Creates a new logger instance with additional bound context
   */
  public with(context: Record<string, any>): Logger {
    return new Logger(
      {
        printThreshold: this.printThreshold,
        printStrategy: this.printStrategy,
        bufferLogs: this.bufferLogs,
      },
      { ...this.boundContext, ...context }
    );
  }

  /**
   * Core logging method with structured LogInfo
   */
  public async log(
    level: LogLevels,
    message: any,
    logInfo: LogInfo = {}
  ): Promise<void> {
    const { source, error, data, ...context } = logInfo;

    const log: ILog = {
      level,
      message,
      source: source || this.boundContext.source,
      timestamp: new Date(),
      error: error ? this.extractErrorInfo(error) : undefined,
      data: data || undefined,
      context: { ...this.boundContext, ...context },
    };

    if (this.bufferLogs) {
      this.buffer.push(log);
      return;
    }

    await this.triggerLocalListeners(log);

    if (this.canPrint(level)) {
      this.print(log);
    }
  }

  private extractErrorInfo(error: Error): {
    name: string;
    message: string;
    stack?: string;
  } {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  private formatTime(timestamp: Date): string {
    const time = timestamp.toISOString().slice(11, 19);
    const ms = timestamp.getMilliseconds().toString().padStart(3, "0");
    return `${COLORS.gray}${time}.${ms}${COLORS.reset}`;
  }

  private formatLevel(level: string): string {
    const color = COLORS[level as keyof typeof COLORS] || COLORS.info;
    const icon = ICONS[level as keyof typeof ICONS] || "●";
    const label = level.toUpperCase().padEnd(7);
    return `${color}${icon} ${COLORS.bold}${label}${COLORS.reset}`;
  }

  private formatSource(source?: string): string {
    if (!source) return "";
    return `${COLORS.blue}[${source}]${COLORS.reset} `;
  }

  private formatMessage(message: any): string {
    if (typeof message === "object") {
      return JSON.stringify(message, null, 2)
        .split("\n")
        .map((line, i) =>
          i === 0 ? line : `                                     ${line}`
        )
        .join("\n");
    }
    return String(message);
  }

  private formatError(error: ILog["error"]): string[] {
    if (!error) return [];

    const lines: string[] = [];
    lines.push(
      `    ${COLORS.gray}╰─${COLORS.reset} ${COLORS.error}${error.name}: ${error.message}${COLORS.reset}`
    );

    if (error.stack) {
      const frames = error.stack.split("\n").slice(1, 3);
      frames.forEach((frame) => {
        const cleaned = frame.trim().replace(/^at /, "");
        lines.push(
          `       ${COLORS.gray}↳${COLORS.reset} ${COLORS.dim}${cleaned}${COLORS.reset}`
        );
      });
    }

    return lines;
  }

  private formatData(data?: Record<string, any>): string[] {
    if (!data || Object.keys(data).length === 0) return [];

    const lines: string[] = [];
    const formatted = JSON.stringify(data, null, 2).split("\n");

    lines.push(
      `    ${COLORS.gray}╰─${COLORS.reset} ${COLORS.cyan}data:${COLORS.reset}`
    );
    formatted.forEach((line) => {
      lines.push(`       ${COLORS.dim}${line}${COLORS.reset}`);
    });

    return lines;
  }

  private formatContext(context?: Record<string, any>): string[] {
    if (!context) return [];

    // Filter out redundant fields
    const filtered = { ...context };
    delete filtered.source;

    if (Object.keys(filtered).length === 0) return [];

    const lines: string[] = [];
    const formatted = JSON.stringify(filtered, null, 2).split("\n");

    lines.push(
      `    ${COLORS.gray}╰─${COLORS.reset} ${COLORS.blue}context:${COLORS.reset}`
    );
    formatted.forEach((line) => {
      lines.push(`       ${COLORS.dim}${line}${COLORS.reset}`);
    });

    return lines;
  }

  public print(log: ILog): void {
    const { level, source, message, timestamp, error, data, context } = log;

    // Build main line
    const mainLine = [
      this.formatTime(timestamp),
      this.formatLevel(level),
      this.formatSource(source),
      this.formatMessage(message),
    ]
      .filter(Boolean)
      .join(" ");

    // Collect all output lines
    const output: string[] = [mainLine];

    // Add supplementary information
    const errorLines = this.formatError(error);
    const dataLines = this.formatData(data);
    const contextLines = this.formatContext(context);

    // Only add supplementary lines if they exist
    if (errorLines.length || dataLines.length || contextLines.length) {
      output.push(...errorLines, ...dataLines, ...contextLines);
      output.push(""); // Clean separator line
    }

    // Output everything
    output.forEach((line) => console.log(line));
  }

  public async info(message: any, logInfo: LogInfo = {}) {
    await this.log("info", message, logInfo);
  }

  public async error(message: any, logInfo: LogInfo = {}) {
    await this.log("error", message, logInfo);
  }

  public async warn(message: any, logInfo: LogInfo = {}) {
    await this.log("warn", message, logInfo);
  }

  public async debug(message: any, logInfo: LogInfo = {}) {
    await this.log("debug", message, logInfo);
  }

  public async trace(message: any, logInfo: LogInfo = {}) {
    await this.log("trace", message, logInfo);
  }

  public async critical(message: any, logInfo: LogInfo = {}) {
    await this.log("critical", message, logInfo);
  }

  /**
   * @param listener - A listener that will be triggered for every log.
   */
  public onLog(listener: (log: ILog) => void | Promise<void>) {
    this.localListeners.push(listener);
  }

  /**
   * Marks the logger as ready.
   * This is used to trigger the local listeners and print the buffered logs (if they exists)
   * @returns A promise that resolves when the logger is ready.
   */
  public async markAsReady() {
    if (this.isReady) {
      return;
    }

    if (this.bufferLogs) {
      for (const log of this.buffer) {
        await this.triggerLocalListeners(log);
      }
      for (const log of this.buffer) {
        if (this.canPrint(log.level)) {
          this.print(log);
        }
      }
    }
    this.bufferLogs = false;
    this.buffer = [];
    this.isReady = true;
  }

  private canPrint(level: LogLevels) {
    if (this.printStrategy === "none") {
      return false;
    }

    return (
      this.printThreshold &&
      Logger.Severity[level] >= Logger.Severity[this.printThreshold]
    );
  }

  private async triggerLocalListeners(log: ILog) {
    for (const listener of this.localListeners) {
      await listener(log);
    }
  }
}
