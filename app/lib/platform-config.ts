/**
 * Platform-level economics configuration
 *
 * Controls platform fees, profit sharing, token addresses, and buyback.
 */

import type { Address } from 'viem';

// ── Profit Sharing ──────────────────────────────────────────────────────────

/** Platform profit share: 10% of net profit before investor/agent split */
export const PLATFORM_FEE_BPS = 1000; // 10% = 1000 basis points

/** One-time USDC registration fee deducted from agent's seed during creation */
export const REGISTRATION_FEE_USDC = 1.0; // $1 USDC

// ── Platform Token ──────────────────────────────────────────────────────────

/** Platform token address (INOMY) on nad.fun — set after deployment */
export const PLATFORM_TOKEN_ADDRESS = (process.env.PLATFORM_TOKEN_ADDRESS || '') as Address;

/** Platform token's nad.fun pool address — set after deployment */
export const PLATFORM_NADFUN_POOL = (process.env.PLATFORM_NADFUN_POOL || '') as Address;

// ── Buyback & Burn ──────────────────────────────────────────────────────────

/** Standard burn address — tokens sent here are permanently removed */
export const BURN_ADDRESS = '0x000000000000000000000000000000000000dEaD' as Address;

/** Default MON amount per buyback (0.05 MON) */
export const BUYBACK_DEFAULT_MON = '0.05';

/** Minimum MON for a buyback to execute (avoid dust transactions) */
export const BUYBACK_MIN_MON = '0.005';

/** Slippage tolerance for buyback (5% = 0.95 multiplier on quoted amount) */
export const BUYBACK_SLIPPAGE_BPS = 500; // 5%
