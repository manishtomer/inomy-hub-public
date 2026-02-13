import { run } from "hardhat";

/**
 * Verification script for deployed contracts
 * Run after deployment to verify contracts on Monad explorer
 */
async function main() {
  const contracts = [
    {
      name: "AgentRegistry",
      address: process.env.AGENT_REGISTRY_ADDRESS || "",
      constructorArgs: [],
    },
    {
      name: "Treasury",
      address: process.env.TREASURY_ADDRESS || "",
      constructorArgs: [],
    },
    {
      name: "TaskAuction",
      address: process.env.TASK_AUCTION_ADDRESS || "",
      constructorArgs: [],
    },
    {
      name: "IntentAuction",
      address: process.env.INTENT_AUCTION_ADDRESS || "",
      constructorArgs: [],
    },
    {
      name: "Partnership",
      address: process.env.PARTNERSHIP_ADDRESS || "",
      constructorArgs: [],
    },
  ];

  console.log("Starting contract verification...\n");

  for (const contract of contracts) {
    if (!contract.address) {
      console.log(`⚠ Skipping ${contract.name} - no address provided`);
      continue;
    }

    try {
      console.log(`Verifying ${contract.name} at ${contract.address}...`);
      await run("verify:verify", {
        address: contract.address,
        constructorArguments: contract.constructorArgs,
      });
      console.log(`✓ ${contract.name} verified\n`);
    } catch (error: any) {
      if (error.message.includes("Already Verified")) {
        console.log(`✓ ${contract.name} already verified\n`);
      } else {
        console.error(`✗ Error verifying ${contract.name}:`, error.message, "\n");
      }
    }
  }

  console.log("Verification complete!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
