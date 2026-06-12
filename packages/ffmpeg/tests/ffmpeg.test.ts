import { describe, it, expect } from 'vitest';
import { FFmpegError, FFmpegCrashError, FFmpegTimeoutError } from '../src/errors';

describe('error hierarchy', () => {
  it('preserves log tails and instanceof chains', () => {
    const crash = new FFmpegCrashError('boom', ['line1', 'line2']);
    expect(crash).toBeInstanceOf(FFmpegError);
    expect(crash.name).toBe('FFmpegCrashError');
    expect(crash.logTail).toEqual(['line1', 'line2']);
    const t = new FFmpegTimeoutError(500);
    expect(t.message).toContain('500ms');
    expect(t).toBeInstanceOf(FFmpegError);
  });
});
