# Phase 1B: @ffweb/ffmpeg TypeScript Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `@ffweb/ffmpeg` TypeScript library — a worker-based, promise-friendly API over the Phase 1A wasm cores — with Vitest unit tests, Node integration tests, and Playwright tests across Chromium/Firefox/WebKit.

**Architecture:** The library spawns a dedicated worker (web `Worker` in browsers, `worker_threads` in Node) which imports the ESM core factory. Main-thread ↔ worker communication is an id-correlated message protocol with transferables. Logs and `-progress pipe:1` output stream back as events; a pure parser converts them to progress ratios. Crashes (`Module.aborted`) reject in-flight calls with the log tail and the worker is respawned lazily on the next call.

**Tech Stack:** TypeScript 5.x, tsup (ESM build + d.ts), Vitest, Playwright, Node 22. Cores from Phase 1A at `packages/core[-gpl]/dist/ffmpeg-core.{js,wasm}` (ESM `createFFmpegCore` factory exposing `exec`, `ffprobe`, `logger`, `ret`, `aborted`, `FS`).

**Established facts the implementation relies on:**
- Core factory: `const createFFmpegCore = (await import(coreURL)).default; const core = await createFFmpegCore(config)`. `config.locateFile` overrides the `.wasm` URL; `config.mainScriptUrlOrBlob` must be set to the core URL so pthread workers can respawn the module when it was imported from a non-relative URL.
- `core.logger = (l) => ...` receives `{ type: 'stdout'|'stderr', message }`. `core.exec(...args)`/`core.ffprobe(...args)` are synchronous, return the exit code, never throw for normal ffmpeg errors; a wasm crash sets `core.aborted = true` and returns 1.
- `core.FS` is Emscripten FS (`writeFile`, `readFile`, `unlink`, `rename`, `mkdir`, `rmdir`, `readdir`, `stat`, `isDir`, `mount`, `unmount`, `filesystems.WORKERFS`).
- WORKERFS works only in browser workers (needs `FileReaderSync`) — `mount()` is documented browser-only and the Node test for it is skipped.
- mt core requires `crossOriginIsolated` in browsers (COOP/COEP headers). The Playwright server must send them.

---

## File structure

```
packages/ffmpeg/
├─ package.json            # @ffweb/ffmpeg, MIT, ESM, exports + types
├─ tsconfig.json
├─ tsup.config.ts          # entries: src/index.ts, src/worker.ts
├─ src/
│  ├─ index.ts             # public exports only
│  ├─ types.ts             # public types + protocol message types
│  ├─ errors.ts            # FFmpegError hierarchy
│  ├─ progress.ts          # pure parsers: progress lines, Duration: lines
│  ├─ worker.ts            # worker entry (browser + node), owns the core
│  └─ ffmpeg.ts            # FFmpeg class: spawn, RPC client, events
└─ tests/                  # vitest unit tests (no wasm)
   ├─ progress.test.ts
   └─ ffmpeg.test.ts       # protocol against a mock worker
tests/node/lib.test.mjs    # node:test integration via built lib + real lgpl core
tests/browser/
├─ server.mjs              # static server with COOP/COEP
├─ fixture/index.html      # loads built lib, exposes window.ffwebTest helpers
└─ core.spec.ts            # playwright spec (runs in 3 browsers)
playwright.config.ts
vitest.config.ts           # root, points at packages/ffmpeg/tests
```

Responsibilities: `progress.ts` and `errors.ts` are pure and unit-testable; `worker.ts` is the only file that touches the core; `ffmpeg.ts` is the only file that touches Worker APIs; `types.ts` is the single protocol definition both sides import.

---

### Task 1: Package scaffolding and toolchain

**Files:**
- Create: `packages/ffmpeg/package.json`, `packages/ffmpeg/tsconfig.json`, `packages/ffmpeg/tsup.config.ts`, `vitest.config.ts`
- Modify: root `package.json` (devDeps + scripts)

- [ ] **Step 1: Write `packages/ffmpeg/package.json`**

```json
{
  "name": "@ffweb/ffmpeg",
  "version": "0.1.0",
  "description": "Fast FFmpeg 8.x for browsers and Node — worker-based wrapper for @ffweb/core",
  "type": "module",
  "license": "MIT",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./worker": "./dist/worker.js"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit"
  },
  "engines": { "node": ">=22" }
}
```

- [ ] **Step 2: Write `packages/ffmpeg/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "WebWorker"],
    "strict": true,
    "declaration": true,
    "skipLibCheck": true,
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `packages/ffmpeg/tsup.config.ts`**

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', worker: 'src/worker.ts' },
  format: ['esm'],
  dts: { entry: { index: 'src/index.ts' } },
  sourcemap: true,
  clean: true,
  platform: 'neutral',
  target: 'es2022',
  external: ['node:worker_threads', 'node:url'],
});
```

- [ ] **Step 4: Root `package.json` additions** (Edit, keep existing fields)

devDependencies: `typescript ^5.5`, `tsup ^8`, `vitest ^2`, `@playwright/test ^1.48`, `@types/node ^22`.
scripts: `"build:lib": "npm run build -w @ffweb/ffmpeg"`, `"test:unit": "vitest run"`, `"test:node": "node --test tests/node/"`, `"test:browser": "playwright test"`.

- [ ] **Step 5: Write root `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['packages/ffmpeg/tests/**/*.test.ts'], environment: 'node' },
});
```

- [ ] **Step 6: Install and verify**

Run: `npm install` then `npx tsc --version && npx vitest --version && npx tsup --version`
Expected: versions print; package-lock.json created.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "chore(lib): scaffold @ffweb/ffmpeg package and test toolchain"
```

---

### Task 2: Types, errors, protocol definitions

**Files:**
- Create: `packages/ffmpeg/src/types.ts`, `packages/ffmpeg/src/errors.ts`

- [ ] **Step 1: Write `packages/ffmpeg/src/types.ts`**

```ts
/** Public options */
export interface CreateOptions {
  /** URL of ffmpeg-core.js (ESM). Defaults to resolving '@ffweb/core'. */
  coreURL?: string | URL;
  /** URL of ffmpeg-core.wasm. Defaults to sibling of coreURL. */
  wasmURL?: string | URL;
  /** Which default core package to resolve when no coreURL given. */
  variant?: 'lgpl' | 'gpl';
}

export interface LogEvent { type: 'stdout' | 'stderr'; message: string }

export interface ProgressEvent {
  /** 0..1 when input duration is known, otherwise undefined */
  ratio?: number;
  /** out_time in microseconds */
  timeUs: number;
  fps?: number;
  speed?: number;
  done: boolean;
}

export interface ExecOptions {
  onLog?: (e: LogEvent) => void;
  onProgress?: (e: ProgressEvent) => void;
  /** Milliseconds; on expiry the worker is terminated and the call rejects. */
  timeout?: number;
}

export type MountSource = { files?: File[]; blobs?: { name: string; data: Blob }[] };

/** RPC protocol (internal) */
export type Req =
  | { id: number; op: 'load'; coreURL: string; wasmURL?: string }
  | { id: number; op: 'exec' | 'ffprobe'; args: string[]; progress: boolean }
  | { id: number; op: 'writeFile'; path: string; data: Uint8Array | string }
  | { id: number; op: 'readFile'; path: string; encoding?: 'utf8' | 'binary' }
  | { id: number; op: 'deleteFile' | 'createDir' | 'deleteDir' | 'listDir'; path: string }
  | { id: number; op: 'rename'; from: string; to: string }
  | { id: number; op: 'mount'; mountPoint: string; source: MountSource }
  | { id: number; op: 'unmount'; mountPoint: string };

export type Res =
  | { id: number; ok: true; data?: unknown }
  | { id: number; ok: false; error: { name: string; message: string; logTail: string[] }; aborted?: boolean }
  | { id: -1; event: 'log'; payload: LogEvent }
  | { id: -1; event: 'progress'; payload: { line: string } };

export interface DirEntry { name: string; isDir: boolean }
```

- [ ] **Step 2: Write `packages/ffmpeg/src/errors.ts`**

```ts
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
```

- [ ] **Step 3: Typecheck and commit**

Run: `npx tsc --noEmit -p packages/ffmpeg` — expect clean (worker/ffmpeg not yet present is fine since include only finds existing files).

```bash
git add packages/ffmpeg/src && git commit -m "feat(lib): protocol types and error hierarchy"
```

---

### Task 3: Progress parsing (pure, TDD)

**Files:**
- Create: `packages/ffmpeg/tests/progress.test.ts`, `packages/ffmpeg/src/progress.ts`

- [ ] **Step 1: Write the failing tests** (`packages/ffmpeg/tests/progress.test.ts`)

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/ffmpeg/tests/progress.test.ts`
Expected: FAIL — cannot resolve '../src/progress'.

- [ ] **Step 3: Write `packages/ffmpeg/src/progress.ts`**

```ts
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
```

Note: malformed `out_time_us` yields `undefined` from `toNum` → `?? 0` per test.

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/ffmpeg/tests/progress.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ffmpeg && git commit -m "feat(lib): progress and duration parsers (TDD)"
```

---

### Task 4: Worker entry

**Files:**
- Create: `packages/ffmpeg/src/worker.ts`

- [ ] **Step 1: Write `packages/ffmpeg/src/worker.ts`**

```ts
/// <reference lib="webworker" />
import type { Req, Res, DirEntry, MountSource } from './types';

interface CoreModule {
  exec: (...args: string[]) => number;
  ffprobe: (...args: string[]) => number;
  logger: (l: { type: 'stdout' | 'stderr'; message: string }) => void;
  aborted?: boolean;
  FS: any;
}

type PostFn = (msg: Res, transfer?: Transferable[]) => void;

const isNode = typeof process === 'object' && !!process.versions?.node && typeof importScripts !== 'function';

let core: CoreModule | null = null;
const logRing: string[] = [];
const LOG_RING_MAX = 100;

function pushLog(post: PostFn, type: 'stdout' | 'stderr', message: string, progress: boolean) {
  logRing.push(message);
  if (logRing.length > LOG_RING_MAX) logRing.shift();
  // -progress output goes to stdout as key=value lines; route those separately.
  if (progress && type === 'stdout' && /^[a-z_]+=.*/.test(message)) {
    post({ id: -1, event: 'progress', payload: { line: message } });
  } else {
    post({ id: -1, event: 'log', payload: { type, message } });
  }
}

async function handle(req: Req, post: PostFn): Promise<void> {
  try {
    switch (req.op) {
      case 'load': {
        const createCore = (await import(/* @vite-ignore */ req.coreURL)).default;
        core = (await createCore({
          mainScriptUrlOrBlob: req.coreURL,
          locateFile: (path: string, prefix: string) =>
            path.endsWith('.wasm') && req.wasmURL ? req.wasmURL : prefix + path,
        })) as CoreModule;
        post({ id: req.id, ok: true });
        return;
      }
      case 'exec':
      case 'ffprobe': {
        const c = mustCore();
        let inProgress = req.op === 'exec' && req.progress;
        c.logger = (l) => pushLog(post, l.type, l.message, inProgress);
        const ret = c[req.op](...req.args);
        if (c.aborted) {
          post({
            id: req.id, ok: false, aborted: true,
            error: { name: 'FFmpegCrashError', message: 'wasm runtime aborted', logTail: [...logRing] },
          });
          return;
        }
        post({ id: req.id, ok: true, data: ret });
        return;
      }
      case 'writeFile': {
        const c = mustCore();
        c.FS.writeFile(req.path, req.data);
        post({ id: req.id, ok: true });
        return;
      }
      case 'readFile': {
        const c = mustCore();
        const data = c.FS.readFile(req.path, { encoding: req.encoding === 'utf8' ? 'utf8' : 'binary' });
        if (typeof data === 'string') post({ id: req.id, ok: true, data });
        else post({ id: req.id, ok: true, data }, [data.buffer]);
        return;
      }
      case 'deleteFile': mustCore().FS.unlink(req.path); post({ id: req.id, ok: true }); return;
      case 'rename': mustCore().FS.rename(req.from, req.to); post({ id: req.id, ok: true }); return;
      case 'createDir': mustCore().FS.mkdir(req.path); post({ id: req.id, ok: true }); return;
      case 'deleteDir': mustCore().FS.rmdir(req.path); post({ id: req.id, ok: true }); return;
      case 'listDir': {
        const c = mustCore();
        const names: string[] = c.FS.readdir(req.path);
        const entries: DirEntry[] = names.map((name) => ({
          name,
          isDir: c.FS.isDir(c.FS.stat(`${req.path}/${name}`.replace(/\/+/g, '/')).mode),
        }));
        post({ id: req.id, ok: true, data: entries });
        return;
      }
      case 'mount': {
        const c = mustCore();
        const wfs = c.FS.filesystems.WORKERFS;
        if (!wfs) throw new Error('WORKERFS unavailable in this environment');
        try { c.FS.mkdir(req.mountPoint); } catch { /* exists */ }
        c.FS.mount(wfs, req.source as MountSource, req.mountPoint);
        post({ id: req.id, ok: true });
        return;
      }
      case 'unmount': {
        const c = mustCore();
        c.FS.unmount(req.mountPoint);
        c.FS.rmdir(req.mountPoint);
        post({ id: req.id, ok: true });
        return;
      }
    }
  } catch (err) {
    const e = err as Error;
    post({
      id: req.id, ok: false,
      error: { name: e?.name ?? 'Error', message: e?.message ?? String(err), logTail: [...logRing] },
    });
  }
}

function mustCore(): CoreModule {
  if (!core) throw new Error('core not loaded — call load first');
  return core;
}

// --- environment wiring -----------------------------------------------------
if (isNode) {
  // Node: worker_threads
  const { parentPort } = await import('node:worker_threads');
  if (!parentPort) throw new Error('worker.ts must run inside a worker');
  const post: PostFn = (msg, transfer) =>
    parentPort.postMessage(msg, (transfer as any[]) ?? []);
  parentPort.on('message', (req: Req) => void handle(req, post));
} else {
  // Browser / web worker
  const post: PostFn = (msg, transfer) =>
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, { transfer: transfer ?? [] });
  self.onmessage = (ev: MessageEvent<Req>) => void handle(ev.data, post);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p packages/ffmpeg`
Expected: clean. (`importScripts` check needs DOM/WebWorker libs — present in tsconfig.)

- [ ] **Step 3: Commit**

```bash
git add packages/ffmpeg/src/worker.ts && git commit -m "feat(lib): worker entry — core loading, RPC handlers, log/progress routing"
```

---

### Task 5: FFmpeg client class

**Files:**
- Create: `packages/ffmpeg/src/ffmpeg.ts`, `packages/ffmpeg/src/index.ts`

- [ ] **Step 1: Write `packages/ffmpeg/src/ffmpeg.ts`**

```ts
import type {
  CreateOptions, ExecOptions, LogEvent, MountSource, ProgressEvent, Req, Res, DirEntry,
} from './types';
import { FFmpegCrashError, FFmpegError, FFmpegTimeoutError } from './errors';
import { ProgressParser, parseDurationLine } from './progress';

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
    const coreURL = String(
      this.opts.coreURL ??
        (await resolveDefaultCore(this.opts.variant)),
    );
    const wasmURL = this.opts.wasmURL ? String(this.opts.wasmURL) : undefined;
    this.worker = await spawnWorker();
    this.worker.onMessage((msg) => this.dispatch(msg));
    this.worker.onError((err) => this.failAll(new FFmpegCrashError(`worker error: ${err.message}`, [...this.logRing])));
    await this.call({ op: 'load', coreURL, wasmURL });
  }

  async exec(args: string[], options: ExecOptions = {}): Promise<number> {
    return this.run('exec', args, options);
  }

  async ffprobe(args: string[], options: ExecOptions = {}): Promise<number> {
    return this.run('ffprobe', args, options);
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const transfer = typeof data === 'string' ? [] : [data.buffer as ArrayBuffer];
    await this.call({ op: 'writeFile', path, data }, transfer);
  }

  async readFile(path: string): Promise<Uint8Array>;
  async readFile(path: string, encoding: 'utf8'): Promise<string>;
  async readFile(path: string, encoding?: 'utf8'): Promise<Uint8Array | string> {
    return (await this.call({ op: 'readFile', path, encoding })) as Uint8Array | string;
  }

  async deleteFile(path: string): Promise<void> { await this.call({ op: 'deleteFile', path }); }
  async rename(from: string, to: string): Promise<void> { await this.call({ op: 'rename', from, to }); }
  async createDir(path: string): Promise<void> { await this.call({ op: 'createDir', path }); }
  async deleteDir(path: string): Promise<void> { await this.call({ op: 'deleteDir', path }); }
  async listDir(path: string): Promise<DirEntry[]> {
    return (await this.call({ op: 'listDir', path })) as DirEntry[];
  }

  /** Browser-only (WORKERFS): mount Files/Blobs read-only without copying. */
  async mount(mountPoint: string, source: MountSource): Promise<void> {
    await this.call({ op: 'mount', mountPoint, source });
  }
  async unmount(mountPoint: string): Promise<void> { await this.call({ op: 'unmount', mountPoint }); }

  terminate(): void {
    this.failAll(new FFmpegError('terminated'));
    this.worker?.terminate();
    this.worker = null;
  }

  // --- internals -------------------------------------------------------------

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

  private call(req: Omit<Req, 'id'>, transfer: Transferable[] = [], timeout?: number): Promise<unknown> {
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
      worker.postMessage({ ...req, id } as Req, transfer);
    });
  }

  private dispatch(msg: Res): void {
    if (msg.id === -1) {
      if (msg.event === 'log') {
        this.logRing.push(msg.payload.message);
        if (this.logRing.length > 100) this.logRing.shift();
        if (this.activeProgress) {
          const d = parseDurationLine(msg.payload.message);
          if (d != null) this.activeProgress.setDuration(d);
        }
        this.activeLog?.(msg.payload);
        for (const cb of this.globalLog) cb(msg.payload);
      } else if (msg.event === 'progress') {
        this.activeProgress?.push(msg.payload.line);
      }
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (p.timer) clearTimeout(p.timer);
    if (msg.ok) {
      p.resolve(msg.data);
    } else if (msg.aborted) {
      // Runtime is dead; drop the worker so the next call respawns it.
      this.worker?.terminate();
      this.worker = null;
      p.reject(new FFmpegCrashError(msg.error.message, msg.error.logTail));
    } else {
      p.reject(Object.assign(new FFmpegError(msg.error.message, msg.error.logTail), { name: msg.error.name }));
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
```

- [ ] **Step 2: Write `packages/ffmpeg/src/index.ts`**

```ts
export { FFmpeg } from './ffmpeg';
export { FFmpegError, FFmpegCrashError, FFmpegTimeoutError } from './errors';
export type {
  CreateOptions, ExecOptions, LogEvent, ProgressEvent, MountSource, DirEntry,
} from './types';
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit -p packages/ffmpeg && npm run build:lib`
Expected: clean; `packages/ffmpeg/dist/` contains index.js, worker.js, index.d.ts, sourcemaps.

- [ ] **Step 4: Commit**

```bash
git add packages/ffmpeg && git commit -m "feat(lib): FFmpeg client class with worker RPC, progress, crash recovery"
```

---

### Task 6: Unit tests for the client (mock worker)

**Files:**
- Create: `packages/ffmpeg/tests/ffmpeg.test.ts`

The FFmpeg class reaches the worker only through `spawnWorker`. To test without wasm, vitest mocks are insufficient (dynamic import of node:worker_threads). Instead, test `dispatch`/`call` behavior through the public API with a stub: export-for-test pattern is NOT used; instead simulate by constructing FFmpeg via `FFmpeg.create` against a real Node worker is integration (Task 7). Here, unit-test the pure seams: protocol envelope round-trip typing and ProgressParser wiring through `parseDurationLine` (already covered) plus error classes.

- [ ] **Step 1: Write `packages/ffmpeg/tests/ffmpeg.test.ts`**

```ts
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
```

(Behavioral coverage of the RPC happens in Task 7 against the real worker — mocking the worker boundary would test the mock.)

- [ ] **Step 2: Run, commit**

Run: `npx vitest run` — expect all unit tests green (progress + errors).

```bash
git add packages/ffmpeg/tests && git commit -m "test(lib): unit tests for errors; progress covered in task 3"
```

---

### Task 7: Node integration tests (real core through the lib)

**Files:**
- Create: `tests/node/lib.test.mjs`

- [ ] **Step 1: Write `tests/node/lib.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FFmpeg } from '../../packages/ffmpeg/dist/index.js';

test('create → exec → readFile round trip (lgpl default resolution)', async () => {
  const ff = await FFmpeg.create();
  try {
    const ret = await ff.exec(['-f', 'lavfi', '-i', 'sine=duration=1',
      '-c:a', 'libmp3lame', '-f', 'mp3', '/out.mp3']);
    assert.equal(ret, 0);
    const data = await ff.readFile('/out.mp3');
    assert.ok(data.length > 500);
  } finally { ff.terminate(); }
});

test('writeFile → ffprobe reads it; listDir; deleteFile', async () => {
  const ff = await FFmpeg.create();
  try {
    assert.equal(await ff.exec(['-f', 'lavfi', '-i', 'sine=duration=1',
      '-c:a', 'libopus', '-f', 'ogg', '/in.ogg']), 0);
    const ogg = await ff.readFile('/in.ogg');
    await ff.writeFile('/copy.ogg', ogg);
    const logs = [];
    const ret = await ff.ffprobe(['-v', 'error', '-show_streams', '-of', 'json', '/copy.ogg'],
      { onLog: (l) => logs.push(l.message) });
    assert.equal(ret, 0);
    assert.match(logs.join('\n'), /"codec_name"\s*:\s*"opus"/);
    const entries = await ff.listDir('/');
    assert.ok(entries.some((e) => e.name === 'copy.ogg' && !e.isDir));
    await ff.deleteFile('/copy.ogg');
    const after = await ff.listDir('/');
    assert.ok(!after.some((e) => e.name === 'copy.ogg'));
  } finally { ff.terminate(); }
});

test('progress events fire with ratio', async () => {
  const ff = await FFmpeg.create();
  try {
    // Use a real file input so stderr carries a Duration line.
    assert.equal(await ff.exec(['-f', 'lavfi', '-i', 'sine=duration=2',
      '-c:a', 'pcm_s16le', '-f', 'wav', '/in.wav']), 0);
    const events = [];
    const ret = await ff.exec(['-i', '/in.wav', '-c:a', 'libmp3lame', '-f', 'mp3', '/out.mp3'],
      { onProgress: (e) => events.push(e) });
    assert.equal(ret, 0);
    assert.ok(events.length >= 1, 'expected at least one progress event');
    const last = events[events.length - 1];
    assert.equal(last.done, true);
    assert.ok(last.ratio === undefined || last.ratio > 0.9, `final ratio: ${last.ratio}`);
  } finally { ff.terminate(); }
});

test('nonzero exit code is returned, not thrown', async () => {
  const ff = await FFmpeg.create();
  try {
    const ret = await ff.exec(['-i', '/nonexistent.mp4', '-f', 'null', '-']);
    assert.notEqual(ret, 0);
  } finally { ff.terminate(); }
});

test('gpl variant resolves and encodes x264', async () => {
  const ff = await FFmpeg.create({ variant: 'gpl' });
  try {
    assert.equal(await ff.exec(['-f', 'lavfi', '-i', 'testsrc2=duration=0.5:size=128x72:rate=5',
      '-c:v', 'libx264', '-f', 'mp4', '/v.mp4']), 0);
    assert.ok((await ff.readFile('/v.mp4')).length > 1000);
  } finally { ff.terminate(); }
});
```

- [ ] **Step 2: Run**

Run: `npm run build:lib && npm run test:node`
Expected: 5/5 pass. Known risks to debug (fix the LIB, not the tests): worker.js URL resolution from dist (tsup output must keep `./worker.js` sibling — verify dist layout); Node worker_threads transfer-list arg shape; default core resolution via `require.resolve('@ffweb/core')` inside the npm workspace (workspaces symlink into root node_modules — should resolve).

- [ ] **Step 3: Commit**

```bash
git add tests/node && git commit -m "test(lib): node integration tests through the built library"
```

---

### Task 8: Browser test server + fixture

**Files:**
- Create: `tests/browser/server.mjs`, `tests/browser/fixture/index.html`, `playwright.config.ts`

- [ ] **Step 1: Write `tests/browser/server.mjs`** (COOP/COEP static server)

```js
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 8788);
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.json': 'application/json', '.map': 'application/json',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = normalize(url.pathname).replace(/^\/+/, '');
    if (path === '' || path === '/') path = 'tests/browser/fixture/index.html';
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT)) throw new Error('traversal');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => console.log(`fixture server on http://localhost:${PORT}`));
```

- [ ] **Step 2: Write `tests/browser/fixture/index.html`**

```html
<!doctype html>
<meta charset="utf-8" />
<title>ffweb fixture</title>
<script type="module">
  import { FFmpeg } from '/packages/ffmpeg/dist/index.js';

  window.ffwebTest = {
    isolated: () => crossOriginIsolated,

    async transcode() {
      const ff = await FFmpeg.create({ coreURL: new URL('/packages/core/dist/ffmpeg-core.js', location.href) });
      try {
        const ret = await ff.exec(['-f', 'lavfi', '-i', 'testsrc2=duration=0.5:size=128x72:rate=5',
          '-c:v', 'libvpx', '-f', 'webm', '/out.webm']);
        const data = ret === 0 ? await ff.readFile('/out.webm') : new Uint8Array();
        return { ret, size: data.length };
      } finally { ff.terminate(); }
    },

    async mountFile() {
      const blob = new Blob([new Uint8Array(await (await fetch('/tests/browser/fixture/tiny.wav')).arrayBuffer())]);
      const ff = await FFmpeg.create({ coreURL: new URL('/packages/core/dist/ffmpeg-core.js', location.href) });
      try {
        await ff.mount('/work', { blobs: [{ name: 'in.wav', data: blob }] });
        const ret = await ff.exec(['-i', '/work/in.wav', '-c:a', 'libmp3lame', '-f', 'mp3', '/out.mp3']);
        const size = ret === 0 ? (await ff.readFile('/out.mp3')).length : 0;
        await ff.unmount('/work');
        return { ret, size };
      } finally { ff.terminate(); }
    },

    async progress() {
      const ff = await FFmpeg.create({ coreURL: new URL('/packages/core/dist/ffmpeg-core.js', location.href) });
      try {
        await ff.exec(['-f', 'lavfi', '-i', 'sine=duration=2', '-c:a', 'pcm_s16le', '-f', 'wav', '/in.wav']);
        const events = [];
        const ret = await ff.exec(['-i', '/in.wav', '-c:a', 'libmp3lame', '-f', 'mp3', '/o.mp3'],
          { onProgress: (e) => events.push(e) });
        return { ret, count: events.length, lastDone: events.at(-1)?.done ?? false };
      } finally { ff.terminate(); }
    },
  };
  window.ffwebReady = true;
</script>
<body>ffweb test fixture</body>
```

- [ ] **Step 3: Generate the tiny.wav fixture** (committed binary, ~100KB ceiling)

Run: `node -e '
import("./packages/ffmpeg/dist/index.js").then(async ({ FFmpeg }) => {
  const ff = await FFmpeg.create();
  await ff.exec(["-f","lavfi","-i","sine=duration=1","-c:a","pcm_s16le","-f","wav","/t.wav"]);
  const d = await ff.readFile("/t.wav");
  (await import("node:fs")).writeFileSync("tests/browser/fixture/tiny.wav", d);
  ff.terminate();
});'`
Expected: `tests/browser/fixture/tiny.wav` ~88KB.

- [ ] **Step 4: Write `playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/browser',
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  webServer: {
    command: 'node tests/browser/server.mjs',
    url: 'http://localhost:8788',
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL: 'http://localhost:8788' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
```

- [ ] **Step 5: Commit**

```bash
git add tests/browser playwright.config.ts && git commit -m "test(browser): COOP/COEP fixture server, test page, playwright config"
```

---

### Task 9: Playwright specs across three browsers

**Files:**
- Create: `tests/browser/core.spec.ts`

- [ ] **Step 1: Write `tests/browser/core.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).ffwebReady === true);
});

test('page is cross-origin isolated (threads available)', async ({ page }) => {
  expect(await page.evaluate(() => (window as any).ffwebTest.isolated())).toBe(true);
});

test('transcodes VP8/webm in-browser', async ({ page }) => {
  const r = await page.evaluate(() => (window as any).ffwebTest.transcode());
  expect(r.ret).toBe(0);
  expect(r.size).toBeGreaterThan(1000);
});

test('WORKERFS mount → mp3 encode', async ({ page }) => {
  const r = await page.evaluate(() => (window as any).ffwebTest.mountFile());
  expect(r.ret).toBe(0);
  expect(r.size).toBeGreaterThan(500);
});

test('progress events stream', async ({ page }) => {
  const r = await page.evaluate(() => (window as any).ffwebTest.progress());
  expect(r.ret).toBe(0);
  expect(r.count).toBeGreaterThanOrEqual(1);
  expect(r.lastDone).toBe(true);
});
```

- [ ] **Step 2: Install browsers and run**

Run: `npx playwright install chromium firefox webkit` then `npm run test:browser`
Expected: 12 passing (4 tests × 3 browsers). Debugging guidance: failures here are usually (a) module-worker support — all three support module workers now, but if WebKit balks at `new Worker(url, {type:'module'})` inside the lib check the served MIME types; (b) the 27MB wasm fetch needs the server's no-store + correct `application/wasm` MIME (already in server.mjs); (c) pthread spawn failures appear as hangs — check `crossOriginIsolated` test first; it failing means header problem, not lib bug. Fix the LIB or SERVER, never weaken assertions. If a single browser fails irreparably after real effort, report DONE_WITH_CONCERNS with details — do not skip the project silently.

- [ ] **Step 3: Commit**

```bash
git add tests/browser && git commit -m "test(browser): playwright specs for isolation, transcode, workerfs, progress"
```

---

### Task 10: CI job for the library

**Files:**
- Modify: `.github/workflows/build.yml`

- [ ] **Step 1: Add a `lib` job** after the existing `cores` job:

```yaml
  lib:
    runs-on: ubuntu-latest
    needs: cores
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - uses: actions/download-artifact@v4
        with:
          name: cores
          path: packages/
      - run: npm ci
      - run: npm run build:lib
      - run: npm run test:unit
      - run: npm run test:node
      - run: npx playwright install --with-deps chromium firefox webkit
      - run: npm run test:browser
```

Note: `upload-artifact` with path `packages/*/dist/` preserves the `core/dist`/`core-gpl/dist` structure under the artifact root; verify after download the layout is `packages/core/dist/ffmpeg-core.js` (adjust `path:` on download if the artifact flattens — test locally with `gh run download` if unsure, or add an `ls -R packages` debug step on first CI run).

- [ ] **Step 2: Validate YAML, commit**

Run: `npx --yes js-yaml .github/workflows/build.yml > /dev/null && echo ok`

```bash
git add .github && git commit -m "ci: library build + unit/node/browser test job"
```

---

### Task 11: Build follow-ups from the Phase 1A final review

**Files:**
- Modify: `build/versions.sh` (zimg commit pin), `build/fetch.sh` (pin usage), `packages/core/package.json` + `packages/core-gpl/package.json` (repository field), `tests/smoke/lgpl.test.mjs` (libass shaping test), `.github/workflows/build.yml` (sources.json drift guard)

- [ ] **Step 1: Pin zimg.** Get current commit: `cd third_party/zimg && git rev-parse HEAD`. In `build/versions.sh` add `ZIMG_COMMIT=<sha>` next to ZIMG_BRANCH; in `build/fetch.sh` after the clone block's `mv zimg.tmp zimg` add `git -C zimg checkout --quiet "$ZIMG_COMMIT" 2>/dev/null || true` and change the clone to drop `--depth 1` (needed to checkout a pinned sha): clone with `--branch "$ZIMG_BRANCH"` then checkout the pin.

- [ ] **Step 2: repository field.** Add to both core package.jsons: `"repository": { "type": "git", "url": "https://github.com/yaakov123/ffmpeg-webassembly" }`.

- [ ] **Step 3: libass shaping smoke test.** Append to `tests/smoke/lgpl.test.mjs`:

```js
test('libass renders subtitles (harfbuzz shaping path)', async () => {
  const { core } = await loadCore('lgpl');
  core.FS.writeFile('/sub.srt', '1\n00:00:00,000 --> 00:00:01,000\nHello ffweb\n');
  // No fonts are bundled; rendering falls back but must not crash, and the
  // subtitles filter must initialize libass + harfbuzz.
  const ret = core.exec(
    '-f', 'lavfi', '-i', 'testsrc2=duration=0.5:size=160x90:rate=5',
    '-vf', 'subtitles=/sub.srt:fontsdir=/',
    '-c:v', 'libvpx', '-f', 'webm', '/s.webm');
  assert.equal(ret, 0);
  assert.ok(core.FS.readFile('/s.webm').length > 500);
});
```

Run `npm run test:smoke` — if libass aborts on missing fonts, embed a font: download is not allowed at test time, so instead commit a tiny open font (e.g. copy a <100KB .ttf from the freetype tree: `find third_party/freetype -name '*.ttf' | head`) into `tests/fixtures/` and `writeFile` it to `/fonts/test.ttf`, using `fontsdir=/fonts`. Report which path was needed.

- [ ] **Step 4: sources.json drift guard.** In `.github/workflows/build.yml` `cores` job, after `make cores` add:
```yaml
      - run: bash build/gen-sources-json.sh && git diff --exit-code packages/*/sources.json
```

- [ ] **Step 5: Run smoke tests, commit**

Run: `npm run test:smoke` (8/8 now) — note the new test runs against existing cores; no rebuild needed.

```bash
git add -A && git commit -m "chore: zimg pin, repository fields, libass smoke test, sources drift guard"
```

---

### Task 12: README usage documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace README.md** with:

```markdown
# ffweb (working name)

A fast, modern WebAssembly port of FFmpeg 8.x for browsers and Node.
Multithreaded + SIMD cores, worker-based API, LGPL and GPL variants.

Design: `docs/superpowers/specs/2026-06-11-ffmpeg-wasm-port-design.md`

## Usage

    import { FFmpeg } from '@ffweb/ffmpeg';

    const ff = await FFmpeg.create({
      // In browsers, point at a self-hosted or CDN copy of the core:
      coreURL: '/vendor/ffmpeg-core.js',          // from @ffweb/core (LGPL)
      // variant: 'gpl',                          // @ffweb/core-gpl: + x264/x265
    });

    await ff.writeFile('/in.webm', new Uint8Array(await file.arrayBuffer()));
    const ret = await ff.exec(['-i', '/in.webm', '-c:v', 'libsvtav1', '/out.mp4'], {
      onProgress: (p) => console.log(`${Math.round((p.ratio ?? 0) * 100)}%`),
      onLog: (l) => console.debug(l.message),
    });
    const out = await ff.readFile('/out.mp4');
    ff.terminate();

Zero-copy input from a `File`/`Blob` (browser):

    await ff.mount('/work', { files: [file] });
    await ff.exec(['-i', `/work/${file.name}`, '/out.mp3']);

### Browser requirements

The multithreaded core needs cross-origin isolation. Serve your page with:

    Cross-Origin-Opener-Policy: same-origin
    Cross-Origin-Embedder-Policy: require-corp

(A single-thread fallback core that lifts this requirement is Phase 2.)

Node 22+ works out of the box (`FFmpeg.create()` resolves the installed
`@ffweb/core` automatically).

## Performance notes

Pass `-threads 4` (or ≤ 8) for encoders on many-core machines; the worker
pool is capped. WebCodecs hardware acceleration lands in Phase 3.

## Building the cores

Requires Docker and Node >= 22.

    make image   # build the toolchain image (once)
    make fetch   # download pinned source tarballs into third_party/
    make libs    # build all codec libraries
    make cores   # build LGPL + GPL FFmpeg cores into packages/*/dist
    npm run test:smoke

## Library development

    npm install && npm run build:lib
    npm run test:unit && npm run test:node
    npx playwright install && npm run test:browser

## Packages

| Package | License | Contents |
|---|---|---|
| `@ffweb/ffmpeg` | MIT | TypeScript API (this is what you import) |
| `@ffweb/core` | LGPL-2.1 | wasm core: all native codecs + VP8/9, AV1, MP3, Opus, Vorbis encoders |
| `@ffweb/core-gpl` | GPL-2.0 | everything above + x264, x265 |
```

- [ ] **Step 2: Commit**

```bash
git add README.md && git commit -m "docs: usage, browser requirements, package matrix"
```

---

## Self-review notes

- **Spec coverage:** worker model + main/worker/Node callability (spec §3.4) → Tasks 4-5; `exec`/`ffprobe`/FS surface + ffmpeg.wasm-compatible names (§3.3, §5) → Task 5; progress/log events (§5) → Tasks 3-5; WORKERFS zero-copy input (§3.3) → Tasks 4-5, 9; crash containment + typed errors with log tail (§8) → Tasks 2, 4-5; Vitest + Playwright matrix (§7) → Tasks 6-9; CI (§9 phase 1) → Task 10. Out of scope per spec phases: ST cores, OPFS/streams, WebCodecs, convenience APIs, benchmarks, CDN/npm publishing.
- **Type consistency:** protocol types defined once in types.ts and imported by both worker.ts and ffmpeg.ts; `DirEntry`, `MountSource`, error names match across tasks.
- **No placeholders:** all code complete; the two genuinely environment-dependent points (artifact download layout in CI, libass font fallback) carry explicit verification instructions instead of hand-waving.
```
