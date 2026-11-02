import { Connection, PublicKey } from '@solana/web3.js';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import { logger } from '../helpers';

// Pump.fun bonding curve program (2026: still the main token launch venue)
export const PUMP_FUN_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvf6ubYBDxCPu7Kp2axS');

export interface PumpCreateEvent {
  name: string;
  symbol: string;
  uri: string;
  mint: PublicKey;
  bondingCurve: PublicKey;
  user: PublicKey;
  creator?: PublicKey;
  timestamp: bigint;
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  tokenTotalSupply: bigint;
  signature: string;
}

const PROGRAM_DATA_PREFIX = 'Program data: ';

/**
 * Listens to Pump.fun launch events in real time and emits decoded
 * `create` events (new token launches). The mint is validated by
 * deriving the bonding-curve PDA from it, so a corrupted decode
 * can never trigger a buy of the wrong token.
 */
export class PumpFunListener extends EventEmitter {
  private subscriptionId?: number;
  private readonly createDiscriminator = crypto.createHash('sha256').update('event:Create').digest().subarray(0, 8);
  private readonly seenSignatures = new Set<string>([]);
  private lastNotificationAt = 0;
  private watchdog?: NodeJS.Timeout;

  constructor(private readonly connection: Connection) {
    super();
  }

  public async start(commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed') {
    await this.subscribe(commitment);

    // watchdog: pump.fun always has traffic, so silence means a dead
    // subscription (typical for rate-limited/public RPC) — resubscribe
    this.watchdog = setInterval(async () => {
      if (this.lastNotificationAt && Date.now() - this.lastNotificationAt > 60_000) {
        logger.warn(`Pump.fun subscription silent for 60s, resubscribing...`);
        try {
          await this.stop();
          await this.subscribe(commitment);
        } catch (error) {
          logger.error({ error }, `Pump.fun resubscribe failed`);
        }
      }
    }, 30_000);
  }

  private async subscribe(commitment: 'processed' | 'confirmed' | 'finalized') {
    this.lastNotificationAt = Date.now();
    this.subscriptionId = await this.connection.onLogs(
      PUMP_FUN_PROGRAM,
      async ({ logs, err, signature }) => {
        this.lastNotificationAt = Date.now();
        if (err) return;
        if (this.seenSignatures.has(signature)) return;
        this.seenSignatures.add(signature);
        if (this.seenSignatures.size > 5000) {
          this.seenSignatures.clear();
        }

        for (const log of logs) {
          if (!log.startsWith(PROGRAM_DATA_PREFIX)) continue;
          const data = Buffer.from(log.slice(PROGRAM_DATA_PREFIX.length), 'base64');
          if (data.length < 8 || !data.subarray(0, 8).equals(this.createDiscriminator)) continue;

          const event = this.decodeCreate(data.subarray(8), signature);
          if (event && this.validate(event)) {
            logger.debug(
              { mint: event.mint.toString(), symbol: event.symbol, name: event.name },
              `Pump.fun launch detected`,
            );
            this.emit('create', event);
          }
        }
      },
      commitment,
    );
  }

  public async stop() {
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = undefined;
    }
    if (this.subscriptionId !== undefined) {
      await this.connection.removeOnLogsListener(this.subscriptionId);
      this.subscriptionId = undefined;
    }
  }

  private decodeCreate(data: Buffer, signature: string): PumpCreateEvent | undefined {
    try {
      let offset = 0;

      const readString = () => {
        const len = data.readUInt32LE(offset);
        offset += 4;
        const value = data.subarray(offset, offset + len).toString('utf-8');
        offset += len;
        return value;
      };

      const name = readString();
      const symbol = readString();
      const uri = readString();

      const mint = new PublicKey(data.subarray(offset, offset + 32));
      offset += 32;
      const bondingCurve = new PublicKey(data.subarray(offset, offset + 32));
      offset += 32;
      const user = new PublicKey(data.subarray(offset, offset + 32));
      offset += 32;

      // optional `creator` field present in newer versions
      let creator: PublicKey | undefined;
      const remaining = data.length - offset;
      if (remaining === 40 + 32) {
        creator = new PublicKey(data.subarray(offset, offset + 32));
        offset += 32;
      } else if (remaining !== 40) {
        return undefined;
      }

      const timestamp = data.readBigInt64LE(offset);
      offset += 8;
      const virtualTokenReserves = data.readBigUInt64LE(offset);
      offset += 8;
      const virtualSolReserves = data.readBigUInt64LE(offset);
      offset += 8;
      const realTokenReserves = data.readBigUInt64LE(offset);
      offset += 8;
      const tokenTotalSupply = data.readBigUInt64LE(offset);
      offset += 8;

      return {
        name,
        symbol,
        uri,
        mint,
        bondingCurve,
        user,
        creator,
        timestamp,
        virtualTokenReserves,
        virtualSolReserves,
        realTokenReserves,
        tokenTotalSupply,
        signature,
      };
    } catch (error) {
      logger.trace({ error }, 'Failed to decode pump.fun CreateEvent');
      return undefined;
    }
  }

  /** Bonds the decoded mint to its bonding-curve PDA — guards against bad decodes. */
  private validate(event: PumpCreateEvent): boolean {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('bonding-curve'), event.mint.toBuffer()],
      PUMP_FUN_PROGRAM,
    );
    return pda.equals(event.bondingCurve);
  }
}
