import { expect } from "chai";
import { ethers } from "hardhat";
import { Partnership, AgentRegistry, Treasury, TaskAuction } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("Partnership", function () {
  let partnership: Partnership;
  let agentRegistry: AgentRegistry;
  let treasury: Treasury;
  let taskAuction: TaskAuction;

  let owner: HardhatEthersSigner;
  let agent1Owner: HardhatEthersSigner;
  let agent2Owner: HardhatEthersSigner;
  let agent3Owner: HardhatEthersSigner;
  let unauthorized: HardhatEthersSigner;

  let agent1Id: bigint;
  let agent2Id: bigint;
  let agent3Id: bigint; // Same type as agent1

  // Agent types from PRD
  const CATALOG_TYPE = 0;
  const REVIEW_TYPE = 1;

  beforeEach(async function () {
    [owner, agent1Owner, agent2Owner, agent3Owner, unauthorized] = await ethers.getSigners();

    // Deploy Treasury
    const TreasuryFactory = await ethers.getContractFactory("Treasury");
    treasury = await TreasuryFactory.deploy();

    // Deploy AgentRegistry
    const AgentRegistryFactory = await ethers.getContractFactory("AgentRegistry");
    agentRegistry = await AgentRegistryFactory.deploy(await treasury.getAddress());

    // Deploy TaskAuction
    const TaskAuctionFactory = await ethers.getContractFactory("TaskAuction");
    taskAuction = await TaskAuctionFactory.deploy(
      await agentRegistry.getAddress(),
      await treasury.getAddress()
    );

    // Configure Treasury
    await treasury.setTaskAuction(await taskAuction.getAddress());

    // Deploy Partnership
    const PartnershipFactory = await ethers.getContractFactory("Partnership");
    partnership = await PartnershipFactory.deploy(
      await agentRegistry.getAddress(),
      await taskAuction.getAddress()
    );

    // Register test agents
    // Agent 1: CATALOG type
    const tx1 = await agentRegistry.connect(agent1Owner).registerAgent(
      "Agent 1",
      "AGT1",
      CATALOG_TYPE,
      agent1Owner.address,
      "ipfs://agent1",
      7500, // 75% investor share
      ethers.parseEther("100")
    );
    const receipt1 = await tx1.wait();
    const event1 = receipt1?.logs.find(
      (log: any) => log.fragment?.name === "AgentRegistered"
    );
    agent1Id = (event1 as any).args[0];

    // Agent 2: REVIEW type (different from agent1)
    const tx2 = await agentRegistry.connect(agent2Owner).registerAgent(
      "Agent 2",
      "AGT2",
      REVIEW_TYPE,
      agent2Owner.address,
      "ipfs://agent2",
      7500,
      ethers.parseEther("100")
    );
    const receipt2 = await tx2.wait();
    const event2 = receipt2?.logs.find(
      (log: any) => log.fragment?.name === "AgentRegistered"
    );
    agent2Id = (event2 as any).args[0];

    // Agent 3: CATALOG type (same as agent1)
    const tx3 = await agentRegistry.connect(agent3Owner).registerAgent(
      "Agent 3",
      "AGT3",
      CATALOG_TYPE,
      agent3Owner.address,
      "ipfs://agent3",
      7500,
      ethers.parseEther("100")
    );
    const receipt3 = await tx3.wait();
    const event3 = receipt3?.logs.find(
      (log: any) => log.fragment?.name === "AgentRegistered"
    );
    agent3Id = (event3 as any).args[0];
  });

  describe("Deployment", function () {
    it("Should set correct registry address", async function () {
      expect(await partnership.agentRegistry()).to.equal(await agentRegistry.getAddress());
    });

    it("Should set correct taskAuction address", async function () {
      expect(await partnership.taskAuction()).to.equal(await taskAuction.getAddress());
    });

    it("Should set default proposal duration to 1 day", async function () {
      expect(await partnership.defaultProposalDuration()).to.equal(86400);
    });

    it("Should start with zero proposals", async function () {
      expect(await partnership.proposalIdCounter()).to.equal(0);
    });

    it("Should start with zero partnerships", async function () {
      expect(await partnership.partnershipIdCounter()).to.equal(0);
    });
  });

  // PRD F4 Acceptance: Proposal rejected if both agents are same type
  describe("Proposal Creation", function () {
    it("Should create proposal between agents of different types", async function () {
      const tx = await partnership.connect(agent1Owner).proposePartnership(agent1Id, agent2Id, 60, 40);

      await expect(tx).to.emit(partnership, "ProposalCreated");

      const proposal = await partnership.getProposal(1);
      expect(proposal.initiatorAgentId).to.equal(agent1Id);
      expect(proposal.targetAgentId).to.equal(agent2Id);
      expect(proposal.initiatorSplit).to.equal(60);
      expect(proposal.targetSplit).to.equal(40);
      expect(proposal.status).to.equal(0); // Pending
    });

    it("Should reject proposal between agents of same type", async function () {
      await expect(
        partnership.connect(agent1Owner).proposePartnership(agent1Id, agent3Id, 50, 50)
      ).to.be.revertedWithCustomError(partnership, "SameAgentType");
    });

    // PRD F4 Acceptance: Proposal rejected if splits don't sum to 100
    it("Should reject proposal if splits don't sum to 100", async function () {
      await expect(
        partnership.connect(agent1Owner).proposePartnership(agent1Id, agent2Id, 60, 60)
      ).to.be.revertedWithCustomError(partnership, "SplitsMustSumTo100");
    });

    it("Should reject proposal if splits sum to less than 100", async function () {
      await expect(
        partnership.connect(agent1Owner).proposePartnership(agent1Id, agent2Id, 40, 40)
      ).to.be.revertedWithCustomError(partnership, "SplitsMustSumTo100");
    });

    it("Should reject proposal from non-agent owner", async function () {
      await expect(
        partnership.connect(unauthorized).proposePartnership(agent1Id, agent2Id, 50, 50)
      ).to.be.revertedWithCustomError(partnership, "NotAgentWallet");
    });

    it("Should allow 0/100 split", async function () {
      await expect(
        partnership.connect(agent1Owner).proposePartnership(agent1Id, agent2Id, 0, 100)
      ).to.not.be.reverted;
    });

    it("Should allow 100/0 split", async function () {
      await expect(
        partnership.connect(agent1Owner).proposePartnership(agent1Id, agent2Id, 100, 0)
      ).to.not.be.reverted;
    });
  });

  // PRD F4 Acceptance: Accept deploys partnership and returns its address
  describe("Proposal Acceptance", function () {
    let proposalId: bigint;

    beforeEach(async function () {
      const tx = await partnership.connect(agent1Owner).proposePartnership(agent1Id, agent2Id, 60, 40);
      const receipt = await tx.wait();
      proposalId = 1n;
    });

    it("Should accept proposal and create partnership", async function () {
      await expect(partnership.connect(agent2Owner).acceptProposal(proposalId))
        .to.emit(partnership, "ProposalAccepted")
        .withArgs(proposalId, 1)
        .to.emit(partnership, "PartnershipCreated")
        .withArgs(1, agent1Id, agent2Id, 60, 40);
    });

    it("Should update proposal status to Accepted", async function () {
      await partnership.connect(agent2Owner).acceptProposal(proposalId);
      const proposal = await partnership.getProposal(proposalId);
      expect(proposal.status).to.equal(1); // Accepted
    });

    it("Should create partnership with correct data", async function () {
      await partnership.connect(agent2Owner).acceptProposal(proposalId);
      const partnershipData = await partnership.getPartnership(1);

      expect(partnershipData.agent1Id).to.equal(agent1Id);
      expect(partnershipData.agent2Id).to.equal(agent2Id);
      expect(partnershipData.agent1Split).to.equal(60);
      expect(partnershipData.agent2Split).to.equal(40);
      expect(partnershipData.status).to.equal(0); // Active
    });

    it("Should reject acceptance from non-target agent", async function () {
      await expect(
        partnership.connect(agent1Owner).acceptProposal(proposalId)
      ).to.be.revertedWithCustomError(partnership, "NotProposalTarget");
    });

    it("Should reject acceptance of already accepted proposal", async function () {
      await partnership.connect(agent2Owner).acceptProposal(proposalId);
      await expect(
        partnership.connect(agent2Owner).acceptProposal(proposalId)
      ).to.be.revertedWithCustomError(partnership, "ProposalNotPending");
    });
  });

  describe("Proposal Rejection", function () {
    let proposalId: bigint;

    beforeEach(async function () {
      await partnership.connect(agent1Owner).proposePartnership(agent1Id, agent2Id, 60, 40);
      proposalId = 1n;
    });

    it("Should allow target to reject proposal", async function () {
      await expect(partnership.connect(agent2Owner).rejectProposal(proposalId))
        .to.emit(partnership, "ProposalRejected")
        .withArgs(proposalId);
    });

    it("Should update proposal status to Rejected", async function () {
      await partnership.connect(agent2Owner).rejectProposal(proposalId);
      const proposal = await partnership.getProposal(proposalId);
      expect(proposal.status).to.equal(2); // Rejected
    });

    it("Should reject rejection from non-target", async function () {
      await expect(
        partnership.connect(agent1Owner).rejectProposal(proposalId)
      ).to.be.revertedWithCustomError(partnership, "NotProposalTarget");
    });
  });

  // PRD F4 Acceptance: Counter-offer creates new proposal linked to original
  describe("Counter Offers", function () {
    let proposalId: bigint;

    beforeEach(async function () {
      await partnership.connect(agent1Owner).proposePartnership(agent1Id, agent2Id, 60, 40);
      proposalId = 1n;
    });

    it("Should allow target to counter-offer with different split", async function () {
      await expect(partnership.connect(agent2Owner).counterOffer(proposalId, 55))
        .to.emit(partnership, "CounterOfferCreated")
        .withArgs(proposalId, 2, 45, 55);
    });

    it("Should mark original proposal as CounterOffered", async function () {
      await partnership.connect(agent2Owner).counterOffer(proposalId, 55);
      const original = await partnership.getProposal(proposalId);
      expect(original.status).to.equal(3); // CounterOffered
    });

    it("Should link counter-proposal to original", async function () {
      await partnership.connect(agent2Owner).counterOffer(proposalId, 55);
      const counter = await partnership.getProposal(2);
      expect(counter.linkedProposalId).to.equal(proposalId);
    });

    it("Should reverse initiator and target in counter-proposal", async function () {
      await partnership.connect(agent2Owner).counterOffer(proposalId, 55);
      const counter = await partnership.getProposal(2);
      expect(counter.initiatorAgentId).to.equal(agent2Id);
      expect(counter.targetAgentId).to.equal(agent1Id);
    });

    it("Should allow original initiator to accept counter-offer", async function () {
      await partnership.connect(agent2Owner).counterOffer(proposalId, 55);
      await expect(partnership.connect(agent1Owner).acceptProposal(2))
        .to.emit(partnership, "PartnershipCreated");
    });
  });

  describe("Proposal Withdrawal", function () {
    let proposalId: bigint;

    beforeEach(async function () {
      await partnership.connect(agent1Owner).proposePartnership(agent1Id, agent2Id, 60, 40);
      proposalId = 1n;
    });

    it("Should allow initiator to withdraw proposal", async function () {
      await expect(partnership.connect(agent1Owner).withdrawProposal(proposalId))
        .to.emit(partnership, "ProposalWithdrawn")
        .withArgs(proposalId);
    });

    it("Should reject withdrawal from non-initiator", async function () {
      await expect(
        partnership.connect(agent2Owner).withdrawProposal(proposalId)
      ).to.be.revertedWithCustomError(partnership, "NotProposalInitiator");
    });
  });

  // PRD F4 Acceptance: submitWork() tracks which partners have submitted
  describe("Work Submission", function () {
    let partnershipId: bigint;
    const taskId = 1n;
    const outputHash1 = ethers.keccak256(ethers.toUtf8Bytes("agent1 output"));
    const outputHash2 = ethers.keccak256(ethers.toUtf8Bytes("agent2 output"));

    beforeEach(async function () {
      // Create and accept partnership
      await partnership.connect(agent1Owner).proposePartnership(agent1Id, agent2Id, 60, 40);
      await partnership.connect(agent2Owner).acceptProposal(1);
      partnershipId = 1n;
    });

    it("Should allow partner to submit work", async function () {
      await expect(
        partnership.connect(agent1Owner).submitWork(partnershipId, taskId, agent1Id, outputHash1)
      )
        .to.emit(partnership, "WorkSubmitted")
        .withArgs(partnershipId, taskId, agent1Id, outputHash1);
    });

    it("Should track agent1 submission", async function () {
      await partnership.connect(agent1Owner).submitWork(partnershipId, taskId, agent1Id, outputHash1);

      const [agent1Submitted, agent2Submitted, hash1, hash2] = await partnership.getTaskWorkStatus(
        partnershipId,
        taskId
      );

      expect(agent1Submitted).to.be.true;
      expect(agent2Submitted).to.be.false;
      expect(hash1).to.equal(outputHash1);
    });

    it("Should track agent2 submission", async function () {
      await partnership.connect(agent2Owner).submitWork(partnershipId, taskId, agent2Id, outputHash2);

      const [agent1Submitted, agent2Submitted, hash1, hash2] = await partnership.getTaskWorkStatus(
        partnershipId,
        taskId
      );

      expect(agent1Submitted).to.be.false;
      expect(agent2Submitted).to.be.true;
      expect(hash2).to.equal(outputHash2);
    });

    it("Should reject duplicate submission from same agent", async function () {
      await partnership.connect(agent1Owner).submitWork(partnershipId, taskId, agent1Id, outputHash1);

      await expect(
        partnership.connect(agent1Owner).submitWork(partnershipId, taskId, agent1Id, outputHash1)
      ).to.be.revertedWithCustomError(partnership, "WorkAlreadySubmitted");
    });

    it("Should reject submission from non-partner", async function () {
      await expect(
        partnership.connect(unauthorized).submitWork(partnershipId, taskId, agent1Id, outputHash1)
      ).to.be.revertedWithCustomError(partnership, "NotAgentWallet");
    });
  });

  // PRD F4 Acceptance: Task only completes when all partners submit
  describe("Task Completion", function () {
    let partnershipId: bigint;
    const taskId = 1n;
    const outputHash1 = ethers.keccak256(ethers.toUtf8Bytes("agent1 output"));
    const outputHash2 = ethers.keccak256(ethers.toUtf8Bytes("agent2 output"));

    beforeEach(async function () {
      await partnership.connect(agent1Owner).proposePartnership(agent1Id, agent2Id, 60, 40);
      await partnership.connect(agent2Owner).acceptProposal(1);
      partnershipId = 1n;
    });

    it("Should reject completion if only agent1 submitted", async function () {
      await partnership.connect(agent1Owner).submitWork(partnershipId, taskId, agent1Id, outputHash1);

      await expect(
        partnership.connect(agent1Owner).completePartnershipTask(partnershipId, taskId)
      ).to.be.revertedWithCustomError(partnership, "NotAllWorkSubmitted");
    });

    it("Should reject completion if only agent2 submitted", async function () {
      await partnership.connect(agent2Owner).submitWork(partnershipId, taskId, agent2Id, outputHash2);

      await expect(
        partnership.connect(agent1Owner).completePartnershipTask(partnershipId, taskId)
      ).to.be.revertedWithCustomError(partnership, "NotAllWorkSubmitted");
    });
  });

  // PRD F4 Acceptance: Payment received is split according to percentages
  // PRD F4 Acceptance: withdraw() sends correct amount to calling partner
  describe("Revenue and Withdrawal", function () {
    let partnershipId: bigint;

    beforeEach(async function () {
      await partnership.connect(agent1Owner).proposePartnership(agent1Id, agent2Id, 60, 40);
      await partnership.connect(agent2Owner).acceptProposal(1);
      partnershipId = 1n;
    });

    it("Should receive payment and track revenue", async function () {
      const amount = ethers.parseEther("10");

      await expect(
        partnership.receivePayment(partnershipId, { value: amount })
      )
        .to.emit(partnership, "RevenueReceived")
        .withArgs(partnershipId, amount, amount);

      const partnershipData = await partnership.getPartnership(partnershipId);
      expect(partnershipData.totalRevenue).to.equal(amount);
    });

    it("Should calculate correct withdrawable amounts (60/40 split)", async function () {
      const amount = ethers.parseEther("10");
      await partnership.receivePayment(partnershipId, { value: amount });

      const agent1Withdrawable = await partnership.getWithdrawableAmount(partnershipId, agent1Id);
      const agent2Withdrawable = await partnership.getWithdrawableAmount(partnershipId, agent2Id);

      expect(agent1Withdrawable).to.equal(ethers.parseEther("6")); // 60%
      expect(agent2Withdrawable).to.equal(ethers.parseEther("4")); // 40%
    });

    it("Should allow partner to withdraw their share", async function () {
      const amount = ethers.parseEther("10");
      await partnership.receivePayment(partnershipId, { value: amount });

      const balanceBefore = await ethers.provider.getBalance(agent1Owner.address);

      const tx = await partnership.connect(agent1Owner).withdraw(partnershipId, agent1Id);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const balanceAfter = await ethers.provider.getBalance(agent1Owner.address);
      const received = balanceAfter - balanceBefore + gasUsed;

      expect(received).to.equal(ethers.parseEther("6"));
    });

    it("Should emit FundsWithdrawn event", async function () {
      const amount = ethers.parseEther("10");
      await partnership.receivePayment(partnershipId, { value: amount });

      await expect(partnership.connect(agent1Owner).withdraw(partnershipId, agent1Id))
        .to.emit(partnership, "FundsWithdrawn")
        .withArgs(partnershipId, agent1Id, ethers.parseEther("6"));
    });

    it("Should reject withdrawal with no funds", async function () {
      await expect(
        partnership.connect(agent1Owner).withdraw(partnershipId, agent1Id)
      ).to.be.revertedWithCustomError(partnership, "NoFundsToWithdraw");
    });

    it("Should reject double withdrawal", async function () {
      const amount = ethers.parseEther("10");
      await partnership.receivePayment(partnershipId, { value: amount });

      await partnership.connect(agent1Owner).withdraw(partnershipId, agent1Id);

      await expect(
        partnership.connect(agent1Owner).withdraw(partnershipId, agent1Id)
      ).to.be.revertedWithCustomError(partnership, "NoFundsToWithdraw");
    });

    it("Should allow both partners to withdraw their shares", async function () {
      const amount = ethers.parseEther("10");
      await partnership.receivePayment(partnershipId, { value: amount });

      await partnership.connect(agent1Owner).withdraw(partnershipId, agent1Id);
      await partnership.connect(agent2Owner).withdraw(partnershipId, agent2Id);

      const partnershipData = await partnership.getPartnership(partnershipId);
      expect(partnershipData.agent1Withdrawn).to.equal(ethers.parseEther("6"));
      expect(partnershipData.agent2Withdrawn).to.equal(ethers.parseEther("4"));
    });

    it("Should handle incremental revenue correctly", async function () {
      // First payment
      await partnership.receivePayment(partnershipId, { value: ethers.parseEther("10") });
      await partnership.connect(agent1Owner).withdraw(partnershipId, agent1Id);

      // Second payment
      await partnership.receivePayment(partnershipId, { value: ethers.parseEther("5") });

      // Agent1 should have 60% of new 5 ETH = 3 ETH available
      const agent1Withdrawable = await partnership.getWithdrawableAmount(partnershipId, agent1Id);
      expect(agent1Withdrawable).to.equal(ethers.parseEther("3"));
    });
  });

  // PRD F4 Acceptance: dissolve() requires all partners to agree
  describe("Dissolution", function () {
    let partnershipId: bigint;

    beforeEach(async function () {
      await partnership.connect(agent1Owner).proposePartnership(agent1Id, agent2Id, 60, 40);
      await partnership.connect(agent2Owner).acceptProposal(1);
      partnershipId = 1n;
    });

    it("Should allow partner to initiate dissolution", async function () {
      await expect(partnership.connect(agent1Owner).initiateDissolution(partnershipId, agent1Id))
        .to.emit(partnership, "DissolutionInitiated")
        .withArgs(partnershipId, agent1Id);
    });

    it("Should set status to Dissolving", async function () {
      await partnership.connect(agent1Owner).initiateDissolution(partnershipId, agent1Id);
      const partnershipData = await partnership.getPartnership(partnershipId);
      expect(partnershipData.status).to.equal(1); // Dissolving
    });

    it("Should require other partner to agree", async function () {
      await partnership.connect(agent1Owner).initiateDissolution(partnershipId, agent1Id);

      // Partnership not yet dissolved
      const partnershipData = await partnership.getPartnership(partnershipId);
      expect(partnershipData.status).to.equal(1); // Still Dissolving
    });

    it("Should dissolve when both partners agree", async function () {
      await partnership.connect(agent1Owner).initiateDissolution(partnershipId, agent1Id);

      await expect(partnership.connect(agent2Owner).agreeToDissolution(partnershipId, agent2Id))
        .to.emit(partnership, "DissolutionAgreed")
        .to.emit(partnership, "PartnershipDissolved")
        .withArgs(partnershipId);

      const partnershipData = await partnership.getPartnership(partnershipId);
      expect(partnershipData.status).to.equal(2); // Dissolved
    });

    it("Should reject agreement if dissolution not initiated", async function () {
      await expect(
        partnership.connect(agent1Owner).agreeToDissolution(partnershipId, agent1Id)
      ).to.be.revertedWithCustomError(partnership, "DissolutionNotInitiated");
    });

    it("Should reject double agreement from same agent", async function () {
      await partnership.connect(agent1Owner).initiateDissolution(partnershipId, agent1Id);

      await expect(
        partnership.connect(agent1Owner).agreeToDissolution(partnershipId, agent1Id)
      ).to.be.revertedWithCustomError(partnership, "AlreadyAgreedToDissolution");
    });

    it("Should allow cancellation of dissolution", async function () {
      await partnership.connect(agent1Owner).initiateDissolution(partnershipId, agent1Id);
      await partnership.connect(agent2Owner).cancelDissolution(partnershipId, agent2Id);

      const partnershipData = await partnership.getPartnership(partnershipId);
      expect(partnershipData.status).to.equal(0); // Active
      expect(partnershipData.agent1DissolveAgreed).to.be.false;
      expect(partnershipData.agent2DissolveAgreed).to.be.false;
    });
  });

  describe("View Functions", function () {
    let partnershipId: bigint;

    beforeEach(async function () {
      await partnership.connect(agent1Owner).proposePartnership(agent1Id, agent2Id, 60, 40);
      await partnership.connect(agent2Owner).acceptProposal(1);
      partnershipId = 1n;
    });

    it("Should return agent proposals", async function () {
      const proposals = await partnership.getAgentProposals(agent1Id);
      expect(proposals.length).to.equal(1);
      expect(proposals[0]).to.equal(1);
    });

    it("Should return agent partnerships", async function () {
      const partnerships = await partnership.getAgentPartnerships(agent1Id);
      expect(partnerships.length).to.equal(1);
      expect(partnerships[0]).to.equal(partnershipId);
    });

    it("Should check if partnership is active", async function () {
      expect(await partnership.isPartnershipActive(partnershipId)).to.be.true;
    });

    it("Should return false for dissolved partnership", async function () {
      await partnership.connect(agent1Owner).initiateDissolution(partnershipId, agent1Id);
      await partnership.connect(agent2Owner).agreeToDissolution(partnershipId, agent2Id);

      expect(await partnership.isPartnershipActive(partnershipId)).to.be.false;
    });
  });

  describe("Admin Functions", function () {
    it("Should allow admin to update proposal duration", async function () {
      await partnership.setDefaultProposalDuration(7 * 24 * 60 * 60); // 7 days
      expect(await partnership.defaultProposalDuration()).to.equal(7 * 24 * 60 * 60);
    });

    it("Should allow admin to pause/unpause", async function () {
      await partnership.pause();

      await expect(
        partnership.connect(agent1Owner).proposePartnership(agent1Id, agent2Id, 50, 50)
      ).to.be.revertedWithCustomError(partnership, "EnforcedPause");

      await partnership.unpause();

      await expect(
        partnership.connect(agent1Owner).proposePartnership(agent1Id, agent2Id, 50, 50)
      ).to.not.be.reverted;
    });

    it("Should reject non-admin from admin functions", async function () {
      await expect(
        partnership.connect(unauthorized).setDefaultProposalDuration(100)
      ).to.be.reverted;

      await expect(
        partnership.connect(unauthorized).pause()
      ).to.be.reverted;
    });
  });

  describe("Edge Cases", function () {
    it("Should handle 50/50 split correctly", async function () {
      await partnership.connect(agent1Owner).proposePartnership(agent1Id, agent2Id, 50, 50);
      await partnership.connect(agent2Owner).acceptProposal(1);

      const amount = ethers.parseEther("10");
      await partnership.receivePayment(1, { value: amount });

      const agent1Withdrawable = await partnership.getWithdrawableAmount(1, agent1Id);
      const agent2Withdrawable = await partnership.getWithdrawableAmount(1, agent2Id);

      expect(agent1Withdrawable).to.equal(ethers.parseEther("5"));
      expect(agent2Withdrawable).to.equal(ethers.parseEther("5"));
    });

    it("Should handle 1/99 split correctly", async function () {
      await partnership.connect(agent1Owner).proposePartnership(agent1Id, agent2Id, 1, 99);
      await partnership.connect(agent2Owner).acceptProposal(1);

      const amount = ethers.parseEther("100");
      await partnership.receivePayment(1, { value: amount });

      const agent1Withdrawable = await partnership.getWithdrawableAmount(1, agent1Id);
      const agent2Withdrawable = await partnership.getWithdrawableAmount(1, agent2Id);

      expect(agent1Withdrawable).to.equal(ethers.parseEther("1"));
      expect(agent2Withdrawable).to.equal(ethers.parseEther("99"));
    });
  });

  // Helper function
  async function getExpectedExpiry(): Promise<bigint> {
    const block = await ethers.provider.getBlock("latest");
    return BigInt(block!.timestamp) + BigInt(86400) + 1n;
  }
});
