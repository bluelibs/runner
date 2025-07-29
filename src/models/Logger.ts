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

    // Color codes for different log levels
    const colors = {
      trace: '\x1b[90m',    // bright black/gray
      debug: '\x1b[36m',    // cyan
      info: '\x1b[32m',     // green
      warn: '\x1b[33m',     // yellow
      error: '\x1b[31m',    // red
      critical: '\x1b[35m', // magenta
      reset: '\x1b[0m',     // reset
      bold: '\x1b[1m',      // bold
      dim: '\x1b[2m',       // dim
      blue: '\x1b[34m',     // blue
      red: '\x1b[31m',      // red
      cyan: '\x1b[36m',     // cyan
    };

    const levelColor = colors[level as keyof typeof colors] || colors.info;
    
    // Format timestamp
    const time = timestamp.toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
    const ms = timestamp.getMilliseconds().toString().padStart(3, '0');
    const formattedTime = `${colors.dim}${time}.${ms}${colors.reset}`;

    // Format level with color and padding
    const levelStr = `${levelColor}${colors.bold}${level.toUpperCase().padEnd(8)}${colors.reset}`;
    
    // Format source
    const sourceStr = source ? `${colors.blue}[${source}]${colors.reset} ` : '';

    // Format the main message
    let messageStr: string;
    if (typeof message === 'object') {
      messageStr = JSON.stringify(message, null, 2);
    } else {
      messageStr = String(message);
    }

    // Build the main log line
    const mainLine = `${formattedTime} ${levelStr} ${sourceStr}${messageStr}`;
    
    // Start building output lines
    const lines = [mainLine];

    // Add error information if present
    if (error) {
      lines.push(`${colors.dim}├─ ${colors.red}Error: ${error.name}${colors.reset}`);
      lines.push(`${colors.dim}├─ ${colors.red}${error.message}${colors.reset}`);
      if (error.stack) {
        const stackLines = error.stack.split('\n').slice(1, 4); // Show first 3 stack frames
        stackLines.forEach((line, index) => {
          const prefix = index === stackLines.length - 1 ? '└─' : '├─';
          lines.push(`${colors.dim}${prefix} ${colors.red}${line.trim()}${colors.reset}`);
        });
      }
    }

    // Add structured data if present
    if (data && Object.keys(data).length > 0) {
      lines.push(`${colors.dim}├─ ${colors.cyan}Data:${colors.reset}`);
      const dataStr = JSON.stringify(data, null, 2);
      const dataLines = dataStr.split('\n');
      dataLines.forEach((line, index) => {
        const prefix = index === dataLines.length - 1 ? '└─' : '├─';
        lines.push(`${colors.dim}${prefix}   ${colors.cyan}${line}${colors.reset}`);
      });
    }

    // Add context if present (excluding common context we already show)
    const filteredContext = context ? { ...context } : {};
    delete filteredContext.source; // Already shown in source
    
    if (filteredContext && Object.keys(filteredContext).length > 0) {
      lines.push(`${colors.dim}└─ ${colors.blue}Context:${colors.reset}`);
      const contextStr = JSON.stringify(filteredContext, null, 2);
      const contextLines = contextStr.split('\n');
      contextLines.forEach((line, index) => {
        const prefix = index === contextLines.length - 1 ? '  ' : '  ';
        lines.push(`${colors.dim}${prefix}   ${colors.blue}${line}${colors.reset}`);
      });
    }

    // Output all lines
    lines.forEach(line => console.log(line));
    
    // Add a subtle separator for multi-line logs
    if (lines.length > 1) {
      console.log(`${colors.dim}${colors.reset}`);
    }
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
