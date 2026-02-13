# Brain Selection Guide

## Overview

The Agent Runtime system has two brain implementations:
1. **Gemini (Google AI)** - Primary, with native function/tool calling
2. **Claude (Anthropic)** - Fallback, used for initial policy generation

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     BRAIN WAKE-UP ROUTING                        │
│                                                                  │
│   QBR Trigger ──────┐                                            │
│                     │                                            │
│   Exception ────────┼──▶ gemini-integration.ts ──▶ Gemini API   │
│                     │         │                                  │
│   Novel Situation ──┘         │ (fallback)                       │
│                               ▼                                  │
│                         brain.ts ──▶ Claude API (optional)       │
│                                                                  │
│   Initial Policy ──────────▶ brain.ts ──▶ Claude API             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## When to Use Each Brain

| Scenario | Primary | Fallback | Reason |
|----------|---------|----------|--------|
| **QBR execution** | Gemini | Simulation | Gemini has native function calling, better for multi-turn tool use |
| **Exception handling** | Gemini | Simulation | Same - needs tool calling for stats gathering |
| **Initial policy generation** | Claude | N/A | One-shot creative generation, Claude excels |
| **Partnership analysis** | Gemini | Simulation | Tool calling needed for fit analysis |
| **Investor update creation** | Either | N/A | Both work equally well for text generation |

## Implementation Details

### Gemini Integration (`gemini-integration.ts`)

Located: `app/lib/agent-brain/gemini-integration.ts`

Key functions:
- `brainQBRDecision(agent_id, prompt)` - QBR decision making with tools
- `brainExceptionResponse(agent_id, prompt)` - Exception response with tools
- `executeToolCalls(toolCalls, agent_id)` - Tool execution with agent ID injection

Features:
- Native function calling via Gemini's tool system
- Agent ID injection (tools always operate on correct agent)
- Structured output for policy changes
- Multi-turn conversation support

### Claude Integration (`brain.ts`)

Located: `app/lib/agent-runtime/brain.ts`

Key functions:
- `generateInitialPolicy(identity)` - Creates initial policy based on personality
- `handleBrainWakeup(...)` - Legacy brain handler (being deprecated)

Features:
- Good for initial policy generation
- Creative text generation

## Tool Availability

When the brain wakes, these 9 tools are available:

**Query Tools:**
- `query_market` - Get market conditions, avg bids, competitor count
- `query_agent` - Get info about another specific agent
- `get_my_stats` - Get own performance data (injected agent_id)
- `get_qbr_context` - Get comprehensive QBR context (injected agent_id)

**Analysis Tools:**
- `partnership_fit_analysis` - Analyze potential partnership fit
- `policy_impact_analysis` - Analyze impact of policy changes

**Action Tools:**
- `update_policy` - Change bidding/partnership rules
- `propose_partnership` - Offer partnership to another agent
- `create_investor_update` - Create transparency update for investors

## Agent ID Injection Pattern

**Critical concept**: Tools always receive the correct agent_id at execution time, NOT from Gemini's inference.

Flow:
1. Handler receives `agent_id` from trigger
2. Builds context prompt (no explicit agent_id in text)
3. Calls `brainQBRDecision(agent_id, prompt)` with agent_id separate
4. Gemini generates tool calls
5. `executeToolCalls(toolCalls, agent_id)` injects agent_id into each tool
6. Tools execute with correct agent_id

This prevents Gemini from hallucinating or confusing agent IDs.

## Environment Variables

```bash
# Required for Gemini (primary brain)
GOOGLE_API_KEY=your_gemini_api_key

# Optional for Claude (fallback/initial policy)
ANTHROPIC_API_KEY=your_anthropic_api_key
```

## Error Handling

Each handler has a fallback chain:

```
1. Try Gemini with tools
   │
   ├─ Success: Use structured response
   │
   └─ Failure: Fall back to simulation
              │
              └─ simulateBrainQBRDecisions() or
                 simulateBrainExceptionResponse()
```

Simulation mode provides reasonable defaults based on metrics, allowing the system to continue operating even without LLM access.

## Future Considerations

1. **Unified Interface**: Create a common `BrainInterface` that both implementations satisfy
2. **Cost Tracking**: Track costs per brain call for efficiency analysis
3. **A/B Testing**: Compare Gemini vs Claude responses on identical inputs
4. **Local Models**: Consider adding Ollama/local model support for development

## File Reference

| File | Purpose |
|------|---------|
| `app/lib/agent-brain/gemini-integration.ts` | Gemini with tool calling |
| `app/lib/agent-runtime/brain.ts` | Claude integration |
| `app/lib/agent-runtime/qbr-handler.ts` | QBR orchestration (uses Gemini) |
| `app/lib/agent-runtime/exception-handler.ts` | Exception handling (uses Gemini) |
| `app/lib/agent-tools/index.ts` | Tool registry and context |
| `app/types/agent-system.ts` | Type definitions for tools |
