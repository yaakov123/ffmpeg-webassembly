import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './helpers.mjs';

test('reports FFmpeg 8.1 version', async () => {
  const { core, logs } = await loadCore('lgpl');
  const ret = core.exec('-version');
  assert.equal(ret, 0);
  assert.match(logs.join('\n'), /ffmpeg version n?8\.1/);
});

test('transcodes lavfi test source to VP9/webm', async () => {
  const { core } = await loadCore('lgpl');
  const ret = core.exec(
    '-f', 'lavfi', '-i', 'testsrc2=duration=1:size=128x72:rate=5',
    '-c:v', 'libvpx-vp9', '-f', 'webm', '/out.webm',
  );
  assert.equal(ret, 0);
  const out = core.FS.readFile('/out.webm');
  assert.ok(out.length > 1000, `output too small: ${out.length}`);
});

test('is re-entrant: two execs on one instance', async () => {
  const { core } = await loadCore('lgpl');
  assert.equal(core.exec('-f', 'lavfi', '-i', 'sine=duration=1',
    '-c:a', 'libmp3lame', '-f', 'mp3', '/a.mp3'), 0);
  assert.equal(core.exec('-f', 'lavfi', '-i', 'sine=duration=1',
    '-c:a', 'libopus', '-f', 'ogg', '/b.ogg'), 0);
  assert.ok(core.FS.readFile('/a.mp3').length > 500);
  assert.ok(core.FS.readFile('/b.ogg').length > 500);
});

test('ffprobe reads back generated file', async () => {
  const { core, logs } = await loadCore('lgpl');
  assert.equal(core.exec('-f', 'lavfi', '-i', 'testsrc2=duration=1:size=128x72:rate=5',
    '-c:v', 'libvpx', '-f', 'webm', '/p.webm'), 0);
  const ret = core.ffprobe('-v', 'error', '-show_streams', '-of', 'json', '/p.webm');
  assert.equal(ret, 0);
  assert.match(logs.join('\n'), /"codec_name"\s*:\s*"vp8"/);
});

test('zscale (zimg) resizes and dithers 10-bit to 8-bit', async () => {
  const { core } = await loadCore('lgpl');
  const ret = core.exec(
    '-f', 'lavfi', '-i', 'testsrc2=duration=0.5:size=160x90:rate=5',
    '-pix_fmt', 'yuv420p10le',
    '-vf', 'zscale=w=128:h=72,format=yuv420p',
    '-c:v', 'libvpx', '-f', 'webm', '/z.webm',
  );
  assert.equal(ret, 0);
  assert.ok(core.FS.readFile('/z.webm').length > 500);
});

test('AV1 encode via SVT-AV1 and decode via dav1d', async () => {
  const { core, logs } = await loadCore('lgpl');
  assert.equal(core.exec(
    '-f', 'lavfi', '-i', 'testsrc2=duration=0.5:size=128x72:rate=5',
    '-c:v', 'libsvtav1', '-preset', '12', '-f', 'ivf', '/a.ivf'), 0);
  assert.ok(core.FS.readFile('/a.ivf').length > 500);
  logs.length = 0;
  assert.equal(core.exec('-c:v', 'libdav1d', '-i', '/a.ivf', '-f', 'null', '-'), 0);
});
