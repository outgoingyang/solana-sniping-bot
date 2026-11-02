import { Connection, PublicKey } from '@solana/web3.js';
import { MAX_PRIORITY_FEE, MIN_PRIORITY_FEE } from './constants';
import { logger } from './logger';

export interface LockedAccounts {
  writable: PublicKey[];
  readonly: PublicKey[];
}

/**
 * Dynamic priority fee estimation based on recent network prioritization fees.
 * Picks the requested percentile of recent paid fees so snipes stay competitive
 * without overpaying during quiet periods.
 */
export async function computePriorityFee(
  connection: Connection,
  percentile: number,
  lockedAccounts: LockedAccounts = { writable: [], readonly: [] },
): Promise<number> {
  try {
    const fees = await connection.getRecentPrioritizationFees({
      lockedWritableAccounts: lockedAccounts.writable.slice(0, 30),
    });

    if (!fees.length) {
      return MIN_PRIORITY_FEE;
    }

    const prices = fees.map((f) => f.prioritizationFee).sort((a, b) => a - b);
    const idx = Math.min(prices.length - 1, Math.max(0, Math.floor((percentile / 100) * (prices.length - 1))));
    const fee = Math.max(prices[idx], MIN_PRIORITY_FEE);

    return Math.min(fee, MAX_PRIORITY_FEE);
  } catch (error) {
    logger.trace({ error }, 'Failed to compute dynamic priority fee, using fallback');
    return MIN_PRIORITY_FEE;
  }
}
