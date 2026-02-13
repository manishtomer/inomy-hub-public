/**
 * Smart Contract Integration Library
 *
 * Provides functions to interact with deployed contracts on Monad testnet:
 * - AgentRegistry: Register agents, get agent info
 * - AgentToken: Buy/sell tokens, get prices
 * - Treasury: Protocol treasury operations
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
  custom,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ============================================================================
// Chain Configuration
// ============================================================================

export const monadTestnet = {
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: {
    name: "Monad",
    symbol: "MON",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://testnet-rpc.monad.xyz"],
    },
  },
  blockExplorers: {
    default: {
      name: "Monad Explorer",
      url: "https://testnet.monadvision.com",
    },
  },
} as const;

// ============================================================================
// Contract Addresses (Deployed on Monad Testnet)
// ============================================================================

export const CONTRACT_ADDRESSES = {
  TREASURY: (process.env.NEXT_PUBLIC_TREASURY_ADDRESS ||
    "0x8723Ab32451C9114143b9784c885fd7eBdBBC490") as Address,
  AGENT_REGISTRY: (process.env.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS ||
    "0xe7dAD10C1274c9E6bb885b36c617b0d310DEF199") as Address,
  TASK_AUCTION: (process.env.NEXT_PUBLIC_TASK_AUCTION_ADDRESS ||
    "0x96dF572c3242631d3Cff4EbCb640971cfb96F833") as Address,
  INTENT_AUCTION: (process.env.NEXT_PUBLIC_INTENT_AUCTION_ADDRESS ||
    "0x48ECD487a9FE688a2904188549a5117def49207e") as Address,
  PARTNERSHIP: (process.env.NEXT_PUBLIC_PARTNERSHIP_ADDRESS ||
    "0xE73655CEb012795CE82E5e92aa50FF9D09eEB0fd") as Address,
  USDC: (process.env.NEXT_PUBLIC_USDC_ADDRESS ||
    "0x534b2f3A21130d7a60830c2Df862319e593943A3") as Address,
} as const;

// ============================================================================
// Contract ABIs (minimal - only functions we need)
// ============================================================================

export const AGENT_REGISTRY_ABI = [
  {
    name: "registerAgent",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      { name: "agentType", type: "uint8" },
      { name: "walletAddress", type: "address" },
      { name: "metadataURI", type: "string" },
      { name: "investorShareBps", type: "uint256" },
      { name: "creatorAllocation", type: "uint256" },
    ],
    outputs: [
      { name: "agentId", type: "uint256" },
      { name: "tokenAddress", type: "address" },
    ],
  },
  {
    name: "getAgent",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "creator", type: "address" },
          { name: "walletAddress", type: "address" },
          { name: "tokenAddress", type: "address" },
          { name: "name", type: "string" },
          { name: "agentType", type: "uint8" },
          { name: "status", type: "uint8" },
          { name: "metadataURI", type: "string" },
          { name: "reputation", type: "uint256" },
          { name: "createdAt", type: "uint256" },
          { name: "totalTasksCompleted", type: "uint256" },
          { name: "totalTasksFailed", type: "uint256" },
          { name: "totalRevenue", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "agentIdByWallet",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "walletAddress", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getTotalAgents",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "registrationFee",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "adjustReputation",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "delta", type: "int256" },
    ],
    outputs: [],
  },
] as const;

export const AGENT_TOKEN_ABI = [
  {
    name: "buy",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "minTokens", type: "uint256" }],
    outputs: [],
  },
  {
    name: "buyExact",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "tokenAmount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "calculateTokensForPayment",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "paymentAmount", type: "uint256" }],
    outputs: [{ name: "tokenAmount", type: "uint256" }],
  },
  {
    name: "sell",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "minRefund", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "calculateSaleRefund",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [{ name: "refund", type: "uint256" }],
  },
  {
    name: "claimProfits",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "getPendingProfits",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "holder", type: "address" }],
    outputs: [{ name: "pending", type: "uint256" }],
  },
  {
    name: "calculatePurchaseCost",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenAmount", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "calculateSaleReturn",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenAmount", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getCurrentPrice",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "totalSupply",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "PROTOCOL_FEE_BPS",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "name",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "reserveBalance",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "investorShareBps",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ============================================================================
// Client Creation
// ============================================================================

/**
 * Create a public client for read-only operations
 */
export function getPublicClient(): PublicClient {
  return createPublicClient({
    chain: monadTestnet,
    transport: http(),
  });
}

/**
 * Create a wallet client from a private key (for server-side operations)
 */
export function getWalletClientFromPrivateKey(privateKey: string): WalletClient {
  const prefixedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(prefixedKey as `0x${string}`);
  return createWalletClient({
    account,
    chain: monadTestnet,
    transport: http(),
  });
}

/**
 * Create a wallet client from a browser provider (for client-side operations)
 */
export function getWalletClientFromProvider(provider: any): WalletClient {
  return createWalletClient({
    chain: monadTestnet,
    transport: custom(provider),
  });
}

// ============================================================================
// Agent Registry Functions
// ============================================================================

/**
 * Agent type enum matching the contract
 */
export enum AgentType {
  CATALOG = 0,
  REVIEW = 1,
  CURATION = 2,
  SELLER = 3,
}

/**
 * Map string type to enum
 */
export function getAgentTypeEnum(type: string): AgentType {
  switch (type.toUpperCase()) {
    case "CATALOG":
      return AgentType.CATALOG;
    case "REVIEW":
      return AgentType.REVIEW;
    case "CURATION":
      return AgentType.CURATION;
    case "SELLER":
      return AgentType.SELLER;
    default:
      return AgentType.CATALOG;
  }
}

export interface RegisterAgentParams {
  name: string;
  symbol: string;
  agentType: AgentType;
  walletAddress: Address;
  metadataURI: string;
  investorShareBps: bigint; // e.g., 7500n for 75%
  creatorAllocation: bigint; // Founder tokens in wei (e.g., 100e18 for 100 tokens)
}

export interface RegisterAgentResult {
  agentId: bigint;
  tokenAddress: Address;
  txHash: Hash;
}

/**
 * Register a new agent on the blockchain
 * Returns the on-chain agent ID and token address
 */
export async function registerAgentOnChain(
  walletClient: WalletClient,
  params: RegisterAgentParams
): Promise<RegisterAgentResult> {
  const publicClient = getPublicClient();

  // Get registration fee (if any)
  const registrationFee = await publicClient.readContract({
    address: CONTRACT_ADDRESSES.AGENT_REGISTRY,
    abi: AGENT_REGISTRY_ABI,
    functionName: "registrationFee",
  });

  // Register the agent
  const hash = await walletClient.writeContract({
    chain: monadTestnet,
    account: walletClient.account!,
    address: CONTRACT_ADDRESSES.AGENT_REGISTRY,
    abi: AGENT_REGISTRY_ABI,
    functionName: "registerAgent",
    args: [
      params.name,
      params.symbol,
      params.agentType,
      params.walletAddress,
      params.metadataURI,
      params.investorShareBps,
      params.creatorAllocation,
    ],
    value: registrationFee,
  });

  // Wait for transaction
  await publicClient.waitForTransactionReceipt({ hash });

  // Get the agent ID from the wallet address
  const agentId = await publicClient.readContract({
    address: CONTRACT_ADDRESSES.AGENT_REGISTRY,
    abi: AGENT_REGISTRY_ABI,
    functionName: "agentIdByWallet",
    args: [params.walletAddress],
  });

  // Get the agent data to retrieve token address
  const agent = await publicClient.readContract({
    address: CONTRACT_ADDRESSES.AGENT_REGISTRY,
    abi: AGENT_REGISTRY_ABI,
    functionName: "getAgent",
    args: [agentId],
  });

  return {
    agentId: agentId as bigint,
    tokenAddress: (agent as any).tokenAddress as Address,
    txHash: hash,
  };
}

/**
 * Get agent data from chain
 */
export async function getAgentFromChain(agentId: bigint) {
  const publicClient = getPublicClient();

  const agent = await publicClient.readContract({
    address: CONTRACT_ADDRESSES.AGENT_REGISTRY,
    abi: AGENT_REGISTRY_ABI,
    functionName: "getAgent",
    args: [agentId],
  });

  return agent;
}

/**
 * Get total number of agents registered
 */
export async function getTotalAgentsOnChain(): Promise<bigint> {
  const publicClient = getPublicClient();

  const total = await publicClient.readContract({
    address: CONTRACT_ADDRESSES.AGENT_REGISTRY,
    abi: AGENT_REGISTRY_ABI,
    functionName: "getTotalAgents",
  });

  return total as bigint;
}

// ============================================================================
// Agent Token Functions
// ============================================================================

export interface TokenPriceInfo {
  currentPrice: bigint;
  totalSupply: bigint;
  protocolFeeBps: bigint;
}

/**
 * Comprehensive token details for display
 */
export interface TokenDetails {
  symbol: string;
  name: string;
  address: string;
  totalSupply: string; // Formatted (e.g., "150.00")
  totalSupplyRaw: bigint;
  currentPrice: string; // Formatted MON (e.g., "0.016")
  currentPriceRaw: bigint;
  reserveBalance: string; // Formatted MON
  reserveBalanceRaw: bigint;
  investorShareBps: number;
  protocolFeeBps: number;
  marketCap: string; // totalSupply * currentPrice in MON
}

/**
 * Get token price info for an agent
 */
export async function getTokenInfo(tokenAddress: Address): Promise<TokenPriceInfo> {
  const publicClient = getPublicClient();

  const [currentPrice, totalSupply, protocolFeeBps] = await Promise.all([
    publicClient.readContract({
      address: tokenAddress,
      abi: AGENT_TOKEN_ABI,
      functionName: "getCurrentPrice",
    }),
    publicClient.readContract({
      address: tokenAddress,
      abi: AGENT_TOKEN_ABI,
      functionName: "totalSupply",
    }),
    publicClient.readContract({
      address: tokenAddress,
      abi: AGENT_TOKEN_ABI,
      functionName: "PROTOCOL_FEE_BPS",
    }),
  ]);

  return {
    currentPrice: currentPrice as bigint,
    totalSupply: totalSupply as bigint,
    protocolFeeBps: protocolFeeBps as bigint,
  };
}

/**
 * Get comprehensive token details for an agent
 */
export async function getTokenDetails(tokenAddress: Address): Promise<TokenDetails> {
  const publicClient = getPublicClient();

  const [symbol, name, totalSupply, currentPrice, reserveBalance, investorShareBps, protocolFeeBps] =
    await Promise.all([
      publicClient.readContract({
        address: tokenAddress,
        abi: AGENT_TOKEN_ABI,
        functionName: "symbol",
      }),
      publicClient.readContract({
        address: tokenAddress,
        abi: AGENT_TOKEN_ABI,
        functionName: "name",
      }),
      publicClient.readContract({
        address: tokenAddress,
        abi: AGENT_TOKEN_ABI,
        functionName: "totalSupply",
      }),
      publicClient.readContract({
        address: tokenAddress,
        abi: AGENT_TOKEN_ABI,
        functionName: "getCurrentPrice",
      }),
      publicClient.readContract({
        address: tokenAddress,
        abi: AGENT_TOKEN_ABI,
        functionName: "reserveBalance",
      }),
      publicClient.readContract({
        address: tokenAddress,
        abi: AGENT_TOKEN_ABI,
        functionName: "investorShareBps",
      }),
      publicClient.readContract({
        address: tokenAddress,
        abi: AGENT_TOKEN_ABI,
        functionName: "PROTOCOL_FEE_BPS",
      }),
    ]);

  const supplyRaw = totalSupply as bigint;
  const priceRaw = currentPrice as bigint;
  const reserveRaw = reserveBalance as bigint;

  // Calculate market cap (supply * price, both in wei, result in wei)
  const marketCapRaw = (supplyRaw * priceRaw) / BigInt(1e18);

  return {
    symbol: symbol as string,
    name: name as string,
    address: tokenAddress,
    totalSupply: formatEther(supplyRaw),
    totalSupplyRaw: supplyRaw,
    currentPrice: formatEther(priceRaw),
    currentPriceRaw: priceRaw,
    reserveBalance: formatEther(reserveRaw),
    reserveBalanceRaw: reserveRaw,
    investorShareBps: Number(investorShareBps),
    protocolFeeBps: Number(protocolFeeBps),
    marketCap: formatEther(marketCapRaw),
  };
}

/**
 * Calculate cost to buy tokens
 */
export async function calculatePurchaseCost(
  tokenAddress: Address,
  tokenAmount: bigint
): Promise<bigint> {
  const publicClient = getPublicClient();

  const cost = await publicClient.readContract({
    address: tokenAddress,
    abi: AGENT_TOKEN_ABI,
    functionName: "calculatePurchaseCost",
    args: [tokenAmount],
  });

  return cost as bigint;
}

/**
 * Calculate return from selling tokens
 */
export async function calculateSaleReturn(
  tokenAddress: Address,
  tokenAmount: bigint
): Promise<bigint> {
  const publicClient = getPublicClient();

  const returnAmount = await publicClient.readContract({
    address: tokenAddress,
    abi: AGENT_TOKEN_ABI,
    functionName: "calculateSaleReturn",
    args: [tokenAmount],
  });

  return returnAmount as bigint;
}

/**
 * Get token balance for an address
 */
export async function getTokenBalance(
  tokenAddress: Address,
  holder: Address
): Promise<bigint> {
  const publicClient = getPublicClient();

  const balance = await publicClient.readContract({
    address: tokenAddress,
    abi: AGENT_TOKEN_ABI,
    functionName: "balanceOf",
    args: [holder],
  });

  return balance as bigint;
}

export interface BuyTokensResult {
  txHash: Hash;
  tokenAmount: bigint;
  costPaid: bigint;
}

/**
 * Buy agent tokens (requires wallet client with connected account)
 */
export async function buyAgentTokens(
  walletClient: WalletClient,
  tokenAddress: Address,
  tokenAmount: bigint
): Promise<BuyTokensResult> {
  const publicClient = getPublicClient();

  // Calculate cost + fee
  const cost = await calculatePurchaseCost(tokenAddress, tokenAmount);
  const tokenInfo = await getTokenInfo(tokenAddress);
  const fee = (cost * tokenInfo.protocolFeeBps) / 10000n;
  const totalCost = cost + fee;

  // Execute purchase
  const hash = await walletClient.writeContract({
    chain: monadTestnet,
    account: walletClient.account!,
    address: tokenAddress,
    abi: AGENT_TOKEN_ABI,
    functionName: "buyExact",
    args: [tokenAmount],
    value: totalCost,
  });

  // Wait for confirmation
  await publicClient.waitForTransactionReceipt({ hash });

  return {
    txHash: hash,
    tokenAmount,
    costPaid: totalCost,
  };
}

export interface SellTokensResult {
  txHash: Hash;
  tokenAmount: bigint;
  monReceived: bigint;
}

/**
 * Sell agent tokens (requires wallet client with connected account)
 */
export async function sellAgentTokens(
  walletClient: WalletClient,
  tokenAddress: Address,
  tokenAmount: bigint
): Promise<SellTokensResult> {
  const publicClient = getPublicClient();

  // Calculate return
  const returnAmount = await calculateSaleReturn(tokenAddress, tokenAmount);

  // Execute sale
  const hash = await walletClient.writeContract({
    chain: monadTestnet,
    account: walletClient.account!,
    address: tokenAddress,
    abi: AGENT_TOKEN_ABI,
    functionName: "sell",
    args: [tokenAmount, BigInt(0)], // minRefund = 0, user handles slippage
  });

  // Wait for confirmation
  await publicClient.waitForTransactionReceipt({ hash });

  return {
    txHash: hash,
    tokenAmount,
    monReceived: returnAmount,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format wei to MON with decimals
 */
export function formatMON(wei: bigint): string {
  return formatEther(wei);
}

/**
 * Parse MON string to wei
 */
export function parseMON(mon: string): bigint {
  return parseEther(mon);
}

/**
 * Get explorer URL for transaction
 */
export function getExplorerTxUrl(txHash: Hash): string {
  return `https://testnet.monadvision.com/tx/${txHash}`;
}

/**
 * Get explorer URL for address
 */
export function getExplorerAddressUrl(address: Address): string {
  return `https://testnet.monadvision.com/address/${address}`;
}

/**
 * Get explorer URL for token contract
 */
export function getExplorerTokenUrl(address: Address): string {
  return `https://testnet.monadvision.com/token/${address}`;
}
