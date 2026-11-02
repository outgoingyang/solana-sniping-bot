import axios from 'axios';
import { PublicKey } from '@solana/web3.js';
import {
  SCANNER_MAX_DEV_PCT,
  SCANNER_MAX_TOKEN_AGE_MIN,
  SCANNER_MIN_HOLDERS,
  SCANNER_MIN_LIQUIDITY_USD,
  SCANNER_MIN_MOMENTUM_5M,
  SCANNER_POLL_INTERVAL,
} from '../helpers/constants';
import { logger } from '../helpers/logger';

export interface ScannerToken {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  liquidity: number;
  usdPrice: number;
  holderCount: number;
  organicScore: number;
  createdAt: string;
  stats5m?: { priceChange?: number };
  audit?: {
    mintAuthorityDisabled?: boolean;
    freezeAuthorityDisabled?: boolean;
    devBalancePercentage?: number;
  };
}

/**
 * Momentum scanner: polls the Jupiter Token API over plain HTTPS (no
 * websockets required — works even on free/public RPC) and surfaces fresh
 * tokens with strong 5-minute momentum, healthy liquidity and clean audit
 * flags. Buys are routed through Jupiter and managed by the Jupiter monitor.
 */
export class MomentumScanner {
  private readonly seen = new Set<string>();

  constructor(private readonly onToken: (token: ScannerToken) => void | Promise<void>) {}

  public start() {
    const poll = async () => {
      try {
        const res = await axios.get<ScannerToken[]>('https://api.jup.ag/tokens/v2/recent', { timeout: 10_000 });
        const tokens = Array.isArray(res.data) ? res.data : [];

        for (const token of tokens) {
          if (this.seen.has(token.id)) continue;
          this.seen.add(token.id);
          if (this.seen.size > 5000) this.seen.clear();

          const verdict = this.evaluate(token);
          logger.trace({ token: token.symbol, verdict: verdict.reasons }, verdict.ok ? `Scanner candidate` : `Scanner rejected`);
          if (verdict.ok) {
            logger.info(
              { symbol: token.symbol, mint: token.id, liquidity: Math.round(token.liquidity), momentum: token.stats5m?.priceChange?.toFixed(1) },
              `SCANNER: momentum candidate found`,
            );
            await this.onToken(token);
          }
        }
      } catch (error) {
        logger.trace({ error }, `Scanner poll failed`);
      }
    };

    void poll();
    const timer = setInterval(poll, Math.max(SCANNER_POLL_INTERVAL, 5000));
    return () => clearInterval(timer);
  }

  public evaluate(token: ScannerToken): { ok: boolean; reasons: string[] } {
    const reasons: string[] = [];

    if (token.liquidity < SCANNER_MIN_LIQUIDITY_USD) {
      reasons.push(`liquidity $${Math.round(token.liquidity)} < $${SCANNER_MIN_LIQUIDITY_USD}`);
    }

    const momentum = token.stats5m?.priceChange;
    if (momentum === undefined || momentum < SCANNER_MIN_MOMENTUM_5M) {
      reasons.push(`5m momentum ${momentum?.toFixed(1) ?? '?'}% < ${SCANNER_MIN_MOMENTUM_5M}%`);
    }

    if (SCANNER_MIN_HOLDERS > 0 && (token.holderCount ?? 0) < SCANNER_MIN_HOLDERS) {
      reasons.push(`holders ${token.holderCount ?? 0} < ${SCANNER_MIN_HOLDERS}`);
    }

    if (SCANNER_MAX_DEV_PCT >= 0 && (token.audit?.devBalancePercentage ?? 0) > SCANNER_MAX_DEV_PCT) {
      reasons.push(`dev holds ${(token.audit?.devBalancePercentage ?? 0).toFixed(1)}% > ${SCANNER_MAX_DEV_PCT}%`);
    }

    if (token.audit && token.audit.mintAuthorityDisabled === false) {
      reasons.push(`mint authority not revoked`);
    }
    if (token.audit && token.audit.freezeAuthorityDisabled === false) {
      reasons.push(`freeze authority not revoked`);
    }

    if (SCANNER_MAX_TOKEN_AGE_MIN > 0) {
      const ageMin = (Date.now() - new Date(token.createdAt).getTime()) / 60_000;
      if (ageMin > SCANNER_MAX_TOKEN_AGE_MIN) {
        reasons.push(`age ${Math.round(ageMin)}m > ${SCANNER_MAX_TOKEN_AGE_MIN}m`);
      }
    }

    return { ok: reasons.length === 0, reasons };
  }

  public toPublicKey(token: ScannerToken): PublicKey {
    return new PublicKey(token.id);
  }
}
