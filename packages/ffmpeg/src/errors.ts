export class FFmpegError extends Error {
  constructor(message: string, public logTail: string[] = []) {
    super(message);
    this.name = 'FFmpegError';
  }
}

export class FFmpegCrashError extends FFmpegError {
  constructor(message: string, logTail: string[] = []) {
    super(message, logTail);
    this.name = 'FFmpegCrashError';
  }
}

export class FFmpegTimeoutError extends FFmpegError {
  constructor(ms: number, logTail: string[] = []) {
    super(`ffmpeg call exceeded ${ms}ms and was terminated`, logTail);
    this.name = 'FFmpegTimeoutError';
  }
}
