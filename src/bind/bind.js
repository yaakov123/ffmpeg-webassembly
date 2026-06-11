// Bind layer: exposes exec()/ffprobe() on the module, captures logs, and
// converts exit() into a return code instead of a dead runtime.
Module['ret'] = 0;
Module['logger'] = () => {};
Module['print'] = (message) => Module['logger']({ type: 'stdout', message });
Module['printErr'] = (message) => Module['logger']({ type: 'stderr', message });

function ffweb_run(entryName, progName, args) {
  const entry = Module['_' + entryName];
  const allArgs = [progName, ...args.map(String)];
  const argc = allArgs.length;
  const ptrs = [];
  const argv = Module['_malloc']((argc + 1) * 4);
  allArgs.forEach((arg, i) => {
    const size = Module['lengthBytesUTF8'](arg) + 1;
    const p = Module['_malloc'](size);
    Module['stringToUTF8'](arg, p, size);
    ptrs.push(p);
    Module['setValue'](argv + i * 4, p, 'i32');
  });
  Module['setValue'](argv + argc * 4, 0, 'i32');
  try {
    Module['ret'] = entry(argc, argv);
  } catch (e) {
    if (e && e.name === 'ExitStatus') {
      // exit() was called; with EXIT_RUNTIME=0 the runtime stays alive.
      Module['ret'] = e.status;
    } else if (e && typeof e.message === 'string' && e.message.includes('Aborted')) {
      Module['ret'] = 1;
    } else {
      throw e;
    }
  } finally {
    ptrs.forEach((p) => Module['_free'](p));
    Module['_free'](argv);
  }
  return Module['ret'];
}

Module['exec'] = (...args) => ffweb_run('ffmpeg_main', 'ffmpeg', ['-nostdin', '-y', ...args]);
Module['ffprobe'] = (...args) => ffweb_run('ffprobe_main', 'ffprobe', args);
