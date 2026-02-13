import { ethers } from "hardhat";

/**
 * Local deployment script for testing
 * Use this to deploy to local Hardhat network for testing
 */
async function main() {
  console.log("Testing local deployment...\n");

  const [deployer, user1, user2] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Test User 1:", user1.address);
  console.log("Test User 2:", user2.address, "\n");

  // Deploy contracts
  const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
  const agentRegistry = await AgentRegistry.deploy();
  await agentRegistry.waitForDeployment();
  console.log("✓ AgentRegistry deployed");

  const Treasury = await ethers.getContractFactory("Treasury");
  const treasury = await Treasury.deploy();
  await treasury.waitForDeployment();
  console.log("✓ Treasury deployed");

  const TaskAuction = await ethers.getContractFactory("TaskAuction");
  const taskAuction = await TaskAuction.deploy();
  await taskAuction.waitForDeployment();
  console.log("✓ TaskAuction deployed");

  const IntentAuction = await ethers.getContractFactory("IntentAuction");
  const intentAuction = await IntentAuction.deploy();
  await intentAuction.waitForDeployment();
  console.log("✓ IntentAuction deployed");

  const Partnership = await ethers.getContractFactory("Partnership");
  const partnership = await Partnership.deploy();
  await partnership.waitForDeployment();
  console.log("✓ Partnership deployed");

  console.log("\n✓ All contracts deployed successfully!");
  console.log("\nYou can now run tests against these contracts.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
