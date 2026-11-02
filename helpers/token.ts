import { Token } from '@raydium-io/raydium-sdk';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

export function getToken(token: string) {
  switch (token.toUpperCase()) {
    case 'WSOL':
    case 'SOL': {
      return Token.WSOL;
    }
    case 'USDC': {
      return new Token(
        TOKEN_PROGRAM_ID,
        new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
        6,
        'USDC',
        'USDC',
      );
    }
    default: {
      throw new Error(`Unsupported quote mint "${token}". Supported values are USDC, WSOL and SOL`);
    }
  }
}

/** True when QUOTE_MINT is native SOL (Jupiter path wraps/unwraps automatically). */
export function isNativeSolMode(quoteMint: string): boolean {
  return quoteMint.toUpperCase() === 'SOL';
}
