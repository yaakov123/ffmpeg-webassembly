import type { ProgressEvent } from './types';

/** Parse "Duration: HH:MM:SS.cc" from ffmpeg stderr; returns microseconds or null. */
export function parseDurationLine(line: string): number | null {
  const m = line.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!m) return null;
  const us = (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1e6;
  return Math.round(us);
}

/**
 * Accumulates `-progress pipe:1` key=value lines (arriving on stdout) and
 * emits one ProgressEvent per `progress=` terminator line.
 */
export class ProgressParser {
  private acc: Record<string, string> = {};

  constructor(
    private durationUs: number | null,
    private emit: (e: ProgressEvent) => void,
  ) {}

  push(line: string): void {
    const eq = line.indexOf('=');
    if (eq < 0) return;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key !== 'progress') {
      this.acc[key] = value;
      return;
    }
    const timeUs = toNum(this.acc['out_time_us']) ?? 0;
    const e: ProgressEvent = {
      timeUs,
      done: value === 'end',
      fps: toNum(this.acc['fps']),
      speed: toNum(this.acc['speed']?.replace(/x$/, '')),
    };
    if (this.durationUs && this.durationUs > 0) {
      e.ratio = Math.min(1, timeUs / this.durationUs);
    }
    this.acc = {};
    this.emit(e);
  }

  setDuration(us: number): void {
    if (this.durationUs == null) this.durationUs = us;
  }
}

function toNum(v: string | undefined): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
