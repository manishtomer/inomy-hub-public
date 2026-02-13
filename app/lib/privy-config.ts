import { PrivyClientConfig } from '@privy-io/react-auth';
import { monadTestnet } from './chains';

/**
 * Privy Configuration for Inomy Hub
 *
 * This configuration sets up:
 * - Login methods (email + MetaMask)
 * - Dark theme with cyber gold accent
 * - Monad Testnet as default chain
 * - Embedded wallet settings
 */
export const privyConfig: PrivyClientConfig = {
  // Login methods
  loginMethods: ['email', 'wallet'],

  // Appearance - dark theme with cyber gold
  appearance: {
    theme: 'dark',
    accentColor: '#d4a012', // Cyber gold
    logo: undefined, // Can be set to your logo URL
    showWalletLoginFirst: false, // Email first, then wallet
  },

  // Embedded wallet configuration
  embeddedWallets: {
    ethereum: {
      createOnLogin: 'users-without-wallets' as const,
    },
  },

  // Default chain
  defaultChain: monadTestnet,

  // Supported chains
  supportedChains: [monadTestnet],

  // Wallet configuration
  walletConnectCloudProjectId: undefined, // Optional: Add WalletConnect project ID
};
