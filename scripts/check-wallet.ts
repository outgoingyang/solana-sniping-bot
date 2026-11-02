import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { getWallet, RPC_ENDPOINT, COMMITMENT_LEVEL } from '../helpers';

async function main() {
  const wallet = getWallet(process.env.PRIVATE_KEY!.trim());
  const connection = new Connection(RPC_ENDPOINT, { commitment: COMMITMENT_LEVEL });

  console.log('Public key:', wallet.publicKey.toString());

  const balance = await connection.getBalance(wallet.publicKey, 'confirmed');
  console.log('SOL balance:', balance / LAMPORTS_PER_SOL);

  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(wallet.publicKey, {
    programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
  });
  for (const { account } of tokenAccounts.value) {
    const info = account.data.parsed.info;
    console.log(`Token: ${info.mint} amount: ${info.tokenAmount.uiAmount}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
