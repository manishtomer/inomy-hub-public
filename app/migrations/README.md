# Database Migrations

This directory contains SQL migration files for the Inomy Hub database schema.

## Migration Files

| File | Description | Status |
|------|-------------|--------|
| `001_initial_schema.sql` | Initial tables (agents, tasks, intents) | Applied |
| `002_economy_dashboard_tables.sql` | Economy dashboard tables (investors, holdings, events, partnerships, bids) | **NEW** |

## How to Apply Migrations

### Option 1: Using Supabase Dashboard

1. Go to your Supabase project: https://app.supabase.com
2. Navigate to SQL Editor
3. Copy the contents of the migration file
4. Paste and execute

### Option 2: Using Supabase CLI

```bash
# From the app directory
npx supabase db push
```

### Option 3: Using psql (Direct)

```bash
# Set your database connection string
export DATABASE_URL="postgresql://user:password@host:port/database"

# Apply migration
psql $DATABASE_URL -f migrations/002_economy_dashboard_tables.sql
```

## Migration 002: Economy Dashboard Tables

This migration creates 5 new tables for Phase 1 of the Agent Economy Dashboard:

### Tables Created

1. **investors** (OFF-CHAIN)
   - Human investor profiles
   - Links to blockchain via wallet_address

2. **token_holdings_cache** (CHAIN-SYNCED)
   - Investment positions (investor tokens in agents)
   - Synced from AgentToken contract

3. **economy_events** (COMPUTED)
   - Activity feed events
   - Generated from chain events + off-chain actions

4. **partnerships_cache** (CHAIN-SYNCED)
   - Agent partnerships with revenue splits
   - Synced from Partnership contract

5. **bids_cache** (CHAIN-SYNCED)
   - Task auction bids
   - Synced from TaskAuction contract

### Architecture Notes

- **OFF-CHAIN**: Data stored only in database (not on blockchain)
- **CHAIN-SYNCED**: Cached from blockchain, includes `last_synced_block` column
- **COMPUTED**: Generated from events or calculations

For hackathon demo (`DEMO_MODE=true`), all operations are database-only. When smart contracts are ready, writes will go to chain and sync service will update these cache tables.

### Verification

After applying the migration, verify with:

```sql
-- Check tables exist
SELECT tablename FROM pg_tables WHERE tablename IN (
  'investors',
  'token_holdings_cache',
  'economy_events',
  'partnerships_cache',
  'bids_cache'
);

-- Check row counts (should be 0)
SELECT
  'investors' as table_name,
  COUNT(*) as row_count
FROM investors
UNION ALL
SELECT 'token_holdings_cache', COUNT(*) FROM token_holdings_cache
UNION ALL
SELECT 'economy_events', COUNT(*) FROM economy_events
UNION ALL
SELECT 'partnerships_cache', COUNT(*) FROM partnerships_cache
UNION ALL
SELECT 'bids_cache', COUNT(*) FROM bids_cache;
```

## Rollback

To rollback migration 002:

```sql
DROP TABLE IF EXISTS bids_cache CASCADE;
DROP TABLE IF EXISTS partnerships_cache CASCADE;
DROP TABLE IF EXISTS economy_events CASCADE;
DROP TABLE IF EXISTS token_holdings_cache CASCADE;
DROP TABLE IF EXISTS investors CASCADE;
```

## Mock Data

After applying migrations, populate with mock data using the generators in `lib/mock-data.ts`:

```typescript
import {
  generateMockInvestors,
  generateMockHoldings,
  generateMockEconomyEvents,
  generateMockPartnerships,
  generateMockBids,
} from '@/lib/mock-data';

// Generate mock data
const investors = generateMockInvestors();
const holdings = generateMockHoldings(investors, agents);
const events = generateMockEconomyEvents(agents, investors);
const partnerships = generateMockPartnerships(agents);
const bids = generateMockBids(tasks, agents);
```

## Next Steps

1. Apply migration 002 to Supabase
2. Update API routes (Phase 2)
3. Build dashboard UI components (Phase 3)
4. Test with mock data
5. Enable chain sync when contracts are ready
