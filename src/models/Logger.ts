import { LogPrinter, PrintStrategy as PrinterStrategy } from "./LogPrinter";

export type LogLevels =
  | "trace"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "critical";

export interface ILogInfo {
  source?: string;
  error?: unknown | Error;
  data?: Record<string, unknown>;
  context?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ILog {
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

export type PrintStrategy = PrinterStrategy;
export class Logger {
  private printThreshold: null | LogLevels = "info";
  private printStrategy: PrintStrategy = "pretty";
  private bufferLogs: boolean = false;
  private buffer: ILog[] = [];
  private boundContext: Record<string, unknown> = {};
  private isLocked: boolean = false;
  private useColors: boolean = true;
  private printer: LogPrinter;
  private source?: string;
  // Points to the top-level logger so child loggers share buffering, listeners, and printing.
  private rootLogger?: Logger;
  public localListeners: Array<(log: ILog) => void | Promise<void>> = [];

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
      printThreshold: null | LogLevels;
      printStrategy: PrintStrategy;
      bufferLogs: boolean;
      useColors?: boolean;
    },
    boundContext: Record<string, unknown> = {},
    source?: string,
    printer?: LogPrinter,
  ) {
    this.boundContext = { ...boundContext };
    this.printThreshold = options.printThreshold;
    this.printStrategy = options.printStrategy;
    this.bufferLogs = options.bufferLogs;
    this.useColors =
      typeof options.useColors === "boolean"
        ? options.useColors
        : this.detectColorSupport();

    this.source = source;

    this.printer = printer
      ? printer
      : new LogPrinter({
          strategy: this.printStrategy,
          useColors: this.useColors,
        });
  }

  private detectColorSupport(): boolean {
    // Respect NO_COLOR convention

    const noColor = typeof process !== "undefined" && !!process.env.NO_COLOR;
    if (noColor) return false;

    const isTty =
      typeof process !== "undefined" &&
      !!process.stdout &&
      !!process.stdout.isTTY;
    return isTty;
  }

  /**
   * Creates a new logger instance with additional bound context
   */
  public with({
    source,
    additionalContext: context,
  }: {
    source?: string;
    additionalContext?: Record<string, unknown>;
  }): Logger {
    const child = new Logger(
      {
        printThreshold: this.printThreshold,
        printStrategy: this.printStrategy,
        bufferLogs: this.bufferLogs,
        useColors: this.useColors,
      },
      { ...this.boundContext, ...context },
      source,
      this.printer,
    );
    // Ensure child logger delegates buffering, listeners and printing to root
    child.rootLogger = this.rootLogger ?? this;
    return child;
  }

  /**
   * Core logging method with structured LogInfo
   */
  public async log(
    level: LogLevels,
    message: unknown,
    logInfo: ILogInfo = {},
  ): Promise<void> {
    const root = this.rootLogger ?? this;
    const shouldPrint = root.canPrint(level);
    const hasListeners = root.localListeners.length > 0;

    // Avoid building log payloads when they would be dropped.
    if (!root.bufferLogs && !shouldPrint && !hasListeners) {
      return;
    }

    const { source, error, data, ...context } = logInfo;

    const log: ILog = {
      level,
      message,
      source: source || this.source,
      timestamp: new Date(),
      error: error ? this.extractErrorInfo(error) : undefined,
      data: data || undefined,
      context: { ...this.boundContext, ...context },
    };

    if (root.bufferLogs) {
      root.buffer.push(log);
      return;
    }

    await root.triggerLogListeners(log);

    if (shouldPrint) {
      root.printer.print(log);
    }
  }

  private extractErrorInfo(error: Error | unknown): {
    name: string;
    message: string;
    stack?: string;
  } {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    return {
      name: "UnknownError",
      message: String(error),
    };
  }

  public async info(message: unknown, logInfo?: ILogInfo) {
    await this.log("info", message, logInfo);
  }

  public async error(message: unknown, logInfo?: ILogInfo) {
    await this.log("error", message, logInfo);
  }

  public async warn(message: unknown, logInfo?: ILogInfo) {
    await this.log("warn", message, logInfo);
  }

  public async debug(message: unknown, logInfo?: ILogInfo) {
    await this.log("debug", message, logInfo);
  }

  public async trace(message: unknown, logInfo?: ILogInfo) {
    await this.log("trace", message, logInfo);
  }

  public async critical(message: unknown, logInfo?: ILogInfo) {
    await this.log("critical", message, logInfo);
  }

  /**
   * Direct print for tests and advanced scenarios. Delegates to LogPrinter.
   */
  public print(log: ILog) {
    this.printer.print(log);
  }

  /**
   * @param listener - A listener that will be triggered for every log.
   */
  public onLog(listener: (log: ILog) => void | Promise<void>) {
    if (this.rootLogger && this.rootLogger !== this) {
      this.rootLogger.onLog(listener);
    } else {
      this.localListeners.push(listener);
    }
  }

  /**
   * Marks the logger as ready.
   * This is used to trigger the local listeners and print the buffered logs (if they exists)
   * @returns A promise that resolves when the logger is ready.
   */
  public async lock() {
    const root = this.rootLogger ?? this;
    if (root.isLocked) {
      return;
    }

    if (root.bufferLogs) {
      for (const log of root.buffer) {
        await root.triggerLogListeners(log);
      }
      for (const log of root.buffer) {
        if (root.canPrint(log.level)) {
          root.printer.print(log);
        }
      }
    }
    root.bufferLogs = false;
    root.buffer = [];
    root.isLocked = true;
  }

  private canPrint(level: LogLevels) {
    if (this.printThreshold === null) {
      return false;
    }

    return (
      this.printThreshold &&
      Logger.Severity[level] >= Logger.Severity[this.printThreshold]
    );
  }

  private async triggerLogListeners(log: ILog) {
    if (this.rootLogger && this.rootLogger !== this) {
      await this.rootLogger.triggerLogListeners(log);
    }

    for (const listener of this.localListeners) {
      try {
        await listener(log);
      } catch (error) {
        this.print({
          level: "error",
          message: "Error in log listener",
          timestamp: new Date(),
          error: {
            name: "ListenerError",
            message: error instanceof Error ? error.message : String(error),
          },
        });
        // We're not breaking the app due to logListener errors.
        continue;
      }
    }
  }
}
