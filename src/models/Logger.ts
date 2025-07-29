import { globalEvents } from "../globals/globalEvents";
import { EventManager } from "./EventManager";

export type LogLevels =
  | "trace"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "critical";

export interface ILog {
  level: string;
  source?: string;
  data: any;
  timestamp: Date;
  additionalData?: Record<string, any>;
}

export class Logger {
  printThreshold: LogLevels | null = null;

  public static Severity = {
    trace: 0,
    debug: 1,
    info: 2,
    warn: 3,
    error: 4,
    critical: 5,
  };

  constructor(protected eventManager: EventManager) {}

  /**
   * @param level
   * @param message
   */
  public async log(
    level: LogLevels,
    data: any,
    additionalData?: Record<string, any>,
    source?: string
  ): Promise<void> {
    const log: ILog = {
      level,
      data,
      source: source,
      additionalData,
      timestamp: new Date(),
    };

    if (
      this.printThreshold &&
      Logger.Severity[level] >= Logger.Severity[this.printThreshold]
    ) {
      this.print(log);
    }

    await this.eventManager.emit(globalEvents.log, log, source || "unknown");
  }

  /**
   * Will print logs after that, use `null` to disable autoprinting.
   * @param level
   */
  public setPrintThreshold(level: LogLevels | null) {
    this.printThreshold = level;
  }

  public print(log: ILog) {
    // Extract the relevant information from the log
    const { level, source: context, data, timestamp } = log;

    // Format the timestamp to a more readable format
    const formattedTimestamp = timestamp.toISOString();

    // Format the log level for better visibility
    const levelStr = `[${level.toUpperCase()}]`;

    // Format the context, if provided
    const contextStr = context ? `(${context})` : "";

    // Handle different data types, especially if it's an error
    let dataStr: string;
    if (data instanceof Error) {
      dataStr = `Error: ${data.name} - ${data.message}\nStack Trace:\n${data.stack}`;
    } else if (typeof data === "object") {
      dataStr = JSON.stringify(data, null, 2); // Pretty-print JSON objects
    } else {
      dataStr = String(data); // Convert any other type to string
    }

    // Construct the final log message
    const logMessage = `${formattedTimestamp} ${levelStr} ${contextStr} - ${dataStr}`;

    // Print the log message
    console.log(logMessage);
  }

  /**
   * Autocompletes the source name for the logger.
   * @param sourceName
   * @returns
   */
  public source(sourceName: string) {
    const levels = ["info", "error", "warn", "debug", "trace", "critical"];

    return levels.reduce((acc, level) => {
      acc[level] = (data: any, additionalData?: Record<string, any>) =>
        this.log(level as LogLevels, data, additionalData, sourceName);
      return acc;
    }, {} as Record<LogLevels, (data: any, additionalData?: Record<string, any>) => Promise<void>>);
  }

  public async info(
    data: any,
    additionalData: Record<string, any> = {},
    source?: string
  ) {
    await this.log("info", data, additionalData, source);
  }

  public async error(
    data: any,
    additionalData: Record<string, any> = {},
    source?: string
  ) {
    await this.log("error", data, additionalData, source);
  }

  public async warn(
    data: any,
    additionalData: Record<string, any> = {},
    source?: string
  ) {
    await this.log("warn", data, additionalData, source);
  }

  public async debug(
    data: any,
    additionalData: Record<string, any> = {},
    source?: string
  ) {
    await this.log("debug", data, additionalData, source);
  }

  public async trace(
    data: any,
    additionalData: Record<string, any> = {},
    source?: string
  ) {
    await this.log("trace", data, additionalData, source);
  }

  public async critical(
    data: any,
    additionalData: Record<string, any> = {},
    source?: string
  ) {
    await this.log("critical", data, additionalData, source);
  }
}
