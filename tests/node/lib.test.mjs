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
