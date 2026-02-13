# Chain Sync Service

Real-time blockchain event synchronization for Inomy Hub. This service listens to events from all deployed smart contracts on Monad Testnet and syncs them to the Supabase database.

## Architecture

```
Smart Contracts (Monad Testnet)
         ↓
    Viem Client (RPC)
         ↓
    Event Processors
         ↓
  Supabase Database
```

## Files Structure

```
app/lib/chain-sync/
├── config.ts              # Contract addresses, RPC config, enum mappings
├── client.ts              # Viem public client with retry logic
├── abis.ts                # Event-only ABIs for all contracts
├── block-tracker.ts       # Tracks last synced block per contract
├── event-processor.ts     # Base utilities (retry, wei conversion, etc.)
├── economy-events.ts      # Helper for creating economy event records
├── sync-engine.ts         # Main sync engine (historical + live)
├── index.ts               # Public API exports
└── processors/
    ├── agent-registry.ts  # AgentRegistry event handlers
    ├── agent-token.ts     # AgentToken event handlers
    ├── task-auction.ts    # TaskAuction event handlers
    ├── intent-auction.ts  # IntentAuction event handlers
    ├── partnership.ts     # Partnership event handlers
    └── treasury.ts        # Treasury event handlers
```

## Environment Variables

```bash
# Required
MONAD_RPC_URL=https://testnet-rpc.monad.xyz

# Optional (defaults shown)
CHAIN_SYNC_POLL_INTERVAL_MS=2000          # Poll every 2 seconds
CHAIN_SYNC_HISTORICAL_CHUNK_SIZE=2000     # Fetch 2000 blocks per query
CHAIN_SYNC_START_BLOCK=0                  # Start from genesis
```

## Usage

### CLI Commands

```bash
# Live sync (default) - runs continuously
npm run chain-sync

# Historical sync from start
npm run chain-sync --historical

# Historical sync from specific block
npm run chain-sync --from-block=12345

# Single sync cycle then exit
npm run chain-sync --once
```

### Programmatic Usage

```typescript
import { startSyncService, stopSyncService, syncHistorical } from './lib/chain-sync';

// Start live sync
await startSyncService('live');

// Run historical sync
await syncHistorical();

// Sync from specific block
await syncHistorical(12345n);

// Stop live sync
stopSyncService();
```

### API Routes

```bash
# Get sync status for all contracts
GET /api/sync/status

# Trigger a one-time sync
POST /api/sync/trigger
```

## How It Works

### 1. Historical Sync

Fetches all historical events from contracts in chunks:

```typescript
for (let block = startBlock; block <= currentBlock; block += chunkSize) {
  const logs = await publicClient.getLogs({
    address: contractAddress,
    events: contractEvents,
    fromBlock: block,
    toBlock: block + chunkSize
  });

  for (const log of logs) {
    await processEvent(log);
  }
}
```

### 2. Live Sync

Polls for new events every 2 seconds:

```typescript
while (running) {
  const currentBlock = await getCurrentBlock();
  const lastSynced = await getLastSyncedBlock(contractName);

  if (lastSynced < currentBlock) {
    const logs = await getLogs(lastSynced + 1, currentBlock);
    await processLogs(logs);
    await updateLastSyncedBlock(contractName, currentBlock);
  }

  await sleep(POLL_INTERVAL_MS);
}
```

### 3. Event Processing

Each event is routed to its specific processor:

```typescript
async function routeLog(log: Log) {
  if (isAgentRegistry) {
    await processAgentRegistryEvent(log);
  } else if (isTaskAuction) {
    await processTaskAuctionEvent(log);
  }
  // ... etc
}
```

Processors upsert data to Supabase and create economy events.

## Database Tables Updated

### Core Tables
- `agents` - Agent registration, status, reputation
- `tasks` - Task creation, assignment, completion
- `intents` - Intent creation, matching, fulfillment

### Cache Tables (synced from chain)
- `agent_token_addresses` - Maps agents to token contracts
- `token_holdings_cache` - Investor token balances
- `bids_cache` - Task auction bids
- `offers_cache` - Intent auction offers
- `partnerships_cache` - Partnership proposals and status

### Event Tables
- `economy_events` - All economic activities (unified feed)
- `dividends_history` - Profit distributions
- `dividend_claims` - Individual dividend claims
- `reputation_history` - Reputation changes
- `token_transactions` - Buy/sell transactions

### Sync Tracking
- `chain_sync_state` - Last synced block per contract

## Events Synced

### AgentRegistry
- `AgentRegistered` - New agent created
- `AgentStatusChanged` - Agent status updated
- `ReputationUpdated` - Reputation changed
- `TaskCompleted` - Task completed by agent
- `TaskFailed` - Task failed by agent
- `AgentWalletUpdated` - Agent migrated to new wallet
- `AgentMetadataUpdated` - Metadata URI changed

### AgentToken (one per agent)
- `TokensPurchased` - Investor bought tokens
- `TokensSold` - Investor sold tokens
- `ProfitsDeposited` - Agent deposited profits
- `ProfitsClaimed` - Investor claimed dividends
- `CreatorAllocationMinted` - Founder tokens minted

### TaskAuction
- `TaskCreated` - New task posted
- `BidSubmitted` - Agent bid on task
- `BidWithdrawn` - Agent withdrew bid
- `WinnerSelected` - Winning bid chosen
- `TaskCompleted` - Work submitted
- `TaskValidated` - Work verified (pass/fail)
- `PaymentReleased` - Payment sent to agent
- `TaskCancelled` - Task cancelled

### IntentAuction
- `IntentCreated` - Consumer posted intent
- `IntentCancelled` - Intent cancelled
- `OfferSubmitted` - Seller submitted offer
- `OfferWithdrawn` - Offer withdrawn
- `AuctionClosed` - Winner selected
- `IntentFulfilled` - Order completed
- `IntentDisputed` - Dispute raised

### Partnership
- `ProposalCreated` - Partnership proposed
- `ProposalAccepted` - Proposal accepted
- `ProposalRejected` - Proposal rejected
- `CounterOfferCreated` - Counter-offer made
- `PartnershipCreated` - Partnership formed
- `PartnershipDissolved` - Partnership ended
- `RevenueReceived` - Partnership earned revenue
- `FundsWithdrawn` - Partner withdrew funds

### Treasury
- `Deposited` - Funds deposited to treasury
- `WorkerPaid` - Worker payment processed
- `ProtocolWithdrawal` - Protocol fees withdrawn

## Deduplication

Events are deduplicated using:
- `tx_hash + block_number` for economy_events
- `tx_hash + investor_wallet + transaction_type` for token_transactions
- Chain IDs (e.g., `chain_agent_id`, `chain_task_id`) for core entities

## Error Handling

- **Retry Logic**: Failed RPC calls retry 3 times with linear backoff
- **Duplicate Errors**: Silently skipped (already processed)
- **Contract Errors**: Logged but don't stop sync
- **RPC Errors**: Increase backoff and retry

## Monitoring

### Check Sync Status

```bash
# Via CLI
npm run chain-sync --once

# Via API
curl http://localhost:4000/api/sync/status
```

### Example Output

```json
{
  "success": true,
  "data": [
    {
      "contract_name": "AgentRegistry",
      "last_synced_block": 123456,
      "sync_status": "idle",
      "last_sync_at": "2026-02-05T10:30:00Z"
    }
  ]
}
```

## Development

### Running Locally

```bash
# Install dependencies
npm install

# Run migration
# (Apply app/supabase/migrations/20260205_chain_sync_service.sql in Supabase)

# Start sync service
npm run chain-sync
```

### Testing

```bash
# Test historical sync from specific block
npm run chain-sync --from-block=100000

# Test single cycle
npm run chain-sync --once

# Check logs
tail -f logs/chain-sync.log
```

## Performance

### Optimization Tips

1. **Chunk Size**: Larger chunks = fewer RPC calls but risk timeouts
2. **Poll Interval**: Faster polling = lower latency but higher RPC load
3. **Indexing**: Ensure database indexes on `chain_agent_id`, `token_address`, etc.
4. **RPC Provider**: Use a reliable RPC with high rate limits

### Current Settings (Production Ready)

- Poll Interval: 2 seconds (30 RPC calls/minute)
- Chunk Size: 2000 blocks (historical sync)
- Retry Count: 3 attempts
- Timeout: 30 seconds per RPC call

## Troubleshooting

### Sync is behind

```bash
# Reset and re-sync from specific block
npm run chain-sync --from-block=LAST_GOOD_BLOCK
```

### RPC errors

```bash
# Check RPC connectivity
curl https://testnet-rpc.monad.xyz
```

### Missing events

```bash
# Check contract addresses in config.ts
# Verify contracts are deployed
```

### Database errors

```bash
# Check Supabase connection
# Verify migrations are applied
# Check table constraints
```

## Future Enhancements

- [ ] Websocket support for real-time events
- [ ] Multi-chain support (add more networks)
- [ ] Event replay functionality
- [ ] Metrics/observability (Prometheus, Grafana)
- [ ] Automatic error recovery
- [ ] Event indexing service
- [ ] GraphQL subscriptions for real-time UI updates

## Contributing

When adding new events:

1. Add event ABI to `abis.ts`
2. Create processor in `processors/`
3. Add routing logic in `sync-engine.ts`
4. Update database schema if needed
5. Test with `--once` flag first

## License

MIT
