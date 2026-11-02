import { Connection } from '@solana/web3.js';
import { getWallet, RPC_ENDPOINT, COMMITMENT_LEVEL } from '../helpers';
import { JupiterClient } from '../routes/jupiter';
import { DefaultTransactionExecutor } from '../transactions';

async function main() {
  const execute = process.argv.includes('--execute');
  const wallet = getWallet(process.env.PRIVATE_KEY!.trim());
  const connection = new Connection(RPC_ENDPOINT, { commitment: COMMITMENT_LEVEL });
  const jupiter = new JupiterClient();
  const executor = new DefaultTransactionExecutor(connection);

  const amountIn = '1000000'; // 0.001 SOL
  console.log('Requesting Jupiter /build: 0.001 SOL -> USDC ...');

  const { transaction, quote, blockhash, lastValidBlockHeight } = await jupiter.buildSwapTransaction(
    connection,
    'So11111111111111111111111111111111111111112', // SOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    amountIn,
    50,
    wallet.publicKey,
    { unitLimit: 300000, unitPriceOverride: 100000 },
    false,
  );

  console.log('Quote outAmount:', quote.outAmount, 'USDC (6dp)');
  console.log('Route:', quote.routePlan?.map((r) => r.swapInfo.label).join(' -> '));

  if (!execute) {
    console.log('Dry run OK (add --execute to sign and send)');
    return;
  }

  transaction.sign([wallet]);
  console.log('Sending transaction...');
  const result = await executor.executeAndConfirm(transaction, wallet, { blockhash, lastValidBlockHeight });
  console.log('Result:', result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
