import http from 'http';
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { Bot } from '../bot';
import { logBuffer } from '../helpers/logger';
import { TradeStats } from '../helpers/stats';
import { logger } from '../helpers/logger';
import { STATS_FILE } from '../helpers/constants';
import { applyRuntimePatch, runtime, updateEnv } from '../helpers/runtime';
import { dashboardHtml } from './index.html';

const stats = new TradeStats(STATS_FILE);

/** Merged view of bot config + runtime overrides for the dashboard settings panel. */
function currentConfig(bot: Bot) {
  const cfg = (bot as any).config;
  return {
    // sell / position management
    takeProfit: cfg.takeProfit,
    stopLoss: cfg.stopLoss,
    trailingStopLoss: cfg.trailingStopLoss,
    skipSellingIfLostMoreThan: cfg.skipSellingIfLostMoreThan,
    priceCheckInterval: cfg.priceCheckInterval,
    priceCheckDuration: cfg.priceCheckDuration,
    sellSlippage: cfg.sellSlippage,
    maxTokensAtTheTime: cfg.maxTokensAtTheTime,
    paused: bot.paused,
    // buy sizing (runtime)
    quoteAmountMode: runtime.quoteAmountMode,
    quoteAmountPercent: runtime.quoteAmountPercent,
    quoteAmount: runtime.quoteAmount,
    minSolBuffer: runtime.minSolBuffer,
    // slippage / protection (runtime)
    rugSlippage: runtime.rugSlippage,
    liquidityDropPct: runtime.liquidityDropPct,
    rugcheckMaxScore: runtime.rugcheckMaxScore,
    rugcheckMinLpLocked: runtime.rugcheckMinLpLocked,
    rugcheckFailOnCritical: runtime.rugcheckFailOnCritical,
  };
}

/** Env names for bot-managed config fields, so dashboard edits survive restarts. */
const CFG_ENV: Record<string, string> = {
  takeProfit: 'TAKE_PROFIT',
  stopLoss: 'STOP_LOSS',
  trailingStopLoss: 'TRAILING_STOP_LOSS',
  skipSellingIfLostMoreThan: 'SKIP_SELLING_IF_LOST_MORE_THAN',
  priceCheckInterval: 'PRICE_CHECK_INTERVAL',
  priceCheckDuration: 'PRICE_CHECK_DURATION',
  sellSlippage: 'SELL_SLIPPAGE',
  maxTokensAtTheTime: 'MAX_TOKENS_AT_THE_TIME',
};

/** Apply a dashboard patch: bot-managed fields go to cfg/bot, env-backed ones to runtime (.env persisted). */
function applyConfigPatch(bot: Bot, patch: Record<string, unknown>) {
  const cfg = (bot as any).config;
  const num = (v: unknown) => Number(v);
  const persist: Record<string, string | number | boolean> = {};
  if (patch.takeProfit !== undefined) { cfg.takeProfit = num(patch.takeProfit); persist.takeProfit = cfg.takeProfit; }
  if (patch.stopLoss !== undefined) { cfg.stopLoss = num(patch.stopLoss); persist.stopLoss = cfg.stopLoss; }
  if (patch.trailingStopLoss !== undefined) { cfg.trailingStopLoss = Boolean(patch.trailingStopLoss); persist.trailingStopLoss = cfg.trailingStopLoss; }
  if (patch.skipSellingIfLostMoreThan !== undefined) { cfg.skipSellingIfLostMoreThan = num(patch.skipSellingIfLostMoreThan); persist.skipSellingIfLostMoreThan = cfg.skipSellingIfLostMoreThan; }
  if (patch.priceCheckInterval !== undefined) { cfg.priceCheckInterval = num(patch.priceCheckInterval); persist.priceCheckInterval = cfg.priceCheckInterval; }
  if (patch.priceCheckDuration !== undefined) { cfg.priceCheckDuration = num(patch.priceCheckDuration); persist.priceCheckDuration = cfg.priceCheckDuration; }
  if (patch.sellSlippage !== undefined) { cfg.sellSlippage = num(patch.sellSlippage); persist.sellSlippage = cfg.sellSlippage; }
  if (patch.maxTokensAtTheTime !== undefined) { cfg.maxTokensAtTheTime = num(patch.maxTokensAtTheTime); persist.maxTokensAtTheTime = cfg.maxTokensAtTheTime; }
  if (patch.paused !== undefined) {
    bot.paused = Boolean(patch.paused);
    // START pressed in "only my list" mode: buy list tokens now and
    // put them through the same TP/SL/rug lifecycle as sniped tokens
    if (!bot.paused && runtime.useSnipeList) {
      logger.info(`Dashboard: START in snipe-list mode — buying listed tokens`);
      void bot.buySnipeListNow().catch((error) => logger.warn({ error }, `Snipe list run failed`));
    }
  }
  applyRuntimePatch(patch);
  for (const [k, v] of Object.entries(persist)) updateEnv(CFG_ENV[k], v);
}

export function startDashboard(bot: Bot, connection: Connection, port: number) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    try {
      if (url.pathname === '/api/state') {
        const snapshot = bot.dashboardSnapshot();
        const walletPubkey = new PublicKey(snapshot.wallet as string);
        const [sol, wsol] = await Promise.all([
          connection.getBalance(walletPubkey),
          connection.getTokenAccountBalance(NATIVE_MINT).catch(() => null),
        ]);
        const body = JSON.stringify({
          ...snapshot,
          solBalance: sol / LAMPORTS_PER_SOL,
          wsolBalance: wsol ? Number(wsol.value.uiAmount ?? 0) : 0,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(body);
        return;
      }

      if (url.pathname === '/api/logs') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ logs: logBuffer.slice(-300) }));
        return;
      }

      if (url.pathname === '/api/trades') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ trades: [...stats.getRecords()].reverse().slice(0, 100) }));
        return;
      }

      if (url.pathname === '/api/config' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(currentConfig(bot)));
        return;
      }

      if (url.pathname === '/api/config' && req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const patch = JSON.parse(raw || '{}');
        applyConfigPatch(bot, patch);
        logger.info({ patch }, `Dashboard: config updated`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (url.pathname === '/api/wallet' && req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const { privateKey } = JSON.parse(raw || '{}');
        if (!privateKey || typeof privateKey !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'privateKey is required' }));
          return;
        }
        let pubkey: PublicKey;
        try {
          pubkey = await bot.switchWallet(privateKey);
        } catch (error) {
          logger.warn({ error }, `Dashboard: wallet switch failed`);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `Invalid private key: ${String(error)}` }));
          return;
        }
        let sol = 0;
        try {
          sol = (await connection.getBalance(pubkey)) / LAMPORTS_PER_SOL;
        } catch { /* balance read is best-effort */ }
        updateEnv('PRIVATE_KEY', privateKey.trim());
        logger.info({ wallet: pubkey.toString(), sol }, `Dashboard: wallet switched and saved to .env`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, wallet: pubkey.toString(), solBalance: sol }));
        return;
      }

      if (url.pathname === '/api/snipe' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ useSnipeList: runtime.useSnipeList, list: bot.snipeList() }));
        return;
      }

      if (url.pathname === '/api/snipe' && req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const patch = JSON.parse(raw || '{}');

        if (patch.useSnipeList !== undefined) {
          applyRuntimePatch({ useSnipeList: Boolean(patch.useSnipeList) });
          logger.info(`Dashboard: snipe mode -> ${runtime.useSnipeList ? 'only my list' : 'ALL new tokens'}`);
        }
        if (Array.isArray(patch.list)) {
          try {
            const saved = bot.saveSnipeList(patch.list.map(String));
            logger.info({ count: saved.length }, `Dashboard: snipe list saved`);
          } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: `Failed to save list: ${String(error)}` }));
            return;
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, useSnipeList: runtime.useSnipeList, list: bot.snipeList() }));
        return;
      }

      if (url.pathname === '/' || url.pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(dashboardHtml);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"not found"}');
    } catch (error) {
      logger.trace({ error }, `Dashboard request failed`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(error) }));
    }
  });

  server.listen(port, () => {
    logger.info(`Dashboard running at http://localhost:${port}`);
  });
}
