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
  source?: string;
  error?: Error;
  data?: Record<string, any>;
  [key: string]: any;
}

export interface ILog {
  level: string;
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

export class Logger {
  printThreshold: LogLevels | null = null;
  private boundContext: Record<string, any> = {};

  public static Severity = {
    trace: 0,
    debug: 1,
    info: 2,
    warn: 3,
    error: 4,
    critical: 5,
  };

  constructor(
    protected eventManager: EventManager,
    boundContext: Record<string, any> = {}
  ) {
    this.boundContext = { ...boundContext };
  }

  /**
   * Creates a new logger instance with additional bound context
   */
  public with(context: Record<string, any>): Logger {
    return new Logger(this.eventManager, {
      ...this.boundContext,
      ...context,
    });
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

  /**
   * Core logging method with structured LogInfo
   */
  public log(level: LogLevels, message: any, logInfo: LogInfo = {}): void {
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

    if (
      this.printThreshold &&
      Logger.Severity[level] >= Logger.Severity[this.printThreshold]
    ) {
      this.print(log);
    }

    if (this.eventManager.hasListeners(globalEvents.log)) {
      setImmediate(() => {
        this.eventManager
          .emit(
            globalEvents.log,
            log,
            source || this.boundContext.source || "unknown"
          )
          .catch((err) => {
            console.error("Logger event emission failed:", err);
          });
      });
    }
  }

  /**
   * Will print logs after that, use `null` to disable autoprinting.
   * @param level
   */
  public setPrintThreshold(level: LogLevels | null) {
    this.printThreshold = level;
  }

  public print(log: ILog) {
    const { level, source, message, timestamp, error, data, context } = log;

    const formattedTimestampWithMs =
      timestamp.toISOString() +
      "." +
      timestamp.getMilliseconds().toString().padStart(3, "0");
    const formattedTimestamp = `[${formattedTimestampWithMs}]`;

    const levelStr = `[${level.toUpperCase()}]`;
    const sourceStr = source ? `(${source})` : "";

    // Format the main message
    let messageStr: string;
    if (typeof message === "object") {
      messageStr = JSON.stringify(message, null, 2);
    } else {
      messageStr = String(message);
    }

    // Add error information if present
    let errorStr = "";
    if (error && error instanceof Error) {
      errorStr = `\nError: ${error.name} - ${error.message}`;
      if (error.stack) {
        errorStr += `\nStack Trace:\n${error.stack}`;
      }
    }

    // Add structured data if present
    let dataStr = "";
    if (data && Object.keys(data).length > 0) {
      dataStr = `\nData: ${JSON.stringify(data, null, 2)}`;
    }

    // Add context if present
    let contextStr = "";
    if (context && Object.keys(context).length > 0) {
      contextStr = `\nContext: ${JSON.stringify(context, null, 2)}`;
    }

    const logMessage = `${formattedTimestamp} ${levelStr} ${sourceStr} - ${messageStr}${errorStr}${dataStr}${contextStr}`;
    console.log(logMessage);
  }

  public info(message: any, logInfo: LogInfo = {}) {
    this.log("info", message, logInfo);
  }

  public error(message: any, logInfo: LogInfo = {}) {
    this.log("error", message, logInfo);
  }

  public warn(message: any, logInfo: LogInfo = {}) {
    this.log("warn", message, logInfo);
  }

  public debug(message: any, logInfo: LogInfo = {}) {
    this.log("debug", message, logInfo);
  }

  public trace(message: any, logInfo: LogInfo = {}) {
    this.log("trace", message, logInfo);
  }

  public critical(message: any, logInfo: LogInfo = {}) {
    this.log("critical", message, logInfo);
  }
}
