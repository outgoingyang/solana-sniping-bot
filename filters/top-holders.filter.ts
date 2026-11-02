import { Connection, PublicKey } from '@solana/web3.js';
import { LiquidityPoolKeysV4 } from '@raydium-io/raydium-sdk';
import { Filter, FilterResult } from './pool-filters';

/**
 * Whale concentration filter: rejects tokens where a single wallet
 * (excluding pool/authority accounts) holds more than MAX_TOP_HOLDER_PCT %
 * of the supply — the classic dump/rug vector.
 */
export class TopHoldersFilter implements Filter {
  private readonly cache = new Map<string, { at: number; result: FilterResult }>();
  private static readonly CACHE_TTL = 30_000;

  constructor(
    private readonly connection: Connection,
    private readonly maxTopHolderPct: number,
    private readonly topHolders: number,
  ) {}

  public async execute(poolKeysV4: LiquidityPoolKeysV4): Promise<FilterResult> {
    const mint = poolKeysV4.baseMint.toString();
    const cached = this.cache.get(mint);
    if (cached && Date.now() - cached.at < TopHoldersFilter.CACHE_TTL) {
      return cached.result;
    }

    const result = await this.evaluate(poolKeysV4.baseMint, poolKeysV4.baseVault, poolKeysV4.authority);
    this.cache.set(mint, { at: Date.now(), result });
    return result;
  }

  private async evaluate(mint: PublicKey, baseVault: PublicKey, ammAuthority: PublicKey): Promise<FilterResult> {
    try {
      const largest = await this.connection.getTokenLargestAccounts(mint);
      const supplyInfo = await this.connection.getTokenSupply(mint);

      const supply = Number(supplyInfo.value.amount);
      if (!supply) {
        return { ok: false, message: `${mint}/top-holders: zero supply` };
      }

      const excluded = new Set([baseVault.toString(), ammAuthority.toString()]);
      const holders = largest.value.slice(0, this.topHolders);

      for (const holder of holders) {
        const address = holder.address.toString();
        if (excluded.has(address)) {
          continue;
        }

        const pct = (Number(holder.amount) / supply) * 100;
        if (pct > this.maxTopHolderPct) {
          return {
            ok: false,
            message: `${mint}/top-holders: wallet ${address.slice(0, 8)}... holds ${pct.toFixed(1)}% > max ${this.maxTopHolderPct}%`,
          };
        }
      }

      return { ok: true, message: `${mint}/top-holders: top ${holders.length} holders concentration ok` };
    } catch (error) {
      return { ok: true, message: `${mint}/top-holders: check failed, allowing (${error})` };
    }
  }
}
