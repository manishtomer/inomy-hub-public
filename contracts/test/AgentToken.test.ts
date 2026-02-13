import { expect } from "chai";
import { ethers } from "hardhat";
import { AgentToken } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("AgentToken", function () {
  let agentToken: AgentToken;
  let owner: HardhatEthersSigner;
  let agentWallet: HardhatEthersSigner;
  let protocolTreasury: HardhatEthersSigner;
  let investor1: HardhatEthersSigner;
  let investor2: HardhatEthersSigner;

  const AGENT_ID = 1;
  const TOKEN_NAME = "Agent Alpha Token";
  const TOKEN_SYMBOL = "ALPHA";

  const INVESTOR_SHARE_BPS = 7500; // 75%

  beforeEach(async function () {
    [owner, agentWallet, protocolTreasury, investor1, investor2] = await ethers.getSigners();

    const AgentTokenFactory = await ethers.getContractFactory("AgentToken");
    agentToken = await AgentTokenFactory.deploy(
      AGENT_ID,
      TOKEN_NAME,
      TOKEN_SYMBOL,
      agentWallet.address,
      protocolTreasury.address,
      INVESTOR_SHARE_BPS,
      agentWallet.address,  // Agent wallet is also owner
      owner.address,        // Creator (receives founder tokens)
      ethers.parseEther("100") // Creator allocation: 100 tokens
    );
  });

  describe("Deployment", function () {
    it("Should set the correct name and symbol", async function () {
      expect(await agentToken.name()).to.equal(TOKEN_NAME);
      expect(await agentToken.symbol()).to.equal(TOKEN_SYMBOL);
    });

    it("Should set the correct agent ID", async function () {
      expect(await agentToken.agentId()).to.equal(AGENT_ID);
    });

    it("Should set the correct agent wallet", async function () {
      expect(await agentToken.agentWallet()).to.equal(agentWallet.address);
    });

    it("Should set the correct owner (agent wallet)", async function () {
      expect(await agentToken.owner()).to.equal(agentWallet.address);
    });

    it("Should set the correct protocol treasury", async function () {
      expect(await agentToken.protocolTreasury()).to.equal(protocolTreasury.address);
    });

    it("Should set the correct investor share", async function () {
      expect(await agentToken.investorShareBps()).to.equal(INVESTOR_SHARE_BPS);
    });

    it("Should reject invalid investor share (too low)", async function () {
      const AgentTokenFactory = await ethers.getContractFactory("AgentToken");
      await expect(
        AgentTokenFactory.deploy(
          1, "Test", "TST", agentWallet.address, protocolTreasury.address,
          4000, // Below MIN_INVESTOR_SHARE_BPS (5000)
          agentWallet.address,
          owner.address, 0 // No creator allocation
        )
      ).to.be.revertedWithCustomError(agentToken, "InvalidInvestorShare");
    });

    it("Should reject invalid investor share (too high)", async function () {
      const AgentTokenFactory = await ethers.getContractFactory("AgentToken");
      await expect(
        AgentTokenFactory.deploy(
          1, "Test", "TST", agentWallet.address, protocolTreasury.address,
          9800, // Above MAX_INVESTOR_SHARE_BPS (9500)
          agentWallet.address,
          owner.address, 0 // No creator allocation
        )
      ).to.be.revertedWithCustomError(agentToken, "InvalidInvestorShare");
    });

    it("Should start with creator allocation", async function () {
      // Creator allocation is 100 tokens
      expect(await agentToken.totalSupply()).to.equal(ethers.parseEther("100"));
      // Creator (owner) should have the allocation
      expect(await agentToken.balanceOf(owner.address)).to.equal(ethers.parseEther("100"));
    });
  });

  describe("Bonding Curve Calculations", function () {
    it("Should return price based on initial supply", async function () {
      const price = await agentToken.getCurrentPrice();
      // Price = BASE_PRICE + (PRICE_INCREMENT * supply / 1e18)
      // Price = 0.001 + 0.0001 * 100 = 0.001 + 0.01 = 0.011 ETH
      expect(price).to.equal(ethers.parseUnits("0.011", "ether"));
    });

    it("Should calculate purchase cost correctly with existing supply", async function () {
      const amount = ethers.parseEther("10"); // 10 tokens
      const cost = await agentToken.calculatePurchaseCost(amount);

      // With existing 100 tokens supply:
      // Cost = BASE_PRICE * 10 + INCREMENT * (110^2 - 100^2) / 2
      // Cost = 0.01 + 0.0001 * (12100 - 10000) / 2
      // Cost = 0.01 + 0.0001 * 1050 = 0.01 + 0.105 = 0.115 ETH
      expect(cost).to.equal(ethers.parseUnits("0.115", "ether"));
    });

    it("Should calculate sale refund correctly", async function () {
      // First buy some tokens
      const buyAmount = ethers.parseEther("10");
      const cost = await agentToken.calculatePurchaseCost(buyAmount);
      const fee = (cost * 250n) / 10000n;

      await agentToken.connect(investor1).buyExact(buyAmount, {
        value: cost + fee + ethers.parseEther("0.01") // Extra for safety
      });

      // Check sale refund equals reserve (minus fees)
      const saleRefund = await agentToken.calculateSaleRefund(buyAmount);
      expect(saleRefund).to.equal(await agentToken.reserveBalance());
    });
  });

  describe("Buying Tokens", function () {
    it("Should allow buying tokens with exact amount", async function () {
      const amount = ethers.parseEther("10");
      const creatorAllocation = ethers.parseEther("100");
      const cost = await agentToken.calculatePurchaseCost(amount);
      const fee = (cost * 250n) / 10000n;
      const totalCost = cost + fee;

      await agentToken.connect(investor1).buyExact(amount, {
        value: totalCost + ethers.parseEther("0.01") // Extra for refund
      });

      expect(await agentToken.balanceOf(investor1.address)).to.equal(amount);
      // Total supply includes creator allocation + purchased amount
      expect(await agentToken.totalSupply()).to.equal(creatorAllocation + amount);
    });

    it("Should update reserve balance on purchase", async function () {
      const amount = ethers.parseEther("10");
      const cost = await agentToken.calculatePurchaseCost(amount);
      const fee = (cost * 250n) / 10000n;

      await agentToken.connect(investor1).buyExact(amount, {
        value: cost + fee
      });

      expect(await agentToken.reserveBalance()).to.equal(cost);
    });

    it("Should collect protocol fees", async function () {
      const amount = ethers.parseEther("10");
      const cost = await agentToken.calculatePurchaseCost(amount);
      const fee = (cost * 250n) / 10000n;

      await agentToken.connect(investor1).buyExact(amount, {
        value: cost + fee
      });

      expect(await agentToken.protocolFees()).to.equal(fee);
    });

    it("Should revert if payment is insufficient", async function () {
      const amount = ethers.parseEther("10");

      await expect(
        agentToken.connect(investor1).buyExact(amount, {
          value: ethers.parseEther("0.001") // Too little
        })
      ).to.be.revertedWithCustomError(agentToken, "InsufficientPayment");
    });

    it("Should refund excess payment", async function () {
      const amount = ethers.parseEther("10");
      const cost = await agentToken.calculatePurchaseCost(amount);
      const fee = (cost * 250n) / 10000n;
      const excess = ethers.parseEther("1");

      const balanceBefore = await ethers.provider.getBalance(investor1.address);

      const tx = await agentToken.connect(investor1).buyExact(amount, {
        value: cost + fee + excess
      });
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const balanceAfter = await ethers.provider.getBalance(investor1.address);

      // Balance should decrease by (cost + fee + gas), not (cost + fee + excess + gas)
      const expectedSpent = cost + fee + gasUsed;
      expect(balanceBefore - balanceAfter).to.be.closeTo(expectedSpent, ethers.parseEther("0.001"));
    });
  });

  describe("Selling Tokens", function () {
    beforeEach(async function () {
      // Buy tokens first
      const amount = ethers.parseEther("10");
      const cost = await agentToken.calculatePurchaseCost(amount);
      const fee = (cost * 250n) / 10000n;

      await agentToken.connect(investor1).buyExact(amount, {
        value: cost + fee
      });
    });

    it("Should allow selling tokens", async function () {
      const sellAmount = ethers.parseEther("5");

      await agentToken.connect(investor1).sell(sellAmount, 0);

      expect(await agentToken.balanceOf(investor1.address)).to.equal(ethers.parseEther("5"));
    });

    it("Should update reserve balance on sale", async function () {
      const reserveBefore = await agentToken.reserveBalance();
      const sellAmount = ethers.parseEther("5");
      const refund = await agentToken.calculateSaleRefund(sellAmount);

      await agentToken.connect(investor1).sell(sellAmount, 0);

      expect(await agentToken.reserveBalance()).to.equal(reserveBefore - refund);
    });

    it("Should revert if selling more than balance", async function () {
      await expect(
        agentToken.connect(investor1).sell(ethers.parseEther("20"), 0)
      ).to.be.revertedWithCustomError(agentToken, "InsufficientBalance");
    });

    it("Should respect minimum refund (slippage protection)", async function () {
      const sellAmount = ethers.parseEther("5");
      const refund = await agentToken.calculateSaleRefund(sellAmount);

      await expect(
        agentToken.connect(investor1).sell(sellAmount, refund * 2n) // Asking for too much
      ).to.be.revertedWithCustomError(agentToken, "InsufficientPayment");
    });
  });

  describe("Profit Distribution", function () {
    beforeEach(async function () {
      // Two investors buy tokens
      const amount1 = ethers.parseEther("10");
      const cost1 = await agentToken.calculatePurchaseCost(amount1);
      const fee1 = (cost1 * 250n) / 10000n;

      await agentToken.connect(investor1).buyExact(amount1, {
        value: cost1 + fee1
      });

      const amount2 = ethers.parseEther("10");
      const cost2 = await agentToken.calculatePurchaseCost(amount2);
      const fee2 = (cost2 * 250n) / 10000n;

      await agentToken.connect(investor2).buyExact(amount2, {
        value: cost2 + fee2
      });
    });

    it("Should distribute profits to holders (75%) and agent (25%)", async function () {
      const profitAmount = ethers.parseEther("1");
      const agentBalanceBefore = await ethers.provider.getBalance(agentWallet.address);

      await agentToken.depositProfits({ value: profitAmount });

      const agentBalanceAfter = await ethers.provider.getBalance(agentWallet.address);
      const agentShare = agentBalanceAfter - agentBalanceBefore;

      // Agent should receive 25%
      expect(agentShare).to.equal(ethers.parseEther("0.25"));
    });

    it("Should allow holders to claim profits", async function () {
      const profitAmount = ethers.parseEther("1");
      await agentToken.depositProfits({ value: profitAmount });

      // Total supply: 100 (creator) + 10 (inv1) + 10 (inv2) = 120 tokens
      // Investor 1 has 10/120 = 8.33% of tokens
      // Investor share of profits: 75% of 1 ETH = 0.75 ETH
      // Investor1's share: 0.75 * 10/120 = 0.0625 ETH
      const pendingProfits = await agentToken.getPendingProfits(investor1.address);
      expect(pendingProfits).to.equal(ethers.parseEther("0.0625"));

      const balanceBefore = await ethers.provider.getBalance(investor1.address);
      const tx = await agentToken.connect(investor1).claimProfits();
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const balanceAfter = await ethers.provider.getBalance(investor1.address);

      expect(balanceAfter - balanceBefore + gasUsed).to.equal(ethers.parseEther("0.0625"));
    });

    it("Should track profits correctly across transfers", async function () {
      // Deposit profits
      await agentToken.depositProfits({ value: ethers.parseEther("1") });

      // Transfer 5 tokens from investor1 to investor2
      await agentToken.connect(investor1).transfer(investor2.address, ethers.parseEther("5"));

      // Investor1 should still have their original profits
      // Total was 120 tokens, investor1 had 10 = 8.33%
      // Investor share: 0.75 ETH * 10/120 = 0.0625 ETH
      const pendingProfits1 = await agentToken.getPendingProfits(investor1.address);
      expect(pendingProfits1).to.equal(ethers.parseEther("0.0625")); // Original share

      // New profits deposited
      await agentToken.depositProfits({ value: ethers.parseEther("1") });

      // Now investor1 has 5 tokens, total still 120
      // New investor share: 0.75 ETH * 5/120 = 0.03125 ETH
      // Total: 0.0625 + 0.03125 = 0.09375 ETH
      const newPending1 = await agentToken.getPendingProfits(investor1.address);
      expect(newPending1).to.equal(ethers.parseEther("0.09375"));
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner (agent wallet) to update agent wallet", async function () {
      const newWallet = investor2.address;

      await agentToken.connect(agentWallet).setAgentWallet(newWallet);

      expect(await agentToken.agentWallet()).to.equal(newWallet);
    });

    it("Should not allow non-owner to update agent wallet", async function () {
      await expect(
        agentToken.connect(investor1).setAgentWallet(investor2.address)
      ).to.be.revertedWithCustomError(agentToken, "OwnableUnauthorizedAccount");
    });

    it("Should allow anyone to withdraw protocol fees to treasury", async function () {
      // Generate some fees
      const amount = ethers.parseEther("100");
      const cost = await agentToken.calculatePurchaseCost(amount);
      const fee = (cost * 250n) / 10000n;

      await agentToken.connect(investor1).buyExact(amount, {
        value: cost + fee
      });

      const feeBalance = await agentToken.protocolFees();
      expect(feeBalance).to.equal(fee);

      const treasuryBalanceBefore = await ethers.provider.getBalance(protocolTreasury.address);

      // Anyone can call withdrawProtocolFees - it always goes to protocolTreasury
      await agentToken.connect(investor1).withdrawProtocolFees();

      const treasuryBalanceAfter = await ethers.provider.getBalance(protocolTreasury.address);

      expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(fee);
      expect(await agentToken.protocolFees()).to.equal(0);
    });

    it("Should allow owner to update protocol treasury", async function () {
      const newTreasury = investor2.address;
      await agentToken.connect(agentWallet).setProtocolTreasury(newTreasury);
      expect(await agentToken.protocolTreasury()).to.equal(newTreasury);
    });

    it("Should allow owner to update investor share", async function () {
      await agentToken.connect(agentWallet).setInvestorShare(8000); // 80%
      expect(await agentToken.investorShareBps()).to.equal(8000);
    });

    it("Should reject invalid investor share update", async function () {
      await expect(
        agentToken.connect(agentWallet).setInvestorShare(4000) // Too low
      ).to.be.revertedWithCustomError(agentToken, "InvalidInvestorShare");
    });
  });

  describe("Price Dynamics", function () {
    it("Should increase price as supply increases", async function () {
      const priceBefore = await agentToken.getCurrentPrice();

      // Buy tokens
      const amount = ethers.parseEther("100");
      const cost = await agentToken.calculatePurchaseCost(amount);
      const fee = (cost * 250n) / 10000n;

      await agentToken.connect(investor1).buyExact(amount, {
        value: cost + fee
      });

      const priceAfter = await agentToken.getCurrentPrice();

      expect(priceAfter).to.be.gt(priceBefore);
    });

    it("Should decrease price as supply decreases", async function () {
      // Buy tokens first
      const amount = ethers.parseEther("100");
      const cost = await agentToken.calculatePurchaseCost(amount);
      const fee = (cost * 250n) / 10000n;

      await agentToken.connect(investor1).buyExact(amount, {
        value: cost + fee
      });

      const priceBefore = await agentToken.getCurrentPrice();

      // Sell some
      await agentToken.connect(investor1).sell(ethers.parseEther("50"), 0);

      const priceAfter = await agentToken.getCurrentPrice();

      expect(priceAfter).to.be.lt(priceBefore);
    });
  });

  describe("View Functions", function () {
    it("Should return correct token stats", async function () {
      const amount = ethers.parseEther("10");
      const creatorAllocation = ethers.parseEther("100");
      const cost = await agentToken.calculatePurchaseCost(amount);
      const fee = (cost * 250n) / 10000n;

      await agentToken.connect(investor1).buyExact(amount, {
        value: cost + fee
      });

      const [supply, reserve, price, marketCap] = await agentToken.getTokenStats();

      // Supply includes creator allocation + purchased amount
      expect(supply).to.equal(creatorAllocation + amount);
      expect(reserve).to.equal(cost);
      expect(price).to.be.gt(0);
      expect(marketCap).to.equal((supply * price) / ethers.parseEther("1"));
    });
  });
});
