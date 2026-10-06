// Builds www/, the copy of the web app that goes inside the iOS and Android apps.
//
//   node tools/native/build-www.mjs        (npm run native:www; native:sync also runs `cap sync`)
//
// The website keeps loading Supabase, three.js, the HEIC decoder and MediaPipe from jsDelivr. A
// store app must not: Apple rejects apps that download executable code (App Review Guideline 2.5.2),
// and an app should open on a plane. So this copies the same files the Dockerfile serves, puts the
// npm-pinned copies of those libraries under www/vendor/, and rewrites each CDN reference to it.
//
// Every rewrite asserts the text it replaces is present. If a source file changes how it loads a
// library, this fails loudly instead of shipping an app that still reaches for the CDN, and the
// final scan refuses any jsDelivr / unpkg reference that is left.
//
// Not rewritten, deliberately: Google Fonts (stylesheets and fonts, not code; the system font is
// the fallback offline), the Sentry loader (error reporting only; the app runs without it), and the
// MediaPipe pose MODEL from storage.googleapis.com (9.4 MB of weights, data rather than code,
// downloaded on first scan exactly as on the web).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'www');
const nm = p => path.join(root, 'node_modules', p);

// The app half of the Dockerfile allowlist. Marketing, legal and demo pages are not bundled: the
// app opens /privacy, /terms and friends on playbookbp.com (js/native.js).
const COPY = ['index.html', 'icon.svg', 'css', 'js', 'img', 'assets'];

const VENDOR = [
  ['@capacitor/core/dist/capacitor.js', 'vendor/capacitor.js'],
  ['@supabase/supabase-js/dist/umd/supabase.js', 'vendor/supabase.js'],
  ['three/build/three.module.js', 'vendor/three/build/three.module.js'],
  ['three/examples/jsm/loaders/GLTFLoader.js', 'vendor/three/examples/jsm/loaders/GLTFLoader.js'],
  ['three/examples/jsm/utils/BufferGeometryUtils.js', 'vendor/three/examples/jsm/utils/BufferGeometryUtils.js'],
  ['heic-to/src/lib/libheif-without-unsafe-eval.js', 'vendor/heic-to/libheif-without-unsafe-eval.js'],
  ['@mediapipe/tasks-vision/vision_bundle.mjs', 'vendor/mediapipe/vision_bundle.mjs'],
  ['@mediapipe/tasks-vision/wasm/vision_wasm_internal.js', 'vendor/mediapipe/wasm/vision_wasm_internal.js'],
  ['@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm', 'vendor/mediapipe/wasm/vision_wasm_internal.wasm'],
  ['@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.js', 'vendor/mediapipe/wasm/vision_wasm_nosimd_internal.js'],
  ['@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.wasm', 'vendor/mediapipe/wasm/vision_wasm_nosimd_internal.wasm'],
];

// The versions the web app pins. A vendored copy of a different version would quietly change what
// a scan measures between the website and the app.
const PINNED = { three: '0.160.0', 'heic-to': '1.5.2', '@mediapipe/tasks-vision': '1.0.1' };

export const REWRITES = {
  'index.html': [
    ['<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>',
     '<script src="/vendor/supabase.js"></script>'],
    ['"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"',
     '"three":"/vendor/three/build/three.module.js"'],
    ['"three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"',
     '"three/addons/":"/vendor/three/examples/jsm/"'],
    // registerPlugin, so js/native.js can reach the native plugins. Before anything else runs.
    ['<script src="/js/native.js"></script>',
     '<script src="/vendor/capacitor.js"></script>\n<script src="/js/native.js"></script>'],
  ],
  'js/heic-decode.js': [
    ["const URL='https://cdn.jsdelivr.net/npm/heic-to@1.5.2/src/lib/libheif-without-unsafe-eval.js';",
     "const URL='/vendor/heic-to/libheif-without-unsafe-eval.js';"],
  ],
  'js/pose-measure.js': [
    ['const MP_BUNDLE  = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`;',
     'const MP_BUNDLE  = `${location.origin}/vendor/mediapipe/vision_bundle.mjs`;'],
    ['const MP_WASM    = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;',
     'const MP_WASM    = `${location.origin}/vendor/mediapipe/wasm`;'],
  ],
  'js/surface-worker.js': [
    ["base='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@'+version",
     "base=location.origin+'/vendor/mediapipe'"],
  ],
};

function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

export function build() {
  for (const [name, version] of Object.entries(PINNED)) {
    const actual = JSON.parse(fs.readFileSync(nm(name + '/package.json'), 'utf8')).version;
    if (actual !== version) throw new Error(`${name} is ${actual} in node_modules; the web app pins ${version}`);
  }

  fs.rmSync(out, { recursive: true, force: true });
  for (const item of COPY) copy(path.join(root, item), path.join(out, item));
  for (const [from, to] of VENDOR) {
    const src = nm(from);
    if (!fs.existsSync(src)) throw new Error('missing ' + from + ' — run npm install');
    copy(src, path.join(out, to));
  }

  for (const [file, pairs] of Object.entries(REWRITES)) {
    const target = path.join(out, file);
    let text = fs.readFileSync(target, 'utf8');
    for (const [from, to] of pairs) {
      if (!text.includes(from)) throw new Error(`${file}: expected to find\n  ${from}\nThe source changed how it loads this library; update tools/native/build-www.mjs.`);
      text = text.split(from).join(to);
    }
    fs.writeFileSync(target, text);
  }

  // Nothing executable may still come from a CDN.
  const left = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (p !== path.join(out, 'vendor')) walk(p); continue; }
      if (!/\.(html|js|mjs|css)$/.test(entry.name)) continue;
      const text = fs.readFileSync(p, 'utf8');
      const hits = text.match(/https:\/\/(cdn\.jsdelivr\.net|unpkg\.com|esm\.sh|cdnjs\.cloudflare\.com)\/[^\s'"`)]*/g);
      if (hits) left.push(...hits.map(h => path.relative(out, p) + ': ' + h));
    }
  };
  walk(out);
  if (left.length) throw new Error('CDN code still referenced in www/:\n  ' + left.join('\n  '));

  let files = 0, bytes = 0;
  const count = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) count(p); else { files++; bytes += fs.statSync(p).size; }
    }
  };
  count(out);
  console.log(`www/ built: ${files} files, ${(bytes / 1048576).toFixed(1)} MB, no CDN code`);
}

// Importable (tests/native-app.test.cjs checks REWRITES against the sources); builds only when run.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) build();
