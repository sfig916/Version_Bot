/**
 * Structured logging for the application
 */

import fs from 'fs';
import path from 'path';
import { LogEntry } from '../models/types';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export class Logger {
  private source: string;
  private logPath: string;
  private logs: LogEntry[] = [];
  private minLevel: LogLevel;

  constructor(source: string, logPath?: string, minLevel: LogLevel = 'info') {
    this.source = source;
    this.logPath = logPath || '';
    this.minLevel = minLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    };
    return levels[level] >= levels[this.minLevel];
  }

  private createLogEntry(
    level: LogLevel,
    message: string,
    details?: unknown
  ): LogEntry {
    return {
      timestamp: new Date(),
      level,
      source: this.source,
      message,
      details,
    };
  }

  debug(message: string, details?: unknown): void {
    if (this.shouldLog('debug')) {
      const entry = this.createLogEntry('debug', message, details);
      this.logs.push(entry);
      console.debug(`[${this.source}] ${message}`, details || '');
    }
  }

  info(message: string, details?: unknown): void {
    if (this.shouldLog('info')) {
      const entry = this.createLogEntry('info', message, details);
      this.logs.push(entry);
      console.log(`[${this.source}] ${message}`, details || '');
    }
  }

  warn(message: string, details?: unknown): void {
    const entry = this.createLogEntry('warn', message, details);
    this.logs.push(entry);
    console.warn(`[${this.source}] ${message}`, details || '');
  }

  error(message: string, details?: unknown): void {
    const entry = this.createLogEntry('error', message, details);
    this.logs.push(entry);
    console.error(`[${this.source}] ${message}`, details || '');
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  clearLogs(): void {
    this.logs = [];
  }

  /**
   * Save logs to file
   */
  async saveLogs(): Promise<string | null> {
    if (!this.logPath) return null;

    const dir = path.dirname(this.logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const content = this.logs
      .map(
        (entry) =>
          `[${entry.timestamp.toISOString()}] [${entry.level.toUpperCase()}] [${entry.source}] ${entry.message}${entry.details ? ` ${JSON.stringify(entry.details)}` : ''}`
      )
      .join('\n');

    fs.writeFileSync(this.logPath, content, 'utf-8');
    return this.logPath;
  }

  /**
   * Export logs as JSON
   */
  exportAsJSON(): string {
    return JSON.stringify(this.logs, null, 2);
  }

  /**
   * Export logs as CSV
   */
  exportAsCSV(): string {
    const headers = ['Timestamp', 'Level', 'Source', 'Message', 'Details'];
    const rows = this.logs.map((entry) => [
      entry.timestamp.toISOString(),
      entry.level,
      entry.source,
      entry.message,
      entry.details ? JSON.stringify(entry.details) : '',
    ]);

    const csv = [
      headers.map((h) => `"${h}"`).join(','),
      ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    return csv;
  }
}

/**
 * Global logger instances
 */
const loggers = new Map<string, Logger>();

export function getLogger(source: string, logPath?: string): Logger {
  const key = source;
  if (!loggers.has(key)) {
    loggers.set(key, new Logger(source, logPath));
  }
  return loggers.get(key)!;
}

export function getAllLoggers(): Logger[] {
  return Array.from(loggers.values());
}

export function clearAllLoggers(): void {
  loggers.forEach((logger) => logger.clearLogs());
  loggers.clear();
}
