import fs from 'fs';
import { STATS_FILE } from './constants';
import { logger } from './logger';

export interface TradeRecord {
  time: string;
  mint: string;
  side: 'buy' | 'dip' | 'sell' | 'rug' | 'error';
  quoteAmount?: number;
  tokenAmount?: number;
  pnl?: number;
  signature?: string;
  note?: string;
}

/**
 * Append-only trade journal used for P&L tracking and post-run analysis.
 * Stored in STATS_FILE (default stats.json).
 */
export class TradeStats {
  private records: TradeRecord[] = [];

  constructor(private readonly file: string = STATS_FILE) {
    try {
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
        if (Array.isArray(parsed)) {
          this.records = parsed;
        }
      }
    } catch (error) {
      logger.trace({ error }, 'Failed to load stats file');
    }
  }

  public record(entry: TradeRecord) {
    this.records.push(entry);
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.records, null, 2));
    } catch (error) {
      logger.trace({ error }, 'Failed to persist stats');
    }
  }

  /** Prints cumulative P&L of all completed sell records. */
  public summarize() {
    const s = this.summary();
    logger.info(
      `Stats: ${s.sells} sells | wins: ${s.wins} | losses: ${s.losses} | win-rate: ${s.winRate}% | realized P&L: ${s.totalPnl.toFixed(6)} quote | total deployed: ${s.deployed.toFixed(6)}`,
    );
  }

  /** Machine-readable P&L summary for the dashboard. */
  public summary() {
    const sells = this.records.filter((r) => r.side === 'sell' || r.side === 'rug');
    const wins = sells.filter((r) => (r.pnl ?? 0) > 0).length;
    const losses = sells.filter((r) => (r.pnl ?? 0) < 0).length;
    const totalPnl = sells.reduce((acc, r) => acc + (r.pnl ?? 0), 0);
    const deployed = this.records
      .filter((r) => r.side === 'buy' || r.side === 'dip')
      .reduce((acc, r) => acc + (r.quoteAmount ?? 0), 0);

    return {
      sells: sells.length,
      wins,
      losses,
      winRate: sells.length ? Math.round((wins / sells.length) * 100) : 0,
      totalPnl,
      deployed,
    };
  }

  public getRecords(): readonly TradeRecord[] {
    return this.records;
  }
}
