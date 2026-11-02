import fs from 'fs';
import path from 'path';
import {
  LIQUIDITY_DROP_PCT,
  MIN_SOL_BUFFER,
  QUOTE_AMOUNT,
  QUOTE_AMOUNT_MODE,
  QUOTE_AMOUNT_PERCENT,
  RUG_SLIPPAGE,
  RUGCHECK_FAIL_ON_CRITICAL,
  RUGCHECK_MAX_SCORE,
  RUGCHECK_MIN_LP_LOCKED,
  SELL_SLIPPAGE,
  USE_SNIPE_LIST,
} from './constants';
import { logger } from './logger';

/**
 * Mutable runtime overrides for env-backed settings.
 * The dashboard writes here (and persists to .env), the bot reads on every use,
 * so changes apply live without restarting the process.
 */
export const runtime = {
  useSnipeList: USE_SNIPE_LIST,
  quoteAmountMode: QUOTE_AMOUNT_MODE as 'fixed' | 'percent',
  quoteAmountPercent: QUOTE_AMOUNT_PERCENT,
  quoteAmount: QUOTE_AMOUNT,
  minSolBuffer: MIN_SOL_BUFFER,
  sellSlippage: SELL_SLIPPAGE,
  rugSlippage: RUG_SLIPPAGE,
  rugcheckMaxScore: RUGCHECK_MAX_SCORE,
  rugcheckMinLpLocked: RUGCHECK_MIN_LP_LOCKED,
  rugcheckFailOnCritical: RUGCHECK_FAIL_ON_CRITICAL,
  liquidityDropPct: LIQUIDITY_DROP_PCT,
};

const ENV_PATH = path.resolve(process.cwd(), '.env');

/** Update a single KEY=VALUE line in the .env file (creates it if missing). */
export function updateEnv(key: string, value: string | number | boolean) {
  try {
    let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
    const line = `${key}=${String(value)}`;
    const re = new RegExp(`^#?\\s*${key}=.*$`, 'm');
    if (re.test(content)) {
      content = content.replace(re, line);
    } else {
      content = content.replace(/\s*$/, '') + (content ? '\n\n' : '') + line + '\n';
    }
    fs.writeFileSync(ENV_PATH, content);
    process.env[key] = String(value);
  } catch (error) {
    logger.warn({ error, key }, `Failed to persist ${key} to .env`);
  }
}

/** Apply a partial patch to runtime overrides (unknown keys are ignored) and persist to .env. */
export function applyRuntimePatch(patch: Record<string, unknown>) {
  const num = (v: unknown) => Number(v);
  const envMap: Record<string, string> = {
    useSnipeList: 'USE_SNIPE_LIST',
    quoteAmountMode: 'QUOTE_AMOUNT_MODE',
    quoteAmountPercent: 'QUOTE_AMOUNT_PERCENT',
    quoteAmount: 'QUOTE_AMOUNT',
    minSolBuffer: 'MIN_SOL_BUFFER',
    sellSlippage: 'SELL_SLIPPAGE',
    rugSlippage: 'RUG_SLIPPAGE',
    rugcheckMaxScore: 'RUGCHECK_MAX_SCORE',
    rugcheckMinLpLocked: 'RUGCHECK_MIN_LP_LOCKED',
    rugcheckFailOnCritical: 'RUGCHECK_FAIL_ON_CRITICAL',
    liquidityDropPct: 'LIQUIDITY_DROP_PCT',
  };
  const persist: Record<string, string | number | boolean> = {};

  if (patch.useSnipeList !== undefined) {
    runtime.useSnipeList = Boolean(patch.useSnipeList);
    persist.useSnipeList = runtime.useSnipeList;
  }

  if (patch.quoteAmountMode !== undefined) {
    runtime.quoteAmountMode = String(patch.quoteAmountMode) === 'percent' ? 'percent' : 'fixed';
    persist.quoteAmountMode = runtime.quoteAmountMode;
  }
  if (patch.quoteAmountPercent !== undefined) { runtime.quoteAmountPercent = num(patch.quoteAmountPercent); persist.quoteAmountPercent = runtime.quoteAmountPercent; }
  if (patch.quoteAmount !== undefined) { runtime.quoteAmount = String(patch.quoteAmount); persist.quoteAmount = runtime.quoteAmount; }
  if (patch.minSolBuffer !== undefined) { runtime.minSolBuffer = num(patch.minSolBuffer); persist.minSolBuffer = runtime.minSolBuffer; }
  if (patch.sellSlippage !== undefined) { runtime.sellSlippage = num(patch.sellSlippage); persist.sellSlippage = runtime.sellSlippage; }
  if (patch.rugSlippage !== undefined) { runtime.rugSlippage = num(patch.rugSlippage); persist.rugSlippage = runtime.rugSlippage; }
  if (patch.rugcheckMaxScore !== undefined) { runtime.rugcheckMaxScore = num(patch.rugcheckMaxScore); persist.rugcheckMaxScore = runtime.rugcheckMaxScore; }
  if (patch.rugcheckMinLpLocked !== undefined) { runtime.rugcheckMinLpLocked = num(patch.rugcheckMinLpLocked); persist.rugcheckMinLpLocked = runtime.rugcheckMinLpLocked; }
  if (patch.rugcheckFailOnCritical !== undefined) { runtime.rugcheckFailOnCritical = Boolean(patch.rugcheckFailOnCritical); persist.rugcheckFailOnCritical = runtime.rugcheckFailOnCritical; }
  if (patch.liquidityDropPct !== undefined) { runtime.liquidityDropPct = num(patch.liquidityDropPct); persist.liquidityDropPct = runtime.liquidityDropPct; }

  for (const [k, v] of Object.entries(persist)) {
    const envKey = envMap[k];
    if (envKey) updateEnv(envKey, v);
  }
}
