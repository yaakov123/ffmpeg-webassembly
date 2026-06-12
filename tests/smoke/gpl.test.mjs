import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './helpers.mjs';

test('encodes H.264 with x264 and HEVC with x265', async () => {
  const { core, logs } = await loadCore('gpl');
  assert.equal(core.exec('-f', 'lavfi', '-i', 'testsrc2=duration=1:size=128x72:rate=5',
    '-c:v', 'libx264', '-f', 'mp4', '/h264.mp4'), 0);
  assert.equal(core.exec('-f', 'lavfi', '-i', 'testsrc2=duration=1:size=128x72:rate=5',
    '-c:v', 'libx265', '-f', 'mp4', '/hevc.mp4'), 0);
  assert.ok(core.FS.readFile('/h264.mp4').length > 1000);
  assert.ok(core.FS.readFile('/hevc.mp4').length > 1000);
  const ret = core.ffprobe('-v', 'error', '-show_streams', '-of', 'json', '/h264.mp4');
  assert.equal(ret, 0);
  assert.match(logs.join('\n'), /"codec_name"\s*:\s*"h264"/);
});
