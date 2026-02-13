import { ethers } from "hardhat";

/**
 * Deployment script for Agent-Owned Commerce Protocol
 *
 * Deployment order (based on constructor dependencies):
 * 1. Treasury (no dependencies)
 * 2. AgentRegistry (needs Treasury)
 * 3. TaskAuction (needs AgentRegistry, Treasury)
 * 4. IntentAuction (needs AgentRegistry, Treasury)
 * 5. Partnership (needs AgentRegistry, TaskAuction)
 *
 * Post-deployment configuration:
 * - Set TaskAuction as operator on AgentRegistry
 * - Set IntentAuction as operator on AgentRegistry
 * - Set TaskAuction address on Treasury
 * - Set IntentAuction address on Treasury
 */
async function main() {
  console.log("Starting deployment to Monad Testnet...\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "MON\n");

  if (balance === 0n) {
    console.error("ERROR: Deployer account has no balance. Please fund it first.");
    console.log("Get testnet MON from: https://faucet.monad.xyz");
    process.exit(1);
  }

  // ============ Deploy Treasury ============
  console.log("1/5 Deploying Treasury...");
  const Treasury = await ethers.getContractFactory("Treasury");
  const treasury = await Treasury.deploy();
  await treasury.waitForDeployment();
  const treasuryAddress = await treasury.getAddress();
  console.log("✓ Treasury deployed to:", treasuryAddress, "\n");

  // ============ Deploy AgentRegistry ============
  console.log("2/5 Deploying AgentRegistry...");
  const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
  const agentRegistry = await AgentRegistry.deploy(treasuryAddress);
  await agentRegistry.waitForDeployment();
  const agentRegistryAddress = await agentRegistry.getAddress();
  console.log("✓ AgentRegistry deployed to:", agentRegistryAddress, "\n");

  // ============ Deploy TaskAuction ============
  console.log("3/5 Deploying TaskAuction...");
  const TaskAuction = await ethers.getContractFactory("TaskAuction");
  const taskAuction = await TaskAuction.deploy(agentRegistryAddress, treasuryAddress);
  await taskAuction.waitForDeployment();
  const taskAuctionAddress = await taskAuction.getAddress();
  console.log("✓ TaskAuction deployed to:", taskAuctionAddress, "\n");

  // ============ Deploy IntentAuction ============
  console.log("4/5 Deploying IntentAuction...");
  const IntentAuction = await ethers.getContractFactory("IntentAuction");
  const intentAuction = await IntentAuction.deploy(agentRegistryAddress, treasuryAddress);
  await intentAuction.waitForDeployment();
  const intentAuctionAddress = await intentAuction.getAddress();
  console.log("✓ IntentAuction deployed to:", intentAuctionAddress, "\n");

  // ============ Deploy Partnership ============
  console.log("5/5 Deploying Partnership...");
  const Partnership = await ethers.getContractFactory("Partnership");
  const partnership = await Partnership.deploy(agentRegistryAddress, taskAuctionAddress);
  await partnership.waitForDeployment();
  const partnershipAddress = await partnership.getAddress();
  console.log("✓ Partnership deployed to:", partnershipAddress, "\n");

  // ============ Post-Deployment Configuration ============
  console.log("Configuring permissions...\n");

  // Grant TaskAuction operator role on AgentRegistry
  console.log("  Setting TaskAuction as operator on AgentRegistry...");
  await agentRegistry.addOperator(taskAuctionAddress);
  console.log("  ✓ TaskAuction granted OPERATOR_ROLE");

  // Grant IntentAuction operator role on AgentRegistry
  console.log("  Setting IntentAuction as operator on AgentRegistry...");
  await agentRegistry.addOperator(intentAuctionAddress);
  console.log("  ✓ IntentAuction granted OPERATOR_ROLE");

  // Set TaskAuction address on Treasury
  console.log("  Setting TaskAuction address on Treasury...");
  await treasury.setTaskAuction(taskAuctionAddress);
  console.log("  ✓ Treasury configured with TaskAuction");

  // Set IntentAuction address on Treasury
  console.log("  Setting IntentAuction address on Treasury...");
  await treasury.setIntentAuction(intentAuctionAddress);
  console.log("  ✓ Treasury configured with IntentAuction\n");

  // ============ Summary ============
  console.log("=".repeat(60));
  console.log("DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log("\nContract Addresses:");
  console.log("-------------------");
  console.log("Treasury:       ", treasuryAddress);
  console.log("AgentRegistry:  ", agentRegistryAddress);
  console.log("TaskAuction:    ", taskAuctionAddress);
  console.log("IntentAuction:  ", intentAuctionAddress);
  console.log("Partnership:    ", partnershipAddress);

  console.log("\n\nAdd to your .env file:");
  console.log("------------------------");
  console.log(`TREASURY_ADDRESS=${treasuryAddress}`);
  console.log(`AGENT_REGISTRY_ADDRESS=${agentRegistryAddress}`);
  console.log(`TASK_AUCTION_ADDRESS=${taskAuctionAddress}`);
  console.log(`INTENT_AUCTION_ADDRESS=${intentAuctionAddress}`);
  console.log(`PARTNERSHIP_ADDRESS=${partnershipAddress}`);

  console.log("\n\nVerification commands:");
  console.log("------------------------");
  console.log(`npx hardhat verify --network monadTestnet ${treasuryAddress}`);
  console.log(`npx hardhat verify --network monadTestnet ${agentRegistryAddress} "${treasuryAddress}"`);
  console.log(`npx hardhat verify --network monadTestnet ${taskAuctionAddress} "${agentRegistryAddress}" "${treasuryAddress}"`);
  console.log(`npx hardhat verify --network monadTestnet ${intentAuctionAddress} "${agentRegistryAddress}" "${treasuryAddress}"`);
  console.log(`npx hardhat verify --network monadTestnet ${partnershipAddress} "${agentRegistryAddress}" "${taskAuctionAddress}"`);

  console.log("\n" + "=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
