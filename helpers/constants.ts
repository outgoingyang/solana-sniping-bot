import { Commitment } from '@solana/web3.js';
import dotenv from 'dotenv';
import { logger } from './logger';

dotenv.config();

const retrieveEnvVariableOptional = (variableName: string, defaultValue: string) => {
  const variable = process.env[variableName];
  return variable === undefined || variable === '' ? defaultValue : variable;
};

// Wallet (empty => a temporary wallet is generated at startup; set a real one via dashboard "Add wallet")
export const PRIVATE_KEY = retrieveEnvVariableOptional('PRIVATE_KEY', '');

// Connection
export const NETWORK = 'mainnet-beta';
export const COMMITMENT_LEVEL: Commitment = retrieveEnvVariableOptional('COMMITMENT_LEVEL', 'confirmed') as Commitment;
export const RPC_ENDPOINT = retrieveEnvVariableOptional('RPC_ENDPOINT', 'https://api.mainnet-beta.solana.com');
export const RPC_WEBSOCKET_ENDPOINT = retrieveEnvVariableOptional('RPC_WEBSOCKET_ENDPOINT', 'wss://api.mainnet-beta.solana.com');

// Bot
export const LOG_LEVEL = retrieveEnvVariableOptional('LOG_LEVEL', 'info');
export const MAX_TOKENS_AT_THE_TIME = Number(retrieveEnvVariableOptional('MAX_TOKENS_AT_THE_TIME', '1'));
export const COMPUTE_UNIT_LIMIT = Number(retrieveEnvVariableOptional('COMPUTE_UNIT_LIMIT', '400000'));
export const COMPUTE_UNIT_PRICE = Number(retrieveEnvVariableOptional('COMPUTE_UNIT_PRICE', '0'));
export const PRE_LOAD_EXISTING_MARKETS = retrieveEnvVariableOptional('PRE_LOAD_EXISTING_MARKETS', 'false') === 'true';
export const CACHE_NEW_MARKETS = retrieveEnvVariableOptional('CACHE_NEW_MARKETS', 'false') === 'true';
export const TRANSACTION_EXECUTOR = retrieveEnvVariableOptional('TRANSACTION_EXECUTOR', 'default');
export const CUSTOM_FEE = retrieveEnvVariableOptional('CUSTOM_FEE', '0.0001');

// Buy
export const AUTO_BUY_DELAY = Number(retrieveEnvVariableOptional('AUTO_BUY_DELAY', '0'));
export const QUOTE_MINT = retrieveEnvVariableOptional('QUOTE_MINT', 'SOL');
export const QUOTE_AMOUNT = retrieveEnvVariableOptional('QUOTE_AMOUNT', '0.01');
export const MAX_BUY_RETRIES = Number(retrieveEnvVariableOptional('MAX_BUY_RETRIES', '3'));
export const BUY_SLIPPAGE = Number(retrieveEnvVariableOptional('BUY_SLIPPAGE', '20'));

// Sell
export const AUTO_SELL = retrieveEnvVariableOptional('AUTO_SELL', 'true') === 'true';
export const AUTO_SELL_DELAY = Number(retrieveEnvVariableOptional('AUTO_SELL_DELAY', '0'));
export const MAX_SELL_RETRIES = Number(retrieveEnvVariableOptional('MAX_SELL_RETRIES', '3'));
export const TAKE_PROFIT = Number(retrieveEnvVariableOptional('TAKE_PROFIT', '5'));
export const STOP_LOSS = Number(retrieveEnvVariableOptional('STOP_LOSS', '25'));
export const TRAILING_STOP_LOSS = retrieveEnvVariableOptional('TRAILING_STOP_LOSS', 'true') === 'true';
export const PRICE_CHECK_INTERVAL = Number(retrieveEnvVariableOptional('PRICE_CHECK_INTERVAL', '2500'));
export const PRICE_CHECK_DURATION = Number(retrieveEnvVariableOptional('PRICE_CHECK_DURATION', '180000'));
export const SELL_SLIPPAGE = Number(retrieveEnvVariableOptional('SELL_SLIPPAGE', '20'));
export const SKIP_SELLING_IF_LOST_MORE_THAN = Number(retrieveEnvVariableOptional('SKIP_SELLING_IF_LOST_MORE_THAN', '90'));

// Filters
export const FILTER_CHECK_INTERVAL = Number(retrieveEnvVariableOptional('FILTER_CHECK_INTERVAL', '2000'));
export const FILTER_CHECK_DURATION = Number(retrieveEnvVariableOptional('FILTER_CHECK_DURATION', '0'));
export const CONSECUTIVE_FILTER_MATCHES = Number(retrieveEnvVariableOptional('CONSECUTIVE_FILTER_MATCHES', '1'));
export const CHECK_IF_MUTABLE = retrieveEnvVariableOptional('CHECK_IF_MUTABLE', 'false') === 'true';
export const CHECK_IF_SOCIALS = retrieveEnvVariableOptional('CHECK_IF_SOCIALS', 'false') === 'true';
export const CHECK_IF_MINT_IS_RENOUNCED = retrieveEnvVariableOptional('CHECK_IF_MINT_IS_RENOUNCED', 'false') === 'true';
export const CHECK_IF_FREEZABLE = retrieveEnvVariableOptional('CHECK_IF_FREEZABLE', 'false') === 'true';
export const CHECK_IF_BURNED = retrieveEnvVariableOptional('CHECK_IF_BURNED', 'false') === 'true';
export const MIN_POOL_SIZE = retrieveEnvVariableOptional('MIN_POOL_SIZE', '0');
export const MAX_POOL_SIZE = retrieveEnvVariableOptional('MAX_POOL_SIZE', '0');
export const USE_SNIPE_LIST = retrieveEnvVariableOptional('USE_SNIPE_LIST', 'false') === 'true';
export const SNIPE_LIST_REFRESH_INTERVAL = Number(retrieveEnvVariableOptional('SNIPE_LIST_REFRESH_INTERVAL', '30000'));

// Jupiter aggregator (Swap API V2 router: https://api.jup.ag/swap/v2/build)
export const JUPITER_API_URL = retrieveEnvVariableOptional('JUPITER_API_URL', 'https://api.jup.ag/swap/v2');
export const JUPITER_API_KEY = retrieveEnvVariableOptional('JUPITER_API_KEY', '');
// auto: raydium for fresh-pool snipes (lowest latency) + jupiter fallback when raydium route is unavailable
export const BUY_EXECUTION = retrieveEnvVariableOptional('BUY_EXECUTION', 'auto');
export const SELL_EXECUTION = retrieveEnvVariableOptional('SELL_EXECUTION', 'auto');
export const JUPITER_MAX_ACCOUNTS = Number(retrieveEnvVariableOptional('JUPITER_MAX_ACCOUNTS', '64'));
export const JUPITER_EXCLUDE_DEXES = retrieveEnvVariableOptional('JUPITER_EXCLUDE_DEXES', '');

// Quote amount: 'fixed' uses QUOTE_AMOUNT, 'percent' spends QUOTE_AMOUNT_PERCENT % of wallet quote balance
export const QUOTE_AMOUNT_MODE = retrieveEnvVariableOptional('QUOTE_AMOUNT_MODE', 'fixed');
export const QUOTE_AMOUNT_PERCENT = Number(retrieveEnvVariableOptional('QUOTE_AMOUNT_PERCENT', '50'));
export const MIN_SOL_BUFFER = Number(retrieveEnvVariableOptional('MIN_SOL_BUFFER', '0.01'));
// keep this much WSOL in the wallet at startup (wrapped 1:1 from SOL, no swap fee); 0 = off
export const WRAP_SOL_AT_START = Number(retrieveEnvVariableOptional('WRAP_SOL_AT_START', '0'));

// Dynamic priority fees (from recent network fees, percentile based)
export const DYNAMIC_PRIORITY_FEES = retrieveEnvVariableOptional('DYNAMIC_PRIORITY_FEES', 'true') === 'true';
export const PRIORITY_FEE_PERCENTILE = Number(retrieveEnvVariableOptional('PRIORITY_FEE_PERCENTILE', '90'));
export const MAX_PRIORITY_FEE = Number(retrieveEnvVariableOptional('MAX_PRIORITY_FEE', '2000000'));
export const MIN_PRIORITY_FEE = Number(retrieveEnvVariableOptional('MIN_PRIORITY_FEE', '50000'));

// Jito
export const JITO_DYNAMIC_TIP = retrieveEnvVariableOptional('JITO_DYNAMIC_TIP', 'true') === 'true';
export const JITO_TIP_PERCENTILE = Number(retrieveEnvVariableOptional('JITO_TIP_PERCENTILE', '75'));
export const MIN_JITO_TIP_SOL = Number(retrieveEnvVariableOptional('MIN_JITO_TIP_SOL', '0.0001'));
export const MAX_JITO_TIP_SOL = Number(retrieveEnvVariableOptional('MAX_JITO_TIP_SOL', '0.01'));

// RugCheck.xyz deep analysis (score_normalised 0-100+, lp lock, risks)
export const RUG_CHECK = retrieveEnvVariableOptional('RUG_CHECK', 'false') === 'true';
export const RUGCHECK_MAX_SCORE = Number(retrieveEnvVariableOptional('RUGCHECK_MAX_SCORE', '5000'));
export const RUGCHECK_MIN_LP_LOCKED = Number(retrieveEnvVariableOptional('RUGCHECK_MIN_LP_LOCKED', '0'));
export const RUGCHECK_FAIL_ON_CRITICAL = retrieveEnvVariableOptional('RUGCHECK_FAIL_ON_CRITICAL', 'true') === 'true';

// Top holders concentration (freeze authority / whale dump protection)
export const CHECK_TOP_HOLDERS = retrieveEnvVariableOptional('CHECK_TOP_HOLDERS', 'false') === 'true';
export const MAX_TOP_HOLDER_PCT = Number(retrieveEnvVariableOptional('MAX_TOP_HOLDER_PCT', '35'));
export const TOP_HOLDERS_TO_CHECK = Number(retrieveEnvVariableOptional('TOP_HOLDERS_TO_CHECK', '10'));

// Rug pull protection: emergency sell when pool liquidity / position value collapses
export const RUG_PULL_PROTECTION = retrieveEnvVariableOptional('RUG_PULL_PROTECTION', 'true') === 'true';
export const LIQUIDITY_DROP_PCT = Number(retrieveEnvVariableOptional('LIQUIDITY_DROP_PCT', '35'));
export const LIQUIDITY_CHECK_INTERVAL = Number(retrieveEnvVariableOptional('LIQUIDITY_CHECK_INTERVAL', '3000'));
export const LIQUIDITY_CHECK_DURATION = Number(retrieveEnvVariableOptional('LIQUIDITY_CHECK_DURATION', '180000'));
export const RUG_SLIPPAGE = Number(retrieveEnvVariableOptional('RUG_SLIPPAGE', '49'));

// Buy the dip: average down when price drops DIP_TRIGGER_PCT % below entry
export const BUY_THE_DIP = retrieveEnvVariableOptional('BUY_THE_DIP', 'false') === 'true';
export const DIP_TRIGGER_PCT = Number(retrieveEnvVariableOptional('DIP_TRIGGER_PCT', '25'));
export const DIP_MAX_BUYS = Number(retrieveEnvVariableOptional('DIP_MAX_BUYS', '2'));
export const DIP_COOLDOWN_MS = Number(retrieveEnvVariableOptional('DIP_COOLDOWN_MS', '60000'));
export const DIP_AMOUNT_MULTIPLIER = Number(retrieveEnvVariableOptional('DIP_AMOUNT_MULTIPLIER', '1'));

// Trade journal (P&L stats)
export const STATS_FILE = retrieveEnvVariableOptional('STATS_FILE', 'stats.json');

// Web dashboard (Phantom-style UI at http://localhost:DASHBOARD_PORT)
export const DASHBOARD_ENABLED = retrieveEnvVariableOptional('DASHBOARD_ENABLED', 'true') === 'true';
export const DASHBOARD_PORT = Number(retrieveEnvVariableOptional('DASHBOARD_PORT', '3000'));

// Pump.fun launch sniping (real-time CreateEvent decoding, buys routed via Jupiter)
// WARNING: needs a dedicated RPC plan — free Helius (and public RPC) block
// pump.fun program subscriptions/signature lookups, so launches are missed.
export const SNIPE_PUMP_FUN = retrieveEnvVariableOptional('SNIPE_PUMP_FUN', 'false') === 'true';
export const PUMP_MIN_INITIAL_SOL = Number(retrieveEnvVariableOptional('PUMP_MIN_INITIAL_SOL', '0'));
export const PUMP_AUTO_BUY_DELAY = Number(retrieveEnvVariableOptional('PUMP_AUTO_BUY_DELAY', '0'));

// Momentum scanner (HTTPS polling over the Jupiter Token API — works on free RPC):
// finds fresh tokens with 5-minute momentum and trades them via Jupiter.
export const SCANNER_MODE = retrieveEnvVariableOptional('SCANNER_MODE', 'false') === 'true';
export const SCANNER_POLL_INTERVAL = Number(retrieveEnvVariableOptional('SCANNER_POLL_INTERVAL', '10000'));
export const SCANNER_MIN_LIQUIDITY_USD = Number(retrieveEnvVariableOptional('SCANNER_MIN_LIQUIDITY_USD', '5000'));
export const SCANNER_MIN_MOMENTUM_5M = Number(retrieveEnvVariableOptional('SCANNER_MIN_MOMENTUM_5M', '10'));
export const SCANNER_MIN_HOLDERS = Number(retrieveEnvVariableOptional('SCANNER_MIN_HOLDERS', '30'));
export const SCANNER_MAX_DEV_PCT = Number(retrieveEnvVariableOptional('SCANNER_MAX_DEV_PCT', '10'));
export const SCANNER_MAX_TOKEN_AGE_MIN = Number(retrieveEnvVariableOptional('SCANNER_MAX_TOKEN_AGE_MIN', '0'));
