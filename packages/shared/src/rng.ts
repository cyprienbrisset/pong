/**
 * Mulberry32 : petit PRNG déterministe, 32 bits d'état.
 *
 * La simulation ne doit jamais appeler Math.random(). Tout l'aléa (angle de
 * service, apparition et type des bonus) passe par ici, ce qui permet de
 * rejouer une partie à l'identique à partir de la graine et de la suite
 * d'entrées — indispensable pour reproduire un bug signalé par un joueur.
 */
export function nextRandom(seed: number): { value: number; seed: number } {
  let s = (seed + 0x6d2b79f5) | 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, seed: s };
}

/** Tirage dans [min, max[. */
export function randRange(seed: number, min: number, max: number) {
  const r = nextRandom(seed);
  return { value: min + r.value * (max - min), seed: r.seed };
}

/** Tirage d'un index dans [0, n[. */
export function randInt(seed: number, n: number) {
  const r = nextRandom(seed);
  return { value: Math.floor(r.value * n) % n, seed: r.seed };
}

export function makeSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}
