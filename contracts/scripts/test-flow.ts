import { ethers } from "hardhat";

/**
 * End-to-End Test Flow Script
 *
 * Tests the full blockchain lifecycle on Monad Testnet:
 *   1. Register 2 agents (with separate wallets)
 *   2. Activate both agents (OPERATOR_ROLE)
 *   3. Create a task with escrowed MON
 *   4. Both agents submit bids
 *   5. Wait for bidding window, select winner
 *   6. Winner completes task
 *   7. Operator validates and releases payment
 *   8. Buy tokens on winning agent's bonding curve
 *   9. Propose and accept a partnership between the agents
 *
 * Run:
 *   npx hardhat run scripts/test-flow.ts --network monadTestnet
 *
 * Prerequisites:
 *   - Contracts deployed (addresses in .env)
 *   - DEPLOYER_PRIVATE_KEY set in .env with MON balance
 *   - Start chain sync in another terminal:  cd app/ && npm run chain-sync
 */

// Contract addresses from .env
const ADDRESSES = {
  TREASURY: process.env.TREASURY_ADDRESS!,
  AGENT_REGISTRY: process.env.AGENT_REGISTRY_ADDRESS!,
  TASK_AUCTION: process.env.TASK_AUCTION_ADDRESS!,
  INTENT_AUCTION: process.env.INTENT_AUCTION_ADDRESS!,
  PARTNERSHIP: process.env.PARTNERSHIP_ADDRESS!,
};

// Enums matching Solidity
const AgentType = { CATALOG: 0, REVIEW: 1, CURATION: 2, SELLER: 3 };
const AgentStatus = { UNFUNDED: 0, ACTIVE: 1, LOW_FUNDS: 2, PAUSED: 3, DEAD: 4 };
const TaskType = { CATALOG: 0, REVIEW: 1, CURATION: 2, BUNDLED: 3 };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function divider(title: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"=".repeat(60)}\n`);
}

async function main() {
  console.log("\n  INOMY - Full Blockchain Flow Test");
  console.log("  Chain: Monad Testnet (10143)\n");

  // Validate addresses
  for (const [name, addr] of Object.entries(ADDRESSES)) {
    if (!addr) {
      console.error(`ERROR: ${name} address not set in .env`);
      process.exit(1);
    }
    console.log(`  ${name}: ${addr}`);
  }

  // ──────────────────────────────────────────────────
  // SETUP
  // ──────────────────────────────────────────────────
  divider("SETUP");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer (Operator):", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "MON");

  if (balance < ethers.parseEther("3.0")) {
    console.error("ERROR: Need at least 3.0 MON. Get testnet MON from https://faucet.monad.xyz");
    process.exit(1);
  }

  // Attach to deployed contracts
  const agentRegistry = await ethers.getContractAt("AgentRegistry", ADDRESSES.AGENT_REGISTRY);
  const taskAuction = await ethers.getContractAt("TaskAuction", ADDRESSES.TASK_AUCTION);
  const partnership = await ethers.getContractAt("Partnership", ADDRESSES.PARTNERSHIP);

  // Create 2 test wallets for agents
  const agentWallet1 = ethers.Wallet.createRandom().connect(ethers.provider);
  const agentWallet2 = ethers.Wallet.createRandom().connect(ethers.provider);

  console.log("\nAgent Wallet 1:", agentWallet1.address);
  console.log("Agent Wallet 2:", agentWallet2.address);

  // Fund agent wallets with gas money
  const gasAllowance = ethers.parseEther("1.0");
  const GAS = { gasLimit: 5_000_000n };
  console.log("\nFunding agent wallets with 1.0 MON each for gas...");

  const tx1 = await deployer.sendTransaction({ to: agentWallet1.address, value: gasAllowance, ...GAS });
  const tx2 = await deployer.sendTransaction({ to: agentWallet2.address, value: gasAllowance, ...GAS });
  await Promise.all([tx1.wait(), tx2.wait()]);
  console.log("Funded.");

  // ──────────────────────────────────────────────────
  // STEP 1: Register Agents
  // ──────────────────────────────────────────────────
  divider("STEP 1: Register Agents");

  const regFee = await agentRegistry.registrationFee();
  console.log("Registration fee:", ethers.formatEther(regFee), "MON");

  // Register Agent 1 - CATALOG type
  console.log("\nRegistering Agent 1: CatalogBot-Alpha (CATALOG)...");
  const regTx1 = await agentRegistry.registerAgent(
    "CatalogBot-Alpha",
    "CBA",
    AgentType.CATALOG,
    agentWallet1.address,
    "ipfs://test-flow/agent-1",
    7500n,  // 75% investor share
    ethers.parseEther("100"),  // 100 founder tokens
    { value: regFee, gasLimit: 5_000_000n }
  );
  const regReceipt1 = await regTx1.wait();
  console.log("TX:", regReceipt1?.hash);

  // Parse AgentRegistered event to get agentId
  const regEvent1 = regReceipt1?.logs.find((log) => {
    try {
      return agentRegistry.interface.parseLog({ topics: [...log.topics], data: log.data })?.name === "AgentRegistered";
    } catch { return false; }
  });
  const parsedReg1 = agentRegistry.interface.parseLog({
    topics: [...regEvent1!.topics],
    data: regEvent1!.data,
  });
  const agent1Id = parsedReg1!.args[0];
  const agent1Token = parsedReg1!.args[3];
  console.log("Agent 1 ID:", agent1Id.toString());
  console.log("Agent 1 Token:", agent1Token);

  // Register Agent 2 - REVIEW type
  console.log("\nRegistering Agent 2: ReviewBot-Beta (REVIEW)...");
  const regTx2 = await agentRegistry.registerAgent(
    "ReviewBot-Beta",
    "RBB",
    AgentType.REVIEW,
    agentWallet2.address,
    "ipfs://test-flow/agent-2",
    8000n,  // 80% investor share
    ethers.parseEther("100"),
    { value: regFee, gasLimit: 5_000_000n }
  );
  const regReceipt2 = await regTx2.wait();
  console.log("TX:", regReceipt2?.hash);

  const regEvent2 = regReceipt2?.logs.find((log) => {
    try {
      return agentRegistry.interface.parseLog({ topics: [...log.topics], data: log.data })?.name === "AgentRegistered";
    } catch { return false; }
  });
  const parsedReg2 = agentRegistry.interface.parseLog({
    topics: [...regEvent2!.topics],
    data: regEvent2!.data,
  });
  const agent2Id = parsedReg2!.args[0];
  const agent2Token = parsedReg2!.args[3];
  console.log("Agent 2 ID:", agent2Id.toString());
  console.log("Agent 2 Token:", agent2Token);

  // ──────────────────────────────────────────────────
  // STEP 2: Activate Agents
  // ──────────────────────────────────────────────────
  divider("STEP 2: Activate Agents (Operator)");

  // Agents start as UNFUNDED - operator sets them to ACTIVE
  console.log("Activating Agent 1...");
  const actTx1 = await agentRegistry.setAgentStatus(agent1Id, AgentStatus.ACTIVE, GAS);
  await actTx1.wait();
  console.log("TX:", actTx1.hash);

  console.log("Activating Agent 2...");
  const actTx2 = await agentRegistry.setAgentStatus(agent2Id, AgentStatus.ACTIVE, GAS);
  await actTx2.wait();
  console.log("TX:", actTx2.hash);

  // Verify agents are active
  const agent1Data = await agentRegistry.getAgent(agent1Id);
  const agent2Data = await agentRegistry.getAgent(agent2Id);
  console.log(`\nAgent 1 status: ${agent1Data.status} (${agent1Data.status === 1n ? "ACTIVE" : "NOT ACTIVE"})`);
  console.log(`Agent 2 status: ${agent2Data.status} (${agent2Data.status === 1n ? "ACTIVE" : "NOT ACTIVE"})`);
  console.log(`Agent 1 reputation: ${agent1Data.reputation.toString()}`);
  console.log(`Agent 2 reputation: ${agent2Data.reputation.toString()}`);

  // ──────────────────────────────────────────────────
  // STEP 3: Create a Task
  // ──────────────────────────────────────────────────
  divider("STEP 3: Create Task (Operator)");

  const maxBid = ethers.parseEther("0.01"); // 0.01 MON max budget
  const biddingDuration = 60; // 60 seconds bidding window
  const completionDuration = 300; // 5 minutes to complete
  const inputHash = ethers.keccak256(ethers.toUtf8Bytes("product:electronics:wireless-earbuds-2026"));

  console.log("Creating CATALOG task...");
  console.log(`  Max bid: ${ethers.formatEther(maxBid)} MON`);
  console.log(`  Bidding window: ${biddingDuration}s`);
  console.log(`  Completion window: ${completionDuration}s`);

  const createTaskTx = await taskAuction.createTask(
    TaskType.CATALOG,
    inputHash,
    "ipfs://test-flow/task-1",
    maxBid,
    biddingDuration,
    completionDuration,
    { value: maxBid, ...GAS } // Escrow the max bid amount
  );
  const taskReceipt = await createTaskTx.wait();
  console.log("TX:", taskReceipt?.hash);

  // Parse TaskCreated event
  const taskEvent = taskReceipt?.logs.find((log) => {
    try {
      return taskAuction.interface.parseLog({ topics: [...log.topics], data: log.data })?.name === "TaskCreated";
    } catch { return false; }
  });
  const parsedTask = taskAuction.interface.parseLog({
    topics: [...taskEvent!.topics],
    data: taskEvent!.data,
  });
  const taskId = parsedTask!.args[0];
  console.log("Task ID:", taskId.toString());

  // ──────────────────────────────────────────────────
  // STEP 4: Agents Submit Bids
  // ──────────────────────────────────────────────────
  divider("STEP 4: Submit Bids (Agent Wallets)");

  const bid1Amount = ethers.parseEther("0.006"); // Agent 1 bids 0.006 MON
  const bid2Amount = ethers.parseEther("0.008"); // Agent 2 bids 0.008 MON

  // Agent 1 submits bid (from agent wallet 1)
  console.log(`Agent 1 bidding ${ethers.formatEther(bid1Amount)} MON...`);
  const taskAuctionAgent1 = taskAuction.connect(agentWallet1);
  const bidTx1 = await taskAuctionAgent1.submitBid(taskId, agent1Id, bid1Amount, GAS);
  const bidReceipt1 = await bidTx1.wait();
  console.log("TX:", bidReceipt1?.hash);

  // Parse BidSubmitted event
  const bidEvent1 = bidReceipt1?.logs.find((log) => {
    try {
      return taskAuction.interface.parseLog({ topics: [...log.topics], data: log.data })?.name === "BidSubmitted";
    } catch { return false; }
  });
  const parsedBid1 = taskAuction.interface.parseLog({
    topics: [...bidEvent1!.topics],
    data: bidEvent1!.data,
  });
  console.log("Bid 1 ID:", parsedBid1!.args[0].toString());

  // Agent 2 submits bid (from agent wallet 2)
  console.log(`\nAgent 2 bidding ${ethers.formatEther(bid2Amount)} MON...`);
  const taskAuctionAgent2 = taskAuction.connect(agentWallet2);
  const bidTx2 = await taskAuctionAgent2.submitBid(taskId, agent2Id, bid2Amount, GAS);
  const bidReceipt2 = await bidTx2.wait();
  console.log("TX:", bidReceipt2?.hash);

  const bidEvent2 = bidReceipt2?.logs.find((log) => {
    try {
      return taskAuction.interface.parseLog({ topics: [...log.topics], data: log.data })?.name === "BidSubmitted";
    } catch { return false; }
  });
  const parsedBid2 = taskAuction.interface.parseLog({
    topics: [...bidEvent2!.topics],
    data: bidEvent2!.data,
  });
  console.log("Bid 2 ID:", parsedBid2!.args[0].toString());

  // ──────────────────────────────────────────────────
  // STEP 5: Wait for Bidding Window + Select Winner
  // ──────────────────────────────────────────────────
  divider("STEP 5: Wait for Bidding Window to Close");

  console.log(`Waiting ${biddingDuration}s for bidding window to close...`);
  for (let i = biddingDuration; i > 0; i -= 10) {
    process.stdout.write(`  ${i}s remaining...\r`);
    await sleep(Math.min(10000, i * 1000));
  }
  console.log("  Bidding window closed!          ");

  // Add a small buffer for block time
  await sleep(5000);

  console.log("\nSelecting winner (lowest bid wins)...");
  const selectTx = await taskAuction.selectWinner(taskId, GAS);
  const selectReceipt = await selectTx.wait();
  console.log("TX:", selectReceipt?.hash);

  // Parse WinnerSelected event
  const winnerEvent = selectReceipt?.logs.find((log) => {
    try {
      return taskAuction.interface.parseLog({ topics: [...log.topics], data: log.data })?.name === "WinnerSelected";
    } catch { return false; }
  });
  const parsedWinner = taskAuction.interface.parseLog({
    topics: [...winnerEvent!.topics],
    data: winnerEvent!.data,
  });
  const winningAgentId = parsedWinner!.args[1];
  const winningAmount = parsedWinner!.args[3];
  console.log("Winner: Agent", winningAgentId.toString());
  console.log("Winning bid:", ethers.formatEther(winningAmount), "MON");
  console.log("(Agent 1 bid lower at 0.006 MON, so Agent 1 should win)");

  // ──────────────────────────────────────────────────
  // STEP 6: Winner Completes Task
  // ──────────────────────────────────────────────────
  divider("STEP 6: Winner Completes Task");

  const outputHash = ethers.keccak256(ethers.toUtf8Bytes("output:catalog-data-for-wireless-earbuds"));

  // The winning agent wallet must call completeTask
  const winnerWallet = winningAgentId === agent1Id ? agentWallet1 : agentWallet2;
  const taskAuctionWinner = taskAuction.connect(winnerWallet);

  console.log("Submitting completed work from winning agent's wallet...");
  const completeTx = await taskAuctionWinner.completeTask(taskId, outputHash, GAS);
  const completeReceipt = await completeTx.wait();
  console.log("TX:", completeReceipt?.hash);

  // ──────────────────────────────────────────────────
  // STEP 7: Operator Validates and Pays
  // ──────────────────────────────────────────────────
  divider("STEP 7: Validate & Pay (Operator)");

  const winnerBalanceBefore = await ethers.provider.getBalance(winnerWallet.address);
  console.log("Winner balance before:", ethers.formatEther(winnerBalanceBefore), "MON");

  console.log("Validating task and releasing payment...");
  const validateTx = await taskAuction.validateAndPay(taskId, true, GAS);
  const validateReceipt = await validateTx.wait();
  console.log("TX:", validateReceipt?.hash);

  const winnerBalanceAfter = await ethers.provider.getBalance(winnerWallet.address);
  console.log("Winner balance after:", ethers.formatEther(winnerBalanceAfter), "MON");
  console.log("Payment received:", ethers.formatEther(winnerBalanceAfter - winnerBalanceBefore), "MON");

  // Check updated agent stats
  const updatedAgent = await agentRegistry.getAgent(winningAgentId);
  console.log("\nUpdated agent stats:");
  console.log("  Tasks completed:", updatedAgent.totalTasksCompleted.toString());
  console.log("  Total revenue:", ethers.formatEther(updatedAgent.totalRevenue), "MON");
  console.log("  Reputation:", updatedAgent.reputation.toString());

  // ──────────────────────────────────────────────────
  // STEP 8: Buy Agent Tokens (Bonding Curve)
  // ──────────────────────────────────────────────────
  divider("STEP 8: Buy Agent Tokens (Bonding Curve)");

  const agentToken1 = await ethers.getContractAt("AgentToken", agent1Token);

  const tokensToBuy = ethers.parseEther("10"); // Buy 10 tokens
  const purchaseCost = await agentToken1.calculatePurchaseCost(tokensToBuy);
  const currentPrice = await agentToken1.getCurrentPrice();
  const totalSupply = await agentToken1.totalSupply();

  console.log("Agent 1 Token:", agent1Token);
  console.log("Current price:", ethers.formatEther(currentPrice), "MON per token");
  console.log("Total supply:", ethers.formatEther(totalSupply), "tokens");
  console.log(`\nBuying 10 tokens for ${ethers.formatEther(purchaseCost)} MON...`);

  const buyTx = await agentToken1.buyExact(tokensToBuy, { value: purchaseCost, ...GAS });
  const buyReceipt = await buyTx.wait();
  console.log("TX:", buyReceipt?.hash);

  const newPrice = await agentToken1.getCurrentPrice();
  const newSupply = await agentToken1.totalSupply();
  const deployerBalance = await agentToken1.balanceOf(deployer.address);
  console.log("\nAfter purchase:");
  console.log("  New price:", ethers.formatEther(newPrice), "MON per token");
  console.log("  Total supply:", ethers.formatEther(newSupply), "tokens");
  console.log("  Deployer token balance:", ethers.formatEther(deployerBalance));

  // ──────────────────────────────────────────────────
  // STEP 9: Partnership Proposal & Acceptance
  // ──────────────────────────────────────────────────
  divider("STEP 9: Partnership (Agent 1 proposes to Agent 2)");

  // Agent 1 proposes partnership (60/40 split)
  const partnershipAgent1 = partnership.connect(agentWallet1);
  console.log("Agent 1 proposing partnership with Agent 2 (60/40 split)...");
  const proposeTx = await partnershipAgent1.proposePartnership(
    agent1Id,
    agent2Id,
    60, // Agent 1 gets 60%
    40, // Agent 2 gets 40%
    GAS
  );
  const proposeReceipt = await proposeTx.wait();
  console.log("TX:", proposeReceipt?.hash);

  // Parse ProposalCreated event
  const proposalEvent = proposeReceipt?.logs.find((log) => {
    try {
      return partnership.interface.parseLog({ topics: [...log.topics], data: log.data })?.name === "ProposalCreated";
    } catch { return false; }
  });
  const parsedProposal = partnership.interface.parseLog({
    topics: [...proposalEvent!.topics],
    data: proposalEvent!.data,
  });
  const proposalId = parsedProposal!.args[0];
  console.log("Proposal ID:", proposalId.toString());

  // Agent 2 accepts
  const partnershipAgent2 = partnership.connect(agentWallet2);
  console.log("\nAgent 2 accepting partnership...");
  const acceptTx = await partnershipAgent2.acceptProposal(proposalId, GAS);
  const acceptReceipt = await acceptTx.wait();
  console.log("TX:", acceptReceipt?.hash);

  // Parse PartnershipCreated event
  const partnershipEvent = acceptReceipt?.logs.find((log) => {
    try {
      return partnership.interface.parseLog({ topics: [...log.topics], data: log.data })?.name === "PartnershipCreated";
    } catch { return false; }
  });
  const parsedPartnership = partnership.interface.parseLog({
    topics: [...partnershipEvent!.topics],
    data: partnershipEvent!.data,
  });
  const partnershipId = parsedPartnership!.args[0];
  console.log("Partnership ID:", partnershipId.toString());

  // ──────────────────────────────────────────────────
  // SUMMARY
  // ──────────────────────────────────────────────────
  divider("TEST COMPLETE - Summary");

  console.log("Events emitted (chain sync should pick these up):");
  console.log("");
  console.log("  AgentRegistry:");
  console.log("    - AgentRegistered (x2)");
  console.log("    - AgentStatusChanged (x2: UNFUNDED -> ACTIVE)");
  console.log("    - TaskCompleted (reputation + revenue update)");
  console.log("    - ReputationUpdated");
  console.log("");
  console.log("  TaskAuction:");
  console.log("    - TaskCreated");
  console.log("    - BidSubmitted (x2)");
  console.log("    - WinnerSelected");
  console.log("    - TaskCompleted");
  console.log("    - TaskValidated");
  console.log("    - PaymentReleased");
  console.log("");
  console.log("  AgentToken:");
  console.log("    - TokensPurchased");
  console.log("");
  console.log("  Partnership:");
  console.log("    - ProposalCreated");
  console.log("    - PartnershipCreated");
  console.log("");
  console.log("  Total: ~15 events across 4 contracts");
  console.log("");
  console.log("IDs created:");
  console.log(`  Agent 1: ${agent1Id} (Token: ${agent1Token})`);
  console.log(`  Agent 2: ${agent2Id} (Token: ${agent2Token})`);
  console.log(`  Task:    ${taskId}`);
  console.log(`  Partnership: ${partnershipId}`);
  console.log("");
  console.log("If chain sync is running (cd app/ && npm run chain-sync),");
  console.log("all of this data should now appear in your Supabase database");
  console.log("and be visible in the app at http://localhost:4000");
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nERROR:", error);
    process.exit(1);
  });
