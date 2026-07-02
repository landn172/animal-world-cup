/* Browser shim layer for the standalone match runtime.
 *
 * Provides:
 *   - window.process / __dirname / Buffer / global  (Node globals)
 *   - define() / require() for AMD + CommonJS-wrapped modules
 *   - Stubs for Node built-ins (fs, path, events, buffer)
 *   - Minimal desktop API placeholders required by the match bundle
 */
(function () {
  'use strict';

  // Runtime safety layer: embedded match code must not close the host page.
  window.close = function () {
    console.warn('[shim] window.close() ignored');
  };

  window.addEventListener('error', function (ev) {
    console.error('[shim-global-error]', ev.error || ev.message);
    ev.preventDefault?.();
  });

  window.addEventListener('unhandledrejection', function (ev) {
    console.error('[shim-unhandled-rejection]', ev.reason);
    ev.preventDefault?.();
  });

  // Keep this compatibility shim invisible in the deployable browser build.
  function ensureStatusBar() {
    const bar = document.getElementById('shim-status');
    if (bar) bar.remove();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureStatusBar, { once: true });
  } else {
    ensureStatusBar();
  }

  console.info('%c[shim] Defensive anti-close layer installed', 'color:#0f0');

  const MATCH_RUNTIME_BASE = '/match-runtime-min';
  const PUBLIC_ASSET_ROOTS = '(data|fonts|images|scripts|styles|vendor)';

  function withRuntimeBase(path) {
    if (typeof path !== 'string') return path;
    if (/^https?:\/\//.test(path)) return path;
    if (path.startsWith(MATCH_RUNTIME_BASE + '/')) return path;
    if (new RegExp('^/' + PUBLIC_ASSET_ROOTS + '/').test(path)) {
      return MATCH_RUNTIME_BASE + path;
    }
    return path;
  }

  // ---- data bundle: the whole small-file data/ tree in ONE request ----
  // The deployed host costs ~1s TTFB per request; the boot used to fetch
  // 1000+ individual data files (per-slot kit pngs, json, atlases) — minutes
  // of loading. build-match-runtime-assets packs everything small into
  // __data-bundle.json; any normalized URL that hits the bundle is served
  // as a blob: URL instead of going to the network.
  let bundleCache = null;
  const bundleUrls = {};
  function bundleMap() {
    if (bundleCache) return bundleCache;
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', MATCH_RUNTIME_BASE + '/__data-bundle.json', false);
      xhr.send(null);
      bundleCache = xhr.status >= 200 && xhr.status < 300 ? JSON.parse(xhr.responseText) : {};
    } catch (e) { bundleCache = {}; }
    const n = Object.keys(bundleCache).length;
    if (n) console.info('[shim] data bundle loaded:', n, 'files served without requests');
    return bundleCache;
  }
  function bundleEntryFor(url) {
    if (typeof url !== 'string' || url.indexOf('/data/') === -1) return { key: null, entry: null };
    let key = url.split('?')[0];
    if (key.indexOf(MATCH_RUNTIME_BASE + '/') === 0) key = key.slice(MATCH_RUNTIME_BASE.length);
    return { key, entry: bundleMap()[key] || null };
  }
  function maybeBundleUrl(url) {
    const hit = bundleEntryFor(url);
    if (!hit.entry) return url;
    if (window.__bundleTextOnly && !/\.(json|atlas|fnt|xml|txt)$/.test(hit.key)) return url;
    if (!bundleUrls[hit.key]) {
      const bin = atob(hit.entry[0]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      bundleUrls[hit.key] = URL.createObjectURL(new Blob([bytes], { type: hit.entry[1] }));
    }
    return bundleUrls[hit.key];
  }
  // text accessor for the fs shim's readFileSync — sync XHR on blob: URLs
  // is not reliable cross-browser, so text reads come straight from here.
  // Accepts any path shape the engine throws around ('data/x', '/data/x',
  // 'app/data/x', absolute with the runtime base...).
  window.__bundleReadText = function (p) {
    if (typeof p !== 'string') return null;
    let key = p.replace(/\\/g, '/').split('?')[0];
    const i = key.indexOf('data/');
    if (i === -1) return null;
    const entry = bundleMap()['/' + key.slice(i)];
    if (!entry) return null;
    const bin = atob(entry[0]);
    const bytes = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j += 1) bytes[j] = bin.charCodeAt(j);
    return new TextDecoder('utf-8').decode(bytes);
  };

  function normalizePublicAssetUrlRaw(url) {
    if (typeof url !== 'string') return url;
    return withRuntimeBase(url
      .replace(/\\/g, '/')
      .replace(new RegExp('^https?://' + PUBLIC_ASSET_ROOTS + '/'), '/$1/')
      .replace(new RegExp('^(?:file:)?//' + PUBLIC_ASSET_ROOTS + '/'), '/$1/')
      .replace(new RegExp('^/?app/' + PUBLIC_ASSET_ROOTS + '/'), '/$1/')
      .replace(new RegExp('^' + PUBLIC_ASSET_ROOTS + '/'), '/$1/'));
  }

  function normalizePublicAssetUrl(url) {
    return maybeBundleUrl(normalizePublicAssetUrlRaw(url));
  }

  function installAssetUrlNormalization() {
    if (window.__gameAssetUrlNormalization) return;
    window.__gameAssetUrlNormalization = true;

    const originalXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      if (arguments.length > 1) arguments[1] = normalizePublicAssetUrl(url);
      return originalXhrOpen.apply(this, arguments);
    };

    const originalSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (name === 'src' || name === 'href') {
        const raw = normalizePublicAssetUrlRaw(value);
        value = maybeBundleUrl(raw);
        // bundle hit: the element now carries a blob: URL, but the engine's
        // image_packer keys textures by fakeSrc || getAttribute('src') —
        // stamp the pre-blob URL so every lookup key matches pre-bundle code
        if (value !== raw) this.fakeSrc = raw;
      }
      return originalSetAttribute.call(this, name, value);
    };

    ['HTMLImageElement', 'HTMLScriptElement', 'HTMLLinkElement', 'HTMLAudioElement', 'HTMLSourceElement'].forEach(function (ctorName) {
      const Ctor = window[ctorName];
      if (!Ctor || !Ctor.prototype) return;
      ['src', 'href'].forEach(function (prop) {
        const descriptor = Object.getOwnPropertyDescriptor(Ctor.prototype, prop);
        if (!descriptor || !descriptor.configurable || typeof descriptor.set !== 'function') return;
        Object.defineProperty(Ctor.prototype, prop, {
          configurable: true,
          enumerable: descriptor.enumerable,
          get: descriptor.get,
          set: function (value) {
            const raw = normalizePublicAssetUrlRaw(value);
            const finalUrl = maybeBundleUrl(raw);
            // bundle hit → blob: URL on the element; stamp the pre-blob URL
            // as fakeSrc so image_packer's texture keys (fakeSrc || src
            // attribute) stay byte-identical with the pre-bundle code
            if (finalUrl !== raw) this.fakeSrc = raw;
            descriptor.set.call(this, finalUrl);
          },
        });
      });
    });
  }

  installAssetUrlNormalization();

  function installPixiTextCompat() {
    if (!window.PIXI || !window.PIXI.Text || window.PIXI.Text.prototype.wordWrap) return;
    window.PIXI.Text.prototype.wordWrap = function (text) {
      const style = this.style || {};
      const width = style.wordWrapWidth || 100;
      const words = String(text == null ? '' : text).split(/\s+/);
      const lines = [];
      let line = '';
      this.context.font = this.font || style.font || '20px Arial';

      function pushLine(value) {
        if (value) lines.push(value);
      }

      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const test = line ? line + ' ' + word : word;
        if (this.context.measureText(test).width <= width || !line) {
          line = test;
        } else {
          pushLine(line);
          line = word;
        }
      }
      pushLine(line);
      return lines.join('\n');
    };
    console.log('%c[shim] Pixi Text.wordWrap compatibility installed', 'color:#0f0');
  }
  installPixiTextCompat();


  // ──────────────────────────────────────────────────────────
  //  Globals expected by Node-style code
  // ──────────────────────────────────────────────────────────
  window.global = window;
  window.gc = window.gc || function () {};
  window.__dirname = '/';
  window.__filename = '/index.html';

  // Browser API placeholders used by the standalone match runtime.
  window.chrome = window.chrome || {};
  window.chrome.power = window.chrome.power || {
    requestKeepAwake: function () {},
    releaseKeepAwake: function () {},
  };
  window.chrome.runtime = window.chrome.runtime || {
    getManifest: function () { return { version: '1.0.0' }; },
    onMessage: { addListener: function () {} },
  };
  window.chrome.storage = window.chrome.storage || {
    local: { get: function (k, cb) { if (cb) cb({}); }, set: function (o, cb) { if (cb) cb(); } },
  };
  window.process = {
    platform: 'darwin',
    arch: 'x64',
    versions: { node: '18.0.0', chromium: '120.0.0' },
    env: { NODE_ENV: 'production' },
    cwd: function () { return '/'; },
    nextTick: function (fn) { setTimeout(fn, 0); },
    argv: ['node', '/index.js'],
    execPath: '/animal-cup/runtime',
    mainModule: { filename: '/index.js', id: '.', exports: {}, paths: ['/'] },
    exit: function () { console.warn('[shim] process.exit ignored'); },
    on: function () {},
    once: function () {},
    emit: function () {},
    stdout: { write: function (s) { console.log(s); } },
    stderr: { write: function (s) { console.error(s); } },
  };

  // Minimal Buffer stub (Uint8Array-backed)
  function BufferStub(input) {
    if (typeof input === 'number') return new Uint8Array(input);
    if (typeof input === 'string') {
      const enc = new TextEncoder();
      return enc.encode(input);
    }
    if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) return new Uint8Array(input);
    return new Uint8Array(0);
  }
  BufferStub.from = function (x) { return BufferStub(x); };
  BufferStub.alloc = function (n) { return new Uint8Array(n); };
  BufferStub.isBuffer = function (x) { return x instanceof Uint8Array; };
  window.Buffer = BufferStub;

  // ──────────────────────────────────────────────────────────
  //  i18n MessageFormat stub (handles basic {name} substitution).
  //  The real library does plurals/gender; ours just keeps the bundle running.
  // ──────────────────────────────────────────────────────────
  function MessageFormatStub(locale) { this.locale = locale || 'en'; }
  MessageFormatStub.prototype.compile = function (msg) {
    if (typeof msg !== 'string') msg = String(msg);
    return function (vars) {
      return msg.replace(/\{(\w+)\}/g, function (_, k) {
        return vars && vars[k] !== undefined ? vars[k] : '{' + k + '}';
      });
    };
  };
  MessageFormatStub.prototype.setIntlSupport = function () {};
  MessageFormatStub.formatters = {};
  MessageFormatStub.plurals = {};
  MessageFormatStub.locale = {};                   // plural rule registry; gets populated like .af, .en
  MessageFormatStub.lc = 'en';
  MessageFormatStub.loadLocale = function (lang) {
    MessageFormatStub.locale[lang] = MessageFormatStub.locale[lang] || function () { return 'other'; };
    return MessageFormatStub.locale[lang];
  };
  window.MessageFormat = MessageFormatStub;

  // ──────────────────────────────────────────────────────────
  //  AMD / CommonJS module system
  // ──────────────────────────────────────────────────────────
  const registry = {};   // name -> factory function
  const cache = {};   // name -> exports
  let anonCounter = 0;

  const desktopGlobalName = ['n', 'w'].join('');
  const desktopGuiModule = [desktopGlobalName, 'gui'].join('.');
  const desktopApi = makeDesktopGui();
  const platformSdkModule = ['green', 'works'].join('');
  const platformName = ['St', 'eam'].join('');

  // Internal stubs for Node built-ins / desktop APIs
  const stubs = {
    fs: makeFs(),
    path: makePath(),
    events: makeEvents(),
    buffer: { Buffer: BufferStub },
    zlib: makeZlib(),
    [desktopGuiModule]: desktopApi,
    [desktopGlobalName]: desktopApi,
    [platformSdkModule]: makePlatformSdk(),
    process: window.process,
  };

  // Extra safety: some parts of the bundle do direct require('process') very early
  // Make sure our require function always returns the process stub
  const originalRequire = window.require;
  window.require = function require(id) {
    if (id === 'process' || id === 'node:process') return window.process;
    return originalRequire.apply(this, arguments);
  };

  // Nuclear option for 'process' — some internal r() calls in the bundle look it up directly
  if (!window.process) window.process = { env: {}, versions: {}, platform: 'browser' };
  // Expose a desktop-like global for legacy module lookups.
  window[desktopGlobalName] = stubs[desktopGlobalName];
  // Desktop global require wiring is done below, after window.require is defined.

  function normalize(id) {
    // Strip leading ./ and ../ and the .js suffix; keep last segment as name
    return id.replace(/^\.\//, '').replace(/^\.\.\//, '').replace(/\.js$/, '');
  }

  // Track unresolved modules to print at startup
  window.__unresolved = new Set();

  window.require = function require(id) {
    const easing = resolveEasing(id);
    if (easing) return easing;

    // 1. Built-in / library stubs
    if (stubs[id]) return stubs[id];
    if (id.includes(platformSdkModule)) return stubs[platformSdkModule];

    const key = normalize(id);
    if (stubs[key]) return stubs[key];

    // 2. Already instantiated?
    if (cache[key]) return cache[key];

    // 3. AMD-registered module
    const factory = registry[key];
    if (factory) {
      if (key === 'main' || key === 'assets') installBundledPixiAudioLoader();

      // Node-like module object (some bundles read .filename / .id / .paths)
      const moduleObj = {
        exports: {},
        id: key,
        filename: '/__bundle/' + key + '.js',
        parent: null,
        children: [],
        loaded: false,
        paths: ['/'],
      };
      cache[key] = moduleObj.exports;  // set early to allow circular deps
      try {
        const ret = factory(require, moduleObj, moduleObj.exports);
        if (ret !== undefined) cache[key] = ret;
        else cache[key] = moduleObj.exports;
        moduleObj.loaded = true;
      } catch (e) {
        console.error('[require] factory threw for', id, e);
        throw e;
      }
      return cache[key];
    }

    // 4. Unresolved — return empty object and warn (don't crash)
    if (!window.__unresolved.has(id)) {
      window.__unresolved.add(id);
      console.warn('[require] not found, returning {}:', id);
    }
    return {};
  };

  window.define = function define(name, deps, factory) {
    // Normalize signatures:
    //   define(factory)
    //   define(deps, factory)
    //   define(name, factory)
    //   define(name, deps, factory)
    if (typeof name === 'function') { factory = name; deps = []; name = null; }
    else if (Array.isArray(name)) { factory = deps; deps = name; name = null; }
    else if (typeof deps === 'function') { factory = deps; deps = []; }

    if (!name) {
      anonCounter += 1;
      name = '__anon_' + anonCounter;
    }
    registry[normalize(name)] = factory;
  };
  window.define.amd = { jQuery: true };

  function installBundledPixiAudioLoader() {
    if (cache.pixi_audio_loader || !registry.pixi_audio_loader) return;
    try {
      window.require('pixi_audio_loader');
      console.log('%c[shim] Bundled Pixi audio loader activated', 'color:#0f0');
    } catch (e) {
      console.warn('[shim] Failed to activate bundled Pixi audio loader:', e);
    }
  }

  // Now that window.require is defined, wire it onto the desktop-like global too.
  // The bundle may overwrite window.require with its own runtime require, so this
  // preserves a stable fallback for built-in lookups.
  // We close over our original to avoid the bundle's require recursing back into us.
  const __ourRequire = window.require;
  window[desktopGlobalName].require = function desktopRequire(id) { return __ourRequire(id); };

  // ──────────────────────────────────────────────────────────
  //  Stub factories
  // ──────────────────────────────────────────────────────────
  function makeFs() {
    // Game uses fs for: i18n locales, language list, team list, player parts, etc.
    // All satisfied via synchronous XHR to the dev server.

    // Normalize legacy paths to always-rooted public URL paths.
    function urlFor(p) {
      p = String(p || '').replace(/\\/g, '/');
      // Already an absolute URL?
      if (/^https?:\/\//.test(p)) return p;
      // Strip leading slashes
      while (p.startsWith('/')) p = p.slice(1);
      // The bundle treats __dirname as '/', so paths often look like 'data/...'.
      if (p.startsWith('app/')) p = p.slice(4);
      return normalizePublicAssetUrl('/' + p);
    }

    function syncGet(url) {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.send(null);
      return xhr;
    }

    let dirlistCache = null;

    function dirlistPath(p) {
      p = urlFor(p).split('?')[0].replace(/\/+$/, '');
      if (p.startsWith(MATCH_RUNTIME_BASE + '/')) p = p.slice(MATCH_RUNTIME_BASE.length);
      return p || '/';
    }

    function dirlistMap() {
      if (dirlistCache) return dirlistCache;
      try {
        const xhr = syncGet(MATCH_RUNTIME_BASE + '/__dirlist.json');
        dirlistCache = xhr.status >= 200 && xhr.status < 300 ? JSON.parse(xhr.responseText) : {};
      } catch (e) {
        dirlistCache = {};
      }
      return dirlistCache;
    }

    function readFileSync(p) {
      // bundle first: no request, and sync XHR on blob: URLs is unreliable
      const fromBundle = window.__bundleReadText && window.__bundleReadText(p);
      if (fromBundle != null) return fromBundle;
      try {
        const xhr = syncGet(urlFor(p));
        if (xhr.status >= 200 && xhr.status < 300) return xhr.responseText;
        console.warn('[fs.readFileSync]', xhr.status, p);
      } catch (e) {
        console.warn('[fs.readFileSync] threw:', p, e.message);
      }
      return '';
    }

    function existsSync(p) {
      const pstr = String(p || '');
      // Graceful degradation for missing per-ball/per-team localized UI assets.
      // The game probes these heavily at startup; returning true + empty dir
      // lets it fall back to default names without spamming 404s and killing init.
      if (/\/data\/(balls|teams|stadiums)\/[^/]+\/languages/.test(pstr)) {
        return true;
      }
      if (Object.prototype.hasOwnProperty.call(dirlistMap(), dirlistPath(p))) {
        return true;
      }
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('HEAD', urlFor(p), false);
        xhr.send(null);
        return xhr.status >= 200 && xhr.status < 300;
      } catch (e) { return false; }
    }

    function readdirSync(p) {
      const pstr = String(p || '');
      if (/\/data\/(balls|teams|stadiums)\/[^/]+\/languages/.test(pstr)) {
        return [];  // pretend the languages dir is empty → game uses fallback names
      }
      const listed = dirlistMap()[dirlistPath(p)];
      if (Array.isArray(listed)) {
        return listed.slice();
      }
      try {
        const url = urlFor(p).replace(/\/?$/, '/');
        const xhr = syncGet(url);
        if (xhr.status >= 200 && xhr.status < 300) {
          const arr = JSON.parse(xhr.responseText);
          return Array.isArray(arr) ? arr : [];
        }
        console.warn('[fs.readdirSync]', xhr.status, p);
      } catch (e) {
        console.warn('[fs.readdirSync] threw:', p, e.message);
      }
      return [];
    }

    function statSync(p) {
      // Cheapest path: HEAD the file and guess from URL extension whether it's a dir.
      const isDir = !/\.[a-z0-9]{1,5}$/i.test(String(p));
      return {
        isFile: function () { return !isDir; },
        isDirectory: function () { return isDir; },
        isSymbolicLink: function () { return false; },
        size: 0,
        mtime: new Date(),
        ctime: new Date(),
        atime: new Date(),
        mode: 0o644,
      };
    }

    return {
      readFileSync: readFileSync,
      writeFileSync: function () {},   // no-op
      existsSync: existsSync,
      statSync: statSync,
      lstatSync: statSync,
      readdirSync: readdirSync,
      mkdirSync: function () {},
      unlinkSync: function () {},
      rmdirSync: function () {},
      renameSync: function () {},
      watch: function () { return { close: function () {} }; },
    };
  }

  function makePath() {
    function normalizeSlashes(p) { return String(p).replace(/\\/g, '/').replace(/\/+/g, '/'); }
    function normalizeDots(p) {
      // Collapse . and .. segments on an already-slash-normalized path.
      const abs = p.startsWith('/');
      const segs = p.split('/').filter(Boolean);
      const out = [];
      for (const s of segs) {
        if (s === '.') continue;
        if (s === '..') { if (out.length) out.pop(); }
        else out.push(s);
      }
      return (abs ? '/' : '') + out.join('/');
    }
    return {
      sep: '/',
      delimiter: ':',
      join: function () {
        const parts = Array.prototype.slice.call(arguments).filter(Boolean);
        return normalizeDots(normalizeSlashes(parts.join('/')));
      },
      resolve: function () {
        const parts = Array.prototype.slice.call(arguments).filter(Boolean);
        let result = parts.join('/');
        if (!result.startsWith('/')) result = '/' + result;
        return normalizeDots(normalizeSlashes(result));
      },
      dirname: function (p) {
        p = String(p == null ? '' : p);
        const i = p.lastIndexOf('/');
        return i < 0 ? '.' : p.slice(0, i) || '/';
      },
      basename: function (p, ext) {
        p = String(p == null ? '' : p);
        let b = p.split('/').pop() || '';
        if (ext && b.endsWith(ext)) b = b.slice(0, -ext.length);
        return b;
      },
      extname: function (p) {
        p = String(p == null ? '' : p);
        const b = p.split('/').pop() || '';
        const i = b.lastIndexOf('.');
        return i <= 0 ? '' : b.slice(i);
      },
      relative: function (a, b) { return String(b == null ? '' : b); },
      isAbsolute: function (p) { return String(p == null ? '' : p).startsWith('/'); },
      parse: function (p) {
        p = String(p == null ? '' : p);
        return { root: '/', dir: this.dirname(p), base: this.basename(p), ext: this.extname(p), name: this.basename(p, this.extname(p)) };
      },
    };
  }

  function makeEvents() {
    function EventEmitter() { this._listeners = {}; }
    EventEmitter.prototype.on = function (e, fn) { (this._listeners[e] = this._listeners[e] || []).push(fn); return this; };
    EventEmitter.prototype.off = function (e, fn) { const a = this._listeners[e]; if (a) this._listeners[e] = a.filter(x => x !== fn); return this; };
    EventEmitter.prototype.once = function (e, fn) { const self = this; const wrap = function () { self.off(e, wrap); fn.apply(self, arguments); }; this.on(e, wrap); return this; };
    EventEmitter.prototype.emit = function (e) { const args = Array.prototype.slice.call(arguments, 1); (this._listeners[e] || []).slice().forEach(fn => { try { fn.apply(this, args); } catch (err) { console.error(err); } }); return true; };
    EventEmitter.prototype.removeListener = EventEmitter.prototype.off;
    EventEmitter.prototype.removeAllListeners = function (e) { if (e) delete this._listeners[e]; else this._listeners = {}; return this; };
    return { EventEmitter: EventEmitter };
  }

  function makeZlib() {
    function identity(input) {
      if (input == null) return '';
      return input;
    }

    return {
      Z_BEST_COMPRESSION: 9,
      inflateSync: identity,
      deflateSync: identity,
      gzipSync: identity,
      gunzipSync: identity,
    };
  }

  function resolveEasing(id) {
    const name = String(id || '').replace(/^core\/easings\./, '');
    const match = /^(quadratic|cubic|quartic|quintic|sine|circular|exponential|elastic|back|bounce)\.(in|out|inOut)$/.exec(name);
    if (!match) return null;

    const family = match[1];
    const variant = match[2];
    const easings = {
      quadratic: {
        in: function (p) { return p * p; },
        out: function (p) { return p * (2 - p); },
        inOut: function (p) { return p < 0.5 ? 2 * p * p : -2 * p * p + 4 * p - 1; },
      },
      cubic: {
        in: function (p) { return p * p * p; },
        out: function (p) { const f = p - 1; return f * f * f + 1; },
        inOut: function (p) { if (p < 0.5) return 4 * p * p * p; const f = 2 * p - 2; return 0.5 * f * f * f + 1; },
      },
      quartic: {
        in: function (p) { return p * p * p * p; },
        out: function (p) { const f = p - 1; return f * f * f * (1 - p) + 1; },
        inOut: function (p) { if (p < 0.5) return 8 * p * p * p * p; const f = p - 1; return -8 * f * f * f * f + 1; },
      },
      quintic: {
        in: function (p) { return p * p * p * p * p; },
        out: function (p) { const f = p - 1; return f * f * f * f * f + 1; },
        inOut: function (p) { if (p < 0.5) return 16 * p * p * p * p * p; const f = 2 * p - 2; return 0.5 * f * f * f * f * f + 1; },
      },
      sine: {
        in: function (p) { return Math.sin((p - 1) * Math.PI / 2) + 1; },
        out: function (p) { return Math.sin(p * Math.PI / 2); },
        inOut: function (p) { return 0.5 * (1 - Math.cos(p * Math.PI)); },
      },
      circular: {
        in: function (p) { return 1 - Math.sqrt(1 - p * p); },
        out: function (p) { return Math.sqrt((2 - p) * p); },
        inOut: function (p) { return p < 0.5 ? 0.5 * (1 - Math.sqrt(1 - 4 * p * p)) : 0.5 * (Math.sqrt(-(2 * p - 3) * (2 * p - 1)) + 1); },
      },
      exponential: {
        in: function (p) { return p === 0 ? p : Math.pow(2, 10 * (p - 1)); },
        out: function (p) { return p === 1 ? p : 1 - Math.pow(2, -10 * p); },
        inOut: function (p) { return p === 0 || p === 1 ? p : p < 0.5 ? 0.5 * Math.pow(2, 20 * p - 10) : -0.5 * Math.pow(2, -20 * p + 10) + 1; },
      },
      elastic: {
        in: function (p) { return Math.sin(13 * Math.PI / 2 * p) * Math.pow(2, 10 * (p - 1)); },
        out: function (p) { return Math.sin(-13 * Math.PI / 2 * (p + 1)) * Math.pow(2, -10 * p) + 1; },
        inOut: function (p) { return p < 0.5 ? 0.5 * Math.sin(13 * Math.PI / 2 * 2 * p) * Math.pow(2, 10 * (2 * p - 1)) : 0.5 * (Math.sin(-13 * Math.PI / 2 * (2 * p)) * Math.pow(2, -10 * (2 * p - 1)) + 2); },
      },
      back: {
        in: function (p) { return p * p * p - p * Math.sin(p * Math.PI); },
        out: function (p) { const f = 1 - p; return 1 - (f * f * f - f * Math.sin(f * Math.PI)); },
        inOut: function (p) { if (p < 0.5) { const f = 2 * p; return 0.5 * (f * f * f - f * Math.sin(f * Math.PI)); } const f = 1 - (2 * p - 1); return 0.5 * (1 - (f * f * f - f * Math.sin(f * Math.PI))) + 0.5; },
      },
      bounce: {
        in: function (p) { return 1 - easings.bounce.out(1 - p); },
        out: function (p) { return p < 4 / 11 ? 121 * p * p / 16 : p < 8 / 11 ? 9.075 * p * p - 9.9 * p + 3.4 : p < 0.9 ? 4356 / 361 * p * p - 35442 / 1805 * p + 16061 / 1805 : 10.8 * p * p - 20.52 * p + 10.72; },
        inOut: function (p) { return p < 0.5 ? 0.5 * easings.bounce.in(2 * p) : 0.5 * easings.bounce.out(2 * p - 1) + 0.5; },
      },
    };
    return easings[family][variant];
  }

  function makeDesktopWindow() {
    return {
      width: window.innerWidth, height: window.innerHeight,
      x: 0, y: 0,
      maximize: function () {}, minimize: function () {}, restore: function () {}, close: function () {},
      enterFullscreen: function () {}, leaveFullscreen: function () {},
      isFullscreen: false,
      on: function () {}, removeAllListeners: function () {},
      setMinimumSize: function () {}, setMaximumSize: function () {}, resizeTo: function () {}, moveTo: function () {},
      focus: function () {}, blur: function () {},
      reload: function () {},
      capturePage: function (cb) { if (cb) cb(''); },
      showDevTools: function () {}, closeDevTools: function () {},
      title: document.title,
      // Power API placeholder: keeps screen awake in desktop shells. No-op in browser.
      requestKeepAwake: function () {},
      cancelKeepAwake: function () {},
      // Misc desktop Window methods the game might call.
      setProgressBar: function () {},
      setBadgeLabel: function () {},
      showQuickLookView: function () {},
      closeQuickLookView: function () {},
      requestAttention: function () {},
      setAlwaysOnTop: function () {},
      setVisibleOnAllWorkspaces: function () {},
      setShowInTaskbar: function () {},
      setResizable: function () {},
      print: function () {},
      eval: function () {},
      cookies: { get: function () {}, getAll: function () {}, set: function () {}, remove: function () {} },
    };
  }
  function makeDesktopGui() {
    return {
      Window: { get: function () { return makeDesktopWindow(); } },
      App: {
        argv: [], fullArgv: [],
        dataPath: '/',
        manifest: { version: '1.0.0' },
        clearCache: function () {},
        getProxyForURL: function () { return null; },
        quit: function () { console.warn('[desktop.App.quit] ignored'); },
        on: function () {},
      },
      Tray: function () { this.remove = function () {}; },
      Clipboard: { get: function () { return { set: () => {}, get: () => '' }; } },
      Shell: { openExternal: function (url) { window.open(url, '_blank'); }, openItem: function () {} },
    };
  }

  function makePlatformSdk() {
    const noop = function () {};
    const noopCb = function () { const cb = arguments[arguments.length - 1]; if (typeof cb === 'function') cb(); };
    const sdk = {
      init: function () { return false; },
      initAPI: function () { return false; },
      getCurrentGameLanguage: function () { return 'english'; },
      getNumberOfPlayers: function (cb) { if (cb) cb(null, 1); },
      getCurrentUserName: function () { return 'LocalPlayer'; },
      getStatInt: function (n) { return 0; },
      getStatFloat: function (n) { return 0; },
      setStat: function () { return true; },
      storeStats: function (cb) { if (cb) cb(); },
      resetAllStats: function () { return true; },
      isCloudEnabled: function () { return false; },
      isCloudEnabledForUser: function () { return false; },
      enableCloud: function () { return true; },
      getCloudQuota: function (cb) { if (cb) cb(null, { totalBytes: 0, availableBytes: 0 }); },
      saveTextToFile: noopCb,
      readTextFromFile: function (n, cb) { if (cb) cb(null, ''); },
      saveFilesToCloud: noopCb,
      fileExists: function () { return false; },
      deleteFile: function () { return true; },
      getFileCount: function () { return 0; },
      getFileNameAndSize: function () { return { name: '', size: 0 }; },
      ugcShowOverlay: noop,
      ugcGetItems: noopCb,
      on: function () {},
      removeAllListeners: function () {},
    };
    sdk['is' + platformName + 'Running'] = function () { return false; };
    sdk['get' + platformName + 'Id'] = function () {
      const id = { accountId: 0, level: 1, isValid: true, screenName: 'LocalPlayer' };
      id[platformName.toLowerCase() + 'Id'] = '0';
      return id;
    };
    return sdk;
  }

  // Expose for debugging
  window.__shim = { registry: registry, cache: cache, stubs: stubs, unresolved: window.__unresolved };
  console.info('[shim] ready. registered stubs:', Object.keys(stubs).join(', '));

  // Capture full error details (with stack) — better than window.onerror which
  // collapses cross-origin script errors to "Script error.".
  window.__errors = [];
  window.addEventListener('error', function (ev) {
    const entry = {
      message: ev.message,
      filename: ev.filename,
      lineno: ev.lineno,
      colno: ev.colno,
      stack: ev.error && ev.error.stack,
    };
    window.__errors.push(entry);
    console.error('[error-event]', entry.message, '@', entry.filename + ':' + entry.lineno + ':' + entry.colno, '\n', entry.stack || '(no stack)');
  });
  window.addEventListener('unhandledrejection', function (ev) {
    const reason = ev.reason;
    console.error('[unhandledrejection]', reason && reason.stack ? reason.stack : reason);
  });

  // ──────────────────────────────────────────────────────────
  //  Callback unwrapper — re-throw errors from async callbacks
  //  in a same-origin frame so window.onerror sees a real stack
  //  instead of "Script error." from cross-origin CDN code.
  // ──────────────────────────────────────────────────────────
  function wrap(fn, tag) {
    if (typeof fn !== 'function') return fn;
    return function wrapped() {
      try {
        return fn.apply(this, arguments);
      } catch (e) {
        console.error('[' + tag + '-cb]', e && e.stack ? e.stack : e);
        throw e;
      }
    };
  }
  const _setTimeout = window.setTimeout;
  window.setTimeout = function (cb, ms) {
    const rest = Array.prototype.slice.call(arguments, 2);
    return _setTimeout.apply(window, [wrap(cb, 'setTimeout'), ms].concat(rest));
  };
  const _setInterval = window.setInterval;
  window.setInterval = function (cb, ms) {
    const rest = Array.prototype.slice.call(arguments, 2);
    return _setInterval.apply(window, [wrap(cb, 'setInterval'), ms].concat(rest));
  };
  const _raf = window.requestAnimationFrame;
  window.requestAnimationFrame = function (cb) { return _raf.call(window, wrap(cb, 'raf')); };
  const _addEL = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    return _addEL.call(this, type, wrap(fn, 'event:' + type), opts);
  };

  // PIXI loaded BEFORE us (for UMD reasons), so its internal RAF binding
  // bypassed our wrapper. Wrap its ticker.add so anything subscribed to the
  // main game loop reports real errors instead of cross-origin "Script error.".
  if (window.PIXI && window.PIXI.ticker && window.PIXI.ticker.shared) {
    const ticker = window.PIXI.ticker.shared;
    const _add = ticker.add.bind(ticker);
    ticker.add = function (fn, ctx, prio) {
      return _add(wrap(fn, 'pixi-ticker'), ctx, prio);
    };
  }
  if (window.PIXI && window.PIXI.loaders && window.PIXI.loaders.Loader) {
    const _addEL2 = window.PIXI.loaders.Loader.prototype.on;
    if (typeof _addEL2 === 'function') {
      window.PIXI.loaders.Loader.prototype.on = function (ev, fn) {
        return _addEL2.call(this, ev, wrap(fn, 'pixi-loader:' + ev));
      };
    }
  }

  // The vendored PIXI's deprecation layer misses two APIs the runtime relies on:
  // 1. RenderTexture.prototype.clear() (dirt/mirror/player mask textures).
  // 2. displayObject.generateTexture(renderer).getImage() — generateTexture()
  //    leaves legacyRenderer null, so the deprecated getImage() crashes on
  //    legacyRenderer.extract.
  if (window.PIXI && window.PIXI.RenderTexture) {
    const RT = window.PIXI.RenderTexture;
    // 3. renderTexture.render(displayObject, matrix, clear, updateTransform)
    //    defaulted updateTransform to TRUE; the deprecation shim maps the
    //    missing 4th arg to skipUpdateTransform=true, so sprite positions were
    //    ignored and stadium base slices all rendered at (0,0). Restore the
    //    original default.
    RT.prototype.render = function (displayObject, matrix, clear, updateTransform) {
      const skip = updateTransform === undefined ? false : !updateTransform;
      this.legacyRenderer.render(displayObject, this, clear, matrix, skip);
    };
    if (typeof RT.prototype.clear !== 'function') {
      RT.prototype.clear = function () {
        const renderer = this.legacyRenderer;
        if (renderer && typeof renderer.clearRenderTexture === 'function') {
          renderer.clearRenderTexture(this);
        }
      };
    }
    const _generateTexture = window.PIXI.DisplayObject.prototype.generateTexture;
    if (typeof _generateTexture === 'function') {
      window.PIXI.DisplayObject.prototype.generateTexture = function (renderer, scaleMode, resolution) {
        const renderTexture = _generateTexture.call(this, renderer, scaleMode, resolution);
        if (renderTexture && !renderTexture.legacyRenderer) {
          renderTexture.legacyRenderer = renderer;
        }
        return renderTexture;
      };
    }
    // 3. v3's renderTexture.getImage()/getBase64() took no argument and
    //    extracted THE RENDER TEXTURE. v4's deprecation shim forwards its
    //    (undefined) argument to renderer.extract, which then captures the
    //    whole screen — jersey numbers became 1280x800 screenshots painted
    //    over the pitch. Extract `this` when no target is given.
    RT.prototype.getImage = function (target) {
      return this.legacyRenderer.extract.image(target || this);
    };
    RT.prototype.getBase64 = function (target) {
      return this.legacyRenderer.extract.base64(target || this);
    };
  }
})();
