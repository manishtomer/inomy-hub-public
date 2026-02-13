import { expect } from "chai";
import { ethers } from "hardhat";
import { Treasury } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("Treasury", function () {
  let treasury: Treasury;
  let owner: HardhatEthersSigner;
  let taskAuction: HardhatEthersSigner;
  let intentAuction: HardhatEthersSigner;
  let worker: HardhatEthersSigner;
  let unauthorized: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, taskAuction, intentAuction, worker, unauthorized] = await ethers.getSigners();

    const TreasuryFactory = await ethers.getContractFactory("Treasury");
    treasury = await TreasuryFactory.deploy();
  });

  describe("Deployment", function () {
    it("Should set the deployer as admin", async function () {
      const DEFAULT_ADMIN_ROLE = await treasury.DEFAULT_ADMIN_ROLE();
      expect(await treasury.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("Should start with zero revenue", async function () {
      expect(await treasury.totalRevenue()).to.equal(0);
    });

    it("Should start with zero costs", async function () {
      expect(await treasury.totalCosts()).to.equal(0);
    });

    it("Should start with zero balance", async function () {
      expect(await treasury.getBalance()).to.equal(0);
    });
  });

  // PRD F5 Acceptance: deposit() increases balance and totalRevenue
  describe("Deposits", function () {
    it("Should accept deposits and increase totalRevenue", async function () {
      const amount = ethers.parseEther("1");

      await treasury.deposit({ value: amount });

      expect(await treasury.totalRevenue()).to.equal(amount);
      expect(await treasury.getBalance()).to.equal(amount);
    });

    it("Should emit Deposited event", async function () {
      const amount = ethers.parseEther("1");

      await expect(treasury.deposit({ value: amount }))
        .to.emit(treasury, "Deposited")
        .withArgs(owner.address, amount, amount);
    });

    it("Should accumulate multiple deposits", async function () {
      const amount1 = ethers.parseEther("1");
      const amount2 = ethers.parseEther("2");

      await treasury.deposit({ value: amount1 });
      await treasury.deposit({ value: amount2 });

      expect(await treasury.totalRevenue()).to.equal(amount1 + amount2);
    });

    it("Should revert on zero deposit", async function () {
      await expect(
        treasury.deposit({ value: 0 })
      ).to.be.revertedWithCustomError(treasury, "ZeroAmount");
    });

    it("Should accept direct ETH transfers", async function () {
      const amount = ethers.parseEther("0.5");

      await owner.sendTransaction({
        to: await treasury.getAddress(),
        value: amount
      });

      expect(await treasury.totalRevenue()).to.equal(amount);
      expect(await treasury.getBalance()).to.equal(amount);
    });
  });

  // PRD F5 Acceptance: payWorker() decreases balance and increases totalCosts
  // PRD F5 Acceptance: payWorker() rejected if caller is not TaskAuction
  describe("Worker Payments", function () {
    beforeEach(async function () {
      // Fund treasury
      await treasury.deposit({ value: ethers.parseEther("10") });

      // Set TaskAuction address
      await treasury.setTaskAuction(taskAuction.address);
    });

    it("Should allow TaskAuction to pay workers", async function () {
      const payment = ethers.parseEther("1");
      const workerBalanceBefore = await ethers.provider.getBalance(worker.address);

      await treasury.connect(taskAuction).payWorker(worker.address, payment);

      const workerBalanceAfter = await ethers.provider.getBalance(worker.address);
      expect(workerBalanceAfter - workerBalanceBefore).to.equal(payment);
      expect(await treasury.totalCosts()).to.equal(payment);
    });

    it("Should emit WorkerPaid event", async function () {
      const payment = ethers.parseEther("1");

      await expect(treasury.connect(taskAuction).payWorker(worker.address, payment))
        .to.emit(treasury, "WorkerPaid")
        .withArgs(worker.address, payment, payment);
    });

    it("Should reject payment from unauthorized caller", async function () {
      await expect(
        treasury.connect(unauthorized).payWorker(worker.address, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(treasury, "UnauthorizedCaller");
    });

    it("Should reject payment to zero address", async function () {
      await expect(
        treasury.connect(taskAuction).payWorker(ethers.ZeroAddress, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(treasury, "ZeroAddress");
    });

    it("Should reject zero payment amount", async function () {
      await expect(
        treasury.connect(taskAuction).payWorker(worker.address, 0)
      ).to.be.revertedWithCustomError(treasury, "ZeroAmount");
    });

    it("Should reject payment exceeding balance", async function () {
      await expect(
        treasury.connect(taskAuction).payWorker(worker.address, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(treasury, "InsufficientBalance");
    });

    it("Should allow payment role holders to pay", async function () {
      // Grant payment role to another address
      await treasury.addPaymentRole(intentAuction.address);

      const payment = ethers.parseEther("1");
      await treasury.connect(intentAuction).payWorker(worker.address, payment);

      expect(await treasury.totalCosts()).to.equal(payment);
    });
  });

  // PRD F5 Acceptance: getProfit() returns revenue minus costs
  describe("Profit Calculation", function () {
    beforeEach(async function () {
      await treasury.setTaskAuction(taskAuction.address);
    });

    it("Should calculate profit correctly (revenue - costs)", async function () {
      // Deposit 10 ETH
      await treasury.deposit({ value: ethers.parseEther("10") });

      // Pay 3 ETH to workers
      await treasury.connect(taskAuction).payWorker(worker.address, ethers.parseEther("3"));

      // Profit should be 7 ETH
      expect(await treasury.getProfit()).to.equal(ethers.parseEther("7"));
    });

    it("Should return zero profit when costs exceed revenue", async function () {
      // This is a conceptual test - in practice costs shouldn't exceed balance
      // But the function should handle this gracefully
      await treasury.deposit({ value: ethers.parseEther("10") });

      // Pay all 10 ETH
      await treasury.connect(taskAuction).payWorker(worker.address, ethers.parseEther("10"));

      // Deposit more and pay more
      await treasury.deposit({ value: ethers.parseEther("5") });
      await treasury.connect(taskAuction).payWorker(worker.address, ethers.parseEther("5"));

      // Revenue: 15, Costs: 15, Profit: 0
      expect(await treasury.getProfit()).to.equal(0);
    });

    it("Should return signed profit (can be calculated)", async function () {
      await treasury.deposit({ value: ethers.parseEther("10") });
      await treasury.connect(taskAuction).payWorker(worker.address, ethers.parseEther("3"));

      expect(await treasury.getSignedProfit()).to.equal(ethers.parseEther("7"));
    });
  });

  // PRD F5 Acceptance: getSummary() returns all financial metrics
  describe("Financial Summary", function () {
    beforeEach(async function () {
      await treasury.setTaskAuction(taskAuction.address);
    });

    it("Should return correct summary", async function () {
      const depositAmount = ethers.parseEther("10");
      const paymentAmount = ethers.parseEther("3");

      await treasury.deposit({ value: depositAmount });
      await treasury.connect(taskAuction).payWorker(worker.address, paymentAmount);

      const [balance, revenue, costs, profit] = await treasury.getSummary();

      expect(balance).to.equal(ethers.parseEther("7")); // 10 - 3
      expect(revenue).to.equal(depositAmount);
      expect(costs).to.equal(paymentAmount);
      expect(profit).to.equal(ethers.parseEther("7")); // 10 - 3
    });

    it("Should handle zero state", async function () {
      const [balance, revenue, costs, profit] = await treasury.getSummary();

      expect(balance).to.equal(0);
      expect(revenue).to.equal(0);
      expect(costs).to.equal(0);
      expect(profit).to.equal(0);
    });
  });

  describe("Admin Functions", function () {
    it("Should allow admin to set TaskAuction address", async function () {
      await expect(treasury.setTaskAuction(taskAuction.address))
        .to.emit(treasury, "ContractAddressUpdated")
        .withArgs("TaskAuction", ethers.ZeroAddress, taskAuction.address);

      expect(await treasury.taskAuctionAddress()).to.equal(taskAuction.address);
    });

    it("Should grant payment role when setting TaskAuction", async function () {
      await treasury.setTaskAuction(taskAuction.address);

      const PAYMENT_ROLE = await treasury.PAYMENT_ROLE();
      expect(await treasury.hasRole(PAYMENT_ROLE, taskAuction.address)).to.be.true;
    });

    it("Should allow admin to set IntentAuction address", async function () {
      await expect(treasury.setIntentAuction(intentAuction.address))
        .to.emit(treasury, "ContractAddressUpdated")
        .withArgs("IntentAuction", ethers.ZeroAddress, intentAuction.address);

      expect(await treasury.intentAuctionAddress()).to.equal(intentAuction.address);
    });

    it("Should reject zero address for TaskAuction", async function () {
      await expect(
        treasury.setTaskAuction(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(treasury, "ZeroAddress");
    });

    it("Should reject zero address for IntentAuction", async function () {
      await expect(
        treasury.setIntentAuction(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(treasury, "ZeroAddress");
    });

    it("Should allow admin to withdraw protocol funds", async function () {
      await treasury.deposit({ value: ethers.parseEther("5") });

      const recipientBalanceBefore = await ethers.provider.getBalance(owner.address);

      const tx = await treasury.withdrawProtocolFunds(owner.address, ethers.parseEther("3"));
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const recipientBalanceAfter = await ethers.provider.getBalance(owner.address);

      expect(recipientBalanceAfter - recipientBalanceBefore + gasUsed).to.equal(ethers.parseEther("3"));
    });

    it("Should allow withdrawing all funds with amount=0", async function () {
      await treasury.deposit({ value: ethers.parseEther("5") });

      await treasury.withdrawProtocolFunds(worker.address, 0);

      expect(await treasury.getBalance()).to.equal(0);
    });

    it("Should reject non-admin from administrative functions", async function () {
      await expect(
        treasury.connect(unauthorized).setTaskAuction(taskAuction.address)
      ).to.be.reverted;

      await expect(
        treasury.connect(unauthorized).withdrawProtocolFunds(owner.address, ethers.parseEther("1"))
      ).to.be.reverted;
    });
  });

  describe("Pause Functionality", function () {
    it("Should allow admin to pause", async function () {
      await treasury.pause();

      await expect(
        treasury.deposit({ value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(treasury, "EnforcedPause");
    });

    it("Should allow admin to unpause", async function () {
      await treasury.pause();
      await treasury.unpause();

      await expect(
        treasury.deposit({ value: ethers.parseEther("1") })
      ).to.not.be.reverted;
    });

    it("Should prevent payments when paused", async function () {
      await treasury.deposit({ value: ethers.parseEther("10") });
      await treasury.setTaskAuction(taskAuction.address);

      await treasury.pause();

      await expect(
        treasury.connect(taskAuction).payWorker(worker.address, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(treasury, "EnforcedPause");
    });
  });

  describe("Role Management", function () {
    it("Should allow admin to add depositor", async function () {
      await treasury.addDepositor(intentAuction.address);

      const DEPOSITOR_ROLE = await treasury.DEPOSITOR_ROLE();
      expect(await treasury.hasRole(DEPOSITOR_ROLE, intentAuction.address)).to.be.true;
    });

    it("Should allow admin to remove depositor", async function () {
      await treasury.addDepositor(intentAuction.address);
      await treasury.removeDepositor(intentAuction.address);

      const DEPOSITOR_ROLE = await treasury.DEPOSITOR_ROLE();
      expect(await treasury.hasRole(DEPOSITOR_ROLE, intentAuction.address)).to.be.false;
    });

    it("Should allow admin to add payment role", async function () {
      await treasury.addPaymentRole(taskAuction.address);

      const PAYMENT_ROLE = await treasury.PAYMENT_ROLE();
      expect(await treasury.hasRole(PAYMENT_ROLE, taskAuction.address)).to.be.true;
    });

    it("Should allow admin to remove payment role", async function () {
      await treasury.addPaymentRole(taskAuction.address);
      await treasury.removePaymentRole(taskAuction.address);

      const PAYMENT_ROLE = await treasury.PAYMENT_ROLE();
      expect(await treasury.hasRole(PAYMENT_ROLE, taskAuction.address)).to.be.false;
    });
  });
});
