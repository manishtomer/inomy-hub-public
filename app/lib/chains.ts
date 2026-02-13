import { Chain } from 'viem';

/**
 * Monad Testnet Chain Configuration
 *
 * Monad is a high-performance EVM-compatible blockchain.
 * This configuration enables wallet connections to the Monad testnet.
 */
export const monadTestnet: Chain = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: {
    decimals: 18,
    name: 'Monad',
    symbol: 'MON',
  },
  rpcUrls: {
    default: {
      http: ['https://testnet-rpc.monad.xyz'],
    },
    public: {
      http: ['https://testnet-rpc.monad.xyz'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Monad Explorer',
      url: 'https://testnet.monadexplorer.com',
    },
  },
  testnet: true,
};

/**
 * All supported chains for Inomy Hub
 */
export const supportedChains = [monadTestnet] as const;

/**
 * Default chain for the application
 */
export const defaultChain = monadTestnet;
