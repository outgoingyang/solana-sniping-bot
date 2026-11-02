import {
  BlockhashWithExpiryBlockHeight,
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from '@solana/web3.js';
import { TransactionExecutor } from './transaction-executor.interface';
import { logger } from '../helpers';
import axios, { AxiosError } from 'axios';
import bs58 from 'bs58';
import { JITO_DYNAMIC_TIP, JITO_TIP_PERCENTILE, MAX_JITO_TIP_SOL, MIN_JITO_TIP_SOL } from '../helpers/constants';

// https://jito-labs.gitbook.io/mev/searcher-resources/json-rpc-api-reference/bundles/gettipaccounts
// Verified current mainnet tip accounts (2026)
export const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

interface TipFloor {
  landed_tips_25th_percentile: number;
  landed_tips_50th_percentile: number;
  landed_tips_75th_percentile: number;
  landed_tips_95th_percentile: number;
  landed_tips_99th_percentile: number;
  ema_landed_tips_50th_percentile: number;
}

export interface JitoOptions {
  dynamicTip: boolean;
  tipPercentile: number;
  minTipSol: number;
  maxTipSol: number;
  /** extra regional endpoints to fan out to */
  regions?: string[];
}

export class JitoTransactionExecutor implements TransactionExecutor {
  private readonly endpoints: string[] = [];
  private tipFloorCache?: { at: number; floor: TipFloor };
  private tipLamportsOverride?: number;

  constructor(
    private readonly fallbackFeeSol: string,
    private readonly connection: Connection,
    private readonly options: JitoOptions = {
      dynamicTip: JITO_DYNAMIC_TIP,
      tipPercentile: JITO_TIP_PERCENTILE,
      minTipSol: MIN_JITO_TIP_SOL,
      maxTipSol: MAX_JITO_TIP_SOL,
    },
  ) {
    this.endpoints = [
      'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
      ...(options.regions ?? ['amsterdam', 'ny', 'tokyo']).map((r) => `https://${r}.mainnet.block-engine.jito.wtf/api/v1/bundles`),
    ];
  }

  public getRandomTipAccount(): PublicKey {
    const randomTip = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
    return new PublicKey(randomTip);
  }

  /** Tip account to embed in the swap transaction (Jito best practice: tip inside the main tx). */
  public setTipLamports(lamports: number) {
    this.tipLamportsOverride = lamports;
  }

  /** Fetches the current Jito tip floor for dynamic tip sizing, cached for 30s. */
  public async getTipFloor(): Promise<TipFloor | undefined> {
    if (this.tipFloorCache && Date.now() - this.tipFloorCache.at < 30_000) {
      return this.tipFloorCache.floor;
    }

    try {
      const res = await axios.get<TipFloor[]>('https://bundles.jito.wtf/api/v1/bundles/tip_floor', { timeout: 5000 });
      if (res.data?.length) {
        this.tipFloorCache = { at: Date.now(), floor: res.data[0] };
        return this.tipFloorCache.floor;
      }
    } catch (error) {
      logger.trace({ error }, 'Failed to fetch jito tip floor');
    }
    return undefined;
  }

  /** Recommended tip in lamports based on the current tip floor percentile. */
  public async computeTipLamports(): Promise<number> {
    if (this.tipLamportsOverride) {
      return this.tipLamportsOverride;
    }

    const minLamports = Math.max(Math.floor(this.options.minTipSol * 1_000_000_000), 1000);
    const maxLamports = Math.floor(this.options.maxTipSol * 1_000_000_000);

    if (!this.options.dynamicTip) {
      return minLamports;
    }

    const floor = await this.getTipFloor();
    if (!floor) {
      return minLamports;
    }

    const percentileSol =
      this.options.tipPercentile <= 25
        ? floor.landed_tips_25th_percentile
        : this.options.tipPercentile <= 50
          ? floor.landed_tips_50th_percentile
          : this.options.tipPercentile <= 75
            ? floor.landed_tips_75th_percentile
            : this.options.tipPercentile <= 95
              ? floor.landed_tips_95th_percentile
              : floor.landed_tips_99th_percentile;

    return Math.min(Math.max(Math.floor(percentileSol * 1_000_000_000), minLamports), maxLamports);
  }

  /**
   * Sends the transaction as a single-tx bundle (tip instruction must already be
   * part of the transaction, see Bot.swap) and confirms via getBundleStatuses.
   * Falls back to regular RPC confirmation.
   */
  public async executeAndConfirm(
    transaction: VersionedTransaction,
    payer: Keypair,
    latestBlockhash: BlockhashWithExpiryBlockHeight,
  ): Promise<{ confirmed: boolean; signature?: string; error?: string }> {
    logger.debug('Starting Jito bundle execution...');
    const signature = bs58.encode(transaction.signatures[0]);

    try {
      const serializedTransaction = bs58.encode(transaction.serialize());
      const requests = this.endpoints.map((url) =>
        axios.post(
          url,
          {
            jsonrpc: '2.0',
            id: 1,
            method: 'sendBundle',
            params: [[serializedTransaction]],
          },
          { timeout: 10000 },
        ),
      );

      const results = await Promise.allSettled(requests);
      let bundleId: string | undefined;
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.data?.result) {
          bundleId = result.value.data.result;
          break;
        }
        if (result.status === 'rejected') {
          logger.trace({ error: (result.reason as AxiosError)?.message }, 'Jito endpoint failed');
        }
      }

      if (!bundleId) {
        logger.debug({ signature }, 'No jito endpoint accepted the bundle, falling back to RPC confirmation');
        return await this.confirmViaRpc(signature, latestBlockhash);
      }

      logger.trace({ bundleId, signature }, 'Bundle accepted by jito block engine');
      return await this.confirmBundle(bundleId, signature, latestBlockhash);
    } catch (error) {
      if (error instanceof AxiosError) {
        logger.trace({ error: error.response?.data }, 'Failed to execute jito bundle');
      }
      logger.error({ error }, 'Error during jito transaction execution');
      return await this.confirmViaRpc(signature, latestBlockhash);
    }
  }

  private async confirmBundle(
    bundleId: string,
    signature: string,
    latestBlockhash: BlockhashWithExpiryBlockHeight,
  ): Promise<{ confirmed: boolean; signature?: string; error?: string }> {
    const deadline = Date.now() + 30_000;

    while (Date.now() < deadline) {
      try {
        // cross-check the signature directly — bundle status can lag behind
        const sigStatus = await this.connection.getSignatureStatus(signature, {
          searchTransactionHistory: false,
        });
        const sigValue = sigStatus?.value;
        if (sigValue && !sigValue.err && (sigValue.confirmationStatus === 'confirmed' || sigValue.confirmationStatus === 'finalized')) {
          logger.debug({ signature, slot: sigValue.slot }, 'Bundle transaction landed (rpc cross-check)');
          return { confirmed: true, signature };
        }

        const res = await axios.post(
          'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
          {
            jsonrpc: '2.0',
            id: 1,
            method: 'getBundleStatuses',
            params: [[bundleId]],
          },
          { timeout: 5000 },
        );

        const status = res.data?.result?.value?.[0];
        if (status) {
          // {"Ok":null} is Solana's success result — only treat real errors as failures
          const failed = status.err != null && JSON.stringify(status.err) !== '{"Ok":null}';
          if (status.confirmationStatus === 'finalized' || status.confirmationStatus === 'confirmed') {
            if (failed) {
              logger.debug({ bundleId, err: status.err }, 'Bundle landed with error');
              return { confirmed: false, signature, error: JSON.stringify(status.err) };
            }
            logger.debug({ bundleId, slot: status.slot }, 'Bundle landed');
            return { confirmed: true, signature };
          }
          if (failed) {
            return { confirmed: false, signature, error: JSON.stringify(status.err) };
          }
        }
      } catch (error) {
        logger.trace({ error }, 'getBundleStatuses poll failed');
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // last chance: check via RPC whether the tx still landed
    return this.confirmViaRpc(signature, latestBlockhash);
  }

  private async confirmViaRpc(signature: string, latestBlockhash: BlockhashWithExpiryBlockHeight) {
    // websocket confirmation first
    try {
      const confirmation = await this.connection.confirmTransaction(
        {
          signature,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          blockhash: latestBlockhash.blockhash,
        },
        this.connection.commitment,
      );

      return { confirmed: !confirmation.value.err, signature };
    } catch (error) {
      logger.trace({ error }, 'Websocket confirmation failed, falling back to signature polling');
    }

    // robust polling fallback (works even when websockets are flaky, e.g. public RPC)
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        const status = await this.connection.getSignatureStatus(signature, { searchTransactionHistory: false });
        const value = status?.value;
        if (value) {
          if (value.err) {
            return { confirmed: false, signature, error: JSON.stringify(value.err) };
          }
          if (value.confirmationStatus === 'confirmed' || value.confirmationStatus === 'finalized') {
            return { confirmed: true, signature };
          }
        }
      } catch (error) {
        logger.trace({ error }, 'Signature status poll failed');
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    return { confirmed: false, signature };
  }
}
