import { expect } from "chai";
import { ethers, network } from "hardhat";
import { IntentAuction, AgentRegistry, Treasury } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("IntentAuction", function () {
  let intentAuction: IntentAuction;
  let registry: AgentRegistry;
  let treasury: Treasury;
  let owner: HardhatEthersSigner;
  let protocolTreasury: HardhatEthersSigner;
  let agentOwner: HardhatEthersSigner;
  let sellerWallet1: HardhatEthersSigner;
  let sellerWallet2: HardhatEthersSigner;
  let consumer: HardhatEthersSigner;

  const MAX_BUDGET = ethers.parseEther("1");
  const PRODUCT_HASH = ethers.keccak256(ethers.toUtf8Bytes("organic coffee beans"));
  const MIN_BID_FEE = ethers.parseEther("0.001");

  // Agent type constants
  const SELLER_TYPE = 3; // SELLER

  beforeEach(async function () {
    [owner, protocolTreasury, agentOwner, sellerWallet1, sellerWallet2, consumer] = await ethers.getSigners();

    // Deploy AgentRegistry
    const AgentRegistryFactory = await ethers.getContractFactory("AgentRegistry");
    registry = await AgentRegistryFactory.deploy(protocolTreasury.address);

    // Deploy Treasury
    const TreasuryFactory = await ethers.getContractFactory("Treasury");
    treasury = await TreasuryFactory.deploy();

    // Deploy IntentAuction
    const IntentAuctionFactory = await ethers.getContractFactory("IntentAuction");
    intentAuction = await IntentAuctionFactory.deploy(
      await registry.getAddress(),
      await treasury.getAddress()
    );

    // Configure Treasury
    await treasury.setIntentAuction(await intentAuction.getAddress());

    // Register SELLER agents (type 3)
    await registry.connect(agentOwner).registerAgent(
      "Seller Agent 1",
      "SELL1",
      SELLER_TYPE, // SELLER type
      sellerWallet1.address,
      "ipfs://seller1",
      7500,
      ethers.parseEther("100")
    );

    await registry.connect(agentOwner).registerAgent(
      "Seller Agent 2",
      "SELL2",
      SELLER_TYPE, // SELLER type
      sellerWallet2.address,
      "ipfs://seller2",
      7500,
      ethers.parseEther("100")
    );

    // Activate both seller agents
    await registry.connect(owner).recordTaskCompletion(1, ethers.parseEther("0.1"));
    await registry.connect(owner).recordTaskCompletion(2, ethers.parseEther("0.1"));
  });

  describe("Deployment", function () {
    it("Should set correct registry address", async function () {
      expect(await intentAuction.agentRegistry()).to.equal(await registry.getAddress());
    });

    it("Should set correct treasury address", async function () {
      expect(await intentAuction.treasury()).to.equal(await treasury.getAddress());
    });

    it("Should set default auction duration to 60 seconds", async function () {
      expect(await intentAuction.defaultAuctionDuration()).to.equal(60);
    });

    it("Should set SELLER_AGENT_TYPE to 3", async function () {
      expect(await intentAuction.SELLER_AGENT_TYPE()).to.equal(3);
    });

    it("Should start with zero intents", async function () {
      expect(await intentAuction.getTotalIntents()).to.equal(0);
    });
  });

  // PRD F3 Acceptance: Intent created with OPEN status
  describe("Intent Creation", function () {
    it("Should create intent with OPEN status", async function () {
      await intentAuction.connect(consumer).createIntent(
        PRODUCT_HASH,
        "ipfs://intent",
        MAX_BUDGET,
        0 // Use default duration
      );

      const intent = await intentAuction.getIntent(1);
      expect(intent.id).to.equal(1);
      expect(intent.consumer).to.equal(consumer.address);
      expect(intent.productHash).to.equal(PRODUCT_HASH);
      expect(intent.maxBudget).to.equal(MAX_BUDGET);
      expect(intent.status).to.equal(0); // Open
    });

    it("Should emit IntentCreated event", async function () {
      await expect(
        intentAuction.connect(consumer).createIntent(PRODUCT_HASH, "ipfs://intent", MAX_BUDGET, 0)
      ).to.emit(intentAuction, "IntentCreated");
    });

    it("Should allow custom auction duration", async function () {
      const customDuration = 120; // 120 seconds
      await intentAuction.connect(consumer).createIntent(PRODUCT_HASH, "ipfs://intent", MAX_BUDGET, customDuration);

      const intent = await intentAuction.getIntent(1);
      // Deadline should be ~120 seconds from now
      const expectedDeadline = (await ethers.provider.getBlock("latest"))!.timestamp + customDuration;
      expect(intent.auctionDeadline).to.be.closeTo(expectedDeadline, 5);
    });

    it("Should reject zero max budget", async function () {
      await expect(
        intentAuction.connect(consumer).createIntent(PRODUCT_HASH, "ipfs://intent", 0, 0)
      ).to.be.revertedWithCustomError(intentAuction, "InvalidMaxBudget");
    });
  });

  // PRD F3 Acceptance: Only SELLER type agents can bid
  describe("Offer Submission", function () {
    beforeEach(async function () {
      // Create an intent
      await intentAuction.connect(consumer).createIntent(PRODUCT_HASH, "ipfs://intent", MAX_BUDGET, 60);
    });

    it("Should accept offer from SELLER type agent", async function () {
      const offerPrice = ethers.parseEther("0.8");
      const bidFee = ethers.parseEther("0.01");

      await expect(
        intentAuction.connect(sellerWallet1).submitOffer(1, 1, offerPrice, { value: bidFee })
      ).to.emit(intentAuction, "OfferSubmitted");

      const offer = await intentAuction.getOffer(1);
      expect(offer.agentId).to.equal(1);
      expect(offer.offerPrice).to.equal(offerPrice);
      expect(offer.bidFee).to.equal(bidFee);
    });

    it("Should reject offer from non-SELLER type agent", async function () {
      // Register a CATALOG agent (type 0)
      const [, , , , , , catalogWallet] = await ethers.getSigners();
      await registry.connect(agentOwner).registerAgent(
        "Catalog Agent",
        "CAT1",
        0, // CATALOG type (not SELLER)
        catalogWallet.address,
        "ipfs://catalog",
        7500,
        ethers.parseEther("100")
      );
      await registry.connect(owner).recordTaskCompletion(3, ethers.parseEther("0.1"));

      await expect(
        intentAuction.connect(catalogWallet).submitOffer(1, 3, ethers.parseEther("0.8"), { value: MIN_BID_FEE })
      ).to.be.revertedWithCustomError(intentAuction, "NotSellerAgent");
    });

    // PRD F3 Acceptance: Bid requires payment (msg.value > 0)
    it("Should reject offer without bid fee", async function () {
      await expect(
        intentAuction.connect(sellerWallet1).submitOffer(1, 1, ethers.parseEther("0.8"), { value: 0 })
      ).to.be.revertedWithCustomError(intentAuction, "InsufficientBidFee");
    });

    it("Should reject offer with insufficient bid fee", async function () {
      await expect(
        intentAuction.connect(sellerWallet1).submitOffer(1, 1, ethers.parseEther("0.8"), { value: ethers.parseEther("0.0005") })
      ).to.be.revertedWithCustomError(intentAuction, "InsufficientBidFee");
    });

    // PRD F3 Acceptance: Bid rejected if offerPrice > maxBudget
    it("Should reject offer exceeding max budget", async function () {
      await expect(
        intentAuction.connect(sellerWallet1).submitOffer(1, 1, MAX_BUDGET + 1n, { value: MIN_BID_FEE })
      ).to.be.revertedWithCustomError(intentAuction, "OfferPriceExceedsBudget");
    });

    it("Should reject offer after auction closes", async function () {
      // Fast forward past auction deadline
      await network.provider.send("evm_increaseTime", [120]);
      await network.provider.send("evm_mine");

      await expect(
        intentAuction.connect(sellerWallet1).submitOffer(1, 1, ethers.parseEther("0.8"), { value: MIN_BID_FEE })
      ).to.be.revertedWithCustomError(intentAuction, "AuctionWindowClosed");
    });

    it("Should reject duplicate offer from same agent", async function () {
      await intentAuction.connect(sellerWallet1).submitOffer(1, 1, ethers.parseEther("0.8"), { value: MIN_BID_FEE });

      await expect(
        intentAuction.connect(sellerWallet1).submitOffer(1, 1, ethers.parseEther("0.7"), { value: MIN_BID_FEE })
      ).to.be.revertedWithCustomError(intentAuction, "AgentAlreadyOffered");
    });

    it("Should collect bid fees", async function () {
      const bidFee = ethers.parseEther("0.01");
      await intentAuction.connect(sellerWallet1).submitOffer(1, 1, ethers.parseEther("0.8"), { value: bidFee });

      const intent = await intentAuction.getIntent(1);
      expect(intent.totalFeesCollected).to.equal(bidFee);
    });
  });

  // PRD F3 Acceptance: Score calculated correctly per formula
  describe("Score Calculation", function () {
    it("Should calculate score correctly", async function () {
      // Score = bidFee × (maxBudget - offerPrice) / maxBudget
      // With bidFee = 0.01 ETH, offerPrice = 0.8 ETH, maxBudget = 1 ETH:
      // Score = 0.01 × (1 - 0.8) / 1 = 0.01 × 0.2 = 0.002 (scaled by 1e18)

      const bidFee = ethers.parseEther("0.01");
      const offerPrice = ethers.parseEther("0.8");

      const score = await intentAuction.calculateScore(bidFee, offerPrice, MAX_BUDGET);

      // Expected: 0.01 × 0.2 × 1e18 / 1 = 0.002 × 1e18 = 2e15
      const expectedScore = (bidFee * (MAX_BUDGET - offerPrice) * BigInt(1e18)) / MAX_BUDGET;
      expect(score).to.equal(expectedScore);
    });

    it("Should give higher score to higher bid fee", async function () {
      const offerPrice = ethers.parseEther("0.5");
      const lowBidFee = ethers.parseEther("0.01");
      const highBidFee = ethers.parseEther("0.05");

      const lowScore = await intentAuction.calculateScore(lowBidFee, offerPrice, MAX_BUDGET);
      const highScore = await intentAuction.calculateScore(highBidFee, offerPrice, MAX_BUDGET);

      expect(highScore).to.be.gt(lowScore);
    });

    it("Should give higher score to lower offer price (same bid fee)", async function () {
      const bidFee = ethers.parseEther("0.01");
      const highPrice = ethers.parseEther("0.9"); // Less discount
      const lowPrice = ethers.parseEther("0.5");  // More discount

      const scoreHighPrice = await intentAuction.calculateScore(bidFee, highPrice, MAX_BUDGET);
      const scoreLowPrice = await intentAuction.calculateScore(bidFee, lowPrice, MAX_BUDGET);

      expect(scoreLowPrice).to.be.gt(scoreHighPrice);
    });

    it("Should return zero score if offerPrice exceeds maxBudget", async function () {
      const bidFee = ethers.parseEther("0.01");
      const overPrice = MAX_BUDGET + ethers.parseEther("0.1");

      const score = await intentAuction.calculateScore(bidFee, overPrice, MAX_BUDGET);
      expect(score).to.equal(0);
    });
  });

  // PRD F3 Acceptance: closeAuction() selects highest score as winner
  describe("Auction Closing", function () {
    beforeEach(async function () {
      await intentAuction.connect(consumer).createIntent(PRODUCT_HASH, "ipfs://intent", MAX_BUDGET, 60);
    });

    it("Should select highest score as winner", async function () {
      // Seller 1: low bid fee, low price
      await intentAuction.connect(sellerWallet1).submitOffer(
        1, 1, ethers.parseEther("0.5"), { value: ethers.parseEther("0.01") }
      );

      // Seller 2: high bid fee, higher price (should win due to high bid fee)
      await intentAuction.connect(sellerWallet2).submitOffer(
        1, 2, ethers.parseEther("0.6"), { value: ethers.parseEther("0.05") }
      );

      // Get scores
      const offer1 = await intentAuction.getOffer(1);
      const offer2 = await intentAuction.getOffer(2);

      // Fast forward past auction deadline
      await network.provider.send("evm_increaseTime", [120]);
      await network.provider.send("evm_mine");

      await intentAuction.closeAuction(1);

      const intent = await intentAuction.getIntent(1);
      const winningOffer = await intentAuction.getWinningOffer(1);

      // The offer with higher score should win
      if (offer1.score > offer2.score) {
        expect(intent.winningOfferId).to.equal(1);
      } else {
        expect(intent.winningOfferId).to.equal(2);
      }
    });

    it("Should emit AuctionClosed event", async function () {
      await intentAuction.connect(sellerWallet1).submitOffer(
        1, 1, ethers.parseEther("0.8"), { value: ethers.parseEther("0.01") }
      );

      await network.provider.send("evm_increaseTime", [120]);
      await network.provider.send("evm_mine");

      await expect(intentAuction.closeAuction(1))
        .to.emit(intentAuction, "AuctionClosed");
    });

    it("Should reject closing before deadline", async function () {
      await intentAuction.connect(sellerWallet1).submitOffer(
        1, 1, ethers.parseEther("0.8"), { value: ethers.parseEther("0.01") }
      );

      await expect(
        intentAuction.closeAuction(1)
      ).to.be.revertedWithCustomError(intentAuction, "AuctionWindowNotClosed");
    });

    it("Should expire intent with no offers", async function () {
      await network.provider.send("evm_increaseTime", [120]);
      await network.provider.send("evm_mine");

      await intentAuction.closeAuction(1);

      const intent = await intentAuction.getIntent(1);
      expect(intent.status).to.equal(3); // Expired
    });

    // PRD F3 Acceptance: Intent status updated to CLOSED
    it("Should update intent status to CLOSED", async function () {
      await intentAuction.connect(sellerWallet1).submitOffer(
        1, 1, ethers.parseEther("0.8"), { value: ethers.parseEther("0.01") }
      );

      await network.provider.send("evm_increaseTime", [120]);
      await network.provider.send("evm_mine");

      await intentAuction.closeAuction(1);

      const intent = await intentAuction.getIntent(1);
      expect(intent.status).to.equal(2); // Closed
    });

    it("Should mark losing offers as Lost", async function () {
      await intentAuction.connect(sellerWallet1).submitOffer(
        1, 1, ethers.parseEther("0.8"), { value: ethers.parseEther("0.01") }
      );
      await intentAuction.connect(sellerWallet2).submitOffer(
        1, 2, ethers.parseEther("0.7"), { value: ethers.parseEther("0.02") }
      );

      await network.provider.send("evm_increaseTime", [120]);
      await network.provider.send("evm_mine");

      await intentAuction.closeAuction(1);

      const intent = await intentAuction.getIntent(1);
      const winningOfferId = intent.winningOfferId;

      // Check non-winning offer is marked as Lost
      const losingOfferId = winningOfferId === 1n ? 2 : 1;
      const losingOffer = await intentAuction.getOffer(losingOfferId);
      expect(losingOffer.status).to.equal(2); // Lost
    });
  });

  // PRD F3 Acceptance: All bid amounts transferred to Treasury
  describe("Fee Transfer to Treasury", function () {
    beforeEach(async function () {
      await intentAuction.connect(consumer).createIntent(PRODUCT_HASH, "ipfs://intent", MAX_BUDGET, 60);
    });

    it("Should transfer all fees to Treasury on close", async function () {
      const bidFee1 = ethers.parseEther("0.01");
      const bidFee2 = ethers.parseEther("0.02");
      const totalFees = bidFee1 + bidFee2;

      await intentAuction.connect(sellerWallet1).submitOffer(1, 1, ethers.parseEther("0.8"), { value: bidFee1 });
      await intentAuction.connect(sellerWallet2).submitOffer(1, 2, ethers.parseEther("0.7"), { value: bidFee2 });

      const treasuryBalanceBefore = await treasury.getBalance();

      await network.provider.send("evm_increaseTime", [120]);
      await network.provider.send("evm_mine");

      await intentAuction.closeAuction(1);

      const treasuryBalanceAfter = await treasury.getBalance();
      expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(totalFees);
    });

    it("Should emit FeesTransferredToTreasury event", async function () {
      await intentAuction.connect(sellerWallet1).submitOffer(1, 1, ethers.parseEther("0.8"), { value: ethers.parseEther("0.01") });

      await network.provider.send("evm_increaseTime", [120]);
      await network.provider.send("evm_mine");

      await expect(intentAuction.closeAuction(1))
        .to.emit(intentAuction, "FeesTransferredToTreasury");
    });

    it("Should update Treasury totalRevenue", async function () {
      const bidFee = ethers.parseEther("0.01");
      await intentAuction.connect(sellerWallet1).submitOffer(1, 1, ethers.parseEther("0.8"), { value: bidFee });

      await network.provider.send("evm_increaseTime", [120]);
      await network.provider.send("evm_mine");

      await intentAuction.closeAuction(1);

      expect(await treasury.totalRevenue()).to.equal(bidFee);
    });

    it("Should allow manual fee flush", async function () {
      await intentAuction.connect(sellerWallet1).submitOffer(1, 1, ethers.parseEther("0.8"), { value: ethers.parseEther("0.01") });

      // Manually flush fees
      await intentAuction.flushFeesToTreasury();

      expect(await treasury.getBalance()).to.equal(ethers.parseEther("0.01"));
    });
  });

  describe("Offer Withdrawal", function () {
    beforeEach(async function () {
      await intentAuction.connect(consumer).createIntent(PRODUCT_HASH, "ipfs://intent", MAX_BUDGET, 60);
      await intentAuction.connect(sellerWallet1).submitOffer(1, 1, ethers.parseEther("0.8"), { value: ethers.parseEther("0.01") });
    });

    it("Should allow seller to withdraw offer before deadline", async function () {
      await expect(
        intentAuction.connect(sellerWallet1).withdrawOffer(1)
      ).to.emit(intentAuction, "OfferWithdrawn");

      const offer = await intentAuction.getOffer(1);
      expect(offer.status).to.equal(3); // Withdrawn
    });

    it("Should reject withdrawal after deadline", async function () {
      await network.provider.send("evm_increaseTime", [120]);
      await network.provider.send("evm_mine");

      await expect(
        intentAuction.connect(sellerWallet1).withdrawOffer(1)
      ).to.be.revertedWithCustomError(intentAuction, "AuctionWindowClosed");
    });

    it("Should reject withdrawal from non-owner", async function () {
      await expect(
        intentAuction.connect(sellerWallet2).withdrawOffer(1)
      ).to.be.revertedWithCustomError(intentAuction, "NotOfferOwner");
    });

    it("Should not refund bid fee on withdrawal", async function () {
      const intentBefore = await intentAuction.getIntent(1);
      expect(intentBefore.totalFeesCollected).to.equal(ethers.parseEther("0.01"));

      await intentAuction.connect(sellerWallet1).withdrawOffer(1);

      // Fees should still be collected
      const intentAfter = await intentAuction.getIntent(1);
      expect(intentAfter.totalFeesCollected).to.equal(ethers.parseEther("0.01"));
    });
  });

  describe("Intent Cancellation", function () {
    it("Should allow consumer to cancel open intent", async function () {
      await intentAuction.connect(consumer).createIntent(PRODUCT_HASH, "ipfs://intent", MAX_BUDGET, 60);

      await expect(intentAuction.connect(consumer).cancelIntent(1))
        .to.emit(intentAuction, "IntentCancelled");

      const intent = await intentAuction.getIntent(1);
      expect(intent.status).to.equal(3); // Expired
    });

    it("Should reject cancellation by non-consumer", async function () {
      await intentAuction.connect(consumer).createIntent(PRODUCT_HASH, "ipfs://intent", MAX_BUDGET, 60);

      await expect(
        intentAuction.connect(sellerWallet1).cancelIntent(1)
      ).to.be.revertedWithCustomError(intentAuction, "NotIntentConsumer");
    });

    it("Should transfer fees to treasury on cancellation", async function () {
      await intentAuction.connect(consumer).createIntent(PRODUCT_HASH, "ipfs://intent", MAX_BUDGET, 60);
      await intentAuction.connect(sellerWallet1).submitOffer(1, 1, ethers.parseEther("0.8"), { value: ethers.parseEther("0.01") });

      await intentAuction.connect(consumer).cancelIntent(1);

      expect(await treasury.getBalance()).to.equal(ethers.parseEther("0.01"));
    });
  });

  describe("Fulfillment", function () {
    beforeEach(async function () {
      await intentAuction.connect(consumer).createIntent(PRODUCT_HASH, "ipfs://intent", MAX_BUDGET, 60);
      await intentAuction.connect(sellerWallet1).submitOffer(1, 1, ethers.parseEther("0.8"), { value: ethers.parseEther("0.01") });

      await network.provider.send("evm_increaseTime", [120]);
      await network.provider.send("evm_mine");

      await intentAuction.closeAuction(1);
    });

    it("Should allow operator to mark fulfilled", async function () {
      await expect(intentAuction.markFulfilled(1))
        .to.emit(intentAuction, "IntentFulfilled");

      const intent = await intentAuction.getIntent(1);
      expect(intent.status).to.equal(4); // Fulfilled
    });

    it("Should reject fulfillment from non-operator", async function () {
      await expect(
        intentAuction.connect(consumer).markFulfilled(1)
      ).to.be.reverted;
    });
  });

  describe("Dispute", function () {
    beforeEach(async function () {
      await intentAuction.connect(consumer).createIntent(PRODUCT_HASH, "ipfs://intent", MAX_BUDGET, 60);
      await intentAuction.connect(sellerWallet1).submitOffer(1, 1, ethers.parseEther("0.8"), { value: ethers.parseEther("0.01") });

      await network.provider.send("evm_increaseTime", [120]);
      await network.provider.send("evm_mine");

      await intentAuction.closeAuction(1);
    });

    it("Should allow consumer to raise dispute", async function () {
      await expect(intentAuction.connect(consumer).raiseDispute(1, "Product not as described"))
        .to.emit(intentAuction, "IntentDisputed");

      const intent = await intentAuction.getIntent(1);
      expect(intent.status).to.equal(5); // Disputed
    });

    it("Should reject dispute from non-consumer", async function () {
      await expect(
        intentAuction.connect(sellerWallet1).raiseDispute(1, "Fake dispute")
      ).to.be.revertedWithCustomError(intentAuction, "NotIntentConsumer");
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await intentAuction.connect(consumer).createIntent(PRODUCT_HASH, "ipfs://intent", MAX_BUDGET, 60);
      await intentAuction.connect(sellerWallet1).submitOffer(1, 1, ethers.parseEther("0.8"), { value: ethers.parseEther("0.01") });
    });

    it("Should return intent offers", async function () {
      const offerIds = await intentAuction.getIntentOffers(1);
      expect(offerIds.length).to.equal(1);
      expect(offerIds[0]).to.equal(1);
    });

    it("Should return agent offers", async function () {
      const offerIds = await intentAuction.getAgentOffers(1);
      expect(offerIds.length).to.equal(1);
    });

    it("Should check if auction is open", async function () {
      expect(await intentAuction.isAuctionOpen(1)).to.be.true;

      await network.provider.send("evm_increaseTime", [120]);
      await network.provider.send("evm_mine");

      expect(await intentAuction.isAuctionOpen(1)).to.be.false;
    });

    it("Should return highest scoring offer", async function () {
      await intentAuction.connect(sellerWallet2).submitOffer(1, 2, ethers.parseEther("0.5"), { value: ethers.parseEther("0.02") });

      const [highestOfferId, highestScore] = await intentAuction.getHighestScoringOffer(1);
      expect(highestOfferId).to.be.gt(0);
      expect(highestScore).to.be.gt(0);
    });
  });

  describe("Admin Functions", function () {
    it("Should allow admin to update auction duration", async function () {
      await intentAuction.setDefaultAuctionDuration(120);
      expect(await intentAuction.defaultAuctionDuration()).to.equal(120);
    });

    it("Should allow admin to pause/unpause", async function () {
      await intentAuction.pause();

      await expect(
        intentAuction.connect(consumer).createIntent(PRODUCT_HASH, "ipfs://intent", MAX_BUDGET, 0)
      ).to.be.revertedWithCustomError(intentAuction, "EnforcedPause");

      await intentAuction.unpause();

      await expect(
        intentAuction.connect(consumer).createIntent(PRODUCT_HASH, "ipfs://intent", MAX_BUDGET, 0)
      ).to.not.be.reverted;
    });
  });
});
