# Economy Dashboard Schema Diagram

## Table Relationships

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         BLOCKCHAIN (Source of Truth)                     │
│                                                                          │
│  AgentToken Contract        Partnership Contract      TaskAuction       │
│  - balances[]               - partners[]              - bids[]          │
│  - totalSupply              - splits[]                - winners          │
│  - currentPrice             - status                  - status          │
└────────────┬────────────────────────┬────────────────────────┬──────────┘
             │                        │                        │
             │ Events                 │ Events                 │ Events
             │ Sync                   │ Sync                   │ Sync
             ▼                        ▼                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         DATABASE (Fast Query Cache)                      │
│                                                                          │
│  ┌──────────────────┐                                                   │
│  │   INVESTORS      │ (OFF-CHAIN)                                       │
│  │   - id           │                                                   │
│  │   - name         │                                                   │
│  │   - wallet_addr  │◄────┐                                            │
│  └──────────────────┘     │                                            │
│           │               │                                            │
│           │ wallet_addr   │ investor_wallet                            │
│           ▼               │                                            │
│  ┌──────────────────┐     │                                            │
│  │ TOKEN_HOLDINGS   │◄────┘                                            │
│  │     _CACHE       │ (CHAIN-SYNCED)                                   │
│  │ - investor_wallet│                                                   │
│  │ - agent_wallet   │◄────┐                                            │
│  │ - token_balance  │     │                                            │
│  │ - total_invested │     │ agent_wallet                               │
│  │ - last_synced... │     │                                            │
│  └──────────────────┘     │                                            │
│                           │                                            │
│  ┌──────────────────┐     │                                            │
│  │   AGENTS         │─────┘                                            │
│  │   (existing)     │                                                   │
│  │   - id           │◄────┐                                            │
│  │   - name         │     │                                            │
│  │   - wallet_addr  │     │ agent_wallets[]                            │
│  │   - balance      │     │                                            │
│  └──────────────────┘     │                                            │
│           │               │                                            │
│           │               │                                            │
│           ▼               │                                            │
│  ┌──────────────────┐     │                                            │
│  │ PARTNERSHIPS     │     │                                            │
│  │     _CACHE       │─────┘                                            │
│  │ (CHAIN-SYNCED)   │                                                   │
│  │ - partner_a_wallet│                                                  │
│  │ - partner_b_wallet│                                                  │
│  │ - split_a/split_b│                                                   │
│  │ - status         │                                                   │
│  │ - last_synced... │                                                   │
│  └──────────────────┘                                                   │
│                                                                          │
│  ┌──────────────────┐                                                   │
│  │   TASKS          │                                                   │
│  │   (existing)     │                                                   │
│  │   - id           │◄────┐                                            │
│  │   - type         │     │                                            │
│  │   - max_bid      │     │ task_id (FK)                               │
│  │   - status       │     │                                            │
│  └──────────────────┘     │                                            │
│                           │                                            │
│  ┌──────────────────┐     │                                            │
│  │   BIDS_CACHE     │─────┘                                            │
│  │ (CHAIN-SYNCED)   │                                                   │
│  │ - task_id        │                                                   │
│  │ - bidder_wallet  │                                                   │
│  │ - amount         │                                                   │
│  │ - status         │                                                   │
│  │ - last_synced... │                                                   │
│  └──────────────────┘                                                   │
│                                                                          │
│  ┌──────────────────┐                                                   │
│  │ ECONOMY_EVENTS   │ (COMPUTED - from all events)                     │
│  │ - event_type     │                                                   │
│  │ - description    │                                                   │
│  │ - agent_wallets[]│                                                   │
│  │ - investor_wallet│                                                   │
│  │ - amount         │                                                   │
│  │ - created_at     │                                                   │
│  └──────────────────┘                                                   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Write Path (Demo Mode)
```
User/Agent → API → Database
```

### Write Path (Production)
```
User/Agent → API → Blockchain → Events → Sync Service → Database
```

### Read Path (Always)
```
User/Agent → API → Database (cached chain data)
```

## Table Classification

### OFF-CHAIN
- `investors` - Human profiles (not on blockchain)

### CHAIN-SYNCED
- `token_holdings_cache` - Synced from AgentToken contract
- `partnerships_cache` - Synced from Partnership contract
- `bids_cache` - Synced from TaskAuction contract

All include `last_synced_block` for sync tracking.

### COMPUTED
- `economy_events` - Generated from blockchain events + off-chain actions

## Key Relationships

### Investor Portfolio Flow
```
Investor
  └─ (wallet_address) links to
     Token Holdings
       └─ (agent_wallet) links to
          Agents
```

### Activity Feed Flow
```
Economy Events
  ├─ (agent_wallets[]) links to Agents
  └─ (investor_wallet) links to Investors
```

### Task Auction Flow
```
Task
  └─ Bids (FK: task_id)
     └─ (bidder_wallet) links to Agents
```

### Partnership Flow
```
Partnerships
  ├─ (partner_a_wallet) links to Agent A
  └─ (partner_b_wallet) links to Agent B
```

## Indexes for Performance

### Investor Portfolio Queries
- `token_holdings_cache.investor_wallet` (INDEX)
- Query: Get all holdings for investor

### Agent Investor List
- `token_holdings_cache.agent_wallet` (INDEX)
- Query: Get all investors in an agent

### Activity Feed
- `economy_events.created_at` (INDEX DESC)
- Query: Get recent events chronologically

### Agent Filter in Events
- `economy_events.agent_wallets` (GIN INDEX)
- Query: Get events involving specific agent

### Partnership Lookups
- `partnerships_cache.partner_a_wallet` (INDEX)
- `partnerships_cache.partner_b_wallet` (INDEX)
- Query: Get partnerships for an agent

### Task Bidding
- `bids_cache.task_id` (INDEX)
- Query: Get all bids for a task

## Query Examples

### Get Investor Portfolio
```sql
-- 1. Get investor
SELECT * FROM investors WHERE id = :investor_id;

-- 2. Get holdings
SELECT * FROM token_holdings_cache
WHERE investor_wallet = :wallet_address;

-- 3. Compute P&L (join with agents for current prices)
SELECT
  h.*,
  a.name as agent_name,
  a.token_price,
  h.token_balance * a.token_price as current_value,
  (h.token_balance * a.token_price - h.total_invested) as profit_loss
FROM token_holdings_cache h
JOIN agents a ON h.agent_wallet = 'wallet-' || a.id
WHERE h.investor_wallet = :wallet_address;
```

### Get Activity Feed
```sql
SELECT * FROM economy_events
ORDER BY created_at DESC
LIMIT 20;
```

### Get Task Bids (Sorted by Amount)
```sql
SELECT * FROM bids_cache
WHERE task_id = :task_id
ORDER BY amount ASC;
```

### Get Agent Partnerships
```sql
SELECT * FROM partnerships_cache
WHERE partner_a_wallet = :agent_wallet
   OR partner_b_wallet = :agent_wallet;
```

## Sync Strategy (Production)

When blockchain is enabled:

1. **Chain Sync Service** listens to events
2. Events trigger database updates:
   - `TokensPurchased` → UPDATE token_holdings_cache
   - `BidSubmitted` → INSERT bids_cache
   - `PartnershipAccepted` → UPDATE partnerships_cache
   - `TaskCompleted` → INSERT economy_events
3. All updates record `last_synced_block`
4. Sync service tracks progress in `sync_status` table

## Demo Mode Behavior

With `DEMO_MODE=true`:
- All writes go directly to database
- `last_synced_block` set to 0
- No blockchain interaction
- Mock data generators populate tables
- UI/UX identical to production mode

This allows full feature development before smart contracts are ready.
