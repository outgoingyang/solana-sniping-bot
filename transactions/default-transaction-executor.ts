import {
  BlockhashWithExpiryBlockHeight,
  Connection,
  Keypair,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import { TransactionExecutor } from './transaction-executor.interface';
import { logger } from '../helpers';

export class DefaultTransactionExecutor implements TransactionExecutor {
  constructor(private readonly connection: Connection) {}

  public async executeAndConfirm(
    transaction: VersionedTransaction,
    payer: Keypair,
    latestBlockhash: BlockhashWithExpiryBlockHeight,
  ): Promise<{ confirmed: boolean; signature?: string, error?: string }> {
    logger.debug('Executing transaction...');
    const signature = await this.execute(transaction);

    logger.debug({ signature }, 'Confirming transaction...');
    return this.confirm(signature, latestBlockhash);
  }

  private async execute(transaction: Transaction | VersionedTransaction) {
    return this.connection.sendRawTransaction(transaction.serialize(), {
      preflightCommitment: this.connection.commitment,
      skipPreflight: true,
    });
  }

  private async confirm(signature: string, latestBlockhash: BlockhashWithExpiryBlockHeight) {
    // websocket confirmation first
    try {
      const confirmation = await this.connection.confirmTransaction(
        {
          signature,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          blockhash: latestBlockhash.blockhash,
        },
        this.connection.commitment,
      );

      return { confirmed: !confirmation.value.err, signature };
    } catch (error) {
      logger.trace({ error }, 'Websocket confirmation failed, falling back to signature polling');
    }

    // robust polling fallback (public RPC websockets are often flaky)
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        const status = await this.connection.getSignatureStatus(signature, { searchTransactionHistory: false });
        const value = status?.value;
        if (value) {
          if (value.err) {
            return { confirmed: false, signature, error: JSON.stringify(value.err) };
          }
          if (value.confirmationStatus === 'confirmed' || value.confirmationStatus === 'finalized') {
            return { confirmed: true, signature };
          }
        }
      } catch (error) {
        logger.trace({ error }, 'Signature status poll failed');
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    return { confirmed: false, signature };
  }
}
