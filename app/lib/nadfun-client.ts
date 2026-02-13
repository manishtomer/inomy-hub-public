/**
 * nad.fun Client-Side Integration
 *
 * Client-safe module (no server-only env vars) for interacting with
 * nad.fun's Lens (quotes) and BondingCurveRouter (buy/sell) from modals.
 *
 * Uses NEXT_PUBLIC_NAD_NETWORK env var (defaults to "testnet").
 */

import type { Address } from 'viem';

// ── Network Config ──────────────────────────────────────────────────────────

type Network = 'testnet' | 'mainnet';

const CONTRACTS: Record<
  Network,
  { BONDING_CURVE_ROUTER: Address; LENS: Address }
> = {
  testnet: {
    BONDING_CURVE_ROUTER: '0x865054F0F6A288adaAc30261731361EA7E908003',
    LENS: '0xB056d79CA5257589692699a46623F901a3BB76f1',
  },
  mainnet: {
    BONDING_CURVE_ROUTER: '0x6F6B8F1a20703309951a5127c45B49b1CD981A22',
    LENS: '0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea',
  },
};

function getNetwork(): Network {
  return (
    (typeof window !== 'undefined'
      ? process.env.NEXT_PUBLIC_NAD_NETWORK
      : process.env.NEXT_PUBLIC_NAD_NETWORK || process.env.NAD_NETWORK) ||
    'testnet'
  ) as Network;
}

export const NAD_CONTRACTS = CONTRACTS[getNetwork()];

// ── ABIs ────────────────────────────────────────────────────────────────────

/** Lens.getAmountOut — quote for buy or sell */
export const lensAbi = [
  {
    type: 'function',
    name: 'getAmountOut',
    inputs: [
      { name: '_token', type: 'address' },
      { name: '_amountIn', type: 'uint256' },
      { name: '_isBuy', type: 'bool' },
    ],
    outputs: [
      { name: 'router', type: 'address' },
      { name: 'amountOut', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const;

/** BondingCurveRouter.buy — buy tokens with MON (payable) */
export const routerBuyAbi = [
  {
    type: 'function',
    name: 'buy',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'amountOutMin', type: 'uint256' },
          { name: 'token', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'payable',
  },
] as const;

/** BondingCurveRouter.sell — sell tokens for MON (needs prior ERC20 approve) */
export const routerSellAbi = [
  {
    type: 'function',
    name: 'sell',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMin', type: 'uint256' },
          { name: 'token', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
] as const;

/** Minimal ERC20 approve for token sell flow */
export const erc20ApproveAbi = [
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const;
