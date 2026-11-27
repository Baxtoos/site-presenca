import type { LoggerService } from "@nestjs/common";
import pino, { type Logger } from "pino";
import type { Env } from "../config/env";

export function createLogger(env: Pick<Env, "NODE_ENV" | "LOG_LEVEL" | "APP_VERSION">): Logger {
  return pino({
    level: env.LOG_LEVEL,
    base: { service: "api", version: env.APP_VERSION },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        'res.headers["set-cookie"]',
        "*.password",
        "*.passwordHash",
        "*.token",
      ],
      censor: "[omitido]",
    },
    ...(env.NODE_ENV === "development"
      ? {
          transport: {
            target: "pino-pretty",
            options: { translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname,service,version" },
          },
        }
      : {}),
  });
}

type Level = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, ...rest: unknown[]) {
    this.write("info", message, rest);
  }
  error(message: unknown, ...rest: unknown[]) {
    this.write("error", message, rest);
  }
  warn(message: unknown, ...rest: unknown[]) {
    this.write("warn", message, rest);
  }
  debug(message: unknown, ...rest: unknown[]) {
    this.write("debug", message, rest);
  }
  verbose(message: unknown, ...rest: unknown[]) {
    this.write("trace", message, rest);
  }
  fatal(message: unknown, ...rest: unknown[]) {
    this.write("fatal", message, rest);
  }

  private write(level: Level, message: unknown, rest: unknown[]) {
    const args = [...rest];
    const context = typeof args.at(-1) === "string" ? (args.pop() as string) : undefined;
    const stack =
      typeof args[0] === "string" && args[0].includes("\n    at ") ? args[0] : undefined;
    if (message instanceof Error) {
      this.logger[level]({ context, err: message }, message.message);
    } else {
      this.logger[level]({ context, stack }, String(message));
    }
  }
}
