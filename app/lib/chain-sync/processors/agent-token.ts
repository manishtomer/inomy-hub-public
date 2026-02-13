/**
 * AgentToken Event Processor
 *
 * Processes events from AgentToken contracts (one per agent)
 */

import { type Log, createPublicClient, http, formatEther } from 'viem';
import type { Address } from 'viem';
import { supabase } from '../../supabase';
import {
  weiToNumber,
  bigintToNumber,
  isDuplicateError,
  logEventProcessed,
  logEventError,
} from '../event-processor';
import {
  createTokenBoughtEvent,
  createTokenSoldEvent,
  createDividendPaidEvent,
} from '../economy-events';

const GET_PRICE_ABI = [{
  name: 'getCurrentPrice', type: 'function' as const,
  stateMutability: 'view' as const, inputs: [],
  outputs: [{ name: 'price', type: 'uint256' as const }],
}] as const;

const monadTestnet = {
  id: 10143, name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
} as const;

const publicClient = createPublicClient({ chain: monadTestnet, transport: http() });

/**
 * Read current token price from bonding curve and update agents.token_price
 */
async function syncTokenPrice(agentId: string, tokenAddress: string): Promise<void> {
  try {
    const price = await publicClient.readContract({
      address: tokenAddress as Address,
      abi: GET_PRICE_ABI,
      functionName: 'getCurrentPrice',
    });
    const priceInMon = Number(formatEther(price));
    await supabase.from('agents').update({ token_price: priceInMon }).eq('id', agentId);
  } catch (err) {
    console.warn(`[ChainSync] Failed to sync token price for ${agentId}:`, err);
  }
}

/**
 * Get agent ID from token address
 */
async function getAgentIdFromToken(tokenAddress: string): Promise<string | null> {
  const { data } = await supabase
    .from('agent_token_addresses')
    .select('agent_id')
    .eq('token_address', tokenAddress.toLowerCase())
    .single();

  return data?.agent_id || null;
}

/**
 * Process TokensPurchased event
 */
async function processTokensPurchased(log: any, tokenAddress: string): Promise<void> {
  try {
    const { buyer, amount, cost, newSupply } = log.args;

    const agentId = await getAgentIdFromToken(tokenAddress);
    if (!agentId) {
      console.warn(`Token ${tokenAddress} not found in agent_token_addresses`);
      return;
    }

    const { data: agent } = await supabase
      .from('agents')
      .select('wallet_address')
      .eq('id', agentId)
      .single();

    if (!agent) return;

    const tokenAmount = weiToNumber(amount);
    const monAmount = weiToNumber(cost);

    // UPSERT token_holdings_cache
    const { error: holdingError } = await supabase
      .from('token_holdings_cache')
      .upsert({
        investor_wallet: buyer.toLowerCase(),
        agent_wallet: agent.wallet_address,
        agent_id: agentId,
        token_balance: tokenAmount, // Will be updated by trigger or next sync
        total_invested: monAmount,
        last_synced_block: bigintToNumber(log.blockNumber),
      }, {
        onConflict: 'investor_wallet,agent_wallet',
        ignoreDuplicates: false,
      });

    if (holdingError && !isDuplicateError(holdingError)) throw holdingError;

    // INSERT token_transactions
    await supabase.from('token_transactions').insert({
      agent_wallet: agent.wallet_address,
      investor_wallet: buyer.toLowerCase(),
      transaction_type: 'BUY',
      token_amount: tokenAmount,
      mon_amount: monAmount,
      supply_after_transaction: weiToNumber(newSupply),
      token_address: tokenAddress.toLowerCase(),
      tx_hash: log.transactionHash,
      block_number: bigintToNumber(log.blockNumber),
      transacted_at: new Date().toISOString(),
    });

    // Create economy event
    await createTokenBoughtEvent(
      buyer.toLowerCase(),
      agent.wallet_address,
      tokenAmount,
      monAmount,
      log.transactionHash,
      bigintToNumber(log.blockNumber)
    );

    // Update token price from bonding curve
    await syncTokenPrice(agentId, tokenAddress);

    logEventProcessed('TokensPurchased', log.blockNumber, log.transactionHash, {
      buyer: buyer.slice(0, 10),
      amount: tokenAmount,
    });
  } catch (error) {
    logEventError('TokensPurchased', error as Error, log.blockNumber, log.transactionHash);
  }
}

/**
 * Process TokensSold event
 */
async function processTokensSold(log: any, tokenAddress: string): Promise<void> {
  try {
    const { seller, amount, refund, newSupply } = log.args;

    const agentId = await getAgentIdFromToken(tokenAddress);
    if (!agentId) return;

    const { data: agent } = await supabase
      .from('agents')
      .select('wallet_address')
      .eq('id', agentId)
      .single();

    if (!agent) return;

    const tokenAmount = weiToNumber(amount);
    const monAmount = weiToNumber(refund);

    // UPDATE token_holdings_cache (decrease balance)
    await supabase
      .from('token_holdings_cache')
      .update({
        token_balance: tokenAmount, // Will be recalculated
        last_synced_block: bigintToNumber(log.blockNumber),
      })
      .eq('investor_wallet', seller.toLowerCase())
      .eq('agent_wallet', agent.wallet_address);

    // INSERT token_transactions
    await supabase.from('token_transactions').insert({
      agent_wallet: agent.wallet_address,
      investor_wallet: seller.toLowerCase(),
      transaction_type: 'SELL',
      token_amount: tokenAmount,
      mon_amount: monAmount,
      supply_after_transaction: weiToNumber(newSupply),
      token_address: tokenAddress.toLowerCase(),
      tx_hash: log.transactionHash,
      block_number: bigintToNumber(log.blockNumber),
      transacted_at: new Date().toISOString(),
    });

    // Create economy event
    await createTokenSoldEvent(
      seller.toLowerCase(),
      agent.wallet_address,
      tokenAmount,
      monAmount,
      log.transactionHash,
      bigintToNumber(log.blockNumber)
    );

    // Update token price from bonding curve
    await syncTokenPrice(agentId, tokenAddress);

    logEventProcessed('TokensSold', log.blockNumber, log.transactionHash);
  } catch (error) {
    logEventError('TokensSold', error as Error, log.blockNumber, log.transactionHash);
  }
}

/**
 * Process ProfitsDeposited event
 */
async function processProfitsDeposited(log: any, tokenAddress: string): Promise<void> {
  try {
    const { totalAmount, investorShare, agentShare } = log.args;

    const agentId = await getAgentIdFromToken(tokenAddress);
    if (!agentId) return;

    const { data: agent } = await supabase
      .from('agents')
      .select('wallet_address')
      .eq('id', agentId)
      .single();

    if (!agent) return;

    // INSERT dividends_history
    await supabase.from('dividends_history').insert({
      agent_id: agentId,
      agent_wallet: agent.wallet_address,
      total_amount: weiToNumber(totalAmount),
      investor_share: weiToNumber(investorShare),
      agent_share: weiToNumber(agentShare),
      tx_hash: log.transactionHash,
      block_number: bigintToNumber(log.blockNumber),
      distributed_at: new Date().toISOString(),
    });

    // Create economy event
    await createDividendPaidEvent(
      agent.wallet_address,
      weiToNumber(totalAmount),
      weiToNumber(investorShare),
      log.transactionHash,
      bigintToNumber(log.blockNumber)
    );

    logEventProcessed('ProfitsDeposited', log.blockNumber, log.transactionHash);
  } catch (error) {
    logEventError('ProfitsDeposited', error as Error, log.blockNumber, log.transactionHash);
  }
}

/**
 * Process ProfitsClaimed event
 */
async function processProfitsClaimed(log: any, tokenAddress: string): Promise<void> {
  try {
    const { holder, amount } = log.args;

    const agentId = await getAgentIdFromToken(tokenAddress);
    if (!agentId) return;

    const { data: agent } = await supabase
      .from('agents')
      .select('wallet_address')
      .eq('id', agentId)
      .single();

    if (!agent) return;

    // INSERT dividend_claims
    await supabase.from('dividend_claims').insert({
      investor_wallet: holder.toLowerCase(),
      agent_wallet: agent.wallet_address,
      amount: weiToNumber(amount),
      tx_hash: log.transactionHash,
      block_number: bigintToNumber(log.blockNumber),
      claimed_at: new Date().toISOString(),
    });

    logEventProcessed('ProfitsClaimed', log.blockNumber, log.transactionHash);
  } catch (error) {
    logEventError('ProfitsClaimed', error as Error, log.blockNumber, log.transactionHash);
  }
}

/**
 * Process CreatorAllocationMinted event
 */
async function processCreatorAllocationMinted(log: any, tokenAddress: string): Promise<void> {
  try {
    const { creator, amount } = log.args;

    const agentId = await getAgentIdFromToken(tokenAddress);
    if (!agentId) return;

    const { data: agent } = await supabase
      .from('agents')
      .select('wallet_address')
      .eq('id', agentId)
      .single();

    if (!agent) return;

    // UPSERT token_holdings_cache for creator
    await supabase.from('token_holdings_cache').upsert({
      investor_wallet: creator.toLowerCase(),
      agent_wallet: agent.wallet_address,
      agent_id: agentId,
      token_balance: weiToNumber(amount),
      total_invested: 0, // Founder tokens are free
      last_synced_block: bigintToNumber(log.blockNumber),
    }, {
      onConflict: 'investor_wallet,agent_wallet',
    });

    logEventProcessed('CreatorAllocationMinted', log.blockNumber, log.transactionHash);
  } catch (error) {
    logEventError('CreatorAllocationMinted', error as Error, log.blockNumber, log.transactionHash);
  }
}

/**
 * Main processor
 */
export async function processAgentTokenEvent(log: Log, tokenAddress: string): Promise<void> {
  const eventName = (log as any).eventName;

  switch (eventName) {
    case 'TokensPurchased':
      await processTokensPurchased(log, tokenAddress);
      break;
    case 'TokensSold':
      await processTokensSold(log, tokenAddress);
      break;
    case 'ProfitsDeposited':
      await processProfitsDeposited(log, tokenAddress);
      break;
    case 'ProfitsClaimed':
      await processProfitsClaimed(log, tokenAddress);
      break;
    case 'CreatorAllocationMinted':
      await processCreatorAllocationMinted(log, tokenAddress);
      break;
    default:
      console.warn(`Unknown AgentToken event: ${eventName}`);
  }
}
