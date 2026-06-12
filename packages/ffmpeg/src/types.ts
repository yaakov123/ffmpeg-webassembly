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
