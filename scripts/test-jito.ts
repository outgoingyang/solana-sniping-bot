import { Connection } from '@solana/web3.js';
import { getWallet, RPC_ENDPOINT, COMMITMENT_LEVEL } from '../helpers';
import { JupiterClient } from '../routes/jupiter';
import { JitoTransactionExecutor } from '../transactions';

async function main() {
  const execute = process.argv.includes('--execute');
  const wallet = getWallet(process.env.PRIVATE_KEY!.trim());
  const connection = new Connection(RPC_ENDPOINT, { commitment: COMMITMENT_LEVEL });
  const jupiter = new JupiterClient();
  const executor = new JitoTransactionExecutor('0.0001', connection, {
    dynamicTip: true,
    tipPercentile: 25,
    minTipSol: 0.000001,
    maxTipSol: 0.001,
  });

  const tipLamports = await executor.computeTipLamports();
  const tipAccount = executor.getRandomTipAccount();
  console.log('Jito tip:', tipLamports, 'lamports ->', tipAccount.toString());
  console.log('Tip floor:', JSON.stringify(await executor.getTipFloor()));

  const { transaction, blockhash, lastValidBlockHeight } = await jupiter.buildSwapTransaction(
    connection,
    'So11111111111111111111111111111111111111112',
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    '1000000', // 0.001 SOL
    50,
    wallet.publicKey,
    { unitLimit: 300000, unitPriceOverride: 100000, jitoTipLamports: tipLamports, jitoTipAccount: tipAccount },
    true,
  );

  if (!execute) {
    console.log('Dry run OK (add --execute to send the bundle)');
    return;
  }

  transaction.sign([wallet]);
  console.log('Sending jito bundle...');
  const result = await executor.executeAndConfirm(transaction, wallet, { blockhash, lastValidBlockHeight });
  console.log('Result:', result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
