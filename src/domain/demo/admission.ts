/** One process-wide ceiling, not an unbounded map of spoofable client IPs.
 * Reserve synchronously before any creation await. Restarts reset this local
 * allowance; a hosted gateway should provide its own shared admission limit. */
const reservations: number[] = [];

export function reserveDemoSample(now = Date.now()): boolean {
  while (reservations.length && reservations[0] <= now - 3_600_000) reservations.shift();
  if (reservations.length >= 12 || reservations.filter(at => at > now - 60_000).length >= 3) return false;
  reservations.push(now);
  return true;
}
