import type {
  CreateOptions, ExecOptions, LogEvent, MountSource, ProgressEvent, Req, Res, DirEntry,
} from './types';
import { FFmpegCrashError, FFmpegError, FFmpegTimeoutError } from './errors';
import { ProgressParser, parseDurationLine } from './progress';

// Distribute Omit over a discriminated union so each member retains its shape.
// (Plain `Omit<Req, 'id'>` collapses the union; this helper keeps each branch.)
type DistributiveOmit<T, K extends keyof T> = T extends T ? Omit<T, K> : never;
type ReqBody = DistributiveOmit<Req, 'id'>;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

interface WorkerLike {
  postMessage(msg: Req, transfer?: Transferable[]): void;
  terminate(): void | Promise<number>;
  onMessage(cb: (msg: Res) => void): void;
  onError(cb: (err: Error) => void): void;
}

const isNode = typeof process === 'object' && !!process.versions?.node && typeof window === 'undefined';

async function spawnWorker(): Promise<WorkerLike> {
  const url = new URL('./worker.js', import.meta.url);
  if (isNode) {
    const { Worker } = await import('node:worker_threads');
    const w = new Worker(url);
    return {
      postMessage: (msg, transfer) => w.postMessage(msg, (transfer as any[]) ?? []),
      terminate: () => w.terminate(),
      onMessage: (cb) => w.on('message', cb),
      onError: (cb) => w.on('error', cb),
    };
  }
  const w = new Worker(url, { type: 'module' });
  return {
    postMessage: (msg, transfer) => w.postMessage(msg, { transfer: transfer ?? [] }),
    terminate: () => w.terminate(),
    onMessage: (cb) => (w.onmessage = (ev) => cb(ev.data)),
    onError: (cb) => (w.onerror = (ev) => cb(new Error(ev.message))),
  };
}

export class FFmpeg {
  private worker: WorkerLike | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private logRing: string[] = [];
  private opts: Required<Pick<CreateOptions, 'variant'>> & CreateOptions;
  /** Per-call routing state (one exec at a time per instance) */
  private activeLog?: (e: LogEvent) => void;
  private activeProgress?: ProgressParser;
  private globalLog: ((e: LogEvent) => void)[] = [];
  /** Single-flight serialization chain: all public ops enqueue onto this. */
  private chain: Promise<unknown> = Promise.resolve();
  /** Guard against concurrent load() calls: share one in-flight spawn. */
  private loading: Promise<void> | null = null;

  private constructor(opts: CreateOptions) {
    this.opts = { variant: 'lgpl', ...opts };
  }

  static async create(opts: CreateOptions = {}): Promise<FFmpeg> {
    const ff = new FFmpeg(opts);
    await ff.load();
    return ff;
  }

  onLog(cb: (e: LogEvent) => void): void {
    this.globalLog.push(cb);
  }

  /** (Re)spawn the worker and load the core. Idempotent when alive. */
  async load(): Promise<void> {
    if (this.worker) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const coreURL = String(
        this.opts.coreURL ??
          (await resolveDefaultCore(this.opts.variant)),
      );
      const wasmURL = this.opts.wasmURL ? String(this.opts.wasmURL) : undefined;
      this.worker = await spawnWorker();
      this.worker.onMessage((msg) => this.dispatch(msg));
      this.worker.onError((err) => this.failAll(new FFmpegCrashError(`worker error: ${err.message}`, [...this.logRing])));
      await this.call({ op: 'load', coreURL, wasmURL });
    })().finally(() => { this.loading = null; });
    return this.loading;
  }

  async exec(args: string[], options: ExecOptions = {}): Promise<number> {
    return this.enqueue(() => this.run('exec', args, options));
  }

  async ffprobe(args: string[], options: ExecOptions = {}): Promise<number> {
    return this.enqueue(() => this.run('ffprobe', args, options));
  }

  /**
   * Write a file into the wasm filesystem.
   *
   * **Transfer note:** on the transfer path the caller's `Uint8Array` is detached
   * after this call returns — do not reuse the buffer after `await writeFile(...)`.
   * If you need the data afterwards, keep a separate reference or pass a copy.
   */
  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    return this.enqueue(async () => {
      if (typeof data === 'string') {
        await this.call({ op: 'writeFile', path, data });
        return;
      }
      // Transfer only a view covering its entire buffer (and only if the buffer
      // is transferable — pooled Node Buffers are not); otherwise copy.
      // Use new Uint8Array(data) rather than data.slice() to guarantee a fresh
      // standalone ArrayBuffer (Buffer.prototype.slice is an alias for subarray
      // and shares the pool buffer).
      const coversBuffer = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength;
      const payload = coversBuffer ? data : new Uint8Array(data);
      try {
        await this.call({ op: 'writeFile', path, data: payload }, [payload.buffer as ArrayBuffer]);
      } catch (e) {
        if ((e as Error)?.name === 'DataCloneError') {
          const copy = new Uint8Array(data);
          await this.call({ op: 'writeFile', path, data: copy }, [copy.buffer as ArrayBuffer]);
        } else { throw e; }
      }
    });
  }

  async readFile(path: string): Promise<Uint8Array>;
  async readFile(path: string, encoding: 'utf8'): Promise<string>;
  async readFile(path: string, encoding?: 'utf8'): Promise<Uint8Array | string> {
    return this.enqueue(() => this.call({ op: 'readFile', path, encoding }) as Promise<Uint8Array | string>);
  }

  async deleteFile(path: string): Promise<void> {
    return this.enqueue(() => this.call({ op: 'deleteFile', path }) as Promise<void>);
  }

  async rename(from: string, to: string): Promise<void> {
    return this.enqueue(() => this.call({ op: 'rename', from, to }) as Promise<void>);
  }

  async createDir(path: string): Promise<void> {
    return this.enqueue(() => this.call({ op: 'createDir', path }) as Promise<void>);
  }

  async deleteDir(path: string): Promise<void> {
    return this.enqueue(() => this.call({ op: 'deleteDir', path }) as Promise<void>);
  }

  async listDir(path: string): Promise<DirEntry[]> {
    return this.enqueue(() => this.call({ op: 'listDir', path }) as Promise<DirEntry[]>);
  }

  /** Browser-only (WORKERFS): mount Files/Blobs read-only without copying. */
  async mount(mountPoint: string, source: MountSource): Promise<void> {
    return this.enqueue(() => this.call({ op: 'mount', mountPoint, source }) as Promise<void>);
  }

  async unmount(mountPoint: string): Promise<void> {
    return this.enqueue(() => this.call({ op: 'unmount', mountPoint }) as Promise<void>);
  }

  terminate(): void {
    this.failAll(new FFmpegError('terminated'));
    this.worker?.terminate();
    this.worker = null;
  }

  // --- internals -------------------------------------------------------------

  /**
   * Serialise `fn` behind the chain so concurrent public calls execute in
   * order and log/progress routing can't be swapped mid-flight.
   */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    // Keep the chain alive regardless of outcome, without unhandled rejections.
    this.chain = next.then(() => undefined, () => undefined);
    return next;
  }

  private async run(op: 'exec' | 'ffprobe', args: string[], options: ExecOptions): Promise<number> {
    await this.load(); // respawn after crash/terminate
    const wantsProgress = !!options.onProgress && op === 'exec';
    const fullArgs = wantsProgress && !args.includes('-progress')
      ? ['-progress', 'pipe:1', '-nostats', ...args]
      : args;

    this.activeProgress = wantsProgress
      ? new ProgressParser(null, (e: ProgressEvent) => options.onProgress!(e))
      : undefined;
    this.activeLog = options.onLog;

    try {
      const ret = (await this.call(
        { op, args: fullArgs, progress: wantsProgress },
        [],
        options.timeout,
      )) as number;
      return ret;
    } finally {
      this.activeProgress = undefined;
      this.activeLog = undefined;
    }
  }

  private call(req: ReqBody, transfer: Transferable[] = [], timeout?: number): Promise<unknown> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new FFmpegError('not loaded'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const pending: Pending = { resolve, reject };
      if (timeout) {
        pending.timer = setTimeout(() => {
          this.pending.delete(id);
          // The wasm call is synchronous in the worker; the only way out is termination.
          this.terminate();
          reject(new FFmpegTimeoutError(timeout, [...this.logRing]));
        }, timeout);
      }
      this.pending.set(id, pending);
      try {
        worker.postMessage({ ...req, id } as Req, transfer);
      } catch (e) {
        this.pending.delete(id);
        if (pending.timer) clearTimeout(pending.timer);
        reject(e);
      }
    });
  }

  private dispatch(msg: Res): void {
    if (msg.id === -1) {
      // Narrow to the event members of the Res union.
      type EventMsg = Extract<Res, { id: -1 }>;
      const ev = msg as EventMsg;
      if (ev.event === 'log') {
        this.logRing.push(ev.payload.message);
        if (this.logRing.length > 100) this.logRing.shift();
        if (this.activeProgress) {
          const d = parseDurationLine(ev.payload.message);
          if (d != null) this.activeProgress.setDuration(d);
        }
        this.activeLog?.(ev.payload);
        for (const cb of this.globalLog) cb(ev.payload);
      } else if (ev.event === 'progress') {
        this.activeProgress?.push(ev.payload.line);
      }
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (p.timer) clearTimeout(p.timer);
    // Narrow to non-event members of the Res union.
    type ReplyMsg = Extract<Res, { ok: boolean }>;
    const reply = msg as ReplyMsg;
    if (reply.ok) {
      p.resolve(reply.data);
    } else if (reply.aborted) {
      // Runtime is dead; drop the worker so the next call respawns it.
      this.worker?.terminate();
      this.worker = null;
      p.reject(new FFmpegCrashError(reply.error.message, reply.error.logTail));
      // Cancel all queued calls so nothing hangs behind the dead chain.
      this.failAll(new FFmpegCrashError('worker aborted; queued calls cancelled', reply.error.logTail));
    } else {
      p.reject(Object.assign(new FFmpegError(reply.error.message, reply.error.logTail), { name: reply.error.name }));
    }
  }

  private failAll(err: Error): void {
    for (const [, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }
}

async function resolveDefaultCore(variant: 'lgpl' | 'gpl'): Promise<string> {
  const pkg = variant === 'gpl' ? '@ffweb/core-gpl' : '@ffweb/core';
  if (isNode) {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const { pathToFileURL } = await import('node:url');
    return pathToFileURL(require.resolve(pkg)).href;
  }
  throw new FFmpegError(
    `No coreURL given. In browsers pass { coreURL } pointing at ${pkg}/dist/ffmpeg-core.js ` +
    '(self-hosted or CDN); bare package resolution is only automatic in Node.',
  );
}
