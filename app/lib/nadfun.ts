/**
 * nad.fun Integration
 *
 * Server-side: prepares token creation (upload image, metadata, mine salt, get fees)
 * Client-side: user signs the BondingCurveRouter.create() TX with their wallet
 *
 * Same code for testnet and mainnet — controlled by NAD_NETWORK env var.
 */

import {
  encodeFunctionData,
  parseEther,
  createPublicClient,
  http,
  decodeEventLog,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { monadTestnet } from "viem/chains";

// ── Network Config ──────────────────────────────────────────────────────────

type Network = "testnet" | "mainnet";

const API_URLS: Record<Network, string> = {
  testnet: "https://dev-api.nad.fun",
  mainnet: "https://api.nadapp.net",
};

const CONTRACTS: Record<
  Network,
  { CURVE: Address; BONDING_CURVE_ROUTER: Address; LENS: Address }
> = {
  testnet: {
    CURVE: "0x1228b0dc9481C11D3071E7A924B794CfB038994e",
    BONDING_CURVE_ROUTER: "0x865054F0F6A288adaAc30261731361EA7E908003",
    LENS: "0xB056d79CA5257589692699a46623F901a3BB76f1",
  },
  mainnet: {
    CURVE: "0xA7283d07812a02AFB7C09B60f8896bCEA3F90aCE",
    BONDING_CURVE_ROUTER: "0x6F6B8F1a20703309951a5127c45B49b1CD981A22",
    LENS: "0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea",
  },
};

function getNetwork(): Network {
  return (process.env.NAD_NETWORK || "testnet") as Network;
}

function getApiUrl(): string {
  return API_URLS[getNetwork()];
}

function getContracts() {
  return CONTRACTS[getNetwork()];
}

// ── ABIs (minimal, only what we need) ───────────────────────────────────────

const curveAbi = [
  {
    type: "function",
    name: "feeConfig",
    inputs: [],
    outputs: [
      { name: "deployFeeAmount", type: "uint256" },
      { name: "graduateFeeAmount", type: "uint256" },
      { name: "protocolFee", type: "uint24" },
    ],
    stateMutability: "view",
  },
] as const;

const lensAbi = [
  {
    type: "function",
    name: "getInitialBuyAmountOut",
    inputs: [{ name: "amountIn", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const bondingCurveRouterAbi = [
  {
    type: "function",
    name: "create",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "tokenURI", type: "string" },
          { name: "amountOut", type: "uint256" },
          { name: "salt", type: "bytes32" },
          { name: "actionId", type: "uint8" },
        ],
      },
    ],
    outputs: [
      { name: "token", type: "address" },
      { name: "pool", type: "address" },
    ],
    stateMutability: "payable",
  },
] as const;

// CurveCreate event from the Curve contract (emitted when a token is created)
// Source: @nadfun/sdk curveAbi — 3 indexed + 6 non-indexed params
const curveCreateEventAbi = [
  {
    type: "event",
    name: "CurveCreate",
    inputs: [
      { name: "creator", type: "address", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "pool", type: "address", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "symbol", type: "string", indexed: false },
      { name: "tokenURI", type: "string", indexed: false },
      { name: "virtualMon", type: "uint256", indexed: false },
      { name: "virtualToken", type: "uint256", indexed: false },
      { name: "targetTokenAmount", type: "uint256", indexed: false },
    ],
  },
] as const;

// ── Public Client ───────────────────────────────────────────────────────────

function getPublicClient() {
  const rpcUrl =
    process.env.MONAD_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL;
  if (!rpcUrl) throw new Error("MONAD_RPC_URL is required");
  return createPublicClient({
    chain: monadTestnet,
    transport: http(rpcUrl),
  });
}

// ── Server-side Prep (steps 1-3 + fee config) ──────────────────────────────

/** Fetch the agent's DiceBear bottts avatar as a PNG buffer */
async function fetchAgentImage(name: string): Promise<Buffer> {
  const url = `https://api.dicebear.com/9.x/bottts/png?seed=${encodeURIComponent(name)}&size=512`;
  console.log(`[nad.fun] Fetching avatar for "${name}"...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch agent avatar: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Step 1: Upload image to nad.fun */
async function uploadImage(image: Buffer): Promise<{ imageUri: string; isNsfw: boolean }> {
  const apiUrl = getApiUrl();
  console.log(`[nad.fun] Uploading image...`);
  const res = await fetch(`${apiUrl}/agent/token/image`, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: new Uint8Array(image),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Image upload failed: ${err.error || res.statusText}`);
  }
  const data = await res.json();
  return { imageUri: data.image_uri, isNsfw: data.is_nsfw };
}

/** Step 2: Upload metadata to nad.fun */
async function uploadMetadata(params: {
  imageUri: string;
  name: string;
  symbol: string;
  description: string;
}): Promise<{ metadataUri: string }> {
  const apiUrl = getApiUrl();
  console.log(`[nad.fun] Uploading metadata...`);
  const res = await fetch(`${apiUrl}/agent/token/metadata`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_uri: params.imageUri,
      name: params.name,
      symbol: params.symbol,
      description: params.description,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Metadata upload failed: ${err.error || res.statusText}`);
  }
  const data = await res.json();
  return { metadataUri: data.metadata_uri };
}

/** Step 3: Mine salt for deterministic address */
async function mineSalt(params: {
  creator: string;
  name: string;
  symbol: string;
  metadataUri: string;
}): Promise<{ salt: Hex; address: Address }> {
  const apiUrl = getApiUrl();
  console.log(`[nad.fun] Mining salt for creator ${params.creator}...`);
  const res = await fetch(`${apiUrl}/agent/salt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      creator: params.creator,
      name: params.name,
      symbol: params.symbol,
      metadata_uri: params.metadataUri,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Salt mining failed: ${err.error || res.statusText}`);
  }
  const data = await res.json();
  return { salt: data.salt as Hex, address: data.address as Address };
}

// ── Exported: prepareTokenCreation ──────────────────────────────────────────

export interface TokenCreationTx {
  /** Contract to call */
  to: Address;
  /** Encoded calldata for BondingCurveRouter.create() */
  data: Hex;
  /** MON value to send (deployFee + initialBuyAmount) in wei as string */
  value: string;
  /** Chain ID */
  chainId: number;
  /** Predicted token address (from salt mining) */
  predictedTokenAddress: Address;
  /** Metadata URI stored on nad.fun */
  metadataUri: string;
  /** Salt used */
  salt: Hex;
}

/**
 * Server-side: prepare everything for nad.fun token creation.
 * Returns TX data for the user to sign with their wallet.
 *
 * The user's wallet calls BondingCurveRouter.create(), pays MON,
 * and receives the initial tokens.
 */
export async function prepareTokenCreation(params: {
  name: string;
  symbol: string;
  description: string;
  creatorWallet: string; // The user's wallet address
  initialBuyAmount?: string; // MON (e.g. "0.1"), default "0"
  image?: Buffer;
}): Promise<TokenCreationTx> {
  const contracts = getContracts();
  const client = getPublicClient();

  // Step 1: Upload image
  const image = params.image || (await fetchAgentImage(params.name));
  const { imageUri } = await uploadImage(image);

  // Step 2: Upload metadata
  const { metadataUri } = await uploadMetadata({
    imageUri,
    name: params.name,
    symbol: params.symbol,
    description: params.description,
  });

  // Step 3: Mine salt (creator = user's wallet so they get the tokens)
  const { salt, address: predictedTokenAddress } = await mineSalt({
    creator: params.creatorWallet,
    name: params.name,
    symbol: params.symbol,
    metadataUri,
  });

  // Read deploy fee from Curve contract
  const feeConfig = await client.readContract({
    address: contracts.CURVE,
    abi: curveAbi,
    functionName: "feeConfig",
  });
  const deployFeeAmount = feeConfig[0];

  // Calculate min tokens for initial buy
  const initialBuyAmount = params.initialBuyAmount
    ? parseEther(params.initialBuyAmount)
    : 0n;

  let minTokens = 0n;
  if (initialBuyAmount > 0n) {
    minTokens = await client.readContract({
      address: contracts.LENS,
      abi: lensAbi,
      functionName: "getInitialBuyAmountOut",
      args: [initialBuyAmount],
    });
  }

  const totalValue = deployFeeAmount + initialBuyAmount;

  // Encode the create() call
  const data = encodeFunctionData({
    abi: bondingCurveRouterAbi,
    functionName: "create",
    args: [
      {
        name: params.name,
        symbol: params.symbol,
        tokenURI: metadataUri,
        amountOut: minTokens,
        salt,
        actionId: 1,
      },
    ],
  });

  console.log(`[nad.fun] Token creation prepared:`);
  console.log(`  - Predicted address: ${predictedTokenAddress}`);
  console.log(`  - Deploy fee: ${deployFeeAmount} wei`);
  console.log(`  - Initial buy: ${initialBuyAmount} wei`);
  console.log(`  - Total MON: ${totalValue} wei`);

  return {
    to: contracts.BONDING_CURVE_ROUTER,
    data,
    value: totalValue.toString(),
    chainId: 10143, // Monad testnet
    predictedTokenAddress,
    metadataUri,
    salt,
  };
}

// ── Exported: parseTokenCreationReceipt ─────────────────────────────────────

/**
 * Parse a token creation TX receipt to extract the token and pool addresses.
 * Called by the confirm endpoint after user signs the TX.
 */
export function parseTokenCreationReceipt(receipt: TransactionReceipt): {
  tokenAddress: Address;
  poolAddress: Address;
} | null {
  for (const log of receipt.logs) {
    try {
      const event = decodeEventLog({
        abi: curveCreateEventAbi,
        data: log.data,
        topics: log.topics,
      });
      if (event.eventName === "CurveCreate") {
        return {
          tokenAddress: event.args.token,
          poolAddress: event.args.pool,
        };
      }
    } catch {
      // Not a CurveCreate event, skip
    }
  }
  return null;
}

// ── Token URL ───────────────────────────────────────────────────────────────

/** Build the nad.fun token URL */
export function getNadFunTokenUrl(tokenAddress: string): string {
  const network = getNetwork();
  if (network === "mainnet") {
    return `https://nad.fun/tokens/${tokenAddress}`;
  }
  // Testnet: link to explorer since testnet.nad.fun is in maintenance
  return `https://monad-testnet.socialscan.io/address/${tokenAddress}`;
}
