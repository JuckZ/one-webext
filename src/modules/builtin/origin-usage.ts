export type ExactOriginUsageProbe = (_originPattern: string) => boolean | Promise<boolean>

export class BuiltinExactOriginUsageCoordinator {
  private readonly probes = new Map<string, ExactOriginUsageProbe>()

  register(owner: string, probe: ExactOriginUsageProbe) {
    if (!owner || this.probes.has(owner))
      throw new TypeError('A unique builtin origin-usage owner is required')
    this.probes.set(owner, probe)
    return () => this.probes.delete(owner)
  }

  async usedByAnother(owner: string, originPattern: string) {
    for (const [candidate, probe] of this.probes) {
      if (candidate !== owner && await probe(originPattern))
        return true
    }
    return false
  }
}
