import pino from 'pino';
import { Writable } from 'stream';

/** In-memory ring buffer of formatted log lines for the dashboard. */
export const logBuffer: string[] = [];
const LOG_BUFFER_MAX = 800;

export function pushLogBuffer(line: string) {
  logBuffer.push(line);
  if (logBuffer.length > LOG_BUFFER_MAX) {
    logBuffer.splice(0, logBuffer.length - LOG_BUFFER_MAX);
  }
}

// captures pino's raw JSON lines and mirrors them as readable text
const captureStream = new Writable({
  write(chunk: any, _enc, cb) {
    try {
      const raw = chunk.toString().trim();
      if (raw) {
        try {
          const obj = JSON.parse(raw);
          const time = new Date(obj.time ?? Date.now()).toLocaleTimeString('en-GB');
          const level = (pino.levels.labels[obj.level] ?? String(obj.level)).toUpperCase();
          const { level: _l, time: _t, msg, ...rest } = obj;
          const extras = Object.entries(rest)
            .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
            .join(' | ');
          pushLogBuffer(`[${time}] ${level}: ${msg ?? ''}${extras ? ` ${extras}` : ''}`);
        } catch {
          pushLogBuffer(raw);
        }
      }
    } catch {
      // never break logging because of the dashboard
    }
    cb();
  },
});

const transport = pino.transport({
  target: 'pino-pretty',
  options: {
    destination: 1,
  },
});

export const logger = pino(
  {
    level: 'info',
    redact: ['poolKeys'],
    serializers: {
      error: pino.stdSerializers.err,
    },
    base: undefined,
  },
  pino.multistream([transport, captureStream]),
);
