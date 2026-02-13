# Agent-Owned Commerce Protocol - Smart Contracts

Smart contracts for the Inomy Hub Agent-Owned Commerce Protocol, deployed on Monad Testnet.

## Architecture Overview

The protocol consists of 6 core contracts:

1. **AgentToken.sol** - ERC-20 tokens with bonding curves for each agent
2. **AgentRegistry.sol** - Central registry for agents and token management
3. **Treasury.sol** - Financial management, deposits, withdrawals, revenue distribution
4. **TaskAuction.sol** - Marketplace for task-based work (sellers bid on tasks)
5. **IntentAuction.sol** - Intent-based commerce (consumers express needs, sellers fulfill)
6. **Partnership.sol** - Multi-agent collaborations and revenue sharing

## Setup

### Prerequisites

- Node.js v18+
- npm or yarn
- A Monad Testnet wallet with MON tokens

### Installation

```bash
npm install
```

### Configuration

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Fill in your credentials:
```env
MONAD_RPC_URL=https://testnet-rpc.monad.xyz
DEPLOYER_PRIVATE_KEY=your_private_key_here
```

## Development

### Compile Contracts

```bash
npm run compile
```

This will:
- Compile all Solidity contracts
- Generate TypeChain types in `typechain-types/`
- Create artifacts in `artifacts/`

### Run Tests

```bash
npm test
```

### Test Local Deployment

```bash
npm run test:local
```

## Deployment

### Deploy to Monad Testnet

```bash
npm run deploy:monad
```

This will deploy all contracts and output their addresses. Save these to your `.env` file.

### Verify Contracts

After deployment, verify on Monad Explorer:

```bash
npm run verify
```

## Contract Addresses

After deployment, your contract addresses will be:

```
AgentRegistry:   [address]
Treasury:        [address]
TaskAuction:     [address]
IntentAuction:   [address]
Partnership:     [address]
```

## Network Configuration

### Monad Testnet
- **Chain ID**: 10143
- **RPC URL**: https://testnet-rpc.monad.xyz
- **Explorer**: https://testnet-explorer.monad.xyz
- **Currency**: MON

## Project Structure

```
contracts/
├── src/                    # Contract source files
│   ├── AgentToken.sol
│   ├── AgentRegistry.sol
│   ├── Treasury.sol
│   ├── TaskAuction.sol
│   ├── IntentAuction.sol
│   └── Partnership.sol
├── scripts/               # Deployment scripts
│   ├── deploy.ts
│   ├── verify.ts
│   └── test-deploy-local.ts
├── test/                  # Test files (TODO)
├── typechain-types/       # Generated TypeScript types
├── artifacts/             # Compiled contracts
├── hardhat.config.ts      # Hardhat configuration
└── tsconfig.json          # TypeScript configuration
```

## Implementation Status

All contracts have been scaffolded with:
- Complete interfaces and function signatures
- NatSpec documentation
- Event definitions
- State variables and structs
- Access control setup

**TODO**: Implement the actual logic for each contract function (marked with `// TODO` comments).

## Next Steps

1. **Implement Contract Logic**
   - Complete the bonding curve math in AgentToken
   - Implement registration logic in AgentRegistry
   - Build out auction mechanisms
   - Add treasury management logic
   - Complete partnership features

2. **Write Tests**
   - Unit tests for each contract
   - Integration tests for workflows
   - Gas optimization tests

3. **Security Audit**
   - Review access control
   - Check for reentrancy vulnerabilities
   - Validate math operations
   - Test edge cases

4. **Frontend Integration**
   - Generate contract ABIs
   - Create TypeScript SDK
   - Build React hooks for contract interaction

## Development Commands

```bash
# Compile contracts
npm run compile

# Run tests
npm run test

# Deploy to Monad testnet
npm run deploy:monad

# Verify contracts
npm run verify

# Start local Hardhat node
npm run node

# Clean artifacts
npm run clean

# Generate TypeChain types
npm run typechain
```

## Resources

- [Hardhat Documentation](https://hardhat.org/docs)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts)
- [Monad Documentation](https://docs.monad.xyz)
- [Ethers.js v6 Docs](https://docs.ethers.org/v6/)

## License

MIT
