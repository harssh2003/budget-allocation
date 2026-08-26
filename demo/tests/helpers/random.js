/**
 * Seeded PRNG for the fuzz tests.
 *
 * Math.random would make a failing fuzz case impossible to reproduce. With a
 * fixed seed, a failure reported by CI is a failure you can re-run locally and
 * step through.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random decimal amount string with up to `decimals` places. */
export function randomAmount(rand, maxMajor, decimals = 2) {
  const whole = BigInt(Math.floor(rand() * maxMajor));
  const frac = String(Math.floor(rand() * 10 ** decimals)).padStart(decimals, '0');
  return `${whole}.${frac}`;
}
