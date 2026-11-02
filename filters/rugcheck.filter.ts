import { Connection } from '@solana/web3.js';
import axios from 'axios';
import { LiquidityPoolKeysV4 } from '@raydium-io/raydium-sdk';
import { Filter, FilterResult } from './pool-filters';
import { RUGCHECK_FAIL_ON_CRITICAL, RUGCHECK_MAX_SCORE, RUGCHECK_MIN_LP_LOCKED } from '../helpers/constants';
import { logger } from '../helpers/logger';

interface RugCheckSummary {
  risks: { name: string; value?: string; description?: string; score: number; level: string }[];
  score: number;
  score_normalised: number;
  lpLockedPct?: number;
}

/**
 * Deep token analysis via RugCheck.xyz (https://api.rugcheck.xyz).
 * Checks overall risk score, LP lock percentage and critical risks
 * (mint authority, freeze, LP unlocked, insider concentration, etc.)
 */
export class RugCheckFilter implements Filter {
  private readonly cache = new Map<string, { at: number; summary?: RugCheckSummary }>();
  private static readonly CACHE_TTL = 60_000;

  constructor(private readonly maxScore: number, private readonly minLpLockedPct: number, private readonly failOnCritical: boolean) {}

  public async execute(poolKeysV4: LiquidityPoolKeysV4): Promise<FilterResult> {
    const mint = poolKeysV4.baseMint.toString();
    const cached = this.cache.get(mint);
    if (cached && Date.now() - cached.at < RugCheckFilter.CACHE_TTL) {
      return this.evaluate(mint, cached.summary);
    }

    let summary: RugCheckSummary | undefined;
    try {
      const res = await axios.get<RugCheckSummary>(`https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`, {
        timeout: 10_000,
        headers: { accept: 'application/json' },
      });
      summary = res.data;
    } catch (error) {
      logger.trace({ mint, error }, 'RugCheck request failed');
    }

    this.cache.set(mint, { at: Date.now(), summary });
    return this.evaluate(mint, summary);
  }

  private evaluate(mint: string, summary?: RugCheckSummary): FilterResult {
    if (!summary) {
      // API unavailable: do not block trading because of our own infrastructure
      return { ok: true, message: `${mint}/rugcheck: report unavailable, allowing` };
    }

    if (summary.score > this.maxScore) {
      return {
        ok: false,
        message: `${mint}/rugcheck: risk score ${summary.score} (normalised ${summary.score_normalised}) exceeds max ${this.maxScore}`,
      };
    }

    if (this.minLpLockedPct > 0 && (summary.lpLockedPct ?? 0) < this.minLpLockedPct) {
      return {
        ok: false,
        message: `${mint}/rugcheck: LP locked ${summary.lpLockedPct ?? 0}% < required ${this.minLpLockedPct}%`,
      };
    }

    if (this.failOnCritical) {
      const critical = summary.risks?.find((r) => r.level === 'danger');
      if (critical) {
        return { ok: false, message: `${mint}/rugcheck: critical risk "${critical.name}" (${critical.description ?? ''})` };
      }
    }

    return {
      ok: true,
      message: `${mint}/rugcheck: score ${summary.score} (normalised ${summary.score_normalised}), LP locked ${summary.lpLockedPct ?? '?'}%`,
    };
  }
}
