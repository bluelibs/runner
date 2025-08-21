import { globalEvents } from "../globals/globalEvents";
import { EventManager } from "./EventManager";
import { LogPrinter, PrintStrategy as PrinterStrategy } from "./LogPrinter";
import { safeStringify } from "./utils/safeStringify";

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
  data?: Record<string, any>;
  context?: Record<string, any>;
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

export type PrintStrategy = PrinterStrategy;
export class Logger {
  private printThreshold: null | LogLevels = "info";
  private printStrategy: PrintStrategy = "pretty";
  private bufferLogs: boolean = false;
  private buffer: ILog[] = [];
  private boundContext: Record<string, any> = {};
  private localListeners: Array<(log: ILog) => void | Promise<void>> = [];
  private isLocked: boolean = false;
  private useColors: boolean = true;
  private printer: LogPrinter;
  private source?: string;

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
    boundContext: Record<string, any> = {},
    source?: string,
  ) {
    this.boundContext = { ...boundContext };
    this.printThreshold = options.printThreshold;
    this.printStrategy = options.printStrategy;
    this.bufferLogs = options.bufferLogs;
    this.useColors =
      typeof options.useColors === "boolean"
        ? options.useColors
        : this.detectColorSupport();
    this.printer = new LogPrinter({
      strategy: this.printStrategy,
      useColors: this.useColors,
    });
    this.source = source;
  }

  private detectColorSupport(): boolean {
    // Respect NO_COLOR convention
    // eslint-disable-next-line no-undef
    const noColor = typeof process !== "undefined" && !!process.env.NO_COLOR;
    if (noColor) return false;
    // eslint-disable-next-line no-undef
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
    context,
  }: {
    source?: string;
    context?: Record<string, any>;
  }): Logger {
    return new Logger(
      {
        printThreshold: this.printThreshold,
        printStrategy: this.printStrategy,
        bufferLogs: this.bufferLogs,
        useColors: this.useColors,
      },
      { ...this.boundContext, ...context },
      source,
    );
  }

  /**
   * Core logging method with structured LogInfo
   */
  public async log(
    level: LogLevels,
    message: any,
    logInfo: ILogInfo = {},
  ): Promise<void> {
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

    if (this.bufferLogs) {
      this.buffer.push(log);
      return;
    }

    await this.triggerLocalListeners(log);

    if (this.canPrint(level)) {
      this.printer.print(log);
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

  public async info(message: any, logInfo?: ILogInfo) {
    await this.log("info", message, logInfo);
  }

  public async error(message: any, logInfo?: ILogInfo) {
    await this.log("error", message, logInfo);
  }

  public async warn(message: any, logInfo?: ILogInfo) {
    await this.log("warn", message, logInfo);
  }

  public async debug(message: any, logInfo?: ILogInfo) {
    await this.log("debug", message, logInfo);
  }

  public async trace(message: any, logInfo?: ILogInfo) {
    await this.log("trace", message, logInfo);
  }

  public async critical(message: any, logInfo?: ILogInfo) {
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
  public onLog(listener: (log: ILog) => any) {
    this.localListeners.push(listener);
  }

  /**
   * Marks the logger as ready.
   * This is used to trigger the local listeners and print the buffered logs (if they exists)
   * @returns A promise that resolves when the logger is ready.
   */
  public async lock() {
    if (this.isLocked) {
      return;
    }

    if (this.bufferLogs) {
      for (const log of this.buffer) {
        await this.triggerLocalListeners(log);
      }
      for (const log of this.buffer) {
        if (this.canPrint(log.level)) {
          this.printer.print(log);
        }
      }
    }
    this.bufferLogs = false;
    this.buffer = [];
    this.isLocked = true;
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

  private async triggerLocalListeners(log: ILog) {
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
