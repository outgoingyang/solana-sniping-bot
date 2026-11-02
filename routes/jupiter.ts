import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import axios from 'axios';
import bs58 from 'bs58';
import { JUPITER_API_KEY, JUPITER_API_URL, JUPITER_EXCLUDE_DEXES, JUPITER_MAX_ACCOUNTS, logger } from '../helpers';

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  priceImpactPct?: string;
  routePlan: {
    swapInfo: { ammKey: string; label: string };
  }[];
}

export interface JupiterBuild {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  priceImpactPct?: string;
  routePlan: {
    swapInfo: { ammKey: string; label: string };
  }[];
  computeBudgetInstructions: ApiInstruction[];
  setupInstructions: ApiInstruction[];
  swapInstruction: ApiInstruction;
  cleanupInstruction: ApiInstruction | null;
  tipInstruction: ApiInstruction | null;
  addressesByLookupTableAddress: Record<string, string[]> | null;
  blockhashWithMetadata: { blockhash: number[]; lastValidBlockHeight: number };
}

interface ApiInstruction {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
}

const SOL_MINT = 'So11111111111111111111111111111111111111112';

function toInstruction(ix: ApiInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((acc) => ({
      pubkey: new PublicKey(acc.pubkey),
      isSigner: acc.isSigner,
      isWritable: acc.isWritable,
    })),
    data: Buffer.from(ix.data, 'base64'),
  });
}

function toLookupTables(raw: Record<string, string[]> | null): AddressLookupTableAccount[] {
  if (!raw) return [];
  return Object.entries(raw).map(
    ([key, addresses]) =>
      new AddressLookupTableAccount({
        key: new PublicKey(key),
        state: {
          deactivationSlot: BigInt('18446744073709551615'),
          lastExtendedSlot: 0,
          lastExtendedSlotStartIndex: 0,
          addresses: addresses.map((a) => new PublicKey(a)),
        },
      }),
  );
}

export interface JupiterSwapOptions {
  /** micro lamports per CU, overrides the API value when > 0 */
  unitPriceOverride?: number;
  unitLimit: number;
  /** lamports appended to the tx for jito bundle landing */
  jitoTipLamports?: number;
  jitoTipAccount?: PublicKey;
}

export class JupiterClient {
  private readonly headers: Record<string, string> = {};

  constructor(private readonly apiKey: string = JUPITER_API_KEY, private readonly baseUrl: string = JUPITER_API_URL) {
    if (this.apiKey) {
      this.headers['x-api-key'] = this.apiKey;
    }
  }

  public async getQuote(inputMint: string, outputMint: string, amount: string, slippageBps: number): Promise<JupiterQuote> {
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount,
      slippageBps: String(slippageBps),
    });

    const res = await axios.get(`${this.baseUrl}/build`, { params, headers: this.headers, timeout: 15000 });
    return res.data.quote;
  }

  /**
   * Requests routed swap instructions from Jupiter Swap API V2 (/build) and
   * assembles a ready-to-sign v0 transaction. Routes across all supported
   * DEXes (Raydium AMM/CPMM/CLMM, Orca, Meteora DLMM/DAMM, Pump.fun, Pump AMM,
   * Whirlpool, Lifinity, Phoenix, OpenBook V2, SolFi, Obric, ...).
   */
  public async buildSwapTransaction(
    connection: Connection,
    inputMint: string,
    outputMint: string,
    amountIn: string,
    slippageBps: number,
    taker: PublicKey,
    options: JupiterSwapOptions,
    forJitoBundle: boolean,
  ): Promise<{ transaction: VersionedTransaction; quote: JupiterQuote; blockhash: string; lastValidBlockHeight: number }> {
    const params: Record<string, string> = {
      inputMint,
      outputMint,
      amount: amountIn,
      taker: taker.toString(),
      slippageBps: String(slippageBps),
      maxAccounts: String(JUPITER_MAX_ACCOUNTS),
    };
    if (forJitoBundle) {
      params.forJitoBundle = 'true';
    }
    if (JUPITER_EXCLUDE_DEXES) {
      params.excludeDexes = JUPITER_EXCLUDE_DEXES;
    }

    const res = await axios.get(`${this.baseUrl}/build`, { params, headers: this.headers, timeout: 15000 });
    const build: JupiterBuild = res.data;

    const quote: JupiterQuote = {
      inputMint: build.inputMint,
      outputMint: build.outputMint,
      inAmount: build.inAmount,
      outAmount: build.outAmount,
      otherAmountThreshold: build.otherAmountThreshold,
      slippageBps: build.slippageBps,
      priceImpactPct: build.priceImpactPct,
      routePlan: build.routePlan,
    };
    logger.debug(
      {
        out: quote.outAmount,
        impact: quote.priceImpactPct,
        route: quote.routePlan?.map((r) => r.swapInfo.label).join(' -> '),
      },
      `Jupiter route`,
    );

    const lookupTables = toLookupTables(build.addressesByLookupTableAddress);

    const swapInstructions = [
      ...build.setupInstructions.map(toInstruction),
      toInstruction(build.swapInstruction),
      ...(build.cleanupInstruction ? [toInstruction(build.cleanupInstruction)] : []),
    ];

    // compute budget: our own CU limit + (dynamic) CU price
    const budgetInstructions: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: Math.min(options.unitLimit, 1_400_000) }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: options.unitPriceOverride ?? 0 }),
    ];

    const jitoTip =
      options.jitoTipLamports && options.jitoTipAccount
        ? [
            SystemProgram.transfer({
              fromPubkey: taker,
              toPubkey: options.jitoTipAccount,
              lamports: options.jitoTipLamports,
            }),
          ]
        : [];

    const messageV0 = new TransactionMessage({
      payerKey: taker,
      recentBlockhash: bs58.encode(Buffer.from(build.blockhashWithMetadata.blockhash)),
      instructions: [...budgetInstructions, ...swapInstructions, ...jitoTip],
    }).compileToV0Message(lookupTables);

    return {
      transaction: new VersionedTransaction(messageV0),
      quote,
      blockhash: bs58.encode(Buffer.from(build.blockhashWithMetadata.blockhash)),
      lastValidBlockHeight: build.blockhashWithMetadata.lastValidBlockHeight,
    };
  }

  public isSolMint(mint: string): boolean {
    return mint === SOL_MINT;
  }
}
