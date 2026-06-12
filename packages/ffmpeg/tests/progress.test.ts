import { describe, it, expect } from 'vitest';
import { ProgressParser, parseDurationLine } from '../src/progress';

describe('parseDurationLine', () => {
  it('extracts duration in microseconds from ffmpeg stderr', () => {
    expect(parseDurationLine('  Duration: 00:00:10.50, start: 0.000000, bitrate: 128 kb/s'))
      .toBe(10_500_000);
  });
  it('returns null for unrelated lines', () => {
    expect(parseDurationLine('frame=   10 fps=0.0')).toBeNull();
    expect(parseDurationLine('  Duration: N/A, start: 0')).toBeNull();
  });
});

describe('ProgressParser', () => {
  it('accumulates key=value lines and emits on progress=', () => {
    const events: unknown[] = [];
    const p = new ProgressParser(10_000_000, (e) => events.push(e));
    p.push('frame=25');
    p.push('fps=12.5');
    p.push('out_time_us=5000000');
    p.push('speed=1.25x');
    expect(events).toHaveLength(0);
    p.push('progress=continue');
    expect(events).toEqual([
      { ratio: 0.5, timeUs: 5_000_000, fps: 12.5, speed: 1.25, done: false },
    ]);
  });

  it('clamps ratio to 1 and flags done on progress=end', () => {
    const events: { ratio?: number; done: boolean }[] = [];
    const p = new ProgressParser(1_000_000, (e) => events.push(e));
    p.push('out_time_us=1500000');
    p.push('progress=end');
    expect(events[0].ratio).toBe(1);
    expect(events[0].done).toBe(true);
  });

  it('omits ratio when duration unknown', () => {
    const events: { ratio?: number }[] = [];
    const p = new ProgressParser(null, (e) => events.push(e));
    p.push('out_time_us=2000000');
    p.push('progress=continue');
    expect(events[0].ratio).toBeUndefined();
  });

  it('ignores malformed values', () => {
    const events: { timeUs: number }[] = [];
    const p = new ProgressParser(null, (e) => events.push(e));
    p.push('out_time_us=N/A');
    p.push('progress=continue');
    expect(events[0].timeUs).toBe(0);
  });
});
