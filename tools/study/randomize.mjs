/* Device order for the measurement study.
 *
 * Protocol §5: after two captures on phone 1, the other phones are used in a randomized order. The
 * order matters because a participant settles into the stance over a session; if every participant
 * used the phones in the same order, a phone would look better or worse partly because of when it
 * was used.
 *
 * A Williams design balances two things: each phone appears in each position equally often, and each
 * phone follows each other phone equally often. For an odd number of phones that takes twice as many
 * rows. Which row a participant receives is shuffled within blocks by a keyed generator seeded from
 * the study configuration, so the sequence is not predictable from enrollment order, and the same
 * seed always reproduces the same assignments.
 */

import crypto from 'node:crypto';

const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'StudyRandomizationError', code }); };

/* Williams square rows as index permutations of 0..n-1. */
export function williamsRows(n) {
  if (!Number.isInteger(n) || n < 2) fail('TOO_FEW_DEVICES', 'Randomizing device order needs at least 2 devices.');
  const first = [0];
  for (let i = 1, low = 1, high = n - 1; i < n; i++) first.push(i % 2 ? low++ : high--);
  const rows = Array.from({ length: n }, (_, shift) => first.map(v => (v + shift) % n));
  return n % 2 ? [...rows, ...rows.map(row => [...row].reverse())] : rows;
}

/* Deterministic uniform integers in [0, bound) from a keyed hash stream. */
function keyedIntegers(seed, label) {
  let counter = 0, pool = Buffer.alloc(0);
  return bound => {
    const limit = Math.floor(0x100000000 / bound) * bound;
    for (;;) {
      if (pool.length < 4) {
        pool = Buffer.concat([pool, crypto.createHmac('sha256', seed).update(label + ':' + counter++).digest()]);
      }
      const value = pool.readUInt32BE(0);
      pool = pool.subarray(4);
      if (value < limit) return value % bound;   // rejection sampling: no modulo bias
    }
  };
}

/* The device order for the participant enrolled at this index (0-based).
 *
 * devices: ids of the phones in the randomized part of the visit, NOT phone 1, which always comes
 * first under the protocol. seed: the study's recorded randomization seed.
 */
export function deviceOrder(enrollmentIndex, devices, seed) {
  if (!Number.isInteger(enrollmentIndex) || enrollmentIndex < 0) fail('BAD_INDEX', 'Enrollment index must be a non-negative integer.');
  if (!Array.isArray(devices) || new Set(devices).size !== devices.length) fail('BAD_DEVICES', 'Devices must be a list of distinct ids.');
  if (typeof seed !== 'string' || seed.length < 32) fail('WEAK_SEED', 'The randomization seed must be at least 32 characters and recorded in the study configuration.');
  if (devices.length === 1) return Object.freeze([devices[0]]);
  const rows = williamsRows(devices.length);
  const block = Math.floor(enrollmentIndex / rows.length);
  const position = enrollmentIndex % rows.length;
  // Shuffle the rows within this block (Fisher–Yates), then take this participant's position.
  const next = keyedIntegers(seed, 'device-order-block-' + block);
  const permutation = rows.map((_, i) => i);
  for (let i = permutation.length - 1; i > 0; i--) {
    const j = next(i + 1);
    [permutation[i], permutation[j]] = [permutation[j], permutation[i]];
  }
  return Object.freeze(rows[permutation[position]].map(i => devices[i]));
}
