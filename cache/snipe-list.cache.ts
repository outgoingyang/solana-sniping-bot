import fs from 'fs';
import path from 'path';
import { logger, SNIPE_LIST_REFRESH_INTERVAL } from '../helpers';

export class SnipeListCache {
  private snipeList: string[] = [];
  private fileLocation = path.join(__dirname, '../snipe-list.txt');

  constructor() {
    setInterval(() => this.loadSnipeList(), SNIPE_LIST_REFRESH_INTERVAL);
  }

  public init() {
    this.loadSnipeList();
  }

  public isInList(mint: string) {
    return this.snipeList.includes(mint);
  }

  /** Current list (for the dashboard settings panel). */
  public getSnipeList(): string[] {
    return [...this.snipeList];
  }

  /**
   * Replace the whole list: writes snipe-list.txt (one mint per line, atomic)
   * and hot-reloads the in-memory cache so new tokens are sniped immediately.
   */
  public setSnipeList(mints: string[]): string[] {
    const clean = Array.from(
      new Set(
        mints
          .map((m) => m.trim())
          .filter((m) => m.length > 0),
      ),
    );
    const content = clean.join('\n') + (clean.length ? '\n' : '');
    const tmp = this.fileLocation + '.tmp';
    try {
      fs.writeFileSync(tmp, content, 'utf-8');
      fs.renameSync(tmp, this.fileLocation);
      this.snipeList = clean;
      logger.info({ count: clean.length }, `Snipe list updated from dashboard`);
    } catch (error) {
      logger.warn({ error }, `Failed to write snipe list`);
      throw error;
    }
    return clean;
  }

  /** Force an immediate reload of snipe-list.txt from disk. */
  public refresh() {
    this.loadSnipeList();
  }

  private loadSnipeList() {
    logger.trace(`Refreshing snipe list...`);

    try {
      const data = fs.readFileSync(this.fileLocation, 'utf-8');
      this.snipeList = data
        .split('\n')
        .map((a) => a.trim())
        .filter((a) => a && !a.startsWith('#'));
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        this.snipeList = [];
        return;
      }
      logger.warn({ error }, `Failed to read snipe list, keeping previous one`);
      return;
    }

    logger.info(`Loaded snipe list: ${this.snipeList.length}`);
  }
}
