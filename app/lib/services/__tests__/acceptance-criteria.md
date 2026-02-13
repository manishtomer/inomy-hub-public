# Unified Pipeline — Acceptance Criteria & Test Cases

Covers all services in `lib/services/` and the pure functions in `lib/agent-runtime/autopilot.ts` that drive them.

---

## 1. Pure Functions (autopilot.ts)

### 1.1 calculateBidScore(reputation, bidAmount)

Formula: `(100 + reputation * 2) / bidAmount`

| # | Test Case | Input | Expected | Why |
|---|-----------|-------|----------|-----|
| 1.1.1 | Standard score | rep=3, bid=0.07 | (100+6)/0.07 = 1514.29 | Basic formula check |
| 1.1.2 | Higher rep wins tiebreaker | rep=5 bid=0.07 vs rep=3 bid=0.07 | 1571.4 > 1514.3 | Rep advantage at same price |
| 1.1.3 | Lower bid beats higher rep | rep=3 bid=0.065 vs rep=5 bid=0.07 | 1631 > 1571 | Price is primary factor |
| 1.1.4 | Zero bid returns 0 | rep=3, bid=0 | 0 | Guard against division by zero |
| 1.1.5 | Negative bid returns 0 | rep=3, bid=-1 | 0 | Guard against negative |
| 1.1.6 | Rep capped at 5 | rep=10, bid=0.07 | Same as rep=5 | Cap prevents gaming |
| 1.1.7 | Zero rep | rep=0, bid=0.07 | 100/0.07 = 1428.57 | Base score still works |

### 1.2 calculateTaskCost(costs)

Sum of: `llm_inference + data_retrieval + storage + submission`

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| 1.2.1 | CATALOG costs | AGENT_COSTS.CATALOG | 0.03+0.02+0.005+0.002 = 0.057 |
| 1.2.2 | REVIEW costs | AGENT_COSTS.REVIEW | 0.04+0.025+0.005+0.002 = 0.072 |
| 1.2.3 | CURATION costs | AGENT_COSTS.CURATION | 0.05+0.01+0.005+0.002 = 0.067 |
| 1.2.4 | SELLER costs | AGENT_COSTS.SELLER | 0.02+0.005+0.002+0.002 = 0.029 |

### 1.3 evaluateAuction(task, policy, costs, state)

Bid formula: `bid = cost / (1 - target_margin)`

| # | Test Case | Inputs | Expected | Why |
|---|-----------|--------|----------|-----|
| 1.3.1 | Target bid fits | CATALOG balanced, max_bid=0.10 | bid ~0.0648, action='bid' | 0.057/(1-0.12)=0.0648 < 0.10 |
| 1.3.2 | Target bid exceeds, min_margin fits | CATALOG balanced, max_bid=0.065 | bid=0.065 (at max_bid) | 0.0648 > 0.065 but minMargin bid=0.057/0.94=0.0606 < 0.065 |
| 1.3.3 | Even min_margin doesn't fit | CATALOG balanced, max_bid=0.059 | action='skip' | 0.057/0.94=0.0606 > 0.059 |
| 1.3.4 | Below skip_below | balanced, max_bid=0.0005 | action='skip' | 0.0005 < skip_below=0.001 |
| 1.3.5 | Insufficient balance | balance=0.01, max_bid=0.10 | action='skip' | 0.01 < 0.057+0.001=0.058 |
| 1.3.6 | Aggressive personality | aggressive, max_bid=0.10 | bid ~0.0613 | 0.057/(1-0.07)=0.0613 (lower margin) |
| 1.3.7 | Conservative personality | conservative, max_bid=0.10 | bid ~0.0713 | 0.057/(1-0.20)=0.0713 (higher margin) |
| 1.3.8 | Conservative can't meet min at low max | conservative, max_bid=0.066 | action='skip' | 0.057/(1-0.12)=0.0648 > 0.066 |

### 1.4 checkExceptions(state, policy, balance, reputation)

Returns first triggered exception or null.

| # | Test Case | State | Expected |
|---|-----------|-------|----------|
| 1.4.1 | Consecutive losses triggers | consecutive_losses=5, balanced policy | type='consecutive_losses' |
| 1.4.2 | Below threshold doesn't trigger | consecutive_losses=4, balanced policy (threshold=5) | null |
| 1.4.3 | Low balance triggers | balance=0.15, balanced policy (threshold=0.2) | type='low_balance' |
| 1.4.4 | Reputation drop triggers | rep_at_check=3.5, current=2.5, balanced (threshold=0.8) | type='reputation_drop' |
| 1.4.5 | Win rate drop triggers | win_rate_last=0.3, win_rate_check=0.55, balanced (threshold=15%) | type='win_rate_drop' |
| 1.4.6 | No exceptions | all values healthy | null |
| 1.4.7 | Priority order: losses checked first | consecutive_losses=5 AND low balance | type='consecutive_losses' |
| 1.4.8 | Aggressive has higher tolerance | consecutive_losses=7, aggressive (threshold=8) | null (below threshold) |

### 1.5 isQBRDue(state, policy, lastQBRRound)

| # | Test Case | State | Expected | Why |
|---|-----------|-------|----------|-----|
| 1.5.1 | Due after base interval | round=15, lastQBR=5, balanced (freq=10) | true | 15-5=10 >= 10 |
| 1.5.2 | Not due yet | round=12, lastQBR=5, balanced (freq=10) | false | 12-5=7 < 10 |
| 1.5.3 | Accelerated by losses | round=10, lastQBR=5, losses=5, balanced (freq=10, losses_above=4) | true | interval=10*0.6=6, 10-5=5 < 6... actually false. Let me recalc: round=11, lastQBR=5 → 6 >= 6 = true |
| 1.5.4 | Never had QBR | round=10, lastQBR=0, balanced (freq=10) | true | 10-0=10 >= 10 |
| 1.5.5 | Conservative more frequent | round=10, lastQBR=2, conservative (freq=8) | true | 10-2=8 >= 8 |

### 1.6 evaluateLifecycleStatus(currentStatus, balance, costs)

| # | Test Case | Input | Expected | Why |
|---|-----------|-------|----------|-----|
| 1.6.1 | Zero balance = DEAD | balance=0 | DEAD | Highest priority check |
| 1.6.2 | Negative balance = DEAD | balance=-0.5 | DEAD | Edge case |
| 1.6.3 | DEAD + funded = ACTIVE | status=DEAD, balance=1.0 | ACTIVE | Revival |
| 1.6.4 | UNFUNDED + funded = ACTIVE | status=UNFUNDED, balance=0.5 | ACTIVE | Activation |
| 1.6.5 | Low runway = LOW_FUNDS | balance=0.1, CATALOG costs | LOW_FUNDS | 0.1/(0.057+0.001+0.001)=1.7 < 5 rounds |
| 1.6.6 | Healthy runway = ACTIVE | balance=1.0, CATALOG costs | ACTIVE | 1.0/0.059=16.9 > 5 rounds |
| 1.6.7 | PAUSED stays PAUSED | status=PAUSED, balance=1.0 | PAUSED | Don't auto-resume |

---

## 2. BiddingService

### 2.1 generateBidForTask(agent, task)

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| 2.1.1 | Type mismatch → skip | CATALOG agent, REVIEW task | action='skip', reason contains 'type' |
| 2.1.2 | Zero balance → skip | balance=0 | action='skip', reason='Insufficient balance' |
| 2.1.3 | Negative balance → skip | balance=-1 | action='skip' |
| 2.1.4 | Matching type, healthy → bid | CATALOG agent, CATALOG task, balance=1.0 | action='bid', amount > 0 |
| 2.1.5 | No policy → uses personality defaults | agent.policy=null, personality='balanced' | Uses balanced defaults (target_margin=0.12) |
| 2.1.6 | Policy overrides defaults | agent.policy.bidding.target_margin=0.20 | Uses 0.20 not personality default |
| 2.1.7 | Score calculated correctly | bid amount known | score = calculateBidScore(rep, amount) |
| 2.1.8 | Policy trace has source | policy exists | policyTrace.source = 'policy' |
| 2.1.9 | Policy trace from defaults | policy null | policyTrace.source = 'personality_default' |
| 2.1.10 | Unknown personality → balanced | personality='unknown_type' | Falls back to balanced defaults |

### 2.2 generateBidsForRound(tasks, agents)

| # | Test Case | Scenario | Expected |
|---|-----------|----------|----------|
| 2.2.1 | Type matching | 1 CATALOG task, 1 CATALOG + 1 REVIEW agent | 1 bid (CATALOG only), 0 skips for REVIEW (filtered out before) |
| 2.2.2 | Multiple agents same type | 1 CATALOG task, 3 CATALOG agents | 3 bids |
| 2.2.3 | Multiple tasks | 2 CATALOG + 1 REVIEW, 2 CATALOG + 1 REVIEW agents | 4 CATALOG bids + 1 REVIEW bid = 5 |
| 2.2.4 | All agents broke | balance=0 for all | 0 bids, all skipped |
| 2.2.5 | No matching agents | SELLER task, only CATALOG agents | 0 bids |
| 2.2.6 | Empty tasks | 0 tasks | 0 bids, 0 skipped |
| 2.2.7 | Empty agents | 3 tasks, 0 agents | 0 bids |
| 2.2.8 | Bid outputs have required fields | any valid input | Each bid has: taskId, agentId, bidderWallet, amount, score, policyUsed |

---

## 3. AuctionService

### 3.1 submitBid(input)

| # | Test Case | Expected |
|---|-----------|----------|
| 3.1.1 | Valid bid inserts into bids_cache | Returns Bid with id, status='PENDING' |
| 3.1.2 | DB error returns null | On insert failure, returns null |

### 3.2 submitBatchBids(inputs, agentCostsMap?)

| # | Test Case | Expected |
|---|-----------|----------|
| 3.2.1 | Empty array | Returns [] immediately |
| 3.2.2 | Multiple bids insert | Returns array of Bid objects |
| 3.2.3 | No costs map | Inserts bids, NO balance deduction |
| 3.2.4 | With costs map | Inserts bids AND deducts bid_submission cost per bid |
| 3.2.5 | Multi-bid same agent | Agent with 3 bids gets 3x bid_submission deducted (0.003 for CATALOG) |
| 3.2.6 | Mixed agents | Each agent's total deduction = count * their bid_submission cost |
| 3.2.7 | DB error returns empty | On insert failure, returns [], NO deductions |

### 3.3 selectWinner(taskId, agents)

| # | Test Case | Scenario | Expected |
|---|-----------|----------|----------|
| 3.3.1 | No bids | Task with 0 bids | Returns null |
| 3.3.2 | Single bid wins | 1 bid on task | That bid wins |
| 3.3.3 | Lowest bid wins (same rep) | 2 agents same rep, bids 0.07 and 0.065 | Lower bid wins (higher score) |
| 3.3.4 | High rep can overcome price | rep=5 bid=0.072 vs rep=1 bid=0.070 | rep=5 wins: (110/0.072=1528) > (102/0.070=1457) |
| 3.3.5 | Agent not in agents list | Bid exists but agent missing | Returns null |
| 3.3.6 | All bids returned in allBids | 3 bids | allBids.length = 3, sorted by score desc |

### 3.4 closeAuction(task, agents)

| # | Test Case | Expected |
|---|-----------|----------|
| 3.4.1 | Successful close | Returns AuctionResult with winningBid, agent, losingBidIds |
| 3.4.2 | Winning bid marked WON | Winning bid status updated to 'WON' in DB |
| 3.4.3 | Losing bids marked LOST | All non-winning bids updated to 'LOST' |
| 3.4.4 | task_assigned event created | createEvent called with task_assigned type |
| 3.4.5 | No bids = no winner | Returns null |
| 3.4.6 | Revenue = winning bid amount | result.revenue === winningBid.amount |

---

## 4. EconomyService

### 4.1 processTaskCompletion — DB-only path (useBlockchain=false)

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| 4.1.1 | Balance updated correctly | bid=0.07, CATALOG costs=0.057 | newBalance = old + (0.07-0.057) = old + 0.013 |
| 4.1.2 | tasks_completed incremented | tasks_completed=5 | Updated to 6 |
| 4.1.3 | Revenue returned | bid=0.07 | result.revenue = 0.07 |
| 4.1.4 | Cost from AGENT_COSTS | CATALOG agent | result.cost = 0.057 |
| 4.1.5 | Profit = revenue - cost | bid=0.07 | result.profit = 0.013 |
| 4.1.6 | Agent local copy updated | agent.balance | agent.balance === newBalance |
| 4.1.7 | No reputation change | | result.reputationChange = 0 |
| 4.1.8 | Agent not found | Invalid agentId | Returns zero result |
| 4.1.9 | Uses agent.costs if provided | Custom cost structure | Uses custom, not AGENT_COSTS lookup |
| 4.1.10 | Fallback to CATALOG costs | Unknown agent type, no costs | Falls back to AGENT_COSTS.CATALOG |

### 4.2 processTaskCompletion — Blockchain path (useBlockchain=true)

| # | Test Case | Expected |
|---|-----------|----------|
| 4.2.1 | Operational cost paid to sink | payOperationalCostToSink called with privy_wallet_id, amount |
| 4.2.2 | Investor share deposited to escrow | depositToEscrow called with privy_wallet_id, investorShareTotal |
| 4.2.3 | Investor share split by BPS | 7500 bps = 75% to investors | investorShare = netProfit * 0.75 |
| 4.2.4 | Agent gets remaining share | | agentShare = netProfit - investorShare |
| 4.2.5 | Token holders get proportional share | Holder A: 60 tokens, B: 40 tokens | A gets 60%, B gets 40% of investorShare |
| 4.2.6 | Escrow deposit audit recorded | | Row in escrow_deposits table |
| 4.2.7 | Reputation increases by 0.025 | | Capped at 5.0 |
| 4.2.8 | Economy events logged | | task_payment + cost_sink_payment + escrow_deposit events |
| 4.2.9 | No privy wallet = skip real transfers | privy_wallet_id=null | No USDC transfers, DB update still happens |
| 4.2.10 | Failed cost sink = warn, continue | payOperationalCostToSink throws | Logs warning, rest of flow continues |

### 4.3 deductLivingCosts(agents, costPerRound, roundNum)

| # | Test Case | Expected |
|---|-----------|----------|
| 4.3.1 | All agents deducted | 3 agents, cost=0.005 | Each loses 0.005 |
| 4.3.2 | Balance doesn't go negative | balance=0.002, cost=0.005 | newBalance = 0 (Math.max(0, ...)) |
| 4.3.3 | Zero balance skipped | balance=0 | No deduction, no DB update |
| 4.3.4 | Local copy updated | | agent.balance reflects new value |
| 4.3.5 | living_cost event recorded | | Insert into economy_events (may fail silently) |

### 4.4 checkAndUpdateLifecycle(agent)

| # | Test Case | Expected |
|---|-----------|----------|
| 4.4.1 | No change | ACTIVE agent, balance=1.0 | Returns null |
| 4.4.2 | ACTIVE → LOW_FUNDS | balance=0.1 (runway < 5) | Returns { changed:true, from:'ACTIVE', to:'LOW_FUNDS' } |
| 4.4.3 | LOW_FUNDS → DEAD | balance=0 | Returns { changed:true, from:'LOW_FUNDS', to:'DEAD' } |
| 4.4.4 | DEAD creates agent_death event | balance=0 | createAgentEvent('agent_death', ...) called |
| 4.4.5 | Agent not found | Invalid agentId | Returns null |
| 4.4.6 | Status updated in DB | Any change | agents.status updated |

### 4.5 adjustBalance(agentId, delta)

| # | Test Case | Expected |
|---|-----------|----------|
| 4.5.1 | Positive delta | delta=+0.05, old=1.0 | Returns 1.05 |
| 4.5.2 | Negative delta | delta=-0.05, old=1.0 | Returns 0.95 |
| 4.5.3 | Floor at zero | delta=-2.0, old=1.0 | Returns 0 |
| 4.5.4 | Agent not found | Invalid ID | Returns 0 |

---

## 5. BrainService

### 5.1 checkAndTriggerExceptions(agents, roundNum, options)

| # | Test Case | Expected |
|---|-----------|----------|
| 5.1.1 | No exceptions = empty results | All agents healthy | Returns [] |
| 5.1.2 | Exception found, useLLM=true | 1 agent with consecutive_losses=5 | Calls wakeForException |
| 5.1.3 | Exception found, useLLM=false | 1 agent with consecutive_losses=5 | Calls applyDefaultExceptionResponses |
| 5.1.4 | Max brain calls respected | 5 exceptions, maxBrainCalls=3 | Only 3 processed |
| 5.1.5 | Default maxBrainCalls=3 | No options.maxBrainCalls | Limit is 3 |
| 5.1.6 | Default useLLM=true | No options.useLLM | Brain is called |
| 5.1.7 | Missing runtime state skipped | Agent with no agent_runtime_state row | That agent skipped |
| 5.1.8 | Uses policy from agent | Agent has custom policy | Custom thresholds used |
| 5.1.9 | Falls back to personality defaults | agent.policy=null | PERSONALITY_DEFAULTS[personality] used |

### 5.2 applyDefaultExceptionResponses (useLLM=false)

| # | Test Case | Expected |
|---|-----------|----------|
| 5.2.1 | consecutive_losses → lower margin | | policyChanges.bidding.target_margin = 0.08 |
| 5.2.2 | balance_critical → conservative margin | | policyChanges.bidding.target_margin = 0.20 |
| 5.2.3 | win_rate_too_low → conservative margin | | policyChanges.bidding.target_margin = 0.20 |
| 5.2.4 | Other exception types → no changes | type='high_performer' | policyChanges = {} |
| 5.2.5 | Result has correct shape | Any | { agentId, agentName, round, exceptionType, reasoning } |
| 5.2.6 | Reasoning mentions LLM disabled | | reasoning contains 'LLM disabled' |

### 5.3 wakeForException (useLLM=true)

| # | Test Case | Expected |
|---|-----------|----------|
| 5.3.1 | Creates exception memory | | createPersonalMemory called with 'exception_handled' |
| 5.3.2 | Calls Gemini brain | | brainStrategicThinking called |
| 5.3.3 | Deducts brain cost $0.01 | | adjustBalance(agentId, -0.01) |
| 5.3.4 | Stores in exception_history | | Row inserted with agent_id, exception_type, brain_response |
| 5.3.5 | Records brain_decision event | | createEvent with 'brain_decision' type |
| 5.3.6 | Policy changes applied | Brain returns policy changes | applyPolicyChanges called |
| 5.3.7 | Brain failure returns null | Gemini throws error | Returns null, logs error |
| 5.3.8 | No policy changes = no DB write | Brain returns empty changes | applyPolicyChanges NOT called |

### 5.4 checkAndRunQBR(agent, roundNumber, useLLM)

| # | Test Case | Expected |
|---|-----------|----------|
| 5.4.1 | QBR not due | round=5, lastQBR=1, freq=10 | Returns false |
| 5.4.2 | QBR due + useLLM=true | round=15, lastQBR=5 | executeQBR called, returns true |
| 5.4.3 | QBR due + useLLM=false | round=15, lastQBR=5 | Updates last_qbr_round, returns false |
| 5.4.4 | Deducts brain cost after QBR | useLLM=true, QBR succeeds | adjustBalance(agentId, -0.01) |
| 5.4.5 | QBR failure | executeQBR throws | Returns false, logs error |
| 5.4.6 | No runtime state | Missing agent_runtime_state | Returns false |

### 5.5 applyPolicyChanges(agent, changes)

| # | Test Case | Expected |
|---|-----------|----------|
| 5.5.1 | Bidding changes merged | changes={bidding:{target_margin:0.15}} | New policy has merged bidding |
| 5.5.2 | Survival changes merged | changes={survival:{min_balance:0.5}} | New policy has merged survival |
| 5.5.3 | New policy version inserted | | New row in agent_policies |
| 5.5.4 | Agent local copy updated | | agent.policy reflects new merged policy |
| 5.5.5 | Existing policy fields preserved | Only change bidding.target_margin | Other bidding fields unchanged |

---

## 6. MemoryService

All methods call `createPersonalMemory()` and are fire-and-forget.

### 6.1 createBidMemory

| # | Test Case | Expected |
|---|-----------|----------|
| 6.1.1 | Correct memory type | | Creates 'bid_outcome' memory |
| 6.1.2 | Includes task details | | metadata has task_id, task_type, my_bid |
| 6.1.3 | Context built from agent | | context has name, type, personality, balance, reputation |

### 6.2 createTaskExecutionMemory

| # | Test Case | Expected |
|---|-----------|----------|
| 6.2.1 | Correct memory type | | Creates 'task_execution' memory |
| 6.2.2 | Calculates profit | rev=0.07, cost=0.057 | metadata.profit = 0.013 |
| 6.2.3 | Calculates margin % | rev=0.07, cost=0.057 | metadata.margin = 18.57% |
| 6.2.4 | Zero revenue margin | rev=0 | metadata.margin = 0 |

### 6.3 createExceptionMemory

| # | Test Case | Expected |
|---|-----------|----------|
| 6.3.1 | Correct memory type | | Creates 'exception_handled' memory |
| 6.3.2 | Importance = 0.7 | | importance parameter = 0.7 |

### 6.4 createQBRMemory

| # | Test Case | Expected |
|---|-----------|----------|
| 6.4.1 | Correct memory type | | Creates 'qbr_insight' memory |
| 6.4.2 | Importance = 0.8 | | importance parameter = 0.8 |

### 6.5 createPartnershipMemory

| # | Test Case | Expected |
|---|-----------|----------|
| 6.5.1 | Formed → importance 0.7 | eventType='formed' | importance = 0.7 |
| 6.5.2 | Rejected → importance 0.5 | eventType='rejected' | importance = 0.5 |
| 6.5.3 | Ended → importance 0.5 | eventType='ended' | importance = 0.5 |
| 6.5.4 | Includes partner details | | metadata has partner_id, partner_name, split, reason |

---

## 7. RoundProcessor — 9-Step Pipeline

### 7.1 Step 1: Lifecycle Checks

| # | Test Case | Expected |
|---|-----------|----------|
| 7.1.1 | DEAD agent excluded | Agent with balance=0 | Not in activeAgents, listed in lifecycleChanges |
| 7.1.2 | ACTIVE agent included | Agent with balance=1.0 | In activeAgents |
| 7.1.3 | Status transition recorded | ACTIVE→LOW_FUNDS | lifecycleChanges has {from:'ACTIVE', to:'LOW_FUNDS'} |
| 7.1.4 | Multiple agents checked | 5 agents, 1 dead | 4 in activeAgents, 1 in lifecycleChanges |

### 7.2 Step 2: Bidding

| # | Test Case | Expected |
|---|-----------|----------|
| 7.2.1 | Bids generated for matching types | 3 tasks, 4 agents | Only type-matching pairs produce bids |
| 7.2.2 | Broke agents skipped | balance=0 | No bids from that agent |
| 7.2.3 | result.bidsPlaced reflects actual | 5 bids submitted | result.bidsPlaced = 5 |
| 7.2.4 | Bid cost deducted per agent | CATALOG agent, 2 bids | Balance reduced by 2 * 0.001 = 0.002 |
| 7.2.5 | Bid memories created | 5 bids | 5 createBidMemory calls (fire-and-forget) |

### 7.3 Steps 3 & 4: Auction Closure + Task Execution

| # | Test Case | Expected |
|---|-----------|----------|
| 7.3.1 | Winner selected per task | 2 bids on task | Higher score wins |
| 7.3.2 | Winning bid marked WON | | bids_cache status='WON' |
| 7.3.3 | Losing bids marked LOST | | bids_cache status='LOST' |
| 7.3.4 | Revenue credited to winner | bid=0.07 | processTaskCompletion called |
| 7.3.5 | Task marked completed | | taskService.completeTask called |
| 7.3.6 | No bids = task expired | Task with 0 bids | taskService.expireTask called |
| 7.3.7 | totalRevenue accumulated | 3 tasks, varied bids | Sum of all winning bid amounts |
| 7.3.8 | tasksCompleted count | 2 of 3 tasks have bids | tasksCompleted=2, tasksExpired=1 |
| 7.3.9 | Task execution memory created | Task won | createTaskExecutionMemory called |

### 7.4 Step 5: Living Costs

| # | Test Case | Expected |
|---|-----------|----------|
| 7.4.1 | All active agents charged | 4 active agents, cost=0.005 | Each loses 0.005 |
| 7.4.2 | Dead agents NOT charged | Agent died in step 1 | Not in activeAgents, not charged |
| 7.4.3 | result.livingCostsDeducted | 4 agents, cost=0.005 | result.livingCostsDeducted = 0.02 |

### 7.5 Steps 6 & 7: Exception Detection + Brain Wake-ups

| # | Test Case | Expected |
|---|-----------|----------|
| 7.5.1 | Exceptions checked for all active agents | 4 active agents | All 4 checked |
| 7.5.2 | useLLM passed through | config.useLLM=false | Default responses applied |
| 7.5.3 | maxBrainCalls=3 | | Max 3 brain calls per round |
| 7.5.4 | Exception memories created | 2 exceptions | 2 createExceptionMemory calls |
| 7.5.5 | result.exceptionsDetected | 2 exceptions | result.exceptionsDetected = 2 |
| 7.5.6 | result.brainWakeups populated | | Array of BrainWakeupResult |

### 7.6 Step 8: QBR

| # | Test Case | Expected |
|---|-----------|----------|
| 7.6.1 | QBR checked for each agent | 4 active agents | checkAndRunQBR called 4 times |
| 7.6.2 | QBR count tracked | 1 of 4 agents due for QBR | result.qbrsRun = 1 |
| 7.6.3 | QBR memory created | QBR ran for agent | createQBRMemory called |

### 7.7 Step 9: Final State

| # | Test Case | Expected |
|---|-----------|----------|
| 7.7.1 | Agent data refreshed | | agentService.refreshAgentData called |
| 7.7.2 | result.agentStates populated | 4 active agents | 4 entries with id, name, balance, reputation, status |
| 7.7.3 | Balances reflect all operations | Agent won task, paid living cost, paid bid cost | Final balance = old + profit - livingCost - bidCost |

### 7.8 Full Pipeline Integration

| # | Test Case | Expected |
|---|-----------|----------|
| 7.8.1 | Empty tasks, active agents | 0 tasks, 3 agents | No bids, no winners, living costs still deducted |
| 7.8.2 | Tasks but no agents | 3 tasks, 0 agents | All tasks expired |
| 7.8.3 | All agents dead | All balances=0 | All excluded in step 1, no processing |
| 7.8.4 | Single agent, single task | 1 CATALOG task, 1 CATALOG agent | 1 bid, 1 winner, 1 completion |
| 7.8.5 | useBlockchain=false | | processDbOnly path, no USDC transfers |
| 7.8.6 | useBlockchain=true | | processWithBlockchain path, real USDC |
| 7.8.7 | Result shape complete | | All fields populated: round, tasksProcessed, bidsPlaced, auctionsClosed, tasksCompleted, tasksExpired, totalRevenue, livingCostsDeducted, exceptionsDetected, brainWakeups, qbrsRun, lifecycleChanges, agentStates |

---

## 8. simulate-v2 API Route

### 8.1 POST /api/admin/simulate-v2

| # | Test Case | Request Body | Expected |
|---|-----------|-------------|----------|
| 8.1.1 | Default parameters | {} | 1 round, 3 tasks, blockchain=false, llm=false |
| 8.1.2 | Custom rounds | { rounds: 5 } | 5 rounds processed |
| 8.1.3 | Custom tasks per round | { tasks_per_round: 10 } | 10 tasks per round |
| 8.1.4 | Custom price range | { price_min: 0.08, price_max: 0.12 } | Tasks have max_bid in [0.08, 0.12] |
| 8.1.5 | Enable blockchain | { use_blockchain: true } | Blockchain payment path used |
| 8.1.6 | Enable LLM | { use_llm: true } | Real brain calls made |
| 8.1.7 | No active agents | DB has no active agents | 400 error: 'No active agents found' |
| 8.1.8 | Round counter persisted | Run twice | Second run starts from correct round |
| 8.1.9 | Response shape | Any valid run | { success, data: { rounds_completed, starting_round, ending_round, total_tasks, total_bids, total_completed, total_revenue, brain_wakeups, rounds[] } } |
| 8.1.10 | Agents refreshed between rounds | 5 rounds | Fresh agent data loaded for rounds 2-5 |
| 8.1.11 | Camel + snake case params | { tasksPerRound: 5 } | Works same as { tasks_per_round: 5 } |
| 8.1.12 | Server error | DB connection fails | 500 with error message |

---

## 9. runner.ts tick() Integration

### 9.1 Tick Method

| # | Test Case | Expected |
|---|-----------|----------|
| 9.1.1 | Loads identity each tick | | loadAgentIdentity called |
| 9.1.2 | Missing identity skips tick | Agent deleted mid-run | Returns without processing |
| 9.1.3 | Advances round number | state.current_round was 5 | Now 6 |
| 9.1.4 | Gets open tasks for agent type | CATALOG agent | getOpenTasks({type:'CATALOG'}) |
| 9.1.5 | Builds AgentWithPolicy | | Has id, name, type, balance, reputation, personality, policy, costs |
| 9.1.6 | Calls processRound | | roundProcessor.processRound called with [tasks], [agentWithPolicy], config |
| 9.1.7 | useLLM=true in runtime | | config.useLLM = true |
| 9.1.8 | useBlockchain from config | | config.useBlockchain = this.config.use_blockchain |
| 9.1.9 | DEAD result stops loop | processRound returns DEAD lifecycle change | abort.abort() called |
| 9.1.10 | Partnerships polled separately | | pollPartnerships called after processRound |
| 9.1.11 | Policy reloaded after brain/QBR | brainWakeups.length > 0 | loadPolicy called, agentPolicies map updated |
| 9.1.12 | State saved after tick | | saveRuntimeState called |

---

## 10. Cross-Cutting Concerns

### 10.1 Cost Consistency

| # | Test Case | Expected |
|---|-----------|----------|
| 10.1.1 | Simulation uses same costs as runtime | Both call AGENT_COSTS[type] | Same cost structure |
| 10.1.2 | Bid cost deducted in both paths | Simulation via submitBatchBids, Runtime via submitBatchBids | Both deduct bid_submission |
| 10.1.3 | Brain cost deducted in both paths | Simulation with useLLM=true, Runtime | Both deduct 0.01 per call |
| 10.1.4 | Living cost deducted in both paths | | Both call deductLivingCosts |
| 10.1.5 | Task cost calculated identically | | Both use calculateTaskCost(AGENT_COSTS[type]) |

### 10.2 Balance Invariants

| # | Test Case | Expected |
|---|-----------|----------|
| 10.2.1 | Balance never goes negative | Any operations | Math.max(0, ...) everywhere |
| 10.2.2 | All deductions trackable | After a round | Sum of: bidCost + taskCost + livingCost + brainCost = total deductions |
| 10.2.3 | Revenue only from winning | Agent that loses all bids | Balance decreases (bid cost + living cost, no revenue) |

### 10.3 Memory Creation

| # | Test Case | Expected |
|---|-----------|----------|
| 10.3.1 | Memory failures don't crash pipeline | createPersonalMemory throws | Pipeline continues, error logged |
| 10.3.2 | All 5 memory types created in pipeline | Full round with win + exception + QBR | bid_outcome + task_execution + exception_handled + qbr_insight memories |
| 10.3.3 | Memory context accurate | | balance/reputation reflect current state at time of event |

### 10.4 Error Resilience

| # | Test Case | Expected |
|---|-----------|----------|
| 10.4.1 | DB read failure | Supabase SELECT fails | Graceful fallback (null/empty), not crash |
| 10.4.2 | DB write failure | Supabase INSERT fails | Error logged, pipeline continues |
| 10.4.3 | Economy event failure | createEvent fails | .catch() swallows, pipeline continues |
| 10.4.4 | Brain failure | Gemini API down | wakeForException returns null, others still process |

---

## Cost Reference Table

| Agent Type | Task Cost | Bid Cost | Brain Cost | Living Cost |
|------------|-----------|----------|------------|-------------|
| CATALOG | $0.057 | $0.001 | $0.01 | $0.001/round |
| REVIEW | $0.072 | $0.001 | $0.01 | $0.001/round |
| CURATION | $0.067 | $0.001 | $0.01 | $0.001/round |
| SELLER | $0.029 | $0.001 | $0.01 | $0.001/round |

## Personality Margin Reference

| Personality | Target Margin | Min Margin | Skip Below |
|-------------|---------------|------------|------------|
| balanced | 12% | 6% | $0.001 |
| aggressive | 7% | 3% | $0.001 |
| conservative | 20% | 12% | $0.002 |
| risk-taker | 8% | 3% | $0.001 |
| profit-maximizer | 18% | 10% | $0.002 |
| volume-chaser | 6% | 2% | $0.001 |
| opportunist | 12% | 5% | $0.001 |
| opportunistic | 12% | 5% | $0.001 |
| partnership-oriented | 14% | 8% | $0.002 |
