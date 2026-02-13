import { expect } from "chai";
import { ethers, network } from "hardhat";
import { TaskAuction, AgentRegistry, Treasury, AgentToken } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("TaskAuction", function () {
  let taskAuction: TaskAuction;
  let registry: AgentRegistry;
  let treasury: Treasury;
  let owner: HardhatEthersSigner;
  let protocolTreasury: HardhatEthersSigner;
  let agentOwner: HardhatEthersSigner;
  let agentWallet: HardhatEthersSigner;
  let agentWallet2: HardhatEthersSigner;
  let consumer: HardhatEthersSigner;

  const MAX_BID = ethers.parseEther("1");
  const INPUT_HASH = ethers.keccak256(ethers.toUtf8Bytes("test input"));
  const OUTPUT_HASH = ethers.keccak256(ethers.toUtf8Bytes("test output"));

  beforeEach(async function () {
    [owner, protocolTreasury, agentOwner, agentWallet, agentWallet2, consumer] = await ethers.getSigners();

    // Deploy AgentRegistry
    const AgentRegistryFactory = await ethers.getContractFactory("AgentRegistry");
    registry = await AgentRegistryFactory.deploy(protocolTreasury.address);

    // Deploy Treasury
    const TreasuryFactory = await ethers.getContractFactory("Treasury");
    treasury = await TreasuryFactory.deploy();

    // Deploy TaskAuction
    const TaskAuctionFactory = await ethers.getContractFactory("TaskAuction");
    taskAuction = await TaskAuctionFactory.deploy(
      await registry.getAddress(),
      await treasury.getAddress()
    );

    // Configure Treasury
    await treasury.setTaskAuction(await taskAuction.getAddress());

    // Grant operator role to TaskAuction for reputation updates
    await registry.addOperator(await taskAuction.getAddress());

    // Register an agent
    await registry.connect(agentOwner).registerAgent(
      "Test Agent",
      "TAG1",
      0, // CATALOG type
      agentWallet.address,
      "ipfs://test",
      7500, // 75% investor share
      ethers.parseEther("100")
    );

    // Activate agent by recording a task completion (sets status to ACTIVE)
    await registry.connect(owner).recordTaskCompletion(1, ethers.parseEther("0.1"));
  });

  describe("Deployment", function () {
    it("Should set correct registry address", async function () {
      expect(await taskAuction.agentRegistry()).to.equal(await registry.getAddress());
    });

    it("Should set correct treasury address", async function () {
      expect(await taskAuction.treasury()).to.equal(await treasury.getAddress());
    });

    it("Should set default bidding window to 5 seconds", async function () {
      expect(await taskAuction.defaultBiddingWindow()).to.equal(5);
    });

    it("Should set default completion window to 30 seconds", async function () {
      expect(await taskAuction.defaultCompletionWindow()).to.equal(30);
    });

    it("Should set MIN_REPUTATION_TO_BID to 300", async function () {
      expect(await taskAuction.MIN_REPUTATION_TO_BID()).to.equal(300);
    });

    it("Should start with zero tasks", async function () {
      expect(await taskAuction.getTotalTasks()).to.equal(0);
    });
  });

  // PRD F2: Task created with correct parameters and OPEN status
  describe("Task Creation", function () {
    it("Should create task with correct parameters and OPEN status", async function () {
      const tx = await taskAuction.createTask(
        0, // CATALOG type
        INPUT_HASH,
        "ipfs://task",
        MAX_BID,
        0, // Use default bidding window
        0, // Use default completion window
        { value: MAX_BID }
      );

      const task = await taskAuction.getTask(1);
      expect(task.id).to.equal(1);
      expect(task.taskType).to.equal(0);
      expect(task.inputHash).to.equal(INPUT_HASH);
      expect(task.metadataURI).to.equal("ipfs://task");
      expect(task.maxBid).to.equal(MAX_BID);
      expect(task.status).to.equal(0); // Open
    });

    it("Should emit TaskCreated event", async function () {
      await expect(
        taskAuction.createTask(0, INPUT_HASH, "ipfs://task", MAX_BID, 0, 0, { value: MAX_BID })
      ).to.emit(taskAuction, "TaskCreated");
    });

    it("Should require escrowing max bid amount", async function () {
      await expect(
        taskAuction.createTask(0, INPUT_HASH, "ipfs://task", MAX_BID, 0, 0, { value: MAX_BID / 2n })
      ).to.be.revertedWith("Must escrow max bid amount");
    });

    it("Should only allow operators to create tasks", async function () {
      await expect(
        taskAuction.connect(consumer).createTask(0, INPUT_HASH, "ipfs://task", MAX_BID, 0, 0, { value: MAX_BID })
      ).to.be.reverted;
    });

    it("Should allow custom bidding and completion windows", async function () {
      const customBidding = 10; // 10 seconds
      const customCompletion = 60; // 60 seconds

      await taskAuction.createTask(0, INPUT_HASH, "ipfs://task", MAX_BID, customBidding, customCompletion, { value: MAX_BID });

      const task = await taskAuction.getTask(1);
      const expectedCompletionDeadline = task.biddingDeadline + BigInt(customCompletion);
      expect(task.completionDeadline).to.equal(expectedCompletionDeadline);
    });
  });

  // PRD F2: Bid rejected if agent reputation < 300
  describe("Bid Submission", function () {
    beforeEach(async function () {
      // Create a task
      await taskAuction.createTask(0, INPUT_HASH, "ipfs://task", MAX_BID, 5, 30, { value: MAX_BID });
    });

    it("Should accept bid from agent with reputation >= 300", async function () {
      const bidAmount = ethers.parseEther("0.5");

      await expect(
        taskAuction.connect(agentWallet).submitBid(1, 1, bidAmount)
      ).to.emit(taskAuction, "BidSubmitted");

      const bid = await taskAuction.getBid(1);
      expect(bid.agentId).to.equal(1);
      expect(bid.amount).to.equal(bidAmount);
    });

    it("Should reject bid from agent with reputation < 300", async function () {
      // Reduce agent reputation below 300
      await registry.connect(owner).adjustReputation(1, -250); // 500 - 250 = 250

      const agent = await registry.getAgent(1);
      expect(agent.reputation).to.be.lt(300);

      await expect(
        taskAuction.connect(agentWallet).submitBid(1, 1, ethers.parseEther("0.5"))
      ).to.be.revertedWithCustomError(taskAuction, "InsufficientReputation");
    });

    // PRD F2: Bid rejected if amount > maxBid
    it("Should reject bid exceeding maxBid", async function () {
      await expect(
        taskAuction.connect(agentWallet).submitBid(1, 1, MAX_BID + 1n)
      ).to.be.revertedWithCustomError(taskAuction, "BidExceedsMaxBid");
    });

    // PRD F2: Bid rejected after bidding window closes
    it("Should reject bid after bidding window closes", async function () {
      // Fast forward past bidding deadline
      await network.provider.send("evm_increaseTime", [10]);
      await network.provider.send("evm_mine");

      await expect(
        taskAuction.connect(agentWallet).submitBid(1, 1, ethers.parseEther("0.5"))
      ).to.be.revertedWithCustomError(taskAuction, "BiddingWindowClosed");
    });

    it("Should reject bid from inactive agent", async function () {
      // Register another agent but don't activate it
      const [, , , , , , newWallet] = await ethers.getSigners();
      await registry.connect(agentOwner).registerAgent(
        "Inactive Agent",
        "INACTIVE",
        0,
        newWallet.address,
        "ipfs://inactive",
        7500,
        ethers.parseEther("100")
      );

      await expect(
        taskAuction.connect(newWallet).submitBid(1, 2, ethers.parseEther("0.5"))
      ).to.be.revertedWithCustomError(taskAuction, "AgentNotActive");
    });

    it("Should reject duplicate bid from same agent", async function () {
      await taskAuction.connect(agentWallet).submitBid(1, 1, ethers.parseEther("0.5"));

      await expect(
        taskAuction.connect(agentWallet).submitBid(1, 1, ethers.parseEther("0.4"))
      ).to.be.revertedWithCustomError(taskAuction, "AgentAlreadyBid");
    });

    it("Should reject bid with zero amount", async function () {
      await expect(
        taskAuction.connect(agentWallet).submitBid(1, 1, 0)
      ).to.be.revertedWithCustomError(taskAuction, "BidTooLow");
    });
  });

  // PRD F2: selectWinner() picks lowest eligible bid
  describe("Winner Selection", function () {
    beforeEach(async function () {
      // Create task with longer bidding window for testing
      await taskAuction.createTask(0, INPUT_HASH, "ipfs://task", MAX_BID, 5, 30, { value: MAX_BID });

      // Register second agent
      await registry.connect(agentOwner).registerAgent(
        "Agent 2",
        "AG2",
        0,
        agentWallet2.address,
        "ipfs://agent2",
        7500,
        ethers.parseEther("100")
      );
      await registry.connect(owner).recordTaskCompletion(2, ethers.parseEther("0.1"));
    });

    it("Should select lowest bid as winner", async function () {
      // Agent 1 bids 0.8 ETH
      await taskAuction.connect(agentWallet).submitBid(1, 1, ethers.parseEther("0.8"));
      // Agent 2 bids 0.5 ETH (lower)
      await taskAuction.connect(agentWallet2).submitBid(1, 2, ethers.parseEther("0.5"));

      // Fast forward past bidding deadline
      await network.provider.send("evm_increaseTime", [10]);
      await network.provider.send("evm_mine");

      await taskAuction.selectWinner(1);

      const task = await taskAuction.getTask(1);
      expect(task.status).to.equal(2); // Assigned

      // Agent 2 should win with lower bid
      const winningBid = await taskAuction.getBid(task.winningBidId);
      expect(winningBid.agentId).to.equal(2);
      expect(winningBid.amount).to.equal(ethers.parseEther("0.5"));
    });

    it("Should emit WinnerSelected event", async function () {
      await taskAuction.connect(agentWallet).submitBid(1, 1, ethers.parseEther("0.5"));

      await network.provider.send("evm_increaseTime", [10]);
      await network.provider.send("evm_mine");

      await expect(taskAuction.selectWinner(1))
        .to.emit(taskAuction, "WinnerSelected");
    });

    it("Should reject winner selection before bidding closes", async function () {
      await taskAuction.connect(agentWallet).submitBid(1, 1, ethers.parseEther("0.5"));

      await expect(
        taskAuction.selectWinner(1)
      ).to.be.revertedWithCustomError(taskAuction, "BiddingWindowNotClosed");
    });

    it("Should revert if no bids submitted", async function () {
      await network.provider.send("evm_increaseTime", [10]);
      await network.provider.send("evm_mine");

      await expect(
        taskAuction.selectWinner(1)
      ).to.be.revertedWithCustomError(taskAuction, "NoBidsSubmitted");
    });

    it("Should mark other bids as lost", async function () {
      await taskAuction.connect(agentWallet).submitBid(1, 1, ethers.parseEther("0.8"));
      await taskAuction.connect(agentWallet2).submitBid(1, 2, ethers.parseEther("0.5"));

      await network.provider.send("evm_increaseTime", [10]);
      await network.provider.send("evm_mine");

      await taskAuction.selectWinner(1);

      // Bid 1 (0.8 ETH) should be Lost
      const bid1 = await taskAuction.getBid(1);
      expect(bid1.status).to.equal(2); // Lost

      // Bid 2 (0.5 ETH) should be Won
      const bid2 = await taskAuction.getBid(2);
      expect(bid2.status).to.equal(1); // Won
    });
  });

  // PRD F2: Only winner can call completeTask()
  // PRD F2: completeTask() rejected after deadline
  describe("Task Completion", function () {
    beforeEach(async function () {
      await taskAuction.createTask(0, INPUT_HASH, "ipfs://task", MAX_BID, 5, 30, { value: MAX_BID });
      await taskAuction.connect(agentWallet).submitBid(1, 1, ethers.parseEther("0.5"));

      await network.provider.send("evm_increaseTime", [10]);
      await network.provider.send("evm_mine");

      await taskAuction.selectWinner(1);
    });

    it("Should allow winner to submit completed work", async function () {
      await expect(
        taskAuction.connect(agentWallet).completeTask(1, OUTPUT_HASH)
      ).to.emit(taskAuction, "TaskCompleted");

      const task = await taskAuction.getTask(1);
      expect(task.status).to.equal(3); // Completed
      expect(task.outputHash).to.equal(OUTPUT_HASH);
    });

    it("Should reject completion from non-winner", async function () {
      await expect(
        taskAuction.connect(agentWallet2).completeTask(1, OUTPUT_HASH)
      ).to.be.revertedWithCustomError(taskAuction, "NotWinningAgent");
    });

    it("Should reject completion after deadline", async function () {
      // Fast forward past completion deadline
      await network.provider.send("evm_increaseTime", [60]);
      await network.provider.send("evm_mine");

      await expect(
        taskAuction.connect(agentWallet).completeTask(1, OUTPUT_HASH)
      ).to.be.revertedWithCustomError(taskAuction, "CompletionDeadlinePassed");
    });
  });

  // PRD F2: validateAndPay(true) transfers funds and increases reputation
  // PRD F2: validateAndPay(false) decreases reputation, no payment
  describe("Validation and Payment", function () {
    beforeEach(async function () {
      await taskAuction.createTask(0, INPUT_HASH, "ipfs://task", MAX_BID, 5, 30, { value: MAX_BID });
      await taskAuction.connect(agentWallet).submitBid(1, 1, ethers.parseEther("0.5"));

      await network.provider.send("evm_increaseTime", [10]);
      await network.provider.send("evm_mine");

      await taskAuction.selectWinner(1);
      await taskAuction.connect(agentWallet).completeTask(1, OUTPUT_HASH);
    });

    it("Should pay worker and increase reputation on approval", async function () {
      const agentBefore = await registry.getAgent(1);
      const agentBalanceBefore = await ethers.provider.getBalance(agentWallet.address);

      await taskAuction.validateAndPay(1, true);

      const agentAfter = await registry.getAgent(1);
      const agentBalanceAfter = await ethers.provider.getBalance(agentWallet.address);

      // Check payment (0.5 ETH)
      expect(agentBalanceAfter - agentBalanceBefore).to.equal(ethers.parseEther("0.5"));

      // Check reputation increased by 10
      expect(agentAfter.reputation - agentBefore.reputation).to.equal(10);

      // Check task status
      const task = await taskAuction.getTask(1);
      expect(task.status).to.equal(4); // Verified
    });

    it("Should emit TaskValidated and PaymentReleased events on approval", async function () {
      await expect(taskAuction.validateAndPay(1, true))
        .to.emit(taskAuction, "TaskValidated")
        .and.to.emit(taskAuction, "PaymentReleased");
    });

    it("Should send leftover to treasury on approval", async function () {
      const treasuryBalanceBefore = await treasury.getBalance();

      await taskAuction.validateAndPay(1, true);

      const treasuryBalanceAfter = await treasury.getBalance();

      // Leftover = maxBid - winningAmount = 1 - 0.5 = 0.5 ETH
      expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(ethers.parseEther("0.5"));
    });

    it("Should not pay worker and decrease reputation on rejection", async function () {
      const agentBefore = await registry.getAgent(1);
      const agentBalanceBefore = await ethers.provider.getBalance(agentWallet.address);

      await taskAuction.validateAndPay(1, false);

      const agentAfter = await registry.getAgent(1);
      const agentBalanceAfter = await ethers.provider.getBalance(agentWallet.address);

      // No payment
      expect(agentBalanceAfter).to.equal(agentBalanceBefore);

      // Reputation decreased by 30
      expect(agentBefore.reputation - agentAfter.reputation).to.equal(30);

      // Check task status
      const task = await taskAuction.getTask(1);
      expect(task.status).to.equal(5); // Failed
    });

    it("Should send all escrowed funds to treasury on rejection", async function () {
      const treasuryBalanceBefore = await treasury.getBalance();

      await taskAuction.validateAndPay(1, false);

      const treasuryBalanceAfter = await treasury.getBalance();

      // Full maxBid goes to treasury
      expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(MAX_BID);
    });

    it("Should only allow operators to validate", async function () {
      await expect(
        taskAuction.connect(consumer).validateAndPay(1, true)
      ).to.be.reverted;
    });
  });

  describe("Expired Task Handling", function () {
    beforeEach(async function () {
      await taskAuction.createTask(0, INPUT_HASH, "ipfs://task", MAX_BID, 5, 30, { value: MAX_BID });
      await taskAuction.connect(agentWallet).submitBid(1, 1, ethers.parseEther("0.5"));

      await network.provider.send("evm_increaseTime", [10]);
      await network.provider.send("evm_mine");

      await taskAuction.selectWinner(1);
      // Don't complete task - let it expire
    });

    it("Should allow failing expired tasks", async function () {
      // Fast forward past completion deadline
      await network.provider.send("evm_increaseTime", [60]);
      await network.provider.send("evm_mine");

      const agentBefore = await registry.getAgent(1);

      await taskAuction.failExpiredTask(1);

      const agentAfter = await registry.getAgent(1);
      const task = await taskAuction.getTask(1);

      // Task failed
      expect(task.status).to.equal(5); // Failed

      // Reputation decreased
      expect(agentBefore.reputation - agentAfter.reputation).to.equal(30);
    });

    it("Should not fail task before deadline", async function () {
      await expect(
        taskAuction.failExpiredTask(1)
      ).to.be.revertedWith("Deadline not passed");
    });
  });

  describe("Bid Withdrawal", function () {
    beforeEach(async function () {
      await taskAuction.createTask(0, INPUT_HASH, "ipfs://task", MAX_BID, 10, 30, { value: MAX_BID });
      await taskAuction.connect(agentWallet).submitBid(1, 1, ethers.parseEther("0.5"));
    });

    it("Should allow agent to withdraw bid before deadline", async function () {
      await expect(
        taskAuction.connect(agentWallet).withdrawBid(1)
      ).to.emit(taskAuction, "BidWithdrawn");

      const bid = await taskAuction.getBid(1);
      expect(bid.status).to.equal(3); // Withdrawn
    });

    it("Should reject withdrawal after deadline", async function () {
      await network.provider.send("evm_increaseTime", [15]);
      await network.provider.send("evm_mine");

      await expect(
        taskAuction.connect(agentWallet).withdrawBid(1)
      ).to.be.revertedWithCustomError(taskAuction, "BiddingWindowClosed");
    });

    it("Should reject withdrawal from non-owner", async function () {
      await expect(
        taskAuction.connect(agentWallet2).withdrawBid(1)
      ).to.be.revertedWithCustomError(taskAuction, "NotBidOwner");
    });
  });

  describe("Task Cancellation", function () {
    it("Should allow operator to cancel open task", async function () {
      await taskAuction.createTask(0, INPUT_HASH, "ipfs://task", MAX_BID, 5, 30, { value: MAX_BID });

      const balanceBefore = await ethers.provider.getBalance(owner.address);

      const tx = await taskAuction.cancelTask(1);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const balanceAfter = await ethers.provider.getBalance(owner.address);

      // Should return escrowed funds
      expect(balanceAfter - balanceBefore + gasUsed).to.equal(MAX_BID);

      const task = await taskAuction.getTask(1);
      expect(task.status).to.equal(6); // Cancelled
    });

    it("Should reject cancellation of assigned task", async function () {
      await taskAuction.createTask(0, INPUT_HASH, "ipfs://task", MAX_BID, 5, 30, { value: MAX_BID });
      await taskAuction.connect(agentWallet).submitBid(1, 1, ethers.parseEther("0.5"));

      await network.provider.send("evm_increaseTime", [10]);
      await network.provider.send("evm_mine");

      await taskAuction.selectWinner(1);

      await expect(
        taskAuction.cancelTask(1)
      ).to.be.revertedWithCustomError(taskAuction, "InvalidTaskStatus");
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await taskAuction.createTask(0, INPUT_HASH, "ipfs://task", MAX_BID, 10, 30, { value: MAX_BID });
      await taskAuction.connect(agentWallet).submitBid(1, 1, ethers.parseEther("0.5"));
    });

    it("Should return task bids", async function () {
      const bidIds = await taskAuction.getTaskBids(1);
      expect(bidIds.length).to.equal(1);
      expect(bidIds[0]).to.equal(1);
    });

    it("Should return agent bids", async function () {
      const bidIds = await taskAuction.getAgentBids(1);
      expect(bidIds.length).to.equal(1);
    });

    it("Should check if bidding is open", async function () {
      expect(await taskAuction.isBiddingOpen(1)).to.be.true;

      await network.provider.send("evm_increaseTime", [15]);
      await network.provider.send("evm_mine");

      expect(await taskAuction.isBiddingOpen(1)).to.be.false;
    });

    it("Should return lowest bid", async function () {
      // Register second agent
      await registry.connect(agentOwner).registerAgent("Agent 2", "AG2", 0, agentWallet2.address, "ipfs://2", 7500, ethers.parseEther("100"));
      await registry.connect(owner).recordTaskCompletion(2, ethers.parseEther("0.1"));

      await taskAuction.connect(agentWallet2).submitBid(1, 2, ethers.parseEther("0.3"));

      const [lowestBidId, lowestAmount] = await taskAuction.getLowestBid(1);
      expect(lowestBidId).to.equal(2);
      expect(lowestAmount).to.equal(ethers.parseEther("0.3"));
    });
  });

  describe("Admin Functions", function () {
    it("Should allow admin to update bidding window", async function () {
      await taskAuction.setDefaultBiddingWindow(20);
      expect(await taskAuction.defaultBiddingWindow()).to.equal(20);
    });

    it("Should allow admin to update completion window", async function () {
      await taskAuction.setDefaultCompletionWindow(120);
      expect(await taskAuction.defaultCompletionWindow()).to.equal(120);
    });

    it("Should allow admin to pause/unpause", async function () {
      await taskAuction.pause();

      await expect(
        taskAuction.createTask(0, INPUT_HASH, "ipfs://task", MAX_BID, 0, 0, { value: MAX_BID })
      ).to.be.revertedWithCustomError(taskAuction, "EnforcedPause");

      await taskAuction.unpause();

      await expect(
        taskAuction.createTask(0, INPUT_HASH, "ipfs://task", MAX_BID, 0, 0, { value: MAX_BID })
      ).to.not.be.reverted;
    });
  });
});
