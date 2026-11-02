import { Connection } from '@solana/web3.js';
import { getWallet, RPC_ENDPOINT, COMMITMENT_LEVEL } from '../helpers';
import { JupiterClient } from '../routes/jupiter';

async function main() {
  const wallet = getWallet(process.env.PRIVATE_KEY!.trim());
  const connection = new Connection(RPC_ENDPOINT, { commitment: COMMITMENT_LEVEL });
  const jupiter = new JupiterClient();

  // CAPY token from the failed trade
  const { transaction, quote } = await jupiter.buildSwapTransaction(
    connection,
    'So11111111111111111111111111111111111111112',
    '5DnWmSL9t3YqK5MeYq8ozJpna46VcdePWzHvyN8avg2g',
    '4172891',
    20,
    wallet.publicKey,
    { unitLimit: 400000, unitPriceOverride: 100000 },
    false,
  );

  console.log('quote out:', quote.outAmount, 'route:', quote.routePlan?.map((r) => r.swapInfo.label).join(' -> '));

  const sim = await connection.simulateTransaction(transaction, { sigVerify: false, replaceRecentBlockhash: false });
  console.log('simulation err:', JSON.stringify(sim.value.err));
  console.log('logs:', sim.value.logs?.slice(-12));
  console.log('units consumed:', sim.value.unitsConsumed);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
