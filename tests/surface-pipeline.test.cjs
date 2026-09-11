// The reconstruction pipeline, driven end to end against a subject whose true dimensions
// are known exactly.
//
// Everything else that tests js/visual-hull.js checks a piece: prepareMask's rejections, an
// analytical box, the connectivity refusal, the cleanup bounds. What none of them does is
// run four silhouettes of a body-SHAPED solid through the whole path and ask whether the
// result is right — and the only end-to-end run that has ever happened was one manual
// session with one real adult, which needed an operator to select the bounded lower-artifact
// cleanup before it produced an accepted surface.
//
// The subject here is a union of boxes and a sphere: head, neck, torso, pelvis and two legs
// with a gap between them. It is SYNTHETIC and is not a person, not a scan, and not derived
// from one. Its value is that its true height, width and depth are known to the millimetre,
// so the pipeline's output can be compared against something rather than merely inspected.
//
// WHAT THIS ESTABLISHES: that the geometry and scaling math is correct, that the pipeline is
// deterministic, and that it behaves monotonically. WHAT IT DOES NOT: anything about a real
// person. A clothed human silhouette is not a box union, real cameras are not orthographic,
// and no tape measure appears anywhere in this file. Anatomical accuracy, repeatability
// across captures, and device performance remain unestablished.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

const VH = require(path.resolve(__dirname, '..', 'js', 'visual-hull.js'));

const HEIGHT_M = 1.80;
const RESOLUTION = 64;

// ---- the synthetic subject -------------------------------------------------------------
// True extents, used as ground truth below: 1.80 tall, 0.40 across the shoulders, 0.24 deep.
const TRUE = { height: 1.80, width: 0.40, depth: 0.24 };

function inSolid(x, y, z) {
  const box = (x0, x1, y0, y1, z0, z1) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1;
  const dy = y - 1.70;
  if (x * x + dy * dy + z * z <= 0.10 * 0.10) return true;      // head
  if (box(-0.05, 0.05, 1.55, 1.62, -0.05, 0.05)) return true;   // neck
  if (box(-0.20, 0.20, 0.95, 1.56, -0.12, 0.12)) return true;   // torso — sets the width
  if (box(-0.17, 0.17, 0.85, 0.95, -0.12, 0.12)) return true;   // pelvis
  if (box(0.03, 0.16, 0.00, 0.86, -0.10, 0.10)) return true;    // right leg
  if (box(-0.16, -0.03, 0.00, 0.86, -0.10, 0.10)) return true;  // left leg
  return false;
}

// A silhouette is "is the solid hit anywhere along the axis this view cannot see".
const RAY_SAMPLES = 40;
const alongZ = (x, y) => { for (let i = 0; i <= RAY_SAMPLES; i++) if (inSolid(x, y, -0.3 + 0.6 * i / RAY_SAMPLES)) return true; return false; };
const alongX = (z, y) => { for (let i = 0; i <= RAY_SAMPLES; i++) if (inSolid(-0.3 + 0.6 * i / RAY_SAMPLES, y, z)) return true; return false; };

// Render a mask the way inside() reads one back: horizontal offset in metres from centerX,
// height in metres measured up from `bottom`.
function render(predicate, width = 160, height = 220, pad = 18) {
  const bottom = height - pad, span = bottom - pad, scale = span / HEIGHT_M;
  const centerX = Math.round(width / 2);
  const data = new Float32Array(width * height);
  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      const horizontal = (u - centerX) / scale;
      const y = (bottom - v) / scale;
      if (y >= 0 && y <= HEIGHT_M && predicate(horizontal, y)) data[v * width + u] = 1;
    }
  }
  return { width, height, data, centerX };
}

// Rendering is the slow part, so the unperturbed views are built once.
let RAW_CACHE = null;
function rawViews() {
  if (!RAW_CACHE) {
    RAW_CACHE = {
      front: render((h, y) => alongZ(h, y)),
      back: render((h, y) => alongZ(-h, y)),
      right: render((h, y) => alongX(h, y)),
      left: render((h, y) => alongX(-h, y)),
    };
  }
  return {
    front: { ...RAW_CACHE.front, data: Float32Array.from(RAW_CACHE.front.data) },
    back: { ...RAW_CACHE.back, data: Float32Array.from(RAW_CACHE.back.data) },
    right: { ...RAW_CACHE.right, data: Float32Array.from(RAW_CACHE.right.data) },
    left: { ...RAW_CACHE.left, data: Float32Array.from(RAW_CACHE.left.data) },
  };
}

function masksFor(tweak) {
  const raw = rawViews();
  if (tweak) tweak(raw);
  const out = {};
  for (const view of VH.VIEWS) out[view] = VH.prepareMask(raw[view]);
  return out;
}

function grow(img) {
  const { width, height, data } = img, out = Float32Array.from(data);
  for (let v = 0; v < height; v++) for (let u = 0; u < width; u++) {
    if (!data[v * width + u]) continue;
    for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const uu = u + du, vv = v + dv;
      if (uu >= 0 && uu < width && vv >= 0 && vv < height) out[vv * width + uu] = 1;
    }
  }
  img.data = out;
}
function shrink(img) {
  const { width, height, data } = img, out = Float32Array.from(data);
  for (let v = 0; v < height; v++) for (let u = 0; u < width; u++) {
    if (!data[v * width + u]) continue;
    for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const uu = u + du, vv = v + dv;
      if (uu < 0 || uu >= width || vv < 0 || vv >= height || !data[vv * width + uu]) { out[v * width + u] = 0; break; }
    }
  }
  img.data = out;
}

const build = (tweak, options) =>
  VH.reconstruct(masksFor(tweak), { heightM: HEIGHT_M, resolution: RESOLUTION, ...options });

function fingerprint(mesh) {
  const h = crypto.createHash('sha256');
  h.update(mesh.vertices.map(v => v.map(n => n.toFixed(7)).join(',')).join(';'));
  h.update('|');
  h.update(mesh.faces.map(f => f.join(',')).join(';'));
  return h.digest('hex');
}

// Horizontal extent at each voxel level.
//
// NOTE, because the obvious alternative is wrong: do NOT try to recover the occupied-voxel
// SET from the mesh. A mesh carries only surface faces, so when the hull grows, cells that
// were on the boundary become interior and lose their faces — they vanish from any set
// derived that way even though the hull still contains them. Comparing those sets reports a
// monotonicity violation that is an artifact of the measurement. Extents per level are
// derived from vertices, which survive that.
function extentsByLevel(mesh) {
  const byLevel = new Map();
  for (const v of mesh.vertices) {
    const level = Math.round(v[1] / mesh.stepM);
    const e = byLevel.get(level) || { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
    e.x0 = Math.min(e.x0, v[0]); e.x1 = Math.max(e.x1, v[0]);
    e.z0 = Math.min(e.z0, v[2]); e.z1 = Math.max(e.z1, v[2]);
    byLevel.set(level, e);
  }
  return byLevel;
}

// Every level present in `inner` must exist in `outer` and be covered by it.
function containmentFailures(outer, inner) {
  const O = extentsByLevel(outer), I = extentsByLevel(inner), failures = [];
  for (const [level, i] of I) {
    const o = O.get(level);
    if (!o) { failures.push('level ' + level + ' missing from the outer hull'); continue; }
    if (i.x0 < o.x0 - 1e-9) failures.push('level ' + level + ' x0 ' + i.x0 + ' < ' + o.x0);
    if (i.x1 > o.x1 + 1e-9) failures.push('level ' + level + ' x1 ' + i.x1 + ' > ' + o.x1);
    if (i.z0 < o.z0 - 1e-9) failures.push('level ' + level + ' z0 ' + i.z0 + ' < ' + o.z0);
    if (i.z1 > o.z1 + 1e-9) failures.push('level ' + level + ' z1 ' + i.z1 + ' > ' + o.z1);
  }
  return failures;
}

// ---- the checks --------------------------------------------------------------------------

test('four silhouettes of a body-shaped solid reconstruct with no cleanup at all', () => {
  const mesh = build();
  // The strict default. The one real-person session needed the operator to select bounded
  // lower-artifact removal; a subject whose four views are mutually consistent does not.
  assert.equal(mesh.topologyAdjustment, undefined,
    'a consistent four-view subject should need no topology adjustment');
  assert.equal(mesh.protocol, 'orthographic-four-silhouette-v1');
  assert.equal(mesh.scaleStatus, 'assumed-stature-not-validated',
    'the scale caveat must survive even when the geometry is exact');
  assert.equal(mesh.experimental, true);
  assert.ok(mesh.occupiedVoxels > 1000, 'expected a substantial hull, got ' + mesh.occupiedVoxels);
  assert.ok(mesh.faces.length > 0 && mesh.vertices.length > 0);
});

test('the surface is closed: every edge is shared by exactly two triangles', () => {
  // reconstruct() throws on ambiguous contacts, so reaching here already implies it — assert
  // it directly so the property is stated rather than inferred from the absence of a throw.
  const mesh = build();
  const edges = new Map();
  for (const f of mesh.faces) {
    for (let i = 0; i < 3; i++) {
      const a = f[i], b = f[(i + 1) % 3];
      const key = a < b ? a + ',' + b : b + ',' + a;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  const bad = [...edges.values()].filter(n => n !== 2);
  assert.equal(bad.length, 0, bad.length + ' edges are not shared by exactly two faces');
});

test('the same silhouettes always produce the same geometry', () => {
  // Repeatability of the PIPELINE. This says nothing about whether two separate captures of
  // a person agree — that is a different question and is not answered anywhere yet.
  const a = build(), b = build();
  assert.equal(fingerprint(a), fingerprint(b), 'reconstruction must be deterministic');
  assert.equal(a.occupiedVoxels, b.occupiedVoxels);
  assert.equal(a.vertices.length, b.vertices.length);
  assert.equal(a.faces.length, b.faces.length);
});

test('scale is correct against a solid whose true size is known', () => {
  // The first ground-truth comparison in this repository. The truth is synthetic, so this
  // establishes the scaling arithmetic and nothing about a human body.
  const mesh = build();
  const xs = mesh.vertices.map(v => v[0]), ys = mesh.vertices.map(v => v[1]), zs = mesh.vertices.map(v => v[2]);
  const got = {
    height: Math.max(...ys) - Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    depth: Math.max(...zs) - Math.min(...zs),
  };
  // A voxel grid cannot resolve finer than one step, so one step is the tolerance. Claiming
  // anything tighter would be claiming sub-voxel accuracy the method does not have.
  const step = mesh.stepM;
  assert.equal(got.height.toFixed(6), TRUE.height.toFixed(6),
    'height is set by the recorded stature and should be exact, not merely close');
  for (const key of ['width', 'depth']) {
    const error = Math.abs(got[key] - TRUE[key]);
    assert.ok(error <= step + 1e-9,
      key + ' error ' + error.toFixed(4) + 'm exceeds one voxel step (' + step.toFixed(4) + 'm)');
    // And it must not be wildly small either — a collapsed hull would also pass an upper bound.
    assert.ok(got[key] > TRUE[key] - step - 1e-9,
      key + ' collapsed: got ' + got[key].toFixed(4) + ' against a true ' + TRUE[key]);
  }
});

test('the reconstruction is body-shaped, not a convex blob', () => {
  // A visual hull cannot recover concavities the silhouettes do not show, but it MUST keep
  // the ones they do. The gap between the legs appears in front and back and must survive;
  // if it does not, the hull has been filled somewhere it should not be.
  const mesh = build();
  const step = mesh.stepM;
  const gapAt = yFraction => {
    const y = yFraction * HEIGHT_M;
    const xs = mesh.vertices.filter(v => Math.abs(v[1] - y) < step).map(v => v[0]).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] > step * 1.5) return true;
    return false;
  };
  assert.ok(gapAt(0.30), 'the gap between the legs should survive at knee height');
  assert.ok(!gapAt(0.70), 'the torso is solid and should show no gap');

  // Width varies with height: shoulders are wider than the legs.
  const widthAt = yFraction => {
    const y = yFraction * HEIGHT_M;
    const xs = mesh.vertices.filter(v => Math.abs(v[1] - y) < step).map(v => v[0]);
    return xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  };
  assert.ok(widthAt(0.70) > widthAt(0.95),
    'the torso should be wider than the head');
});

test('a larger silhouette can only produce a larger hull', () => {
  // Monotonicity. Growing every view by one pixel must not remove anything from the hull,
  // and shrinking every view must not add anything. This catches rounding and sampling
  // errors in inside() that no single-shape test would reveal.
  const base = build();
  const bigger = build(raw => { for (const v of VH.VIEWS) grow(raw[v]); });
  const smaller = build(raw => { for (const v of VH.VIEWS) shrink(raw[v]); });

  assert.ok(smaller.occupiedVoxels <= base.occupiedVoxels,
    'eroded ' + smaller.occupiedVoxels + ' should not exceed base ' + base.occupiedVoxels);
  assert.ok(base.occupiedVoxels <= bigger.occupiedVoxels,
    'base ' + base.occupiedVoxels + ' should not exceed dilated ' + bigger.occupiedVoxels);

  assert.deepEqual(containmentFailures(bigger, base), [],
    'the dilated hull must contain the base hull at every level');
  assert.deepEqual(containmentFailures(base, smaller), [],
    'the base hull must contain the eroded hull at every level');
});

test('that containment check can actually fail', () => {
  // A guard nobody has watched fail is a guard nobody has tested. Base against dilated is
  // the comparison the previous test makes in the correct direction; reversed, the smaller
  // hull cannot contain the larger one and the helper must say so.
  const base = build();
  const bigger = build(raw => { for (const v of VH.VIEWS) grow(raw[v]); });
  const reversed = containmentFailures(base, bigger);
  assert.ok(reversed.length > 0,
    'a base hull cannot contain a dilated one; the helper should have reported failures');
});

test('resolution changes the sampling but not the subject', () => {
  // Different grids are different meshes — that is expected and is why the repeat-comparison
  // work refuses to compare across resolutions. What must hold is that the overall extents
  // still land on the same solid, within that grid's own step.
  for (const resolution of [48, 96]) {
    const mesh = VH.reconstruct(masksFor(), { heightM: HEIGHT_M, resolution });
    assert.equal(mesh.resolution, resolution);
    const xs = mesh.vertices.map(v => v[0]), ys = mesh.vertices.map(v => v[1]);
    assert.equal((Math.max(...ys) - Math.min(...ys)).toFixed(6), TRUE.height.toFixed(6));
    const widthError = Math.abs((Math.max(...xs) - Math.min(...xs)) - TRUE.width);
    assert.ok(widthError <= mesh.stepM + 1e-9,
      'at resolution ' + resolution + ' the width error ' + widthError.toFixed(4) + 'm exceeds its step');
  }
});

test('the OBJ export carries the same geometry and keeps its caveats', () => {
  const mesh = build();
  const obj = VH.toOBJ(mesh);
  const vLines = obj.split('\n').filter(l => l.startsWith('v '));
  const fLines = obj.split('\n').filter(l => l.startsWith('f '));
  assert.equal(vLines.length, mesh.vertices.length, 'every vertex should be exported');
  assert.equal(fLines.length, mesh.faces.length, 'every face should be exported');
  assert.match(obj, /EXPERIMENTAL/, 'the export must not shed its experimental marking');
  assert.match(obj, /clothed outer surface, not anatomical reconstruction/);
  assert.match(obj, /NOT independently calibrated/);
  // OBJ indices are one-based and must all be in range.
  for (const line of fLines) {
    for (const n of line.slice(2).split(' ').map(Number)) {
      assert.ok(Number.isInteger(n) && n >= 1 && n <= mesh.vertices.length,
        'face index ' + n + ' is out of range');
    }
  }
});
