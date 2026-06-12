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
        // Emscripten calls URL.createObjectURL(mainScriptUrlOrBlob) when it is
        // not a string — URL.createObjectURL in Node requires a Blob, not a URL
        // object.  Instead pass an absolute path string (worker_threads.Worker
        // accepts those) derived via fileURLToPath so the pthread sub-workers
        // resolve correctly.
        let mainScriptUrlOrBlob: string = req.coreURL;
        if (isNode && req.coreURL.startsWith('file://')) {
          const { fileURLToPath } = await import('node:url');
          mainScriptUrlOrBlob = fileURLToPath(req.coreURL);
        }
        core = (await createCore({
          mainScriptUrlOrBlob,
          locateFile: (path: string, prefix: string) =>
            path.endsWith('.wasm') && req.wasmURL ? req.wasmURL : prefix + path,
        })) as CoreModule;
        post({ id: req.id, ok: true });
        return;
      }
      case 'exec':
      case 'ffprobe': {
        const c = mustCore();
        const inProgress = req.op === 'exec' && req.progress;
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
