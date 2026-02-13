/**
 * Agent Runtime Logger
 *
 * Simple structured logging for agent runtime operations.
 * Outputs timestamped, agent-scoped log lines with configurable levels.
 *
 * Last Updated: 2026-02-05
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

interface Logger {
  debug: (msg: string, data?: unknown) => void;
  info: (msg: string, data?: unknown) => void;
  warn: (msg: string, data?: unknown) => void;
  error: (msg: string, data?: unknown) => void;
}

/**
 * Create a logger instance scoped to a specific agent
 *
 * @param agentName - Name of the agent (for log line prefix)
 * @param level - Minimum log level to output (default: "info")
 * @returns Logger instance with debug, info, warn, error methods
 *
 * @example
 * const logger = createLogger("CatalogAgent-1", "info");
 * logger.info("Evaluating auction", { taskId: "123", maxBid: 0.5 });
 * // Output: [14:23:45] [INFO] [CatalogAgent-1] Evaluating auction {"taskId":"123","maxBid":0.5}
 */
export function createLogger(
  agentName: string,
  level: LogLevel = "info"
): Logger {
  const minLevel = LOG_LEVELS[level];

  function formatTimestamp(): string {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  }

  function log(levelName: LogLevel, msg: string, data?: unknown): void {
    if (LOG_LEVELS[levelName] < minLevel) {
      return;
    }

    const timestamp = formatTimestamp();
    const levelStr = levelName.toUpperCase().padEnd(5);
    const prefix = `[${timestamp}] [${levelStr}] [${agentName}]`;

    if (data !== undefined) {
      const dataStr =
        typeof data === "object" ? JSON.stringify(data) : String(data);
      console.log(`${prefix} ${msg} ${dataStr}`);
    } else {
      console.log(`${prefix} ${msg}`);
    }
  }

  return {
    debug: (msg: string, data?: unknown) => log("debug", msg, data),
    info: (msg: string, data?: unknown) => log("info", msg, data),
    warn: (msg: string, data?: unknown) => log("warn", msg, data),
    error: (msg: string, data?: unknown) => log("error", msg, data),
  };
}

/**
 * Create a logger for runtime-level operations (not agent-specific)
 *
 * @param level - Minimum log level to output (default: "info")
 * @returns Logger instance
 *
 * @example
 * const logger = createRuntimeLogger("debug");
 * logger.info("Agent runtime starting", { maxAgents: 8 });
 * // Output: [14:23:45] [INFO] [Runtime] Agent runtime starting {"maxAgents":8}
 */
export function createRuntimeLogger(level: LogLevel = "info"): Logger {
  return createLogger("Runtime", level);
}
