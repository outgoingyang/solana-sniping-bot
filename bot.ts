import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAccount,
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  RawAccount,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Liquidity, LiquidityPoolKeysV4, LiquidityStateV4, Percent, Token, TokenAmount } from '@raydium-io/raydium-sdk';
import { MarketCache, PoolCache, SnipeListCache } from './cache';
import { PoolFilters } from './filters';
import { TransactionExecutor } from './transactions';
import { createPoolKeys, getWallet, isNativeSolMode, logger, NETWORK, sleep } from './helpers';
import { Semaphore } from 'async-mutex';
import BN from 'bn.js';
import { WarpTransactionExecutor } from './transactions/warp-transaction-executor';
import { JitoTransactionExecutor } from './transactions/jito-rpc-transaction-executor';
import { JupiterClient } from './routes/jupiter';
import { computePriorityFee } from './helpers/priority-fees';
import { runtime } from './helpers/runtime';
import { TradeStats } from './helpers/stats';
import {
  BUY_EXECUTION,
  BUY_THE_DIP,
  DIP_AMOUNT_MULTIPLIER,
  DIP_COOLDOWN_MS,
  DIP_MAX_BUYS,
  DIP_TRIGGER_PCT,
  DYNAMIC_PRIORITY_FEES,
  LIQUIDITY_DROP_PCT,
  MIN_SOL_BUFFER,
  PRIORITY_FEE_PERCENTILE,
  PUMP_AUTO_BUY_DELAY,
  PUMP_MIN_INITIAL_SOL,
  QUOTE_AMOUNT_MODE,
  QUOTE_AMOUNT_PERCENT,
  RUG_CHECK,
  RUG_SLIPPAGE,
  RUGCHECK_FAIL_ON_CRITICAL,
  RUGCHECK_MAX_SCORE,
  RUGCHECK_MIN_LP_LOCKED,
  RUG_PULL_PROTECTION,
  SELL_EXECUTION,
  SNIPE_PUMP_FUN,
  QUOTE_MINT,
  STATS_FILE,
  WRAP_SOL_AT_START,
} from './helpers/constants';
import { RugCheckFilter } from './filters/rugcheck.filter';
import { PumpCreateEvent } from './listeners/pump-fun-listener';

export interface BotConfig {
  wallet: Keypair;
  minPoolSize: TokenAmount;
  maxPoolSize: TokenAmount;
  quoteToken: Token;
  quoteAmount: TokenAmount;
  quoteAta: PublicKey;
  maxTokensAtTheTime: number;
  useSnipeList: boolean;
  autoSell: boolean;
  autoBuyDelay: number;
  autoSellDelay: number;
  maxBuyRetries: number;
  maxSellRetries: number;
  unitLimit: number;
  unitPrice: number;
  takeProfit: number;
  stopLoss: number;
  trailingStopLoss: boolean;
  skipSellingIfLostMoreThan: number;
  buySlippage: number;
  sellSlippage: number;
  priceCheckInterval: number;
  priceCheckDuration: number;
  filterCheckInterval: number;
  filterCheckDuration: number;
  consecutiveMatchCount: number;
}

interface PositionState {
  ata: PublicKey;
  quoteSpent: number; // decimal-adjusted quote units put into this token
  tokensAtEntry: number;
  stopLoss?: TokenAmount;
  dipsUsed: number;
  lastDipAt: number;
  monitoring: boolean;
  baselineLiquidity?: number;
}

export class Bot {
  private readonly snipeListCache?: SnipeListCache;

  private readonly semaphore: Semaphore;
  private sellExecutionCount = 0;
  private readonly stopLoss = new Map<string, TokenAmount>();
  private readonly positions = new Map<string, PositionState>();
  private readonly jupiter = new JupiterClient();
  private readonly stats = new TradeStats(STATS_FILE);
  private readonly pumpSeen = new Set<string>();
  public readonly isWarp: boolean = false;
  public readonly isJito: boolean = false;
  /** Dashboard pause switch: when true, new buys are skipped (sells keep working). */
  public paused = false;

  constructor(
    private readonly connection: Connection,
    private readonly marketStorage: MarketCache,
    private readonly poolStorage: PoolCache,
    private readonly txExecutor: TransactionExecutor,
    readonly config: BotConfig,
  ) {
    this.isWarp = txExecutor instanceof WarpTransactionExecutor;
    this.isJito = txExecutor instanceof JitoTransactionExecutor;
    this.semaphore = new Semaphore(config.maxTokensAtTheTime);

    // always available so the dashboard can toggle "snipe only my list" live
    this.snipeListCache = new SnipeListCache();
    this.snipeListCache.init();
  }

  async validate() {
    // keep a WSOL balance ready at startup (wrapped 1:1 from SOL, zero fees)
    if (WRAP_SOL_AT_START > 0) {
      try {
        const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, this.config.wallet.publicKey);
        const balance = await this.connection.getTokenAccountBalance(wsolAta).catch(() => null);
        const current = balance?.value.uiAmount ?? 0;

        if (current < WRAP_SOL_AT_START) {
          const deficitLamports = Math.ceil((WRAP_SOL_AT_START - current) * 1_000_000_000);
          const latestBlockhash = await this.connection.getLatestBlockhash();
          const tx = new VersionedTransaction(
            new TransactionMessage({
              payerKey: this.config.wallet.publicKey,
              recentBlockhash: latestBlockhash.blockhash,
              instructions: [
                createAssociatedTokenAccountIdempotentInstruction(
                  this.config.wallet.publicKey,
                  wsolAta,
                  this.config.wallet.publicKey,
                  NATIVE_MINT,
                ),
                SystemProgram.transfer({
                  fromPubkey: this.config.wallet.publicKey,
                  toPubkey: wsolAta,
                  lamports: deficitLamports,
                }),
                createSyncNativeInstruction(wsolAta),
              ],
            }).compileToV0Message(),
          );
          tx.sign([this.config.wallet]);
          const signature = await this.connection.sendRawTransaction(tx.serialize());
          await this.connection.confirmTransaction({ signature, ...latestBlockhash }, 'confirmed');
          logger.info(
            { signature, wsolAta: wsolAta.toString(), wrappedSOL: deficitLamports / 1e9 },
            `Wrapped SOL -> WSOL at startup`,
          );
        } else {
          logger.info({ wsolBalance: current }, `WSOL balance is sufficient`);
        }
      } catch (error) {
        logger.warn({ error }, `Startup SOL wrap failed, continuing`);
      }
    }

    if (isNativeSolMode(QUOTE_MINT)) {
      try {
        // make sure the WSOL ATA exists so the Raydium path can use it
        const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, this.config.wallet.publicKey);
        await getAccount(this.connection, wsolAta, this.connection.commitment);
        logger.info({ wsolAta: wsolAta.toString() }, `WSOL token account confirmed`);
      } catch (error) {
        logger.warn(`WSOL token account not found, Jupiter routing will handle wrapping automatically`);
      }
      return true;
    }

    try {
      await getAccount(this.connection, this.config.quoteAta, this.connection.commitment);
    } catch (error) {
      logger.error(
        `${this.config.quoteToken.symbol} token account not found in wallet: ${this.config.wallet.publicKey.toString()}`,
      );
      return false;
    }

    return true;
  }

  /**
   * Hot-swap the wallet at runtime (dashboard "Add wallet").
   * Validates the key, re-points quoteAta, re-wraps WSOL for the new wallet.
   */
  public async switchWallet(privateKey: string): Promise<PublicKey> {
    const next = getWallet(privateKey.trim());
    this.config.wallet = next;
    this.config.quoteAta = getAssociatedTokenAddressSync(this.config.quoteToken.mint, next.publicKey);
    logger.info({ wallet: next.publicKey.toString() }, `Wallet switched via dashboard`);

    // prepare the new wallet: wrap WSOL buffer + confirm quote ATA
    await this.validate();
    return next.publicKey;
  }

  /** Current snipe list (dashboard view). */
  public snipeList(): string[] {
    return this.snipeListCache?.getSnipeList() ?? [];
  }

  /** Replace the snipe list from the dashboard and hot-reload the cache. */
  public saveSnipeList(mints: string[]): string[] {
    return this.snipeListCache?.setSnipeList(mints) ?? [];
  }

  /** Resolve the actual quote amount to spend, supporting percent-of-wallet mode. */
  private async resolveQuoteAmount(): Promise<TokenAmount> {
    if (runtime.quoteAmountMode !== 'percent') {
      return this.config.quoteAmount;
    }

    let rawBalance = BigInt(0);

    if (this.config.quoteToken.mint.equals(NATIVE_MINT)) {
      const lamports = await this.connection.getBalance(this.config.wallet.publicKey, this.connection.commitment);
      const buffer = BigInt(Math.floor(runtime.minSolBuffer * 1_000_000_000));
      rawBalance = lamports > buffer ? BigInt(lamports) - buffer : BigInt(0);
    } else {
      const account = await this.connection.getTokenAccountBalance(this.config.quoteAta);
      rawBalance = BigInt(account.value.amount);
    }

    const spendable = (rawBalance * BigInt(Math.max(1, Math.round(runtime.quoteAmountPercent)))) / BigInt(100);
    logger.debug({ spendable: spendable.toString() }, `Percent mode: spending ${runtime.quoteAmountPercent}% of wallet quote balance`);
    return new TokenAmount(this.config.quoteToken, spendable, true);
  }

  public async buy(accountId: PublicKey, poolState: LiquidityStateV4, quoteAmountOverride?: TokenAmount) {
    logger.trace({ mint: poolState.baseMint }, `Processing new pool...`);

    if (runtime.useSnipeList && !this.snipeListCache?.isInList(poolState.baseMint.toString())) {
      logger.debug({ mint: poolState.baseMint.toString() }, `Skipping buy because token is not in a snipe list`);
      return;
    }

    if (this.paused) {
      logger.debug({ mint: poolState.baseMint.toString() }, `Skipping buy: paused from dashboard`);
      return;
    }

    if (this.config.autoBuyDelay > 0) {
      logger.debug({ mint: poolState.baseMint }, `Waiting for ${this.config.autoBuyDelay} ms before buy`);
      await sleep(this.config.autoBuyDelay);
    }

    const numberOfActionsBeingProcessed =
      this.config.maxTokensAtTheTime - this.semaphore.getValue() + this.sellExecutionCount;
    if (this.semaphore.isLocked() || numberOfActionsBeingProcessed >= this.config.maxTokensAtTheTime) {
      logger.debug(
        { mint: poolState.baseMint.toString() },
        `Skipping buy because max tokens to process at the same time is ${this.config.maxTokensAtTheTime} and currently ${numberOfActionsBeingProcessed} tokens is being processed`,
      );
      return;
    }

    await this.semaphore.acquire();

    try {
      const [market, mintAta] = await Promise.all([
        this.marketStorage.get(poolState.marketId.toString()),
        getAssociatedTokenAddress(poolState.baseMint, this.config.wallet.publicKey),
      ]);
      const poolKeys: LiquidityPoolKeysV4 = createPoolKeys(accountId, poolState, market);

      if (!runtime.useSnipeList) {
        const match = await this.filterMatch(poolKeys);

        if (!match) {
          logger.trace({ mint: poolKeys.baseMint.toString() }, `Skipping buy because pool doesn't match filters`);
          return;
        }
      }

      const quoteAmount = quoteAmountOverride ?? (await this.resolveQuoteAmount());
      const tokenOut = new Token(TOKEN_PROGRAM_ID, poolKeys.baseMint, poolKeys.baseDecimals);
      const canUseRaydium = BUY_EXECUTION !== 'jupiter';

      let confirmed = false;
      let signature: string | undefined;
      let lastError: string | undefined;

      // Primary: direct Raydium AMM v4 route (lowest latency for fresh pools)
      if (canUseRaydium) {
        for (let i = 0; i < this.config.maxBuyRetries && !confirmed; i++) {
          try {
            logger.info(
              { mint: poolState.baseMint.toString() },
              `Send buy transaction attempt: ${i + 1}/${this.config.maxBuyRetries}`,
            );
            const result = await this.swap(
              poolKeys,
              this.config.quoteAta,
              mintAta,
              this.config.quoteToken,
              tokenOut,
              quoteAmount,
              this.config.buySlippage,
              this.config.wallet,
              'buy',
            );

            if (result.confirmed) {
              confirmed = true;
              signature = result.signature;
              break;
            }

            lastError = result.error;
            logger.info(
              { mint: poolState.baseMint.toString(), signature: result.signature, error: result.error },
              `Error confirming buy tx`,
            );
          } catch (error) {
            logger.debug({ mint: poolState.baseMint.toString(), error }, `Error confirming buy transaction`);
          }
        }
      }

      // Fallback: Jupiter aggregation across all DEXes (Raydium CPMM/CLMM, Orca,
      // Meteora DLMM/DAMM, Pump.fun, Pump AMM, Whirlpool, ...). Handles tokens
      // without an OpenBook V4 market and works with any input amount.
      if (!confirmed && (BUY_EXECUTION === 'jupiter' || BUY_EXECUTION === 'auto')) {
        logger.info({ mint: poolState.baseMint.toString() }, `Falling back to Jupiter aggregated buy`);
        const result = await this.swapViaJupiter(
          this.config.quoteToken.mint.toString(),
          poolKeys.baseMint.toString(),
          quoteAmount.raw.toString(),
          this.config.buySlippage,
          'buy',
        );
        confirmed = result.confirmed;
        signature = result.signature;
        lastError = result.error;
      }

      if (confirmed && signature) {
        logger.info(
          {
            mint: poolState.baseMint.toString(),
            signature,
            url: `https://solscan.io/tx/${signature}?cluster=${NETWORK}`,
          },
          `Confirmed buy tx`,
        );

        await this.onBuyConfirmed(poolState.baseMint, mintAta, quoteAmount, signature);
      } else {
        logger.info({ mint: poolState.baseMint.toString(), error: lastError }, `Buy failed on all routes`);
      }
    } catch (error) {
      logger.error({ mint: poolState.baseMint.toString(), error }, `Failed to buy token`);
    } finally {
      this.semaphore.release();
    }
  }

  /** Shared post-buy bookkeeping: register position + trade journal entry. */
  private async onBuyConfirmed(mint: PublicKey, mintAta: PublicKey, quoteAmount: TokenAmount, signature: string) {
    let tokensBought = 0;
    let decimals = 9;
    try {
      const balance = await this.connection.getTokenAccountBalance(mintAta);
      tokensBought = Number(balance.value.amount);
      decimals = balance.value.decimals;
    } catch {
      // token account may not be readable yet, ignore
    }

    this.positions.set(mint.toString(), {
      ata: mintAta,
      quoteSpent: Number(quoteAmount.toFixed()),
      tokensAtEntry: tokensBought / Math.pow(10, decimals),
      dipsUsed: 0,
      lastDipAt: 0,
      monitoring: false,
    });

    this.stats.record({
      time: new Date().toISOString(),
      mint: mint.toString(),
      side: 'buy',
      quoteAmount: Number(quoteAmount.toFixed()),
      signature,
    });
  }

  /**
   * Core Jupiter buy used by pump.fun sniping and the momentum scanner:
   * semaphore + deep analysis (RugCheck) + routed swap + position registration.
   */
  public async buyTokenViaJupiter(mint: PublicKey, label: string): Promise<boolean> {
    const mintStr = mint.toString();

    if (this.paused) {
      logger.debug({ mint: mintStr }, `Skipping buy: paused from dashboard`);
      return false;
    }

    // "only my list" mode: the scanner/pump flows only buy tokens from the list
    if (runtime.useSnipeList && !this.snipeListCache?.isInList(mintStr)) {
      logger.debug({ mint: mintStr }, `Skipping buy: snipe list mode is on and token is not in the list`);
      return false;
    }

    const numberOfActionsBeingProcessed =
      this.config.maxTokensAtTheTime - this.semaphore.getValue() + this.sellExecutionCount;
    if (this.semaphore.isLocked() || numberOfActionsBeingProcessed >= this.config.maxTokensAtTheTime) {
      logger.debug({ mint: mintStr }, `Skipping buy: max concurrent tokens reached`);
      return false;
    }

    await this.semaphore.acquire();

    try {
      // deep analysis before spending: RugCheck report
      if (RUG_CHECK) {
        const rugFilter = new RugCheckFilter(runtime.rugcheckMaxScore, runtime.rugcheckMinLpLocked, runtime.rugcheckFailOnCritical);
        const check = await rugFilter.execute({ baseMint: mint } as unknown as LiquidityPoolKeysV4);
        if (!check.ok) {
          logger.info({ mint: mintStr, message: check.message }, `Skipping buy: rugcheck rejected`);
          return false;
        }
      }

      const quoteAmount = await this.resolveQuoteAmount();
      const mintAta = getAssociatedTokenAddressSync(mint, this.config.wallet.publicKey);
      const inputMint = isNativeSolMode(QUOTE_MINT) ? NATIVE_MINT.toString() : this.config.quoteToken.mint.toString();

      logger.info({ mint: mintStr, symbol: label }, `Sending snipe buy via Jupiter...`);
      const result = await this.swapViaJupiter(
        inputMint,
        mintStr,
        quoteAmount.raw.toString(),
        this.config.buySlippage,
        'buy',
      );

      if (result.confirmed && result.signature) {
        logger.info(
          {
            mint: mintStr,
            symbol: label,
            signature: result.signature,
            url: `https://solscan.io/tx/${result.signature}?cluster=${NETWORK}`,
          },
          `Confirmed buy tx`,
        );
        await this.onBuyConfirmed(mint, mintAta, quoteAmount, result.signature);
        return true;
      } else {
        logger.info({ mint: mintStr, error: result.error }, `Buy failed`);
        return false;
      }
    } catch (error) {
      logger.error({ mint: mintStr, error }, `Failed to buy token`);
      return false;
    } finally {
      this.semaphore.release();
    }
  }

  /**
   * "Only my list" mode: buys every token from the snipe list right now
   * (triggered by the dashboard START button) and puts each purchased token
   * through the same take-profit / stop-loss / rug-protection lifecycle as
   * real-time sniped tokens.
   */
  public async buySnipeListNow(): Promise<number> {
    const mints = this.snipeList();
    if (!mints.length) {
      logger.warn(`Snipe list mode: START pressed but the snipe list is empty`);
      return 0;
    }

    logger.info({ count: mints.length }, `Snipe list mode: buying listed tokens now...`);
    let bought = 0;

    for (const m of mints) {
      if (this.paused) {
        logger.info(`Snipe list buy paused, stopping list run`);
        break;
      }

      if (this.positions.has(m)) {
        logger.debug({ mint: m }, `Snipe list: already holding/monitoring this token, skipping`);
        continue;
      }

      let mint: PublicKey;
      try {
        mint = new PublicKey(m);
      } catch {
        logger.warn({ mint: m }, `Snipe list: invalid mint address, skipping`);
        continue;
      }

      const symbol = m.slice(0, 4) + '…' + m.slice(-4);
      const ok = await this.buyTokenViaJupiter(mint, symbol);
      if (ok) {
        bought++;
        await this.startMonitoringFor(m.toString());
      }
    }

    logger.info({ bought, total: mints.length }, `Snipe list run finished`);
    return bought;
  }

  /**
   * Starts the position monitor for an already-bought token manually
   * (used by snipe-list buys where the wallet listener may not fire).
   */
  public async startMonitoringFor(mintStr: string) {
    const position = this.positions.get(mintStr);
    if (!position || position.monitoring) {
      return;
    }

    position.monitoring = true;
    try {
      const balance = await this.connection.getTokenAccountBalance(position.ata);
      const decimals = balance.value.decimals;
      const tokenIn = new Token(TOKEN_PROGRAM_ID, new PublicKey(mintStr), decimals);

      const poolData = await this.poolStorage.get(mintStr);
      if (poolData) {
        const market = await this.marketStorage.get(poolData.state.marketId.toString());
        const poolKeys: LiquidityPoolKeysV4 = createPoolKeys(new PublicKey(poolData.id), poolData.state, market);
        await this.runPositionMonitor(poolKeys, position.ata, tokenIn, position);
      } else {
        // no Raydium AMM v4 pool (pump.fun bonding curve etc.) — Jupiter monitor
        await this.runJupiterMonitor(mintStr, position.ata, position, decimals);
      }
    } catch (error) {
      logger.warn({ mint: mintStr, error }, `Failed to start position monitor`);
    } finally {
      position.monitoring = false;
      this.stopLoss.delete(mintStr);
    }
  }

  /**
   * Pump.fun launch sniping: buys a freshly created bonding-curve token
   * through Jupiter (routes to the pump.fun program directly).
   */
  public async buyPumpToken(event: PumpCreateEvent) {
    if (!SNIPE_PUMP_FUN) {
      return;
    }

    const mint = event.mint.toString();
    if (this.pumpSeen.has(mint)) {
      return;
    }
    this.pumpSeen.add(mint);
    if (this.pumpSeen.size > 5000) {
      this.pumpSeen.clear();
    }

    if (runtime.useSnipeList && !this.snipeListCache?.isInList(mint)) {
      logger.debug({ mint }, `Skipping pump buy: token is not in a snipe list`);
      return;
    }

    if (PUMP_MIN_INITIAL_SOL > 0 && Number(event.virtualSolReserves) / 1e9 < PUMP_MIN_INITIAL_SOL) {
      logger.debug({ mint }, `Skipping pump buy: virtual SOL reserves below PUMP_MIN_INITIAL_SOL`);
      return;
    }

    if (PUMP_AUTO_BUY_DELAY > 0) {
      logger.debug({ mint }, `Waiting for ${PUMP_AUTO_BUY_DELAY} ms before pump buy`);
      await sleep(PUMP_AUTO_BUY_DELAY);
    }

    await this.buyTokenViaJupiter(event.mint, event.symbol);
  }

  public async sell(accountId: PublicKey, rawAccount: RawAccount) {
    this.sellExecutionCount++;

    try {
      logger.trace({ mint: rawAccount.mint }, `Processing new token...`);

      const mint = rawAccount.mint.toString();
      const position = this.positions.get(mint);

      // monitor loop already running for this position (e.g. dip buy refill)
      if (position?.monitoring) {
        logger.trace({ mint }, `Position already monitored, skipping duplicate sell trigger`);
        return;
      }

      const poolData = await this.poolStorage.get(mint);

      if (!poolData) {
        // No Raydium AMM v4 pool (e.g. pump.fun bonding curve token):
        // run a Jupiter-only price monitor and sell through Jupiter.
        logger.trace({ mint }, `Token pool data is not found, using Jupiter-only lifecycle`);

        if (!this.config.autoSell) {
          return;
        }

        const balance = await this.connection.getTokenAccountBalance(accountId);
        const tokenDecimals = balance.value.decimals;
        const tokenIn = new Token(TOKEN_PROGRAM_ID, rawAccount.mint, tokenDecimals);
        const tokenAmountIn = new TokenAmount(tokenIn, rawAccount.amount, true);

        if (tokenAmountIn.isZero()) {
          logger.info({ mint }, `Empty balance, can't sell`);
          return;
        }

        if (this.config.autoSellDelay > 0) {
          logger.debug({ mint }, `Waiting for ${this.config.autoSellDelay} ms before sell`);
          await sleep(this.config.autoSellDelay);
        }

        const state: PositionState =
          position ??
          {
            ata: accountId,
            quoteSpent: 0,
            tokensAtEntry: Number(rawAccount.amount) / Math.pow(10, tokenDecimals),
            dipsUsed: 0,
            lastDipAt: 0,
            monitoring: false,
          };
        this.positions.set(mint, state);

        state.monitoring = true;
        try {
          await this.runJupiterMonitor(mint, accountId, state, tokenDecimals);
        } finally {
          state.monitoring = false;
        }
        return;
      }

      const tokenIn = new Token(TOKEN_PROGRAM_ID, poolData.state.baseMint, poolData.state.baseDecimal.toNumber());
      const tokenAmountIn = new TokenAmount(tokenIn, rawAccount.amount, true);

      if (tokenAmountIn.isZero()) {
        logger.info({ mint }, `Empty balance, can't sell`);
        return;
      }

      if (this.config.autoSellDelay > 0) {
        logger.debug({ mint }, `Waiting for ${this.config.autoSellDelay} ms before sell`);
        await sleep(this.config.autoSellDelay);
      }

      const market = await this.marketStorage.get(poolData.state.marketId.toString());
      const poolKeys: LiquidityPoolKeysV4 = createPoolKeys(new PublicKey(poolData.id), poolData.state, market);

      if (!this.config.autoSell) {
        return;
      }

      const state: PositionState =
        position ??
        {
          ata: accountId,
          quoteSpent: 0,
          tokensAtEntry: Number(rawAccount.amount) / Math.pow(10, tokenIn.decimals),
          dipsUsed: 0,
          lastDipAt: 0,
          monitoring: false,
        };
      this.positions.set(mint, state);

      if (!state.quoteSpent) {
        // pre-existing/manual tokens: baseline at current value
        const current = await this.estimateTokenValue(poolKeys, accountId, tokenIn);
        state.quoteSpent = current ? Number(current.toFixed()) : 0;
        state.tokensAtEntry = Number(rawAccount.amount) / Math.pow(10, tokenIn.decimals);
      }

      state.monitoring = true;
      try {
        await this.runPositionMonitor(poolKeys, accountId, tokenIn, state);
      } finally {
        state.monitoring = false;
        this.stopLoss.delete(mint);
      }
    } catch (error) {
      logger.error({ mint: rawAccount.mint.toString(), error }, `Failed to sell token`);
    } finally {
      this.sellExecutionCount--;
    }
  }

  /**
   * Position monitor: take profit / stop loss / trailing stop, rug-pull
   * protection (liquidity drain detection) and buy-the-dip averaging.
   */
  private async runPositionMonitor(
    poolKeys: LiquidityPoolKeysV4,
    accountId: PublicKey,
    tokenIn: Token,
    state: PositionState,
  ) {
    const mint = tokenIn.mint.toString();

    if (this.config.priceCheckDuration === 0 || this.config.priceCheckInterval === 0) {
      await this.executeSell(poolKeys, accountId, tokenIn, 'sell');
      return;
    }

    const timesToCheck = this.config.priceCheckDuration / this.config.priceCheckInterval;
    const profitFraction = this.config.quoteAmount.mul(this.config.takeProfit).numerator.div(new BN(100));
    const profitAmount = new TokenAmount(this.config.quoteToken, profitFraction, true);
    const takeProfit = this.config.quoteAmount.add(profitAmount);

    if (!state.stopLoss) {
      const lossFraction = this.config.quoteAmount.mul(this.config.stopLoss).numerator.div(new BN(100));
      const lossAmount = new TokenAmount(this.config.quoteToken, lossFraction, true);
      state.stopLoss = this.config.quoteAmount.subtract(lossAmount);
    }

    const slippage = new Percent(this.config.sellSlippage, 100);
    let timesChecked = 0;

    do {
      try {
        // fresh balance: includes dip-bought tokens
        const balanceInfo = await this.connection.getTokenAccountBalance(accountId);
        const freshAmount = new TokenAmount(tokenIn, BigInt(balanceInfo.value.amount), true);

        if (freshAmount.isZero()) {
          logger.info({ mint }, `Empty balance, closing monitor`);
          return;
        }

        const poolInfo = await Liquidity.fetchInfo({ connection: this.connection, poolKeys });

        const amountOut = Liquidity.computeAmountOut({
          poolKeys,
          poolInfo,
          amountIn: freshAmount,
          currencyOut: this.config.quoteToken,
          slippage,
        }).amountOut as TokenAmount;

        // rug-pull protection: track quote vault (pool liquidity) drain
        if (RUG_PULL_PROTECTION) {
          const liquidity = await this.connection.getTokenAccountBalance(poolKeys.quoteVault);
          const liquidityAmount = Number(liquidity.value.amount);

          if (state.baselineLiquidity === undefined) {
            state.baselineLiquidity = liquidityAmount;
          } else {
            const dropPct = ((state.baselineLiquidity - liquidityAmount) / state.baselineLiquidity) * 100;
            if (dropPct >= runtime.liquidityDropPct) {
              logger.warn(
                { mint, dropPct: dropPct.toFixed(1) },
                `RUG PULL DETECTED: pool liquidity dropped ${dropPct.toFixed(1)}%, emergency selling!`,
              );
              this.stats.record({
                time: new Date().toISOString(),
                mint,
                side: 'rug',
                note: `liquidity dropped ${dropPct.toFixed(1)}%`,
              });
              await this.executeSell(poolKeys, accountId, tokenIn, 'rug', freshAmount);
              return;
            }
          }
        }

        if (this.config.trailingStopLoss) {
          const trailingLossFraction = amountOut.mul(this.config.stopLoss).numerator.div(new BN(100));
          const trailingLossAmount = new TokenAmount(this.config.quoteToken, trailingLossFraction, true);
          const trailingStopLoss = amountOut.subtract(trailingLossAmount);

          if (!state.stopLoss || trailingStopLoss.gt(state.stopLoss)) {
            logger.trace(
              { mint },
              `Updating trailing stop loss from ${state.stopLoss?.toFixed()} to ${trailingStopLoss.toFixed()}`,
            );
            state.stopLoss = trailingStopLoss;
          }
        }

        if (this.config.skipSellingIfLostMoreThan > 0 && !RUG_PULL_PROTECTION) {
          const stopSellingFraction = this.config.quoteAmount
            .mul(this.config.skipSellingIfLostMoreThan)
            .numerator.div(new BN(100));

          const stopSellingAmount = new TokenAmount(this.config.quoteToken, stopSellingFraction, true);

          if (amountOut.lt(stopSellingAmount)) {
            logger.debug(
              { mint },
              `Token dropped more than ${this.config.skipSellingIfLostMoreThan}%, sell stopped. Initial: ${this.config.quoteAmount.toFixed()} | Current: ${amountOut.toFixed()}`,
            );
            return;
          }
        }

        logger.debug(
          { mint },
          `Take profit: ${takeProfit.toFixed()} | Stop loss: ${state.stopLoss.toFixed()} | Current: ${amountOut.toFixed()}`,
        );

        // buy the dip: average down when the token falls DIP_TRIGGER_PCT below entry
        if (BUY_THE_DIP && state.dipsUsed < DIP_MAX_BUYS) {
          const entryPrice = state.tokensAtEntry > 0 ? state.quoteSpent / state.tokensAtEntry : 0;
          const currentPrice =
            Number(freshAmount.toFixed()) > 0 ? Number(amountOut.toFixed()) / Number(freshAmount.toFixed()) : 0;

          const drawdownPct = entryPrice > 0 && currentPrice > 0 ? ((entryPrice - currentPrice) / entryPrice) * 100 : 0;
          const cooledDown = Date.now() - state.lastDipAt >= DIP_COOLDOWN_MS;

          if (drawdownPct >= DIP_TRIGGER_PCT && cooledDown) {
            logger.info(
              { mint, drawdown: drawdownPct.toFixed(1) },
              `BUY THE DIP: price is down ${drawdownPct.toFixed(1)}% from entry (dip buy ${state.dipsUsed + 1}/${DIP_MAX_BUYS})`,
            );

            const dipAmount =
              DIP_AMOUNT_MULTIPLIER === 1
                ? this.config.quoteAmount
                : new TokenAmount(
                    this.config.quoteToken,
                    this.config.quoteAmount.raw.mul(new BN(Math.round(DIP_AMOUNT_MULTIPLIER * 100))).div(new BN(100)),
                    true,
                  );

            try {
              await this.buy(new PublicKey(poolKeys.id), await this.getPoolStateForDip(poolKeys), dipAmount);

              state.dipsUsed++;
              state.lastDipAt = Date.now();

              // recompute avg cost basis for TP/SL
              const updated = this.positions.get(mint);
              if (updated) {
                state.quoteSpent = updated.quoteSpent;
                state.tokensAtEntry = updated.tokensAtEntry;
              }
            } catch (dipError) {
              logger.trace({ mint, dipError }, `Dip buy failed`);
            }
          }
        }

        if (amountOut.lt(state.stopLoss)) {
          break;
        }

        if (amountOut.gt(takeProfit)) {
          break;
        }

        await sleep(this.config.priceCheckInterval);
      } catch (e) {
        logger.trace({ mint, e }, `Failed to check token price`);
      } finally {
        timesChecked++;
      }
    } while (timesChecked < timesToCheck);

    await this.executeSell(poolKeys, accountId, tokenIn, 'sell');
  }

  /** Rebuilds a LiquidityStateV4-compatible object for dip buys on an existing pool. */
  private async getPoolStateForDip(poolKeys: LiquidityPoolKeysV4): Promise<LiquidityStateV4> {
    const poolData = await this.poolStorage.get(poolKeys.baseMint.toString());
    if (poolData) {
      return poolData.state;
    }
    throw new Error('Pool state not found for dip buy');
  }

  private async estimateTokenValue(poolKeys: LiquidityPoolKeysV4, accountId: PublicKey, tokenIn: Token) {
    try {
      const poolInfo = await Liquidity.fetchInfo({ connection: this.connection, poolKeys });
      const balance = await this.connection.getTokenAccountBalance(accountId);
      const amountIn = new TokenAmount(tokenIn, BigInt(balance.value.amount), true);
      return Liquidity.computeAmountOut({
        poolKeys,
        poolInfo,
        amountIn,
        currencyOut: this.config.quoteToken,
        slippage: new Percent(0, 100),
      }).amountOut as TokenAmount;
    } catch {
      return undefined;
    }
  }

  /** Executes a sell: Raydium first, Jupiter fallback on repeated failures. */
  private async executeSell(
    poolKeys: LiquidityPoolKeysV4,
    accountId: PublicKey,
    tokenIn: Token,
    reason: 'sell' | 'rug',
    amountOverride?: TokenAmount,
  ) {
    const mint = tokenIn.mint.toString();

    let amountIn = amountOverride;
    if (!amountIn) {
      const balance = await this.connection.getTokenAccountBalance(accountId);
      amountIn = new TokenAmount(tokenIn, BigInt(balance.value.amount), true);
    }

    if (amountIn.isZero()) {
      logger.info({ mint }, `Empty balance, can't sell`);
      return;
    }

    const tokenOutValueBefore = await this.estimateTokenValue(poolKeys, accountId, tokenIn);

    let confirmed = false;
    let signature: string | undefined;
    let lastError: string | undefined;

    const useJupiterFirst = SELL_EXECUTION === 'jupiter';
    const tryRaydium = SELL_EXECUTION === 'raydium' || SELL_EXECUTION === 'auto';
    const tryJupiter = SELL_EXECUTION === 'jupiter' || SELL_EXECUTION === 'auto';

    if (useJupiterFirst && tryJupiter) {
      const result = await this.swapViaJupiter(mint, this.config.quoteToken.mint.toString(), amountIn.raw.toString(), this.config.sellSlippage, 'sell');
      confirmed = result.confirmed;
      signature = result.signature;
      lastError = result.error;
    }

    for (let i = 0; i < this.config.maxSellRetries && !confirmed && tryRaydium; i++) {
      try {
        logger.info({ mint }, `Send sell transaction attempt: ${i + 1}/${this.config.maxSellRetries}`);

        const result = await this.swap(
          poolKeys,
          accountId,
          this.config.quoteAta,
          tokenIn,
          this.config.quoteToken,
          amountIn,
          reason === 'rug' ? runtime.rugSlippage : this.config.sellSlippage,
          this.config.wallet,
          'sell',
        );

        if (result.confirmed) {
          confirmed = true;
          signature = result.signature;
          break;
        }

        lastError = result.error;
        logger.info({ mint, signature: result.signature, error: result.error }, `Error confirming sell tx`);
      } catch (error) {
        logger.debug({ mint, error }, `Error confirming sell transaction`);
      }
    }

    if (!confirmed && tryJupiter) {
      logger.info({ mint }, `Falling back to Jupiter aggregated sell`);
      const result = await this.swapViaJupiter(mint, this.config.quoteToken.mint.toString(), amountIn.raw.toString(), reason === 'rug' ? runtime.rugSlippage : this.config.sellSlippage, 'sell');
      confirmed = result.confirmed;
      signature = result.signature;
      lastError = result.error;
    }

    if (confirmed && signature) {
      logger.info(
        {
          dex: `https://dexscreener.com/solana/${mint}?maker=${this.config.wallet.publicKey}`,
          mint,
          signature,
          url: `https://solscan.io/tx/${signature}?cluster=${NETWORK}`,
        },
        `Confirmed ${reason === 'rug' ? 'emergency (rug) ' : ''}sell tx`,
      );

      // proceeds = pre-sell value estimate of the sold tokens
      const proceeds = tokenOutValueBefore ? Number(tokenOutValueBefore.toFixed()) : undefined;
      const position = this.positions.get(mint);
      const pnl = position && proceeds !== undefined ? proceeds - position.quoteSpent : undefined;

      this.stats.record({
        time: new Date().toISOString(),
        mint,
        side: reason === 'rug' ? 'rug' : 'sell',
        quoteAmount: proceeds,
        pnl,
        signature,
      });

      if (position) {
        this.positions.delete(mint);
      }

      this.stats.summarize();
    } else {
      logger.info({ mint, error: lastError }, `Sell failed on all routes`);
      this.stats.record({ time: new Date().toISOString(), mint, side: 'error', note: lastError });
    }
  }

  /** Wrap SOL -> WSOL when the wallet WSOL balance doesn't cover the trade (native SOL mode). */
  private async wrapSolInstructions(amountRaw: bigint): Promise<TransactionInstruction[]> {
    const wallet = this.config.wallet;
    const wsolAta = this.config.quoteAta;

    const balance = await this.connection.getTokenAccountBalance(wsolAta).catch(() => null);
    const current = balance ? BigInt(balance.value.amount) : BigInt(0);
    const deficit = amountRaw > current ? amountRaw - current : BigInt(0);

    const instructions: TransactionInstruction[] = [
      createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, wsolAta, wallet.publicKey, NATIVE_MINT),
    ];

    if (deficit > 0) {
      instructions.push(
        SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: wsolAta, lamports: Number(deficit) }),
        createSyncNativeInstruction(wsolAta),
      );
      logger.debug({ deficit: deficit.toString() }, `Wrapping SOL -> WSOL`);
    }

    return instructions;
  }

  /**
   * Price monitor for tokens that have no Raydium AMM v4 pool (pump.fun
   * bonding curves etc.). Uses Jupiter quotes for pricing and execution:
   * take profit, stop loss, trailing stop, rug detection and buy-the-dip.
   */
  private async runJupiterMonitor(mint: string, accountId: PublicKey, state: PositionState, tokenDecimals: number) {
    const quoteMint = this.config.quoteToken.mint.toString();
    const quoteDecimals = this.config.quoteToken.decimals;
    const interval = Math.max(this.config.priceCheckInterval, 2500); // respect jupiter rate limits
    const timesToCheck = this.config.priceCheckDuration > 0 ? Math.ceil(this.config.priceCheckDuration / interval) : 1;
    let consecutiveFailures = 0;
    let lastValue = 0;
    let peakValue = 0;

    for (let timesChecked = 0; timesChecked < timesToCheck; timesChecked++) {
      try {
        const balance = await this.connection.getTokenAccountBalance(accountId);
        const amount = balance.value.amount;

        if (amount === '0') {
          logger.info({ mint }, `Empty balance, closing jupiter monitor`);
          return;
        }

        const quote = await this.jupiter.getQuote(mint, quoteMint, amount, Math.max(this.config.sellSlippage, 10));
        const value = Number(quote.outAmount) / Math.pow(10, quoteDecimals);
        consecutiveFailures = 0;

        if (!state.quoteSpent) {
          state.quoteSpent = value; // baseline for manual/pre-existing positions
          state.tokensAtEntry = Number(amount) / Math.pow(10, tokenDecimals);
        }

        // rug detection: sudden value collapse between checks
        if (RUG_PULL_PROTECTION && lastValue > 0) {
          const dropPct = ((lastValue - value) / lastValue) * 100;
          if (dropPct >= runtime.liquidityDropPct) {
            logger.warn(
              { mint, dropPct: dropPct.toFixed(1) },
              `RUG PULL DETECTED: value dropped ${dropPct.toFixed(1)}% between checks, emergency selling!`,
            );
            await this.swapViaJupiter(mint, quoteMint, amount, runtime.rugSlippage, 'sell');
            const pnl = value - state.quoteSpent;
            this.stats.record({ time: new Date().toISOString(), mint, side: 'rug', pnl, quoteAmount: value });
            this.positions.delete(mint);
            this.stats.summarize();
            return;
          }
        }
        lastValue = value;
        peakValue = Math.max(peakValue, value);

        const ratio = state.quoteSpent > 0 ? value / state.quoteSpent : 1;
        logger.debug({ mint }, `Jupiter monitor: value ${value.toFixed()} | ratio ${(ratio * 100).toFixed(1)}%`);

        // trailing stop on the peak value
        if (this.config.trailingStopLoss && peakValue > state.quoteSpent) {
          const trailingStop = peakValue * (1 - this.config.stopLoss / 100);
          if (value < trailingStop) {
            logger.info({ mint }, `Trailing stop hit (peak ${peakValue.toFixed()})`);
            break;
          }
        }

        // skip selling if lost more than X% (unless rug protection will catch the collapse)
        if (this.config.skipSellingIfLostMoreThan > 0 && !RUG_PULL_PROTECTION) {
          if (ratio <= 1 - this.config.skipSellingIfLostMoreThan / 100) {
            logger.debug({ mint }, `Token lost more than ${this.config.skipSellingIfLostMoreThan}%, sell stopped`);
            return;
          }
        }

        if (ratio <= 1 - this.config.stopLoss / 100) {
          break;
        }

        if (ratio >= 1 + this.config.takeProfit / 100) {
          break;
        }

        // buy the dip
        if (BUY_THE_DIP && state.dipsUsed < DIP_MAX_BUYS) {
          const drawdownPct = (1 - ratio) * 100;
          if (drawdownPct >= DIP_TRIGGER_PCT && Date.now() - state.lastDipAt >= DIP_COOLDOWN_MS) {
            logger.info(
              { mint, drawdown: drawdownPct.toFixed(1) },
              `BUY THE DIP (jupiter): down ${drawdownPct.toFixed(1)}% (dip ${state.dipsUsed + 1}/${DIP_MAX_BUYS})`,
            );
            const dipRaw =
              DIP_AMOUNT_MULTIPLIER === 1
                ? this.config.quoteAmount.raw
                : this.config.quoteAmount.raw.mul(new BN(Math.round(DIP_AMOUNT_MULTIPLIER * 100))).div(new BN(100));
            const inputMint = isNativeSolMode(QUOTE_MINT) ? NATIVE_MINT.toString() : quoteMint;
            const dipResult = await this.swapViaJupiter(inputMint, mint, dipRaw.toString(), this.config.buySlippage, 'buy');
            if (dipResult.confirmed) {
              state.dipsUsed++;
              state.lastDipAt = Date.now();
              state.quoteSpent += Number(dipRaw) / Math.pow(10, quoteDecimals);
              const fresh = await this.connection.getTokenAccountBalance(accountId);
              state.tokensAtEntry = Number(fresh.value.amount) / Math.pow(10, tokenDecimals);
            }
          }
        }

        await sleep(interval);
      } catch (e) {
        consecutiveFailures++;
        logger.trace({ mint, e }, `Jupiter monitor check failed`);
        if (consecutiveFailures >= 5) {
          logger.warn({ mint }, `Jupiter monitor: 5 consecutive failures (token likely unroutable), stopping monitor`);
          return;
        }
        await sleep(interval);
      }
    }

    // duration elapsed or TP/SL hit — sell everything via Jupiter
    const balance = await this.connection.getTokenAccountBalance(accountId);
    if (balance.value.amount !== '0') {
      const quote = await this.jupiter
        .getQuote(mint, quoteMint, balance.value.amount, Math.max(this.config.sellSlippage, 10))
        .catch(() => undefined);
      const exitValue = quote ? Number(quote.outAmount) / Math.pow(10, quoteDecimals) : undefined;
      const pnl = exitValue !== undefined ? exitValue - state.quoteSpent : undefined;

      const result = await this.swapViaJupiter(mint, quoteMint, balance.value.amount, this.config.sellSlippage, 'sell');
      if (result.confirmed) {
        logger.info({ mint, signature: result.signature }, `Confirmed jupiter sell tx`);
        this.stats.record({
          time: new Date().toISOString(),
          mint,
          side: 'sell',
          quoteAmount: exitValue,
          pnl,
          signature: result.signature,
        });
        this.positions.delete(mint);
        this.stats.summarize();
      } else {
        logger.info({ mint, error: result.error }, `Jupiter sell failed`);
        this.stats.record({ time: new Date().toISOString(), mint, side: 'error', note: result.error });
      }
    }
  }

  // noinspection JSUnusedLocalSymbols
  private async swap(
    poolKeys: LiquidityPoolKeysV4,
    ataIn: PublicKey,
    ataOut: PublicKey,
    tokenIn: Token,
    tokenOut: Token,
    amountIn: TokenAmount,
    slippage: number,
    wallet: Keypair,
    direction: 'buy' | 'sell',
  ) {
    const slippagePercent = new Percent(slippage, 100);
    const poolInfo = await Liquidity.fetchInfo({
      connection: this.connection,
      poolKeys,
    });

    const computedAmountOut = Liquidity.computeAmountOut({
      poolKeys,
      poolInfo,
      amountIn,
      currencyOut: tokenOut,
      slippage: slippagePercent,
    });

    let unitPrice = this.config.unitPrice;
    if (DYNAMIC_PRIORITY_FEES) {
      unitPrice = await computePriorityFee(this.connection, PRIORITY_FEE_PERCENTILE);
    }

    const latestBlockhash = await this.connection.getLatestBlockhash();
    const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
      {
        poolKeys: poolKeys,
        userKeys: {
          tokenAccountIn: ataIn,
          tokenAccountOut: ataOut,
          owner: wallet.publicKey,
        },
        amountIn: amountIn.raw,
        minAmountOut: computedAmountOut.minAmountOut.raw,
      },
      poolKeys.version,
    );

    // native SOL mode: atomically wrap SOL -> WSOL inside the buy transaction
    let preInstructions: TransactionInstruction[] = [];
    if (isNativeSolMode(QUOTE_MINT)) {
      preInstructions = await this.wrapSolInstructions(BigInt(amountIn.raw.toString()));
    }

    // jito: tip inside the main transaction (single-tx bundle)
    const jitoTip: TransactionInstruction[] = [];
    if (this.isJito) {
      const executor = this.txExecutor as JitoTransactionExecutor;
      const tipLamports = await executor.computeTipLamports();
      const tipAccount = executor.getRandomTipAccount();
      jitoTip.push(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: tipAccount,
          lamports: tipLamports,
        }),
      );
      logger.debug({ tipLamports, tipAccount: tipAccount.toString() }, `Jito tip`);
    }

    const messageV0 = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        ...preInstructions,
        ...(this.isWarp || this.isJito
          ? [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: unitPrice })]
          : [
              ComputeBudgetProgram.setComputeUnitPrice({ microLamports: unitPrice }),
              ComputeBudgetProgram.setComputeUnitLimit({ units: this.config.unitLimit }),
            ]),
        ...(direction === 'buy'
          ? [
              createAssociatedTokenAccountIdempotentInstruction(
                wallet.publicKey,
                ataOut,
                wallet.publicKey,
                tokenOut.mint,
              ),
            ]
          : []),
        ...innerTransaction.instructions,
        ...(direction === 'sell' ? [createCloseAccountInstruction(ataIn, wallet.publicKey, wallet.publicKey)] : []),
        ...jitoTip,
      ],
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([wallet, ...innerTransaction.signers]);

    return this.txExecutor.executeAndConfirm(transaction, wallet, latestBlockhash);
  }

  /** Jupiter aggregated swap across every routed DEX, with fresh-blockhash retries. */
  private async swapViaJupiter(
    inputMint: string,
    outputMint: string,
    amountIn: string,
    slippage: number,
    direction: 'buy' | 'sell',
  ) {
    let lastError: string | undefined;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // Jupiter rejects zero/dust amounts with "Invalid amount" — surface a clear error instead
        if (!/^\d+$/.test(amountIn) || BigInt(amountIn) <= BigInt(0)) {
          logger.warn(
            { inputMint, outputMint, amountIn },
            `Trade amount is 0: not enough quote balance for this trade (check QUOTE_AMOUNT / percent mode / MIN_SOL_BUFFER)`,
          );
          return { confirmed: false, error: 'insufficient quote balance: trade amount is 0' };
        }

        let unitPrice = this.config.unitPrice;
        if (DYNAMIC_PRIORITY_FEES) {
          unitPrice = await computePriorityFee(this.connection, PRIORITY_FEE_PERCENTILE);
        }

        let jitoTipLamports: number | undefined;
        let jitoTipAccount: PublicKey | undefined;
        if (this.isJito) {
          const executor = this.txExecutor as JitoTransactionExecutor;
          jitoTipLamports = await executor.computeTipLamports();
          jitoTipAccount = executor.getRandomTipAccount();
        }

        const { transaction, blockhash, lastValidBlockHeight } = await this.jupiter.buildSwapTransaction(
          this.connection,
          inputMint,
          outputMint,
          amountIn,
          slippage,
          this.config.wallet.publicKey,
          { unitPriceOverride: unitPrice, unitLimit: this.config.unitLimit, jitoTipLamports, jitoTipAccount },
          this.isJito,
        );

        // simulate once on the first attempt to surface the real failure reason
        if (attempt === 0) {
          try {
            const sim = await this.connection.simulateTransaction(transaction, { sigVerify: false, replaceRecentBlockhash: false });
            if (sim.value.err) {
              lastError = JSON.stringify(sim.value.err) + ' | ' + (sim.value.logs?.slice(-3).join(' | ') ?? '');
              logger.debug({ err: sim.value.err }, `Jupiter tx simulation failed`);
              continue; // rebuild with a fresh quote on the next attempt
            }
          } catch (simError) {
            logger.trace({ simError }, `Jupiter tx simulation unavailable`);
          }
        }

        transaction.sign([this.config.wallet]);

        const result = await this.txExecutor.executeAndConfirm(transaction, this.config.wallet, {
          blockhash,
          lastValidBlockHeight,
        });

        if (result.confirmed) {
          return result;
        }

        lastError = result.error ?? 'not confirmed';
        // dropped txs (no on-chain status) are usually stale-blockhash races:
        // retry immediately with a freshly built quote + blockhash
        logger.debug({ attempt, signature: result.signature, error: lastError }, `Jupiter tx not confirmed, retrying with fresh blockhash`);
      } catch (error: any) {
        lastError = error?.response?.data ? JSON.stringify(error.response.data) : String(error?.message ?? error);
        logger.debug({ error: lastError }, `Jupiter swap failed`);
      }
    }

    return { confirmed: false, error: lastError };
  }

  /** Snapshot for the web dashboard. */
  public dashboardSnapshot() {
    const positions: Record<string, unknown>[] = [];
    for (const [mint, p] of this.positions.entries()) {
      positions.push({
        mint,
        ata: p.ata.toString(),
        quoteSpent: p.quoteSpent,
        tokensAtEntry: p.tokensAtEntry,
        dipsUsed: p.dipsUsed,
        monitoring: p.monitoring,
      });
    }

    return {
      paused: this.paused,
      wallet: this.config.wallet.publicKey.toString(),
      quoteToken: this.config.quoteToken.symbol,
      config: {
        takeProfit: this.config.takeProfit,
        stopLoss: this.config.stopLoss,
        trailingStopLoss: this.config.trailingStopLoss,
        skipSellingIfLostMoreThan: this.config.skipSellingIfLostMoreThan,
        priceCheckInterval: this.config.priceCheckInterval,
        priceCheckDuration: this.config.priceCheckDuration,
        maxTokensAtTheTime: this.config.maxTokensAtTheTime,
      },
      positions,
      stats: this.stats.summary(),
    };
  }

  private async filterMatch(poolKeys: LiquidityPoolKeysV4) {
    if (this.config.filterCheckInterval === 0 || this.config.filterCheckDuration === 0) {
      return true;
    }

    const filters = new PoolFilters(this.connection, {
      quoteToken: this.config.quoteToken,
      minPoolSize: this.config.minPoolSize,
      maxPoolSize: this.config.maxPoolSize,
    });

    const timesToCheck = this.config.filterCheckDuration / this.config.filterCheckInterval;
    let timesChecked = 0;
    let matchCount = 0;

    do {
      try {
        const shouldBuy = await filters.execute(poolKeys);

        if (shouldBuy) {
          matchCount++;

          if (this.config.consecutiveMatchCount <= matchCount) {
            logger.debug(
              { mint: poolKeys.baseMint.toString() },
              `Filter match ${matchCount}/${this.config.consecutiveMatchCount}`,
            );
            return true;
          }
        } else {
          matchCount = 0;
        }

        await sleep(this.config.filterCheckInterval);
      } finally {
        timesChecked++;
      }
    } while (timesChecked < timesToCheck);

    return false;
  }
}
