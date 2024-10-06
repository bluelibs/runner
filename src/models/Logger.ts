import { globalEvents } from "../globalEvents";
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
  context?: string;
  data: any;
  timestamp: Date;
}

export class Logger {
  printThreshold: LogLevels | null = null;

  public severity = {
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
    source?: string
  ): Promise<void> {
    const log: ILog = {
      level,
      data,
      context: source,
      timestamp: new Date(),
    };

    if (
      this.printThreshold &&
      this.severity[level] >= this.severity[this.printThreshold]
    ) {
      this.print(log);
    }

    await this.eventManager.emit(globalEvents.log, log);
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
    const { level, context, data, timestamp } = log;

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

  public async info(data: any, context?: string) {
    await this.log("info", data, context);
  }

  public async error(data: any, context?: string) {
    await this.log("error", data, context);
  }

  public async warn(data: any, context?: string) {
    await this.log("warn", data, context);
  }

  public async debug(data: any, context?: string) {
    await this.log("debug", data, context);
  }

  public async trace(data: any, context?: string) {
    await this.log("trace", data, context);
  }

  public async critical(data: any, context?: string) {
    await this.log("critical", data, context);
  }
}
