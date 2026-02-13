import { expect } from "chai";
import { ethers } from "hardhat";
import { AgentRegistry, AgentToken } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("AgentRegistry", function () {
  let registry: AgentRegistry;
  let owner: HardhatEthersSigner;
  let protocolTreasury: HardhatEthersSigner;
  let agentOwner: HardhatEthersSigner;
  let agentWallet: HardhatEthersSigner;
  let investor: HardhatEthersSigner;
  let operator: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, protocolTreasury, agentOwner, agentWallet, investor, operator] = await ethers.getSigners();

    const AgentRegistryFactory = await ethers.getContractFactory("AgentRegistry");
    registry = await AgentRegistryFactory.deploy(protocolTreasury.address);
  });

  describe("Deployment", function () {
    it("Should set the deployer as admin", async function () {
      const DEFAULT_ADMIN_ROLE = await registry.DEFAULT_ADMIN_ROLE();
      expect(await registry.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("Should set the deployer as operator", async function () {
      const OPERATOR_ROLE = await registry.OPERATOR_ROLE();
      expect(await registry.hasRole(OPERATOR_ROLE, owner.address)).to.be.true;
    });

    it("Should start with zero agents", async function () {
      expect(await registry.getTotalAgents()).to.equal(0);
    });

    it("Should start with zero registration fee", async function () {
      expect(await registry.registrationFee()).to.equal(0);
    });
  });

  describe("Agent Registration", function () {
    it("Should register a new agent and create token", async function () {
      const tx = await registry.connect(agentOwner).registerAgent(
        "CatalogBot Alpha",
        "CATALOG1",
        0, // CATALOG type
        agentWallet.address,
        "ipfs://metadata",
        7500, // 75% investor share
        ethers.parseEther("100") // 100 tokens creator allocation
      );

      const receipt = await tx.wait();

      // Check agent was created
      expect(await registry.getTotalAgents()).to.equal(1);

      // Get agent details
      const agent = await registry.getAgent(1);
      expect(agent.name).to.equal("CatalogBot Alpha");
      expect(agent.creator).to.equal(agentOwner.address);
      expect(agent.walletAddress).to.equal(agentWallet.address);
      expect(agent.agentType).to.equal(0); // CATALOG
      expect(agent.status).to.equal(0); // UNFUNDED
      expect(agent.reputation).to.equal(300); // INITIAL_REPUTATION (PRD-001: 3.0 = 300)
    });

    it("Should create a valid AgentToken contract", async function () {
      await registry.connect(agentOwner).registerAgent(
        "CatalogBot Alpha",
        "CATALOG1",
        0,
        agentWallet.address,
        "ipfs://metadata",
        7500, // 75% investor share
        ethers.parseEther("100") // 100 tokens creator allocation
      );

      const agent = await registry.getAgent(1);
      const tokenAddress = agent.tokenAddress;

      // Verify token contract
      const token = await ethers.getContractAt("AgentToken", tokenAddress) as AgentToken;
      expect(await token.name()).to.equal("CatalogBot Alpha Token");
      expect(await token.symbol()).to.equal("CATALOG1");
      expect(await token.agentId()).to.equal(1);
      expect(await token.agentWallet()).to.equal(agentWallet.address);
    });

    it("Should update mappings correctly", async function () {
      await registry.connect(agentOwner).registerAgent(
        "CatalogBot Alpha",
        "CATALOG1",
        0,
        agentWallet.address,
        "ipfs://metadata",
        7500, // 75% investor share
        ethers.parseEther("100") // 100 tokens creator allocation
      );

      // Check creator mapping
      const agentIds = await registry.getAgentsByCreator(agentOwner.address);
      expect(agentIds.length).to.equal(1);
      expect(agentIds[0]).to.equal(1);

      // Check wallet mapping
      expect(await registry.getAgentByWallet(agentWallet.address)).to.equal(1);

      // Check token mapping
      const agent = await registry.getAgent(1);
      expect(await registry.getAgentByToken(agent.tokenAddress)).to.equal(1);
    });

    it("Should revert if wallet already registered", async function () {
      await registry.connect(agentOwner).registerAgent(
        "Agent 1",
        "AG1",
        0,
        agentWallet.address,
        "ipfs://1",
        7500,
        ethers.parseEther("100") // 100 tokens creator allocation
      );

      await expect(
        registry.connect(agentOwner).registerAgent(
          "Agent 2",
          "AG2",
          0,
          agentWallet.address, // Same wallet
          "ipfs://2",
          7500,
          ethers.parseEther("100")
        )
      ).to.be.revertedWithCustomError(registry, "WalletAlreadyRegistered");
    });

    it("Should revert with empty name", async function () {
      await expect(
        registry.connect(agentOwner).registerAgent(
          "",
          "EMPTY",
          0,
          agentWallet.address,
          "ipfs://metadata",
          7500,
          ethers.parseEther("100")
        )
      ).to.be.revertedWithCustomError(registry, "EmptyName");
    });

    it("Should revert with zero wallet address", async function () {
      await expect(
        registry.connect(agentOwner).registerAgent(
          "Test Agent",
          "TEST",
          0,
          ethers.ZeroAddress,
          "ipfs://metadata",
          7500,
          ethers.parseEther("100")
        )
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    });

    it("Should collect registration fee when set", async function () {
      const fee = ethers.parseEther("0.1");
      await registry.connect(owner).setRegistrationFee(fee);

      await registry.connect(agentOwner).registerAgent(
        "Agent",
        "AG",
        0,
        agentWallet.address,
        "ipfs://metadata",
        7500,
        ethers.parseEther("100"), // 100 tokens creator allocation
        { value: fee }
      );

      expect(await registry.collectedFees()).to.equal(fee);
    });

    it("Should revert if fee is insufficient", async function () {
      const fee = ethers.parseEther("0.1");
      await registry.connect(owner).setRegistrationFee(fee);

      await expect(
        registry.connect(agentOwner).registerAgent(
          "Agent",
          "AG",
          0,
          agentWallet.address,
          "ipfs://metadata",
          7500,
          ethers.parseEther("100"), // 100 tokens creator allocation
          { value: ethers.parseEther("0.05") }
        )
      ).to.be.revertedWithCustomError(registry, "InsufficientFee");
    });
  });

  describe("Agent Self-Governance", function () {
    beforeEach(async function () {
      await registry.connect(agentOwner).registerAgent(
        "CatalogBot Alpha",
        "CATALOG1",
        0,
        agentWallet.address,
        "ipfs://metadata",
        7500, // 75% investor share
        ethers.parseEther("100") // 100 tokens creator allocation
      );
    });

    it("Should allow agent wallet to update metadata", async function () {
      await registry.connect(agentWallet).updateMetadata(1, "ipfs://new-metadata");
      const agent = await registry.getAgent(1);
      expect(agent.metadataURI).to.equal("ipfs://new-metadata");
    });

    it("Should NOT allow creator to update metadata", async function () {
      await expect(
        registry.connect(agentOwner).updateMetadata(1, "ipfs://creator-attempt")
      ).to.be.revertedWithCustomError(registry, "NotAgentWallet");
    });

    it("Should NOT allow random address to update metadata", async function () {
      await expect(
        registry.connect(investor).updateMetadata(1, "ipfs://hacked")
      ).to.be.revertedWithCustomError(registry, "NotAgentWallet");
    });

    it("Should allow agent wallet to pause itself", async function () {
      await registry.connect(agentWallet).pauseAgent(1);
      const agent = await registry.getAgent(1);
      expect(agent.status).to.equal(3); // PAUSED
    });

    it("Should NOT allow creator to pause agent", async function () {
      await expect(
        registry.connect(agentOwner).pauseAgent(1)
      ).to.be.revertedWithCustomError(registry, "NotAgentWallet");
    });

    it("Should allow agent wallet to unpause itself", async function () {
      await registry.connect(agentWallet).pauseAgent(1);
      await registry.connect(agentWallet).unpauseAgent(1);
      const agent = await registry.getAgent(1);
      expect(agent.status).to.equal(1); // ACTIVE
    });

    it("Should allow agent wallet to update status", async function () {
      await registry.connect(agentWallet).updateStatus(1, 1); // ACTIVE
      const agent = await registry.getAgent(1);
      expect(agent.status).to.equal(1); // ACTIVE
    });

    it("Should NOT allow creator to update status", async function () {
      await expect(
        registry.connect(agentOwner).updateStatus(1, 1)
      ).to.be.revertedWithCustomError(registry, "NotAgentWallet");
    });

    it("Should allow agent wallet to migrate to a new wallet", async function () {
      const [, , , , , , , newWallet] = await ethers.getSigners();
      await registry.connect(agentWallet).updateAgentWallet(1, newWallet.address);

      const agent = await registry.getAgent(1);
      expect(agent.walletAddress).to.equal(newWallet.address);

      // Old wallet should no longer have governance
      await expect(
        registry.connect(agentWallet).updateMetadata(1, "ipfs://should-fail")
      ).to.be.revertedWithCustomError(registry, "NotAgentWallet");

      // New wallet should have governance
      await registry.connect(newWallet).updateMetadata(1, "ipfs://new-wallet-works");
      const updatedAgent = await registry.getAgent(1);
      expect(updatedAgent.metadataURI).to.equal("ipfs://new-wallet-works");
    });

    it("Should NOT allow creator to migrate agent wallet", async function () {
      const [, , , , , , , newWallet] = await ethers.getSigners();
      await expect(
        registry.connect(agentOwner).updateAgentWallet(1, newWallet.address)
      ).to.be.revertedWithCustomError(registry, "NotAgentWallet");
    });

    it("Creator field should be immutable historical record", async function () {
      const agent = await registry.getAgent(1);
      expect(agent.creator).to.equal(agentOwner.address);
      // Creator is just informational - no governance function to change it
    });
  });

  describe("Operator Functions", function () {
    beforeEach(async function () {
      await registry.connect(agentOwner).registerAgent(
        "CatalogBot Alpha",
        "CATALOG1",
        0,
        agentWallet.address,
        "ipfs://metadata",
        7500, // 75% investor share
        ethers.parseEther("100") // 100 tokens creator allocation
      );

      // Add operator
      await registry.connect(owner).addOperator(operator.address);
    });

    it("Should allow operator to update reputation", async function () {
      // PRD-001: Reputation must be within 100-500 range
      await registry.connect(operator).updateReputation(1, 400);
      const agent = await registry.getAgent(1);
      expect(agent.reputation).to.equal(400);
    });

    it("Should cap reputation at MAX_REPUTATION (500)", async function () {
      // PRD-001: MAX_REPUTATION is 500
      await expect(
        registry.connect(operator).updateReputation(1, 600)
      ).to.be.revertedWithCustomError(registry, "InvalidReputation");
    });

    it("Should reject reputation below MIN_REPUTATION (100)", async function () {
      // PRD-001: MIN_REPUTATION is 100
      await expect(
        registry.connect(operator).updateReputation(1, 50)
      ).to.be.revertedWithCustomError(registry, "InvalidReputation");
    });

    it("Should allow operator to adjust reputation positively", async function () {
      // PRD-001: Initial reputation is 300
      await registry.connect(operator).adjustReputation(1, 100);
      const agent = await registry.getAgent(1);
      expect(agent.reputation).to.equal(400); // 300 + 100
    });

    it("Should allow operator to adjust reputation negatively", async function () {
      // PRD-001: Initial reputation is 300, MIN is 100
      await registry.connect(operator).adjustReputation(1, -100);
      const agent = await registry.getAgent(1);
      expect(agent.reputation).to.equal(200); // 300 - 100
    });

    it("Should cap reputation at MIN_REPUTATION (100) when decreasing", async function () {
      // PRD-001: MIN_REPUTATION is 100
      await registry.connect(operator).adjustReputation(1, -1000);
      const agent = await registry.getAgent(1);
      expect(agent.reputation).to.equal(100); // Capped at MIN_REPUTATION
    });

    it("Should cap reputation at MAX_REPUTATION (500) when increasing", async function () {
      // PRD-001: MAX_REPUTATION is 500
      await registry.connect(operator).adjustReputation(1, 500);
      const agent = await registry.getAgent(1);
      expect(agent.reputation).to.equal(500); // 300 + 500 = 800 capped at 500
    });

    it("Should allow operator to record task completion", async function () {
      const revenue = ethers.parseEther("1");
      await registry.connect(operator).recordTaskCompletion(1, revenue);

      const agent = await registry.getAgent(1);
      expect(agent.totalTasksCompleted).to.equal(1);
      expect(agent.totalRevenue).to.equal(revenue);
      expect(agent.status).to.equal(1); // ACTIVE (auto-activated)
    });

    it("Should allow operator to record task failure", async function () {
      await registry.connect(operator).recordTaskFailure(1);

      const agent = await registry.getAgent(1);
      expect(agent.totalTasksFailed).to.equal(1);
    });

    it("Should not allow non-operator to update reputation", async function () {
      await expect(
        registry.connect(investor).updateReputation(1, 750)
      ).to.be.reverted; // AccessControl revert
    });
  });

  describe("Query Functions", function () {
    beforeEach(async function () {
      // Register multiple agents
      await registry.connect(agentOwner).registerAgent(
        "Agent 1", "AG1", 0, agentWallet.address, "ipfs://1",
        7500,
        ethers.parseEther("100") // 100 tokens creator allocation
      );

      const [, , , , , , wallet2] = await ethers.getSigners();
      await registry.connect(agentOwner).registerAgent(
        "Agent 2", "AG2", 1, wallet2.address, "ipfs://2",
        7500,
        ethers.parseEther("100") // 100 tokens creator allocation
      );
    });

    it("Should return correct agent count", async function () {
      expect(await registry.getTotalAgents()).to.equal(2);
    });

    it("Should return agents by creator", async function () {
      const agentIds = await registry.getAgentsByCreator(agentOwner.address);
      expect(agentIds.length).to.equal(2);
    });

    it("Should return agent count by creator", async function () {
      expect(await registry.getAgentCountByCreator(agentOwner.address)).to.equal(2);
    });

    it("Should check if agent is active", async function () {
      // Initially UNFUNDED
      expect(await registry.isAgentActive(1)).to.be.false;

      // Activate via task completion
      await registry.connect(owner).recordTaskCompletion(1, 100);
      expect(await registry.isAgentActive(1)).to.be.true;
    });

    it("Should revert when getting non-existent agent", async function () {
      await expect(
        registry.getAgent(999)
      ).to.be.revertedWithCustomError(registry, "AgentNotFound");
    });

    it("Should return agents by type (PRD-001 F1)", async function () {
      // Agent 1 is CATALOG (type 0), Agent 2 is REVIEW (type 1)
      const catalogAgents = await registry.getAgentsByType(0);
      const reviewAgents = await registry.getAgentsByType(1);

      expect(catalogAgents.length).to.equal(1);
      expect(catalogAgents[0]).to.equal(1);
      expect(reviewAgents.length).to.equal(1);
      expect(reviewAgents[0]).to.equal(2);
    });

    it("Should return empty array for type with no agents", async function () {
      const curationAgents = await registry.getAgentsByType(2); // CURATION
      expect(curationAgents.length).to.equal(0);
    });

    it("Should identify competitors (same type) (PRD-001 F1)", async function () {
      // Register another CATALOG agent
      const [, , , , , , , wallet3] = await ethers.getSigners();
      await registry.connect(agentOwner).registerAgent(
        "Agent 3", "AG3", 0, wallet3.address, "ipfs://3", // CATALOG type
        7500,
        ethers.parseEther("100") // 100 tokens creator allocation
      );

      // Agent 1 and Agent 3 are both CATALOG -> competitors
      expect(await registry.isCompetitor(1, 3)).to.be.true;

      // Agent 1 (CATALOG) and Agent 2 (REVIEW) -> not competitors
      expect(await registry.isCompetitor(1, 2)).to.be.false;
    });

    it("Should revert isCompetitor for non-existent agent", async function () {
      await expect(
        registry.isCompetitor(1, 999)
      ).to.be.revertedWithCustomError(registry, "AgentNotFound");

      await expect(
        registry.isCompetitor(999, 1)
      ).to.be.revertedWithCustomError(registry, "AgentNotFound");
    });
  });

  describe("Admin Functions", function () {
    it("Should allow admin to set registration fee", async function () {
      const newFee = ethers.parseEther("0.5");
      await registry.connect(owner).setRegistrationFee(newFee);
      expect(await registry.registrationFee()).to.equal(newFee);
    });

    it("Should allow admin to withdraw fees", async function () {
      const fee = ethers.parseEther("0.1");
      await registry.connect(owner).setRegistrationFee(fee);

      await registry.connect(agentOwner).registerAgent(
        "Agent", "AG", 0, agentWallet.address, "ipfs://1",
        7500,
        ethers.parseEther("100"), // 100 tokens creator allocation
        { value: fee }
      );

      const balanceBefore = await ethers.provider.getBalance(owner.address);
      const tx = await registry.connect(owner).withdrawFees(owner.address);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const balanceAfter = await ethers.provider.getBalance(owner.address);

      expect(balanceAfter - balanceBefore + gasUsed).to.equal(fee);
      expect(await registry.collectedFees()).to.equal(0);
    });

    it("Should allow admin to add/remove operators", async function () {
      const OPERATOR_ROLE = await registry.OPERATOR_ROLE();

      await registry.connect(owner).addOperator(operator.address);
      expect(await registry.hasRole(OPERATOR_ROLE, operator.address)).to.be.true;

      await registry.connect(owner).removeOperator(operator.address);
      expect(await registry.hasRole(OPERATOR_ROLE, operator.address)).to.be.false;
    });
  });

  describe("Token Integration", function () {
    it("Should allow buying tokens from created agent", async function () {
      await registry.connect(agentOwner).registerAgent(
        "CatalogBot", "CAT", 0, agentWallet.address, "ipfs://1",
        7500,
        ethers.parseEther("100") // 100 tokens creator allocation
      );

      const agent = await registry.getAgent(1);
      const token = await ethers.getContractAt("AgentToken", agent.tokenAddress) as AgentToken;

      // Buy tokens
      const amount = ethers.parseEther("10");
      const cost = await token.calculatePurchaseCost(amount);
      const fee = (cost * 250n) / 10000n;

      await token.connect(investor).buyExact(amount, {
        value: cost + fee
      });

      expect(await token.balanceOf(investor.address)).to.equal(amount);
    });

    it("Should send profits to agent wallet", async function () {
      await registry.connect(agentOwner).registerAgent(
        "CatalogBot", "CAT", 0, agentWallet.address, "ipfs://1",
        7500,
        ethers.parseEther("100") // 100 tokens creator allocation
      );

      const agent = await registry.getAgent(1);
      const token = await ethers.getContractAt("AgentToken", agent.tokenAddress) as AgentToken;

      // Buy tokens first
      const amount = ethers.parseEther("10");
      const cost = await token.calculatePurchaseCost(amount);
      const fee = (cost * 250n) / 10000n;
      await token.connect(investor).buyExact(amount, { value: cost + fee });

      // Deposit profits
      const profit = ethers.parseEther("1");
      const agentBalanceBefore = await ethers.provider.getBalance(agentWallet.address);

      await token.depositProfits({ value: profit });

      const agentBalanceAfter = await ethers.provider.getBalance(agentWallet.address);
      expect(agentBalanceAfter - agentBalanceBefore).to.equal(ethers.parseEther("0.25")); // 25%
    });
  });
});
