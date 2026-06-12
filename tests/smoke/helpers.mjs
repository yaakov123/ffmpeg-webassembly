import { fileURLToPath } from 'node:url';

export async function loadCore(variant) {
  const pkg = variant === 'gpl' ? 'core-gpl' : 'core';
  const url = new URL(`../../packages/${pkg}/dist/ffmpeg-core.js`, import.meta.url);
  const createFFmpegCore = (await import(fileURLToPath(url))).default;
  const core = await createFFmpegCore();
  const logs = [];
  core.logger = (l) => logs.push(l.message);
  return { core, logs };
}
