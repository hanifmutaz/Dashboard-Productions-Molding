/** In-memory login throttling (single Node process, ADR-001). 5 failures / 15 min per username+IP. */
export class LoginThrottle {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly max = 5, private readonly windowMs = 15 * 60_000) {}
  private key(user: string, ip: string) { return `${user.toLowerCase()}|${ip}`; }
  blocked(user: string, ip: string, now = Date.now()) {
    const k = this.key(user, ip);
    const list = (this.hits.get(k) ?? []).filter((t) => now - t < this.windowMs);
    this.hits.set(k, list);
    return list.length >= this.max;
  }
  fail(user: string, ip: string, now = Date.now()) {
    const k = this.key(user, ip);
    this.hits.set(k, [...(this.hits.get(k) ?? []), now]);
  }
  reset(user: string, ip: string) { this.hits.delete(this.key(user, ip)); }
}
