import { LIQUIDITY_STATE_LAYOUT_V4, MAINNET_PROGRAM_ID, MARKET_STATE_LAYOUT_V3, Token } from '@raydium-io/raydium-sdk';
import bs58 from 'bs58';
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { EventEmitter } from 'events';
import { PumpFunListener, PumpCreateEvent } from './pump-fun-listener';
import { RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, SNIPE_PUMP_FUN } from '../helpers/constants';
import { logger } from '../helpers/logger';

export class Listeners extends EventEmitter {
  private subscriptions: number[] = [];
  private pumpFunListener?: PumpFunListener;

  constructor(private readonly connection: Connection) {
    super();
  }

  public async start(config: {
    walletPublicKey: PublicKey;
    quoteToken: Token;
    autoSell: boolean;
    cacheNewMarkets: boolean;
    snipePumpFun?: boolean;
  }) {
    if (config.cacheNewMarkets) {
      const openBookSubscription = await this.subscribeToOpenBookMarkets(config);
      this.subscriptions.push(openBookSubscription);
    }

    const raydiumSubscription = await this.subscribeToRaydiumPools(config);
    this.subscriptions.push(raydiumSubscription);

    if (SNIPE_PUMP_FUN || config.snipePumpFun) {
      // dedicated websocket: pump.fun log volume is huge and would otherwise
      // starve the pool/wallet subscriptions on the main connection
      const pumpConnection = new Connection(RPC_ENDPOINT, {
        wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
        commitment: this.connection.commitment,
      });
      this.pumpFunListener = new PumpFunListener(pumpConnection);
      this.pumpFunListener.on('create', (event: PumpCreateEvent) => this.emit('pump', event));
      await this.pumpFunListener.start();
    }

    if (config.autoSell) {
      const walletSubscription = await this.subscribeToWalletChanges(config);
      this.subscriptions.push(walletSubscription);
    }
  }

  private async subscribeToOpenBookMarkets(config: { quoteToken: Token }) {
    return this.connection.onProgramAccountChange(
      MAINNET_PROGRAM_ID.OPENBOOK_MARKET,
      async (updatedAccountInfo) => {
        this.emit('market', updatedAccountInfo);
      },
      this.connection.commitment,
      [
        { dataSize: MARKET_STATE_LAYOUT_V3.span },
        {
          memcmp: {
            offset: MARKET_STATE_LAYOUT_V3.offsetOf('quoteMint'),
            bytes: config.quoteToken.mint.toBase58(),
          },
        },
      ],
    );
  }

  private async subscribeToRaydiumPools(config: { quoteToken: Token }) {
    let notifications = 0;
    return this.connection.onProgramAccountChange(
      MAINNET_PROGRAM_ID.AmmV4,
      async (updatedAccountInfo) => {
        notifications++;
        if (notifications % 500 === 0) {
          logger.trace({ notifications }, `Raydium pool subscription alive`);
        }
        this.emit('pool', updatedAccountInfo);
      },
      this.connection.commitment,
      [
        { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
            bytes: config.quoteToken.mint.toBase58(),
          },
        },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('marketProgramId'),
            bytes: MAINNET_PROGRAM_ID.OPENBOOK_MARKET.toBase58(),
          },
        },
        {
          memcmp: {
            offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('status'),
            bytes: bs58.encode([6, 0, 0, 0, 0, 0, 0, 0]),
          },
        },
      ],
    );
  }

  private async subscribeToWalletChanges(config: { walletPublicKey: PublicKey }) {
    return this.connection.onProgramAccountChange(
      TOKEN_PROGRAM_ID,
      async (updatedAccountInfo) => {
        this.emit('wallet', updatedAccountInfo);
      },
      this.connection.commitment,
      [
        {
          dataSize: 165,
        },
        {
          memcmp: {
            offset: 32,
            bytes: config.walletPublicKey.toBase58(),
          },
        },
      ],
    );
  }

  public async stop() {
    if (this.pumpFunListener) {
      await this.pumpFunListener.stop();
      this.pumpFunListener = undefined;
    }
    for (let i = this.subscriptions.length; i >= 0; --i) {
      const subscription = this.subscriptions[i];
      await this.connection.removeAccountChangeListener(subscription);
      this.subscriptions.splice(i, 1);
    }
  }
}
