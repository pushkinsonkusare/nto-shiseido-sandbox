/*!
 * prototype-comments dev-20260511
 * Drop-in commenting widget for HTML prototypes.
 * https://git.soma.salesforce.com/mayank-dhingra/prototype-comments-
 *
 * Bundles: truescreen v0.1.0
 *   pixel-perfect screenshot library (getDisplayMedia + scroll-stitch)
 *
 * Usage: <script src="comments.js" defer></script>
 */
/*! truescreen v0.1.0 — pixel-perfect screenshot library */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') module.exports = factory();
  else if (typeof define === 'function' && define.amd) define([], factory);
  else root.truescreen = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
// ====== util.js ======
/*
 * util.js — small async + DOM helpers
 */
function nextPaint(times = 2) {
  return new Promise(resolve => {
    let n = 0;
    const tick = () => {
      n++;
      if (n >= times) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
function frameToCanvas(video) {
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) throw new Error('truescreen: video has no dimensions yet');
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(video, 0, 0);
  return c;
}
function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) reject(new Error('canvas.toBlob returned null'));
      else resolve(blob);
    }, type, quality);
  });
}
function getDocSize() {
  return {
    width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
  };
}


// ====== sticky.js ======
/*
 * sticky.js — neutralize position:sticky / position:fixed during capture
 *
 * Sticky elements stay in view as you scroll; if we don't demote them
 * they get duplicated every viewport-height in the stitched output.
 * Fixed elements get pinned at their original page coordinates.
 *
 * Demotion rules:
 *   sticky → static  (stays in flow, no content shift)
 *   fixed  → absolute pinned at original page coords
 *
 * Sticky → absolute would work for the pixel layout but pulls the
 * element out of flow, shifting all content below it — the bug we
 * already fixed in the POC. Keep it static.
 */
function neutralizeSticky() {
  const snapshots = [];
  const nodes = document.body.querySelectorAll('*');
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    let pos;
    try { pos = getComputedStyle(n).position; } catch (e) { continue; }
    if (pos !== 'sticky' && pos !== '-webkit-sticky' && pos !== 'fixed') continue;

    snapshots.push({
      node: n,
      position: n.style.position,
      top: n.style.top,
      left: n.style.left,
      right: n.style.right,
      bottom: n.style.bottom
    });

    if (pos === 'fixed') {
      const r = n.getBoundingClientRect();
      const sx = window.scrollX || window.pageXOffset;
      const sy = window.scrollY || window.pageYOffset;
      n.style.position = 'absolute';
      n.style.top = (r.top + sy) + 'px';
      n.style.left = (r.left + sx) + 'px';
      n.style.right = 'auto';
      n.style.bottom = 'auto';
    } else {
      // sticky → static; clear any inline top/left/right/bottom that
      // the original CSS set (e.g. `top: 60px`) so the element doesn't
      // get pushed when its position type changes.
      n.style.position = 'static';
      n.style.top = 'auto';
      n.style.left = 'auto';
      n.style.right = 'auto';
      n.style.bottom = 'auto';
    }
  }
  return snapshots;
}
function restoreSticky(snapshots) {
  for (const s of snapshots) {
    s.node.style.position = s.position;
    s.node.style.top = s.top;
    s.node.style.left = s.left;
    s.node.style.right = s.right;
    s.node.style.bottom = s.bottom;
  }
}


// ====== capture.js ======
/*
 * capture.js — the core scroll-and-stitch full-page capture.
 *
 * Given a Truescreen instance (a held MediaStream + <video>), scroll
 * the page programmatically and stitch viewport frames into a single
 * canvas at the document's full size.
 */
async function captureFullPage(instance, opts = {}) {
  const { video, frameW, frameH } = instance;
  const onProgress = opts.onProgress || null;
  const settleMs = typeof opts.settleMs === 'number' ? opts.settleMs : 40;

  // Save scroll position to restore at the end
  const origScrollX = window.scrollX || window.pageXOffset;
  const origScrollY = window.scrollY || window.pageYOffset;

  // Demote sticky/fixed elements so they don't duplicate
  const stickySnaps = neutralizeSticky();

  // Compute page size + scaling AFTER neutralization (sticky→static
  // can change the document height in degenerate cases — re-measure)
  const { width: docW, height: docH } = getDocSize();
  const viewW = window.innerWidth;
  const viewH = window.innerHeight;

  // Scale = frame px per CSS px. Should equal devicePixelRatio for tab
  // capture; warn if X and Y diverge (means user picked a non-tab source).
  const scaleX = frameW / viewW;
  const scaleY = frameH / viewH;
  if (Math.abs(scaleX - scaleY) > 0.05) {
    console.warn('[truescreen] frame aspect doesn\'t match viewport — was a tab picked?');
  }
  const scale = scaleX;

  const out = document.createElement('canvas');
  out.width = Math.round(docW * scale);
  out.height = Math.round(docH * scale);
  const ctx = out.getContext('2d');

  const restore = () => {
    restoreSticky(stickySnaps);
    window.scrollTo(origScrollX, origScrollY);
  };

  try {
    // Build a grid of viewport-sized tiles to cover the whole document.
    const stepY = Math.max(100, Math.floor(viewH * 0.95));   // ~5% overlap
    const stepX = Math.max(100, Math.floor(viewW * 0.95));
    const positions = [];
    for (let y = 0; y < docH; y += stepY) {
      for (let x = 0; x < docW; x += stepX) {
        positions.push({ x, y });
      }
    }
    if (positions.length === 0) positions.push({ x: 0, y: 0 });

    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      window.scrollTo(p.x, p.y);
      // Wait for the browser to repaint at the new scroll position
      await nextPaint(2);
      if (settleMs) await sleep(settleMs);

      // Use the *actual* clamped scroll position. scrollTo near the
      // bottom can clamp; if we draw at the requested Y the bottom
      // strip lands at the wrong page Y.
      const actualX = window.scrollX || window.pageXOffset;
      const actualY = window.scrollY || window.pageYOffset;

      const frame = frameToCanvas(video);
      const dx = Math.round(actualX * scale);
      const dy = Math.round(actualY * scale);
      ctx.drawImage(frame, dx, dy);

      if (onProgress) {
        try { onProgress({ done: i + 1, total: positions.length }); } catch (e) {}
      }
    }
  } finally {
    restore();
  }

  if (opts.format === 'canvas') return out;
  return canvasToBlob(out, opts.type || 'image/png', opts.quality);
}
async function captureViewport(instance, opts = {}) {
  const frame = frameToCanvas(instance.video);
  if (opts.format === 'canvas') return frame;
  return canvasToBlob(frame, opts.type || 'image/png', opts.quality);
}
async function captureRegion(instance, x, y, width, height, opts = {}) {
  // Capture full page, then crop. Could be optimized to only stitch
  // tiles intersecting the region, but full-page is simpler and
  // most pages aren't that tall.
  const fullCanvas = await captureFullPage(instance, { format: 'canvas' });
  const docW = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  const scale = fullCanvas.width / Math.max(1, docW);

  const px = Math.max(0, Math.round(x * scale));
  const py = Math.max(0, Math.round(y * scale));
  const pw = Math.max(1, Math.min(fullCanvas.width - px, Math.round(width * scale)));
  const ph = Math.max(1, Math.min(fullCanvas.height - py, Math.round(height * scale)));

  const out = document.createElement('canvas');
  out.width = pw;
  out.height = ph;
  out.getContext('2d').drawImage(fullCanvas, px, py, pw, ph, 0, 0, pw, ph);

  if (opts.format === 'canvas') return out;
  return canvasToBlob(out, opts.type || 'image/png', opts.quality);
}


// ====== fallback.js ======
/*
 * fallback.js — html2canvas-based capture for browsers without
 * getDisplayMedia (or when the user denies the permission).
 *
 * Quality is "approximately right" — same compromises as html2canvas:
 * letter-spacing drift, sticky duplication, etc. We do a few of the
 * stabilizing tricks (capture-time CSS, sticky neutralization, fonts
 * ready) but the underlying engine is still re-implemented layout.
 *
 * Used only when the primary getDisplayMedia path is unavailable.
 * The host page must provide a global `html2canvas` function.
 */


function installCaptureCSS() {
  const s = document.createElement('style');
  s.id = 'truescreen-capture-css';
  s.textContent = `
    .truescreen-capturing, .truescreen-capturing * {
      letter-spacing: normal !important;
      text-rendering: geometricPrecision !important;
      -webkit-font-smoothing: antialiased !important;
    }
    .truescreen-capturing { transform: none !important; }
  `;
  document.head.appendChild(s);
}
function removeCaptureCSS() {
  const s = document.getElementById('truescreen-capture-css');
  if (s) s.remove();
}
async function captureWithHtml2Canvas(opts = {}) {
  if (typeof window.html2canvas !== 'function') {
    throw new Error('truescreen: html2canvas fallback requested but window.html2canvas is not available');
  }

  installCaptureCSS();
  document.body.classList.add('truescreen-capturing');
  const stickySnaps = neutralizeSticky();
  const origScrollX = window.scrollX || window.pageXOffset;
  const origScrollY = window.scrollY || window.pageYOffset;
  window.scrollTo(0, 0);

  const fontsReady = (document.fonts && document.fonts.ready) || Promise.resolve();
  await fontsReady;

  const restore = () => {
    restoreSticky(stickySnaps);
    document.body.classList.remove('truescreen-capturing');
    removeCaptureCSS();
    window.scrollTo(origScrollX, origScrollY);
  };

  try {
    const { width: docW, height: docH } = getDocSize();
    // Try foreignObjectRendering first — uses real browser layout via
    // SVG <foreignObject>, so positions are exact when it works.
    let canvas;
    try {
      canvas = await window.html2canvas(document.documentElement, {
        backgroundColor: '#ffffff',
        useCORS: true,
        allowTaint: true,
        scale: Math.min(2, window.devicePixelRatio || 1),
        logging: false,
        foreignObjectRendering: true,
        windowWidth: docW,
        windowHeight: docH,
        width: docW,
        height: docH,
        scrollX: 0,
        scrollY: 0,
        x: 0,
        y: 0
      });
    } catch (err) {
      console.warn('[truescreen] foreignObject capture failed, falling back to legacy renderer:', err);
      canvas = await window.html2canvas(document.documentElement, {
        backgroundColor: '#ffffff',
        useCORS: true,
        allowTaint: true,
        scale: Math.min(2, window.devicePixelRatio || 1),
        logging: false,
        windowWidth: docW,
        windowHeight: docH,
        width: docW,
        height: docH,
        scrollX: 0,
        scrollY: 0,
        x: 0,
        y: 0
      });
    }

    if (opts.format === 'canvas') {
      restore();
      return canvas;
    }
    const blob = await canvasToBlob(canvas, opts.type || 'image/png', opts.quality);
    restore();
    return blob;
  } catch (err) {
    restore();
    throw err;
  }
}


// ====== index.js ======
/*
 * truescreen — pixel-perfect screenshot library for the browser
 *
 * Public API (v0.1):
 *
 *   const ts = await truescreen.create();          // shows tab picker once
 *   const blob = await ts.captureFullPage();       // PNG Blob of full page
 *   const blob = await ts.captureViewport();       // just visible area
 *   const blob = await ts.captureRegion(x,y,w,h);  // subrectangle of page
 *   ts.dispose();                                  // releases the stream
 *
 * Or one-shot (creates + captures + disposes):
 *
 *   const blob = await truescreen.capture();       // full page, single call
 *
 * Or with html2canvas fallback when getDisplayMedia is unavailable
 * (callers must include html2canvas globally before using this path):
 *
 *   const blob = await truescreen.capture({ allowFallback: true });
 */


const VERSION = '0.1.0';

class Truescreen {
  constructor(stream, video) {
    this.stream = stream;
    this.video = video;
    this._track = stream.getVideoTracks()[0];
    const settings = this._track.getSettings();
    this.frameW = settings.width || video.videoWidth;
    this.frameH = settings.height || video.videoHeight;
    this.surface = settings.displaySurface || 'unknown';
    this._disposed = false;

    // If the user stops sharing via the browser UI, mark disposed
    this._track.addEventListener('ended', () => { this._disposed = true; });
  }

  isDisposed() { return this._disposed; }
  surfaceType() { return this.surface; }

  _check() {
    if (this._disposed) throw new Error('truescreen: instance disposed (stream stopped)');
  }

  async captureFullPage(opts) {
    this._check();
    return captureFullPage(this, opts);
  }

  async captureViewport(opts) {
    this._check();
    return captureViewport(this, opts);
  }

  async captureRegion(x, y, w, h, opts) {
    this._check();
    return captureRegion(this, x, y, w, h, opts);
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    try { this._track && this._track.stop(); } catch (e) {}
    if (this.video && this.video.parentNode) this.video.parentNode.removeChild(this.video);
    this.stream = this.video = this._track = null;
  }
}

function isSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
}

async function create(opts = {}) {
  if (!isSupported()) {
    throw new Error('truescreen: getDisplayMedia not available in this browser');
  }
  const constraints = {
    video: {
      cursor: 'never',
      displaySurface: 'browser',
      ...(opts.video || {})
    },
    audio: false,
    preferCurrentTab: true,        // Chrome — biases the picker toward this tab
    selfBrowserSurface: 'include',
    systemAudio: 'exclude'
  };
  const stream = await navigator.mediaDevices.getDisplayMedia(constraints);

  const v = document.createElement('video');
  v.style.cssText = 'position:fixed;left:-99999px;top:-99999px;width:1px;height:1px;';
  v.muted = true;
  v.playsInline = true;
  v.srcObject = stream;
  document.body.appendChild(v);

  await new Promise((resolve, reject) => {
    v.onloadedmetadata = () => v.play().then(resolve).catch(reject);
    v.onerror = () => reject(new Error('truescreen: <video> element error'));
  });

  // First frame is sometimes black; settle briefly.
  await new Promise(r => setTimeout(r, opts.warmupMs ?? 80));

  return new Truescreen(stream, v);
}

// One-shot helper: create, capture, dispose. Uses html2canvas fallback
// when allowFallback is true and getDisplayMedia isn't available.
async function capture(opts = {}) {
  if (!isSupported()) {
    if (opts.allowFallback) return captureWithHtml2Canvas(opts);
    throw new Error('truescreen: getDisplayMedia not available; pass { allowFallback: true } to use html2canvas');
  }
  let ts;
  try {
    ts = await create(opts);
  } catch (err) {
    if (opts.allowFallback) {
      console.warn('[truescreen] getDisplayMedia denied or failed, using fallback:', err);
      return captureWithHtml2Canvas(opts);
    }
    throw err;
  }
  try {
    return await ts.captureFullPage(opts);
  } finally {
    ts.dispose();
  }
}
const truescreen = {
  version: VERSION,
  isSupported,
  create,
  capture,
  // direct fallback for callers who explicitly want it
  captureWithHtml2Canvas
};

  return truescreen;
}));

/* ---------- prototype-comments widget ---------- */
/*!
 * prototype-comments — drop-in commenting widget for HTML prototypes
 *
 * Reviewers press C to reveal the widget, click anywhere on the page to
 * drop a numbered pin, type a comment, then export the page as a PNG
 * with all pins + a sidebar of comments — to share in Slack.
 *
 * Usage: <script src="comments.js" defer></script>
 *
 * Storage: localStorage (per-page, ephemeral). The exported PNG is the artifact.
 * Dependencies: truescreen (bundled above this code) — pixel-perfect
 *   screenshot library that uses getDisplayMedia. The first export per
 *   session shows a "share tab" picker; subsequent exports could reuse
 *   the stream but currently re-prompt for simplicity.
 */
(function () {
  'use strict';

  if (window.__protoCommentsLoaded) return;
  window.__protoCommentsLoaded = true;

  // -------------------- Config --------------------
  var BRAND = '#0176D3';
  var STORAGE_KEY = 'protoComments::' + location.pathname + location.search + location.hash;
  var NAME_KEY = 'protoComments::reviewerName';
  var HINT_KEY = 'protoComments::hintShown';
  var SIDEBAR_KEY = 'protoComments::sidebarOpen';
  var HOTKEY = 'c';
  var SIDEBAR_HOTKEY = 'l';

  // Okabe-Ito colorblind-safe palette
  var PALETTE = [
    { c: '#0072B2', t: '#fff' }, // blue
    { c: '#D55E00', t: '#fff' }, // vermillion
    { c: '#009E73', t: '#fff' }, // bluish green
    { c: '#CC79A7', t: '#fff' }, // reddish purple
    { c: '#56B4E9', t: '#000' }, // sky blue
    { c: '#E69F00', t: '#000' }, // orange
    { c: '#F0E442', t: '#000' }, // yellow
    { c: '#000000', t: '#fff' }  // black
  ];

  function paletteFor(index) { return PALETTE[index % PALETTE.length]; }

  // -------------------- State --------------------
  var state = {
    comments: [],
    visible: false,
    mode: false,
    sidebar: localStorage.getItem(SIDEBAR_KEY) === '1',
    autoOpenedSidebar: false,
    reviewer: localStorage.getItem(NAME_KEY) || ''
  };

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      state.comments = raw ? JSON.parse(raw) : [];
    } catch (e) { state.comments = []; }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.comments)); } catch (e) {}
  }
  function uid() { return 'c_' + Math.random().toString(36).slice(2, 9); }
  function nowISO() { return new Date().toISOString(); }
  function fmtTime(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch (e) { return iso; }
  }

  // -------------------- Styles --------------------
  var STYLES = [
    '.pc-root, .pc-root * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }',
    '.pc-fab { position: fixed; right: 20px; bottom: 20px; z-index: 2147483600; display: flex; gap: 8px; align-items: center; }',
    '.pc-btn { background: ' + BRAND + '; color: #fff; border: none; border-radius: 999px; padding: 10px 16px; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,.15); display: inline-flex; align-items: center; gap: 6px; }',
    '.pc-btn:hover { filter: brightness(1.05); }',
    '.pc-btn.pc-btn-secondary { background: #fff; color: #181818; border: 1px solid #d8dde6; }',
    '.pc-btn.pc-btn-active { background: #014486; }',
    '.pc-toast { position: fixed; left: 50%; bottom: 80px; transform: translateX(-50%); background: rgba(0,0,0,.85); color: #fff; padding: 10px 16px; border-radius: 8px; font-size: 13px; z-index: 2147483647; pointer-events: none; opacity: 0; transition: opacity .2s; max-width: 80vw; text-align: center; }',
    '.pc-toast.pc-show { opacity: 1; }',
    '.pc-mode-banner { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); background: ' + BRAND + '; color: #fff; padding: 8px 14px; border-radius: 999px; font-size: 13px; font-weight: 600; z-index: 2147483600; box-shadow: 0 2px 8px rgba(0,0,0,.2); pointer-events: none; }',
    'body.pc-mode-on, body.pc-mode-on * { cursor: crosshair !important; }',
    /* Click-catcher overlay used during comment mode so the underlying */
    /* page elements never receive the click (no :focus outlines, no */
    /* navigation, no hover states bleeding into the export). */
    '.pc-click-catcher { position: fixed; inset: 0; z-index: 2147483540; cursor: crosshair; background: transparent; }',
    /* Pins */
    '.pc-pin { position: absolute; width: 28px; height: 28px; border-radius: 50%; color: #fff; font-weight: 700; font-size: 12px; line-height: 24px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 0; margin: 0; text-align: center; letter-spacing: 0; cursor: pointer; z-index: 2147483550; box-shadow: 0 2px 6px rgba(0,0,0,.30); border: 2px solid #fff; pointer-events: auto; box-sizing: border-box; transition: transform .12s ease-out; }',
    '.pc-pin:hover { transform: scale(1.12); }',
    '.pc-pin.pc-pin-pulse { animation: pc-pulse 1s ease-out 1; }',
    '@keyframes pc-pulse { 0% { box-shadow: 0 2px 6px rgba(0,0,0,.30), 0 0 0 0 currentColor; } 30% { box-shadow: 0 2px 6px rgba(0,0,0,.30), 0 0 0 10px rgba(0,0,0,0); } 100% { box-shadow: 0 2px 6px rgba(0,0,0,.30), 0 0 0 0 rgba(0,0,0,0); } }',
    /* Popover */
    '.pc-popover { position: absolute; z-index: 2147483600; background: #fff; border: 1px solid #d8dde6; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.18); width: 280px; padding: 12px; }',
    '.pc-popover textarea { width: 100%; min-height: 80px; border: 1px solid #d8dde6; border-radius: 6px; padding: 8px; font-size: 13px; font-family: inherit; resize: vertical; }',
    '.pc-popover textarea:focus { outline: 2px solid ' + BRAND + '; outline-offset: -1px; }',
    '.pc-popover .pc-pop-meta { font-size: 11px; color: #5c6370; margin-bottom: 6px; }',
    '.pc-popover .pc-pop-actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 8px; }',
    '.pc-popover .pc-pop-actions button { font-size: 12px; padding: 6px 10px; border-radius: 6px; border: 1px solid #d8dde6; background: #fff; cursor: pointer; }',
    '.pc-popover .pc-pop-actions button.pc-primary { background: ' + BRAND + '; color: #fff; border-color: ' + BRAND + '; }',
    '.pc-popover .pc-pop-actions button.pc-danger { color: #ba0517; border-color: #ba0517; }',
    /* Modal (name prompt) */
    '.pc-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 2147483640; display: flex; align-items: center; justify-content: center; }',
    '.pc-modal { background: #fff; border-radius: 12px; padding: 20px; width: 320px; box-shadow: 0 12px 32px rgba(0,0,0,.25); }',
    '.pc-modal h3 { margin: 0 0 8px; font-size: 16px; }',
    '.pc-modal p { margin: 0 0 12px; font-size: 13px; color: #5c6370; }',
    '.pc-modal input { width: 100%; padding: 8px 10px; border: 1px solid #d8dde6; border-radius: 6px; font-size: 14px; font-family: inherit; }',
    '.pc-modal input:focus { outline: 2px solid ' + BRAND + '; outline-offset: -1px; }',
    '.pc-modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }',
    /* Menu */
    '.pc-menu { position: fixed; right: 20px; bottom: 70px; background: #fff; border: 1px solid #d8dde6; border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.18); z-index: 2147483600; min-width: 240px; padding: 6px; }',
    '.pc-menu button { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 8px 10px; font-size: 13px; border: none; background: transparent; cursor: pointer; border-radius: 6px; color: #181818; }',
    '.pc-menu button:hover { background: #f3f3f3; }',
    '.pc-menu button.pc-danger { color: #ba0517; }',
    '.pc-menu .pc-menu-sep { height: 1px; background: #e5e5e5; margin: 4px 0; }',
    '.pc-menu .pc-menu-kbd { margin-left: auto; font-size: 10px; color: #8a8f99; background: #f3f3f3; border-radius: 4px; padding: 1px 5px; font-family: ui-monospace, Menlo, monospace; }',
    /* Sidebar */
    '.pc-sidebar { position: fixed; top: 0; right: 0; width: 320px; height: 100vh; background: #fff; border-left: 1px solid #e5e9ef; box-shadow: -4px 0 16px rgba(0,0,0,.06); z-index: 2147483555; display: flex; flex-direction: column; transform: translateX(100%); transition: transform .22s ease-out; }',
    '.pc-sidebar.pc-sidebar-open { transform: translateX(0); }',
    '.pc-sidebar-header { padding: 14px 16px; border-bottom: 1px solid #e5e9ef; display: flex; align-items: center; gap: 10px; }',
    '.pc-sidebar-header .pc-sb-title { font-size: 13px; font-weight: 700; color: #181818; text-transform: uppercase; letter-spacing: .04em; }',
    '.pc-sidebar-header .pc-sb-count { font-size: 11px; color: #5c6370; background: #f3f3f3; padding: 2px 8px; border-radius: 999px; font-weight: 600; }',
    '.pc-sidebar-header .pc-sb-spacer { flex: 1; }',
    '.pc-sidebar-header button { background: transparent; border: none; cursor: pointer; padding: 4px 6px; border-radius: 6px; color: #5c6370; font-size: 14px; }',
    '.pc-sidebar-header button:hover { background: #f3f3f3; color: #181818; }',
    '.pc-sidebar-list { flex: 1; overflow-y: auto; padding: 8px; }',
    '.pc-sb-empty { padding: 24px 16px; color: #5c6370; font-size: 13px; text-align: center; }',
    '.pc-sb-empty b { display: block; color: #181818; margin-bottom: 4px; font-size: 14px; }',
    '.pc-sb-item { display: flex; gap: 10px; padding: 10px; border-radius: 8px; cursor: pointer; transition: background .12s; margin-bottom: 2px; }',
    '.pc-sb-item:hover, .pc-sb-item.pc-sb-item-active { background: #f3f6fb; }',
    '.pc-sb-item-pin { flex: 0 0 26px; width: 26px; height: 26px; border-radius: 50%; font-weight: 700; font-size: 12px; line-height: 22px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 0; margin: 0; text-align: center; letter-spacing: 0; border: 2px solid #fff; box-shadow: 0 1px 2px rgba(0,0,0,.15); box-sizing: border-box; }',
    '.pc-sb-item-body { flex: 1; min-width: 0; }',
    '.pc-sb-item-author { font-size: 12px; font-weight: 600; color: #181818; line-height: 1.3; }',
    '.pc-sb-item-time { font-size: 10px; color: #5c6370; margin-top: 1px; }',
    '.pc-sb-item-text { font-size: 15px; color: #181818; line-height: 1.4; margin-top: 4px; white-space: pre-wrap; word-wrap: break-word; }',
    '.pc-sidebar-footer { padding: 10px 12px; border-top: 1px solid #e5e9ef; display: flex; gap: 6px; }',
    '.pc-sidebar-footer button { flex: 1; padding: 6px 10px; font-size: 12px; border-radius: 6px; border: 1px solid #d8dde6; background: #fff; cursor: pointer; color: #181818; }',
    '.pc-sidebar-footer button.pc-danger { color: #ba0517; border-color: #ba0517; }'
  ].join('\n');

  function injectStyles() {
    if (document.getElementById('pc-styles')) return;
    var s = document.createElement('style');
    s.id = 'pc-styles';
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  // -------------------- DOM helpers --------------------
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === 'class') n.className = attrs[k];
        else if (k === 'style') n.style.cssText = attrs[k];
        else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), attrs[k]);
        else n.setAttribute(k, attrs[k]);
      }
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null) return;
        n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return n;
  }

  function toast(msg, ms) {
    var t = document.querySelector('.pc-toast');
    if (!t) {
      t = el('div', { class: 'pc-toast pc-root' });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('pc-show');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove('pc-show'); }, ms || 1800);
  }

  function isWidgetEl(node) {
    while (node && node !== document.body) {
      if (node.classList && (
        node.classList.contains('pc-root') ||
        node.classList.contains('pc-pin') ||
        node.classList.contains('pc-popover') ||
        node.classList.contains('pc-fab') ||
        node.classList.contains('pc-menu') ||
        node.classList.contains('pc-modal-backdrop') ||
        node.classList.contains('pc-mode-banner') ||
        node.classList.contains('pc-sidebar') ||
        node.classList.contains('pc-click-catcher') ||
        node.classList.contains('pc-toast')
      )) return true;
      node = node.parentElement;
    }
    return false;
  }

  // -------------------- Position --------------------
  // Each comment is just a (pageX, pageY) point. No element selector
  // needed — the pin lives at the absolute page coordinate the user
  // clicked, so it survives reflow as long as the page layout is the
  // same width.
  function positionFor(c) {
    return { x: c.pageX || 0, y: c.pageY || 0 };
  }

  // -------------------- Pin layer --------------------
  var layer;
  function ensureLayer() {
    if (layer && layer.isConnected) return layer;
    layer = el('div', {
      class: 'pc-layer pc-root',
      style: 'position:absolute; left:0; top:0; width:100%; pointer-events:none; z-index:2147483550;'
    });
    document.body.appendChild(layer);
    return layer;
  }

  function renderComments() {
    if (!state.visible) {
      if (layer) { layer.remove(); layer = null; }
      return;
    }
    ensureLayer();
    layer.innerHTML = '';
    state.comments.forEach(function (c, i) {
      var p = positionFor(c);
      var color = paletteFor(i);
      // Pin centered on the click point (translate by half its size)
      var pin = el('div', {
        class: 'pc-pin',
        'data-id': c.id,
        style: 'left:' + (p.x - 14) + 'px; top:' + (p.y - 14) + 'px;'
             + 'background:' + color.c + '; color:' + color.t + ';',
        title: (c.author || 'Anon') + ': ' + c.text,
        onclick: function (ev) {
          ev.stopPropagation();
          openPopover(c, p);
        }
      }, document.createTextNode(String(i + 1)));
      layer.appendChild(pin);
    });
  }

  // -------------------- Popover --------------------
  var openPop;
  function closePopover() {
    if (openPop && openPop.parentNode) openPop.parentNode.removeChild(openPop);
    openPop = null;
  }

  function openPopover(comment, pos) {
    closePopover();
    var isNew = !comment.id;
    var pop = el('div', {
      class: 'pc-popover pc-root',
      style: 'left:' + (pos.x + 18) + 'px; top:' + (pos.y + 6) + 'px;',
      onclick: function (e) { e.stopPropagation(); }
    });

    var meta = el('div', { class: 'pc-pop-meta' },
      isNew ? 'New comment as ' + (state.reviewer || 'Anon') :
              (comment.author || 'Anon') + ' · ' + fmtTime(comment.createdAt));
    var ta = el('textarea', { placeholder: 'Type your comment…' });
    ta.value = comment.text || '';

    var actions = el('div', { class: 'pc-pop-actions' });
    if (!isNew) {
      actions.appendChild(el('button', {
        class: 'pc-danger',
        onclick: function () {
          state.comments = state.comments.filter(function (c) { return c.id !== comment.id; });
          save(); renderComments(); renderSidebar(); closePopover();
        }
      }, 'Delete'));
    }
    actions.appendChild(el('button', { onclick: closePopover }, 'Cancel'));
    actions.appendChild(el('button', {
      class: 'pc-primary',
      onclick: function () {
        var txt = ta.value.trim();
        if (!txt) { ta.focus(); return; }
        var firstComment = isNew && state.comments.length === 0;
        if (isNew) {
          comment.id = uid();
          comment.author = state.reviewer || 'Anon';
          comment.text = txt;
          comment.createdAt = nowISO();
          state.comments.push(comment);
        } else {
          comment.text = txt;
          comment.updatedAt = nowISO();
        }
        save(); renderComments(); renderSidebar(); closePopover();
        if (firstComment && !state.sidebar && !state.autoOpenedSidebar) {
          state.autoOpenedSidebar = true;
          setSidebar(true);
        }
      }
    }, 'Save'));

    pop.appendChild(meta);
    pop.appendChild(ta);
    pop.appendChild(actions);
    document.body.appendChild(pop);
    openPop = pop;
    setTimeout(function () { ta.focus(); }, 10);

    var r = pop.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) pop.style.left = (pos.x - r.width - 18) + 'px';
    if (r.bottom > window.innerHeight - 8) pop.style.top = (pos.y - r.height - 12) + 'px';
  }

  // -------------------- Comment mode --------------------
  var clickCatcher;

  function setMode(on) {
    if (!state.visible && on) return;
    state.mode = !!on;
    document.body.classList.toggle('pc-mode-on', state.mode);
    var btn = document.querySelector('.pc-btn-toggle');
    if (btn) btn.classList.toggle('pc-btn-active', state.mode);
    var banner = document.querySelector('.pc-mode-banner');

    if (state.mode) {
      if (!banner) {
        banner = el('div', { class: 'pc-mode-banner pc-root' }, 'Comment mode — click anywhere to drop a pin · Esc to exit');
        document.body.appendChild(banner);
      }
      // Add a fullscreen click-catcher so the underlying page never sees
      // the click. This prevents :focus outlines, navigation, hover
      // styles, and any other side-effect from leaking into the page
      // (which would then end up in the exported screenshot).
      if (!clickCatcher) {
        clickCatcher = el('div', {
          class: 'pc-click-catcher pc-root',
          onclick: function (e) {
            e.preventDefault(); e.stopPropagation();
            // If a popover is already open, treat this click as
            // "click outside" to close it. Don't drop another pin.
            if (openPop) { closePopover(); return; }
            handleCommentClick(e);
          }
        });
        document.body.appendChild(clickCatcher);
      }
    } else {
      if (banner) banner.remove();
      if (clickCatcher) { clickCatcher.remove(); clickCatcher = null; }
    }
  }

  function handleCommentClick(e) {
    var doDrop = function () { dropPin(e); };
    if (!state.reviewer) {
      promptName(doDrop);
    } else {
      doDrop();
    }
  }

  function dropPin(e) {
    // Use the click coordinates directly — no element selector, no
    // offset-percentage. Pin lands exactly where the cursor was.
    var sx = window.scrollX || window.pageXOffset;
    var sy = window.scrollY || window.pageYOffset;
    var draft = {
      pageX: e.clientX + sx,
      pageY: e.clientY + sy
    };
    openPopover(draft, { x: draft.pageX, y: draft.pageY });
  }

  // -------------------- Name prompt --------------------
  function promptName(onDone) {
    var backdrop = el('div', { class: 'pc-modal-backdrop pc-root', onclick: function (e) { if (e.target === backdrop) backdrop.remove(); } });
    var modal = el('div', { class: 'pc-modal' });
    modal.appendChild(el('h3', null, 'What\'s your name?'));
    modal.appendChild(el('p', null, 'Shown next to your comments. Saved on this device.'));
    var input = el('input', { type: 'text', placeholder: 'e.g. Alex Dev', value: state.reviewer || '' });
    modal.appendChild(input);
    var actions = el('div', { class: 'pc-modal-actions' });
    actions.appendChild(el('button', { class: 'pc-btn pc-btn-secondary', onclick: function () { backdrop.remove(); } }, 'Cancel'));
    actions.appendChild(el('button', {
      class: 'pc-btn',
      onclick: function () {
        var v = input.value.trim();
        if (!v) { input.focus(); return; }
        state.reviewer = v;
        try { localStorage.setItem(NAME_KEY, v); } catch (e) {}
        backdrop.remove();
        if (onDone) onDone();
      }
    }, 'Save'));
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    setTimeout(function () { input.focus(); input.select(); }, 10);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') actions.querySelector('.pc-btn:not(.pc-btn-secondary)').click();
      if (e.key === 'Escape') backdrop.remove();
    });
  }

  // -------------------- Sidebar (live comment list) --------------------
  var sidebarEl;

  function ensureSidebar() {
    if (sidebarEl && sidebarEl.isConnected) return sidebarEl;
    sidebarEl = el('div', { class: 'pc-sidebar pc-root' });
    document.body.appendChild(sidebarEl);
    return sidebarEl;
  }

  function setSidebar(on) {
    if (!state.visible && on) return;
    state.sidebar = !!on;
    try { localStorage.setItem(SIDEBAR_KEY, state.sidebar ? '1' : '0'); } catch (e) {}
    if (state.sidebar) {
      ensureSidebar();
      renderSidebar();
      requestAnimationFrame(function () { sidebarEl.classList.add('pc-sidebar-open'); });
    } else if (sidebarEl) {
      sidebarEl.classList.remove('pc-sidebar-open');
    }
    var btn = document.querySelector('.pc-btn-sidebar');
    if (btn) btn.classList.toggle('pc-btn-active', state.sidebar);
  }

  function renderSidebar() {
    if (!sidebarEl) return;
    sidebarEl.innerHTML = '';

    var header = el('div', { class: 'pc-sidebar-header' });
    header.appendChild(el('div', { class: 'pc-sb-title' }, 'Comments'));
    header.appendChild(el('div', { class: 'pc-sb-count' }, String(state.comments.length)));
    header.appendChild(el('div', { class: 'pc-sb-spacer' }));
    header.appendChild(el('button', {
      title: 'Close (L)',
      onclick: function () { setSidebar(false); }
    }, '✕'));
    sidebarEl.appendChild(header);

    var list = el('div', { class: 'pc-sidebar-list' });
    if (state.comments.length === 0) {
      list.appendChild(el('div', { class: 'pc-sb-empty' }, [
        el('b', null, 'No comments yet'),
        document.createTextNode('Click 💬 Comment, then click anywhere on the page to drop a pin.')
      ]));
    } else {
      state.comments.forEach(function (c, i) {
        var color = paletteFor(i);
        var item = el('div', {
          class: 'pc-sb-item',
          'data-id': c.id,
          onclick: function () { focusComment(c); }
        });
        item.appendChild(el('div', {
          class: 'pc-sb-item-pin',
          style: 'background:' + color.c + '; color:' + color.t + ';'
        }, String(i + 1)));
        var body = el('div', { class: 'pc-sb-item-body' });
        body.appendChild(el('div', { class: 'pc-sb-item-text' }, c.text));
        item.appendChild(body);
        list.appendChild(item);
      });
    }
    sidebarEl.appendChild(list);

    var footer = el('div', { class: 'pc-sidebar-footer' });
    footer.appendChild(el('button', {
      title: 'Export full page',
      onclick: function () { exportPNG({ kind: 'full' }); }
    }, '📸 Export'));
    if (state.comments.length > 0) {
      footer.appendChild(el('button', {
        class: 'pc-danger',
        onclick: function () {
          if (confirm('Clear all ' + state.comments.length + ' comments on this page?')) {
            state.comments = []; save(); renderComments(); renderSidebar();
          }
        }
      }, '🗑 Clear'));
    }
    sidebarEl.appendChild(footer);
  }

  function focusComment(c) {
    var p = positionFor(c);
    var sx = window.scrollX || window.pageXOffset;
    var sy = window.scrollY || window.pageYOffset;
    var inView = p.y >= sy + 80 && p.y <= sy + window.innerHeight - 80;
    if (!inView) {
      window.scrollTo({
        left: sx,
        top: Math.max(0, p.y - window.innerHeight / 3),
        behavior: 'smooth'
      });
    }
    // Pulse the pin
    if (layer) {
      var pin = layer.querySelector('.pc-pin[data-id="' + c.id + '"]');
      if (pin) {
        pin.classList.remove('pc-pin-pulse');
        void pin.offsetWidth;
        pin.classList.add('pc-pin-pulse');
        setTimeout(function () { pin.classList.remove('pc-pin-pulse'); }, 1000);
      }
    }
  }

  // -------------------- FAB + Menu --------------------
  function buildFab() {
    if (document.querySelector('.pc-fab')) return;
    var fab = el('div', { class: 'pc-fab pc-root' });
    var toggle = el('button', {
      class: 'pc-btn pc-btn-toggle',
      title: 'Toggle comment mode',
      onclick: function () { setMode(!state.mode); }
    }, '💬 Comment');
    var sidebarBtn = el('button', {
      class: 'pc-btn pc-btn-secondary pc-btn-sidebar' + (state.sidebar ? ' pc-btn-active' : ''),
      title: 'Toggle comment list (L)',
      onclick: function () { setSidebar(!state.sidebar); }
    }, '📋 List');
    var exportBtn = el('button', {
      class: 'pc-btn pc-btn-secondary',
      title: 'Export full page (PNG)',
      onclick: function () { exportPNG({ kind: 'full' }); }
    }, '📸 Export');
    var more = el('button', {
      class: 'pc-btn pc-btn-secondary',
      title: 'More',
      onclick: function (e) { e.stopPropagation(); toggleMenu(); }
    }, '⋯');
    fab.appendChild(toggle);
    fab.appendChild(sidebarBtn);
    fab.appendChild(exportBtn);
    fab.appendChild(more);
    document.body.appendChild(fab);
  }

  function removeFab() {
    var fab = document.querySelector('.pc-fab'); if (fab) fab.remove();
    closeMenu();
    var banner = document.querySelector('.pc-mode-banner'); if (banner) banner.remove();
  }

  var menuEl;
  function toggleMenu() {
    if (menuEl) { menuEl.remove(); menuEl = null; return; }
    menuEl = el('div', { class: 'pc-menu pc-root' });
    var addItem = function (label, kbd, fn, danger) {
      var b = el('button', { class: danger ? 'pc-danger' : '', onclick: function () { closeMenu(); fn(); } });
      b.appendChild(document.createTextNode(label));
      if (kbd) b.appendChild(el('span', { class: 'pc-menu-kbd' }, kbd));
      menuEl.appendChild(b);
    };
    addItem('📸 Export full page', '', function () { exportPNG({ kind: 'full' }); });
    addItem('📋 Copy to clipboard', '', function () { exportPNG({ kind: 'full', clipboard: true }); });
    menuEl.appendChild(el('div', { class: 'pc-menu-sep' }));
    addItem('📋 Toggle comment list', 'L', function () { setSidebar(!state.sidebar); });
    addItem('✏️ Change my name', '', function () { promptName(); });
    addItem('👁 Hide widget', 'C', function () { setVisible(false); });
    menuEl.appendChild(el('div', { class: 'pc-menu-sep' }));
    addItem('🗑 Clear all comments', '', function () {
      if (confirm('Clear all ' + state.comments.length + ' comments on this page?')) {
        state.comments = []; save(); renderComments(); renderSidebar();
      }
    }, true);
    document.body.appendChild(menuEl);
  }
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }

  // -------------------- Visibility --------------------
  function setVisible(on) {
    state.visible = !!on;
    if (state.visible) {
      buildFab();
      renderComments();
      if (state.sidebar) setSidebar(true);
    } else {
      setMode(false);
      closePopover();
      removeFab();
      renderComments();
      if (sidebarEl) {
        sidebarEl.classList.remove('pc-sidebar-open');
        setTimeout(function () { if (sidebarEl) { sidebarEl.remove(); sidebarEl = null; } }, 250);
      }
    }
  }

  function showFirstTimeHint() {
    if (localStorage.getItem(HINT_KEY)) return;
    setTimeout(function () {
      toast('Press C to leave comments on this prototype', 4500);
      try { localStorage.setItem(HINT_KEY, '1'); } catch (e) {}
    }, 800);
  }

  // -------------------- Export --------------------
  function buildSidebarForExport(width, comments) {
    var node = el('div', {
      class: 'pc-export-sidebar',
      style: 'position:fixed; left:-99999px; top:0; width:' + width + 'px; background:#fafbfc; padding:24px; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; color:#181818; box-sizing:border-box;'
    });
    node.appendChild(el('div', { style: 'font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:#5c6370; margin-bottom:6px;' }, 'Comments'));
    node.appendChild(el('div', { style: 'font-size:20px; font-weight:700; margin-bottom:4px;' }, comments.length + ' comment' + (comments.length === 1 ? '' : 's')));
    node.appendChild(el('div', { style: 'font-size:12px; color:#5c6370; margin-bottom:18px;' }, 'Exported ' + new Date().toLocaleString()));

    comments.forEach(function (c, i) {
      var color = paletteFor(i);
      var row = el('div', { style: 'display:flex; gap:10px; margin-bottom:14px; padding-bottom:14px; border-bottom:1px solid #e5e5e5;' });
      var pin = el('div', {
        style: 'flex:0 0 28px; width:28px; height:28px; border-radius:50%; background:' + color.c + '; color:' + color.t + '; font-weight:700; font-size:13px; line-height:24px; text-align:center; border:2px solid #fff; box-shadow:0 1px 2px rgba(0,0,0,.15); box-sizing:border-box;'
      }, String(i + 1));
      var body = el('div', { style: 'flex:1; min-width:0;' });
      body.appendChild(el('div', { style: 'font-size:13px; font-weight:600; margin-bottom:2px;' }, c.author || 'Anon'));
      body.appendChild(el('div', { style: 'font-size:11px; color:#5c6370; margin-bottom:6px;' }, fmtTime(c.createdAt)));
      body.appendChild(el('div', { style: 'font-size:13px; line-height:1.45; white-space:pre-wrap; word-wrap:break-word;' }, c.text));
      row.appendChild(pin);
      row.appendChild(body);
      node.appendChild(row);
    });

    if (comments.length === 0) {
      node.appendChild(el('div', { style: 'font-size:13px; color:#5c6370;' }, 'No comments yet.'));
    }
    document.body.appendChild(node);
    return node;
  }

  function drawPinOnCanvas(ctx, x, y, n, scale, color, radiusPx) {
    scale = scale || 1;
    color = color || { c: BRAND, t: '#fff' };
    var R = (radiusPx != null ? radiusPx : 14) * scale;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = color.c;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2 * scale;
    ctx.shadowColor = 'rgba(0,0,0,.30)';
    ctx.shadowBlur = 6 * scale;
    ctx.shadowOffsetY = 2 * scale;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.stroke();
    ctx.fillStyle = color.t;
    // Scale text with the pin radius — 13px base for R=14, ~20px for R=22.
    var fontPx = Math.round(R * 0.92);
    ctx.font = 'bold ' + fontPx + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), 0, 0);
    ctx.restore();
  }

  // Render export sidebar: pin number + comment text only.
  // Width = 20% of page canvas. Font floor = 14pt * scale. Never smaller.
  function renderSidebarCanvas(comments, canvasW, scale, pageH) {
    var fontStack = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    var bg  = '#fafbfc';
    var ink = '#181818';
    var sep = '#e5e5e5';

    // Font size: 14pt minimum regardless of scale/page-width.
    var fontSize   = Math.max(16 * scale, 16);
    var lineH      = Math.round(fontSize * 1.5);
    var pad        = Math.round(16 * scale);
    var pinR       = Math.round(10 * scale);
    var pinGap     = Math.round(8 * scale);
    var rowPad     = Math.round(12 * scale);
    var textW      = canvasW - pad * 2 - pinR * 2 - pinGap;

    // Measure-only canvas for text wrapping.
    var mctx = document.createElement('canvas').getContext('2d');
    mctx.font = fontSize + 'px ' + fontStack;

    function wrap(text, maxW) {
      var lines = [];
      String(text).split('\n').forEach(function (para) {
        if (!para) { lines.push(''); return; }
        var words = para.split(/(\s+)/);
        var line = '';
        for (var i = 0; i < words.length; i++) {
          var test = line + words[i];
          if (!line || mctx.measureText(test).width <= maxW) {
            line = test;
          } else {
            lines.push(line.trimEnd());
            line = words[i].trimStart();
          }
        }
        if (line) lines.push(line.trimEnd());
      });
      return lines;
    }

    // Pre-compute rows to get total height.
    var rows = comments.map(function (c, i) {
      var lines = wrap(c.text || '', textW);
      var rowH = rowPad + Math.max(pinR * 2, lines.length * lineH) + rowPad;
      return { c: c, i: i, lines: lines, rowH: rowH };
    });

    var totalH = rows.reduce(function (s, r) { return s + r.rowH + 1; }, pad);
    totalH += pad;
    var canvasH = Math.max(totalH, pageH);

    var canvas = document.createElement('canvas');
    canvas.width  = canvasW;
    canvas.height = canvasH;
    var ctx = canvas.getContext('2d');

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvasW, canvasH);

    var y = pad;
    ctx.font = fontSize + 'px ' + fontStack;
    ctx.textBaseline = 'top';

    rows.forEach(function (row) {
      var color = paletteFor(row.i);
      var pinX = pad + pinR;
      var pinY = y + rowPad + pinR;
      drawPinOnCanvas(ctx, pinX, pinY, row.i + 1, scale, color, pinR / scale);

      var tx = pad + pinR * 2 + pinGap;
      var ty = y + rowPad;
      ctx.fillStyle = ink;
      row.lines.forEach(function (line) {
        ctx.fillText(line, tx, ty);
        ty += lineH;
      });

      y += row.rowH;
      ctx.fillStyle = sep;
      ctx.fillRect(pad, y, canvasW - pad * 2, 1);
      y += 1;
    });

    return canvas;
  }

  function exportPNG(opts) {
    opts = opts || {};
    var log = function () {
      try { console.log.apply(console, ['[proto-comments]'].concat([].slice.call(arguments))); } catch (e) {}
    };
    log('exportPNG called', opts);

    if (!window.truescreen) {
      console.error('[proto-comments] window.truescreen is not loaded');
      toast('truescreen not loaded — check console');
      return;
    }
    if (!window.truescreen.isSupported || !window.truescreen.isSupported()) {
      console.error('[proto-comments] getDisplayMedia not available — make sure the page is served over http(s)://, not file://');
      toast('Export needs http(s):// — run a local server (e.g. python3 -m http.server)');
      return;
    }

    setMode(false);
    closePopover();
    closeMenu();

    // Hide widget chrome from the screenshot.
    var hideEls = document.querySelectorAll('.pc-fab, .pc-menu, .pc-toast, .pc-mode-banner, .pc-layer, .pc-popover, .pc-modal-backdrop, .pc-sidebar, .pc-click-catcher');
    var prevDisplay = [];
    hideEls.forEach(function (e) { prevDisplay.push(e.style.display); e.style.display = 'none'; });

    // Full-page export: include ALL comments, in their original order.
    // Pin numbers in the screenshot match the live `L` sidebar.
    var allComments = state.comments.slice();
    log('allComments=' + allComments.length);

    var teardownDone = false;
    var teardown = function () {
      if (teardownDone) return;
      teardownDone = true;
      hideEls.forEach(function (e, i) { e.style.display = prevDisplay[i]; });
    };

    var fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();

    toast('Pick this tab in the next prompt…', 6000);
    log('awaiting fonts.ready');

    fontsReady.then(function () {
      log('fonts ready, calling truescreen.create()');
      return window.truescreen.create();
    }).then(function (ts) {
      var surface = ts.surfaceType();
      log('truescreen instance ready, surface=' + surface + ', frame=' + ts.frameW + 'x' + ts.frameH);
      if (surface && surface !== 'browser' && surface !== 'unknown') {
        console.warn('[proto-comments] surface is "' + surface + '" not "browser" — output may be off if you picked Window or Entire Screen');
      }

      toast('Capturing…', 60000);
      return ts.captureViewport({ format: 'canvas' }).then(function (canvas) {
        log('captureViewport done, canvas=' + canvas.width + 'x' + canvas.height);
        ts.dispose();
        return canvas;
      }, function (err) {
        ts.dispose();
        throw err;
      });
    }).then(function (pageCanvas) {
      var scale = pageCanvas.width / Math.max(1, window.innerWidth);
      log('drawing pins, scale=' + scale.toFixed(3) + ', pins=' + allComments.length);

      teardown();

      // Draw pins on the page canvas at their viewport coords.
      var pctx = pageCanvas.getContext('2d');
      var sx = window.scrollX || window.pageXOffset;
      var sy = window.scrollY || window.pageYOffset;
      allComments.forEach(function (c, i) {
        var p = positionFor(c);
        var vx = (p.x - sx) * scale;
        var vy = (p.y - sy) * scale;
        if (vx < 0 || vy < 0 || vx > pageCanvas.width || vy > pageCanvas.height) return;
        drawPinOnCanvas(pctx, vx, vy, i + 1, scale, paletteFor(i));
      });

      // Sidebar: 20% of page width, same height as page canvas.
      var sidebarW = Math.round(pageCanvas.width * 0.20);
      log('sidebar canvasW=' + sidebarW);
      var sidebarCanvas = renderSidebarCanvas(allComments, sidebarW, scale, pageCanvas.height);

      var out = document.createElement('canvas');
      out.width  = pageCanvas.width + sidebarCanvas.width;
      out.height = Math.max(pageCanvas.height, sidebarCanvas.height);
      var octx = out.getContext('2d');
      octx.fillStyle = '#fafbfc';
      octx.fillRect(0, 0, out.width, out.height);
      octx.drawImage(pageCanvas, 0, 0);
      octx.drawImage(sidebarCanvas, pageCanvas.width, 0);
      log('stitched: ' + out.width + 'x' + out.height);
      return out;
    }).then(function (canvas) {
      log('toBlob…');
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (!blob) reject(new Error('canvas.toBlob returned null'));
          else resolve(blob);
        }, 'image/png');
      });
    }).then(function (blob) {
      log('blob ready, size=' + blob.size + ' bytes');
      if (opts.clipboard && navigator.clipboard && window.ClipboardItem) {
        return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          .then(function () { toast('Copied to clipboard ✓'); })
          .catch(function () { downloadBlob(blob); toast('Clipboard blocked — downloaded instead'); });
      }
      downloadBlob(blob);
      toast('PNG downloaded ✓');
    }).catch(function (err) {
      teardown();
      console.error('[proto-comments] export failed:', err);
      if (err && err.name === 'NotAllowedError') {
        toast('Export cancelled (share prompt denied)');
      } else if (err && /toBlob/.test(err.message || '')) {
        toast('Export failed: image too large for browser');
      } else {
        toast('Export failed: ' + (err && err.message ? err.message : 'unknown — see console'), 5000);
      }
    });
  }

  function downloadBlob(blob) {
    var url = URL.createObjectURL(blob);
    var name = (document.title || 'prototype').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
    var stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    var a = el('a', { href: url, download: name + '-comments-' + stamp + '.png' });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 100);
  }

  // -------------------- Wire up --------------------
  function init() {
    injectStyles();
    load();
    showFirstTimeHint();

    // Outside-click handler for menu / popover. Clicks made while
    // comment mode is active are caught by the .pc-click-catcher
    // overlay before they ever reach this listener.
    document.addEventListener('click', function (e) {
      if (menuEl && !e.target.closest('.pc-menu') && !e.target.closest('.pc-fab')) closeMenu();
      if (openPop && !e.target.closest('.pc-popover') && !e.target.closest('.pc-pin')) closePopover();
    }, true);

    document.addEventListener('keydown', function (e) {
      var realTarget = (e.composedPath ? e.composedPath()[0] : null) || e.target;
      var tag = (realTarget && realTarget.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || (realTarget && realTarget.isContentEditable);
      if (e.key === 'Escape') {
        if (openPop) { closePopover(); return; }
        if (state.mode) { setMode(false); return; }
        closeMenu();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      var k = (e.key || '').toLowerCase();
      if (k === HOTKEY) { e.preventDefault(); setVisible(!state.visible); return; }
      if (!state.visible) return;
      if (k === SIDEBAR_HOTKEY) { e.preventDefault(); setSidebar(!state.sidebar); return; }
    });

    var rerender = function () { renderComments(); };
    window.addEventListener('resize', debounce(rerender, 80));
    window.addEventListener('scroll', debounce(rerender, 80), true);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(rerender);
  }

  function debounce(fn, ms) {
    var t; return function () { clearTimeout(t); var a = arguments, c = this; t = setTimeout(function () { fn.apply(c, a); }, ms); };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.protoComments = {
    show: function () { setVisible(true); },
    hide: function () { setVisible(false); },
    toggle: function () { setVisible(!state.visible); },
    get: function () { return state.comments.slice(); },
    clear: function () { state.comments = []; save(); renderComments(); renderSidebar(); },
    export: function () { exportPNG({ kind: 'full' }); },
    setName: function (n) { state.reviewer = n; localStorage.setItem(NAME_KEY, n); }
  };
})();
