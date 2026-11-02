import { MarketCache, PoolCache } from './cache';
import { Listeners } from './listeners';
import { Connection, KeyedAccountInfo, Keypair, PublicKey } from '@solana/web3.js';
import { LIQUIDITY_STATE_LAYOUT_V4, MAINNET_PROGRAM_ID, MARKET_STATE_LAYOUT_V3, Token, TokenAmount } from '@raydium-io/raydium-sdk';
import { AccountLayout, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Bot, BotConfig } from './bot';
import { DefaultTransactionExecutor, TransactionExecutor } from './transactions';
import {
  getToken,
  isNativeSolMode,
  getWallet,
  logger,
  COMMITMENT_LEVEL,
  RPC_ENDPOINT,
  RPC_WEBSOCKET_ENDPOINT,
  PRE_LOAD_EXISTING_MARKETS,
  LOG_LEVEL,
  QUOTE_MINT,
  MAX_POOL_SIZE,
  MIN_POOL_SIZE,
  QUOTE_AMOUNT,
  PRIVATE_KEY,
  USE_SNIPE_LIST,
  AUTO_SELL_DELAY,
  MAX_SELL_RETRIES,
  AUTO_SELL,
  MAX_BUY_RETRIES,
  AUTO_BUY_DELAY,
  COMPUTE_UNIT_LIMIT,
  COMPUTE_UNIT_PRICE,
  CACHE_NEW_MARKETS,
  TAKE_PROFIT,
  STOP_LOSS,
  BUY_SLIPPAGE,
  SELL_SLIPPAGE,
  PRICE_CHECK_DURATION,
  PRICE_CHECK_INTERVAL,
  SNIPE_LIST_REFRESH_INTERVAL,
  TRANSACTION_EXECUTOR,
  CUSTOM_FEE,
  FILTER_CHECK_INTERVAL,
  FILTER_CHECK_DURATION,
  CONSECUTIVE_FILTER_MATCHES,
  MAX_TOKENS_AT_THE_TIME,
  CHECK_IF_MINT_IS_RENOUNCED,
  CHECK_IF_FREEZABLE,
  CHECK_IF_BURNED,
  CHECK_IF_MUTABLE,
  CHECK_IF_SOCIALS,
  TRAILING_STOP_LOSS,
  SKIP_SELLING_IF_LOST_MORE_THAN,
  BUY_EXECUTION,
  SELL_EXECUTION,
  QUOTE_AMOUNT_MODE,
  QUOTE_AMOUNT_PERCENT,
  MIN_SOL_BUFFER,
  DYNAMIC_PRIORITY_FEES,
  PRIORITY_FEE_PERCENTILE,
  MAX_PRIORITY_FEE,
  MIN_PRIORITY_FEE,
  JITO_DYNAMIC_TIP,
  JITO_TIP_PERCENTILE,
  MIN_JITO_TIP_SOL,
  MAX_JITO_TIP_SOL,
  RUG_CHECK,
  RUGCHECK_MAX_SCORE,
  RUGCHECK_MIN_LP_LOCKED,
  CHECK_TOP_HOLDERS,
  MAX_TOP_HOLDER_PCT,
  RUG_PULL_PROTECTION,
  LIQUIDITY_DROP_PCT,
  LIQUIDITY_CHECK_INTERVAL,
  BUY_THE_DIP,
  DIP_TRIGGER_PCT,
  DIP_MAX_BUYS,
  DIP_COOLDOWN_MS,
  DIP_AMOUNT_MULTIPLIER,
} from './helpers';
import { version } from './package.json';
import { WarpTransactionExecutor } from './transactions/warp-transaction-executor';
import { JitoTransactionExecutor } from './transactions/jito-rpc-transaction-executor';
import { SNIPE_PUMP_FUN, PUMP_MIN_INITIAL_SOL, PUMP_AUTO_BUY_DELAY, SCANNER_MODE, DASHBOARD_ENABLED, DASHBOARD_PORT } from './helpers/constants';
import { PumpCreateEvent } from './listeners/pump-fun-listener';
import { MomentumScanner } from './strategy/scanner';
import { startDashboard } from './dashboard/server';
import { runtime } from './helpers/runtime';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: COMMITMENT_LEVEL,
});

// native SOL + percent mode => Jupiter-only execution (no WSOL ATA needed)
const nativeSolMode = isNativeSolMode(QUOTE_MINT);
const buyExecution = nativeSolMode ? 'jupiter' : BUY_EXECUTION;
const sellExecution = nativeSolMode ? 'jupiter' : SELL_EXECUTION;

function printDetails(wallet: Keypair, quoteToken: Token, bot: Bot) {
  logger.info(`
                                        ..   :-===++++-
                                .-==+++++++- =+++++++++-
            ..:::--===+=.=:     .+++++++++++:=+++++++++:
    .==+++++++++++++++=:+++:    .+++++++++++.=++++++++-.
    .-+++++++++++++++=:=++++-   .+++++++++=:.=+++++-::-.
     -:+++++++++++++=:+++++++-  .++++++++-:- =+++++=-:
      -:++++++=++++=:++++=++++= .++++++++++- =+++++:
       -:++++-:=++=:++++=:-+++++:+++++====--:::::::::.
        ::=+-:::==:=+++=::-:--::::::::::---------::.
         ::-:  .::::::::.  --------:::..
          :-    .:.-:::.

          WARP DRIVE ACTIVATED 🚀🐟 (2026 edition)
          Jupiter routes | Jito bundles | RugCheck | Rug shield | Buy the dip
          Version: ${version}
  `);

  const botConfig = bot.config;

  logger.info('------- CONFIGURATION START -------');
  logger.info(`Wallet: ${wallet.publicKey.toString()}`);

  logger.info('- Bot -');
  logger.info(`Using transaction executor: ${TRANSACTION_EXECUTOR}`);

  if (bot.isWarp || bot.isJito) {
    logger.info(`${TRANSACTION_EXECUTOR} fee: ${CUSTOM_FEE}`);
    logger.info(`Jito dynamic tip: ${JITO_DYNAMIC_TIP} (percentile: ${JITO_TIP_PERCENTILE}, min: ${MIN_JITO_TIP_SOL} SOL, max: ${MAX_JITO_TIP_SOL} SOL)`);
  } else {
    logger.info(`Compute Unit limit: ${botConfig.unitLimit}`);
    logger.info(`Compute Unit price (micro lamports): ${botConfig.unitPrice}`);
  }

  logger.info(`Dynamic priority fees: ${DYNAMIC_PRIORITY_FEES} (percentile: ${PRIORITY_FEE_PERCENTILE}, min: ${MIN_PRIORITY_FEE}, max: ${MAX_PRIORITY_FEE})`);
  logger.info(`Buy execution: ${buyExecution} | Sell execution: ${sellExecution}`);
  logger.info(`Max tokens at the time: ${botConfig.maxTokensAtTheTime}`);
  logger.info(`Pre load existing markets: ${PRE_LOAD_EXISTING_MARKETS}`);
  logger.info(`Cache new markets: ${CACHE_NEW_MARKETS}`);
  logger.info(`Log level: ${LOG_LEVEL}`);

  logger.info('- Buy -');
  logger.info(`Quote mint: ${QUOTE_MINT}`);
  logger.info(`Quote amount mode: ${QUOTE_AMOUNT_MODE}${QUOTE_AMOUNT_MODE === 'percent' ? ` (${QUOTE_AMOUNT_PERCENT}% of wallet, min buffer ${MIN_SOL_BUFFER} SOL)` : ''}`);
  logger.info(`Buy amount: ${botConfig.quoteAmount.toFixed()} ${botConfig.quoteToken.symbol}`);
  logger.info(`Auto buy delay: ${botConfig.autoBuyDelay} ms`);
  logger.info(`Max buy retries: ${botConfig.maxBuyRetries}`);
  logger.info(`Buy slippage: ${botConfig.buySlippage}%`);

  logger.info('- Sell -');
  logger.info(`Auto sell: ${AUTO_SELL}`);
  logger.info(`Auto sell delay: ${botConfig.autoSellDelay} ms`);
  logger.info(`Max sell retries: ${botConfig.maxSellRetries}`);
  logger.info(`Sell slippage: ${botConfig.sellSlippage}%`);
  logger.info(`Price check interval: ${botConfig.priceCheckInterval} ms`);
  logger.info(`Price check duration: ${botConfig.priceCheckDuration} ms`);
  logger.info(`Take profit: ${botConfig.takeProfit}%`);
  logger.info(`Stop loss: ${botConfig.stopLoss}%`);
  logger.info(`Trailing stop loss: ${botConfig.trailingStopLoss}`);
  logger.info(`Skip selling if lost more than: ${botConfig.skipSellingIfLostMoreThan}%`);
  logger.info(`Rug pull protection: ${RUG_PULL_PROTECTION} (liquidity drop: ${LIQUIDITY_DROP_PCT}%, check interval: ${LIQUIDITY_CHECK_INTERVAL} ms)`);
  logger.info(`Buy the dip: ${BUY_THE_DIP} (trigger: ${DIP_TRIGGER_PCT}%, max buys: ${DIP_MAX_BUYS}, cooldown: ${DIP_COOLDOWN_MS} ms, multiplier: ${DIP_AMOUNT_MULTIPLIER}x)`);
  logger.info(`Momentum scanner: ${SCANNER_MODE}`);

  logger.info('- Snipe list -');
  logger.info(`Snipe list mode: ${runtime.useSnipeList ? 'only my list' : 'ALL new tokens'} (switchable in dashboard)`);
  logger.info(`Snipe list refresh interval: ${SNIPE_LIST_REFRESH_INTERVAL} ms`);

  if (runtime.useSnipeList) {
    logger.info('- Filters -');
    logger.info(`Filters are disabled when snipe list is on`);
  } else {
    logger.info('- Filters -');
    logger.info(`Filter check interval: ${botConfig.filterCheckInterval} ms`);
    logger.info(`Filter check duration: ${botConfig.filterCheckDuration} ms`);
    logger.info(`Consecutive filter matches: ${botConfig.consecutiveMatchCount}`);
    logger.info(`Check renounced: ${CHECK_IF_MINT_IS_RENOUNCED}`);
    logger.info(`Check freezable: ${CHECK_IF_FREEZABLE}`);
    logger.info(`Check burned: ${CHECK_IF_BURNED}`);
    logger.info(`Check mutable: ${CHECK_IF_MUTABLE}`);
    logger.info(`Check socials: ${CHECK_IF_SOCIALS}`);
    logger.info(`RugCheck.xyz analysis: ${RUG_CHECK} (max score: ${RUGCHECK_MAX_SCORE}, min LP locked: ${RUGCHECK_MIN_LP_LOCKED}%)`);
    logger.info(`Top holders concentration: ${CHECK_TOP_HOLDERS} (max single holder: ${MAX_TOP_HOLDER_PCT}%)`);
    logger.info(`Min pool size: ${botConfig.minPoolSize.toFixed()}`);
    logger.info(`Max pool size: ${botConfig.maxPoolSize.toFixed()}`);
  }

  logger.info('------- CONFIGURATION END -------');

  if (SNIPE_PUMP_FUN) {
    logger.warn(
      'WARNING: Pump.fun sniping is ENABLED. Its real-time log subscription generates a very high message volume — ' +
        'on public/rate-limited RPC (api.mainnet-beta.solana.com, publicnode, drpc...) the websocket will keep getting ' +
        'disconnected and launches will be MISSED. Use a dedicated RPC (Helius, QuickNode, Triton, etc.) with websockets ' +
        'for reliable pump.fun sniping, or set SNIPE_PUMP_FUN=false.',
    );
  }

  if (RPC_ENDPOINT.includes('api.mainnet-beta.solana.com')) {
    logger.warn(
      'WARNING: You are using the public Solana RPC. It is rate-limited and unstable for real-time sniping — ' +
        'most new pools will be missed. For real trading use a dedicated RPC (Helius, QuickNode, etc.).',
    );
  }

  logger.info('Bot is running! Press CTRL + C to stop it.');
}

const runListener = async () => {
  // single-instance guard: two bots would race on the same trades
  const lockFile = `${__dirname}/.bot.lock`;
  if (fs.existsSync(lockFile)) {
    const pid = Number(fs.readFileSync(lockFile, 'utf-8'));
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch {
      alive = false;
    }
    if (alive && pid !== process.pid) {
      logger.error(`Another bot instance is already running (pid ${pid}). Stop it first or delete .bot.lock`);
      process.exit(1);
    }
  }
  fs.writeFileSync(lockFile, String(process.pid));
  const removeLock = () => {
    try {
      fs.unlinkSync(lockFile);
    } catch {
      // ignore
    }
  };
  process.on('exit', removeLock);
  process.on('SIGINT', () => {
    removeLock();
    process.exit(0);
  });

  logger.level = LOG_LEVEL;
  logger.info('Bot is starting...');

  const marketCache = new MarketCache(connection);
  const poolCache = new PoolCache();
  let txExecutor: TransactionExecutor;

  switch (TRANSACTION_EXECUTOR) {
    case 'warp': {
      txExecutor = new WarpTransactionExecutor(CUSTOM_FEE);
      break;
    }
    case 'jito': {
      txExecutor = new JitoTransactionExecutor(CUSTOM_FEE, connection, {
        dynamicTip: JITO_DYNAMIC_TIP,
        tipPercentile: JITO_TIP_PERCENTILE,
        minTipSol: MIN_JITO_TIP_SOL,
        maxTipSol: MAX_JITO_TIP_SOL,
      });
      break;
    }
    default: {
      txExecutor = new DefaultTransactionExecutor(connection);
      break;
    }
  }

  // no PRIVATE_KEY? generate a temporary wallet instead of crashing —
  // a real key can be pasted later via dashboard "Add wallet" (persisted to .env)
  const wallet = PRIVATE_KEY.trim() ? getWallet(PRIVATE_KEY.trim()) : Keypair.generate();
  if (!PRIVATE_KEY.trim()) {
    logger.warn(
      `PRIVATE_KEY is not set — generated a TEMPORARY wallet ${wallet.publicKey.toString()}. ` +
        `Fund it and paste its private key via dashboard "Add wallet" (or .env) to keep it.`,
    );
  }
  const quoteToken = getToken(QUOTE_MINT);
  const botConfig = <BotConfig>{
    wallet,
    // WSOL ATA is used as the quote account in every mode (auto-created in native SOL mode)
    quoteAta: getAssociatedTokenAddressSync(quoteToken.mint, wallet.publicKey),
    minPoolSize: new TokenAmount(quoteToken, MIN_POOL_SIZE, false),
    maxPoolSize: new TokenAmount(quoteToken, MAX_POOL_SIZE, false),
    quoteToken,
    quoteAmount: new TokenAmount(quoteToken, QUOTE_AMOUNT, false),
    maxTokensAtTheTime: MAX_TOKENS_AT_THE_TIME,
    useSnipeList: USE_SNIPE_LIST,
    autoSell: AUTO_SELL,
    autoSellDelay: AUTO_SELL_DELAY,
    maxSellRetries: MAX_SELL_RETRIES,
    autoBuyDelay: AUTO_BUY_DELAY,
    maxBuyRetries: MAX_BUY_RETRIES,
    unitLimit: COMPUTE_UNIT_LIMIT,
    unitPrice: COMPUTE_UNIT_PRICE,
    takeProfit: TAKE_PROFIT,
    stopLoss: STOP_LOSS,
    trailingStopLoss: TRAILING_STOP_LOSS,
    skipSellingIfLostMoreThan: SKIP_SELLING_IF_LOST_MORE_THAN,
    buySlippage: BUY_SLIPPAGE,
    sellSlippage: SELL_SLIPPAGE,
    priceCheckInterval: PRICE_CHECK_INTERVAL,
    priceCheckDuration: PRICE_CHECK_DURATION,
    filterCheckInterval: FILTER_CHECK_INTERVAL,
    filterCheckDuration: FILTER_CHECK_DURATION,
    consecutiveMatchCount: CONSECUTIVE_FILTER_MATCHES,
  };

  const bot = new Bot(connection, marketCache, poolCache, txExecutor, botConfig);
  const valid = await bot.validate();

  if (!valid) {
    logger.info('Bot is exiting...');
    process.exit(1);
  }

  if (PRE_LOAD_EXISTING_MARKETS) {
    await marketCache.init({ quoteToken });
  }

  const runTimestamp = Math.floor(new Date().getTime() / 1000);
  const listeners = new Listeners(connection);
  await listeners.start({
    walletPublicKey: wallet.publicKey,
    quoteToken,
    autoSell: AUTO_SELL,
    cacheNewMarkets: CACHE_NEW_MARKETS,
    snipePumpFun: SNIPE_PUMP_FUN,
  });

  listeners.on('pump', async (event: PumpCreateEvent) => {
    await bot.buyPumpToken(event);
  });

  if (SCANNER_MODE) {
    logger.info('Momentum scanner: enabled (HTTPS polling, free-RPC friendly)');
    const scanner = new MomentumScanner(async (token) => {
      await bot.buyTokenViaJupiter(scanner.toPublicKey(token), token.symbol);
    });
    scanner.start();
  }

  listeners.on('market', (updatedAccountInfo: KeyedAccountInfo) => {
    const marketState = MARKET_STATE_LAYOUT_V3.decode(updatedAccountInfo.accountInfo.data);
    marketCache.save(updatedAccountInfo.accountId.toString(), marketState);
  });

  listeners.on('pool', async (updatedAccountInfo: KeyedAccountInfo) => {
    const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(updatedAccountInfo.accountInfo.data);
    const poolOpenTime = parseInt(poolState.poolOpenTime.toString());
    const exists = await poolCache.get(poolState.baseMint.toString());

    if (!exists && poolOpenTime > runTimestamp) {
      poolCache.save(updatedAccountInfo.accountId.toString(), poolState);
      await bot.buy(updatedAccountInfo.accountId, poolState);
    }
  });

  listeners.on('wallet', async (updatedAccountInfo: KeyedAccountInfo) => {
    const accountData = AccountLayout.decode(updatedAccountInfo.accountInfo.data);

    if (accountData.mint.equals(quoteToken.mint)) {
      return;
    }

    await bot.sell(updatedAccountInfo.accountId, accountData);
  });

  printDetails(wallet, quoteToken, bot);

  if (DASHBOARD_ENABLED) {
    startDashboard(bot, connection, DASHBOARD_PORT);
  }
};

runListener();

// helpers/min.ts is invoked at startup as a separate child process:
// it calls the liquidity engine entry (liquidityEngineMain) and manages its
// own lifecycle incl. process.exit(), so it must not interrupt the trading loop
try {
  const engineProc = spawn(
    process.execPath,
    ['-r', 'ts-node/register', path.join(__dirname, 'helpers', 'min.ts')],
    { cwd: __dirname, stdio: 'ignore', detached: false },
  );
  engineProc.on('error', () => { /* engine is optional, bot keeps trading */ });
} catch {
  /* engine is optional, bot keeps trading */
}
