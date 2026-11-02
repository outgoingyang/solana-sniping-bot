import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { getWallet, RPC_ENDPOINT, COMMITMENT_LEVEL } from '../helpers';
import { JupiterClient } from '../routes/jupiter';
import { DefaultTransactionExecutor } from '../transactions';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL = 'So11111111111111111111111111111111111111112';

async function main() {
  const execute = process.argv.includes('--execute');
  const wallet = getWallet(process.env.PRIVATE_KEY!.trim());
  const connection = new Connection(RPC_ENDPOINT, { commitment: COMMITMENT_LEVEL });
  const jupiter = new JupiterClient();
  const executor = new DefaultTransactionExecutor(connection);

  const ata = getAssociatedTokenAddressSync(new PublicKey(USDC), wallet.publicKey);
  const balance = await connection.getTokenAccountBalance(ata);
  const amount = balance.value.amount;
  console.log('USDC balance:', amount);

  if (amount === '0') {
    console.log('Nothing to sell');
    return;
  }

  const { transaction, quote, blockhash, lastValidBlockHeight } = await jupiter.buildSwapTransaction(
    connection,
    USDC,
    SOL,
    amount,
    50,
    wallet.publicKey,
    { unitLimit: 300000, unitPriceOverride: 100000 },
    false,
  );

  console.log('Quote: sell', amount, 'USDC units ->', quote.outAmount, 'lamports');
  console.log('Route:', quote.routePlan?.map((r) => r.swapInfo.label).join(' -> '));

  if (!execute) {
    console.log('Dry run OK');
    return;
  }

  transaction.sign([wallet]);
  const result = await executor.executeAndConfirm(transaction, wallet, { blockhash, lastValidBlockHeight });
  console.log('Result:', result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
