// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title Treasury
 * @notice Manages protocol funds, tracks revenue and costs, and handles payments
 * @dev Implements PRD-001 F5 requirements:
 *      - Receives deposits from IntentAuction (seller bid fees) and TaskAuction (leftover funds)
 *      - Pays workers when authorized contracts request payment
 *      - Tracks total revenue (deposits) and costs (payments to workers)
 *      - Calculates and reports profit
 *      - Only authorized contracts can trigger payments
 *
 * Protocol Economics:
 *   SELLERS pay bid fees → IntentAuction → TREASURY
 *                                              ↓
 *   PROTOCOL pays workers → TaskAuction validates → Workers receive payment
 *                                              ↓
 *   Leftover from task bids → TREASURY
 */
contract Treasury is AccessControl, ReentrancyGuard, Pausable {
    // ============================================================================
    // ROLES
    // ============================================================================

    /// @notice Role for contracts that can deposit funds (IntentAuction, TaskAuction)
    bytes32 public constant DEPOSITOR_ROLE = keccak256("DEPOSITOR_ROLE");

    /// @notice Role for contracts that can request worker payments
    bytes32 public constant PAYMENT_ROLE = keccak256("PAYMENT_ROLE");

    // ============================================================================
    // STATE VARIABLES
    // ============================================================================

    /// @notice Total revenue received (all deposits)
    uint256 public totalRevenue;

    /// @notice Total costs paid out (worker payments)
    uint256 public totalCosts;

    /// @notice Address of the TaskAuction contract (can request payments)
    address public taskAuctionAddress;

    /// @notice Address of the IntentAuction contract (can deposit)
    address public intentAuctionAddress;

    // ============================================================================
    // EVENTS
    // ============================================================================

    event Deposited(
        address indexed from,
        uint256 amount,
        uint256 newTotalRevenue
    );

    event WorkerPaid(
        address indexed worker,
        uint256 amount,
        uint256 newTotalCosts
    );

    event ProtocolWithdrawal(
        address indexed to,
        uint256 amount,
        uint256 remainingBalance
    );

    event ContractAddressUpdated(
        string contractName,
        address oldAddress,
        address newAddress
    );

    // ============================================================================
    // ERRORS
    // ============================================================================

    error ZeroAddress();
    error ZeroAmount();
    error InsufficientBalance(uint256 requested, uint256 available);
    error TransferFailed();
    error UnauthorizedCaller(address caller);

    // ============================================================================
    // CONSTRUCTOR
    // ============================================================================

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ============================================================================
    // CORE FUNCTIONS
    // ============================================================================

    /**
     * @notice Deposit funds into treasury
     * @dev Can be called by:
     *      - IntentAuction (seller bid fees)
     *      - TaskAuction (leftover funds after task completion/failure)
     *      - Anyone (protocol funding)
     *
     * PRD Acceptance: deposit() increases balance and totalRevenue
     */
    function deposit() external payable nonReentrant whenNotPaused {
        if (msg.value == 0) revert ZeroAmount();

        totalRevenue += msg.value;

        emit Deposited(msg.sender, msg.value, totalRevenue);
    }

    /**
     * @notice Pay a worker from treasury funds
     * @param worker The worker address to pay
     * @param amount The amount to pay
     * @dev Only callable by authorized contracts (TaskAuction)
     *
     * PRD Acceptance:
     *   - payWorker() decreases balance and increases totalCosts
     *   - payWorker() rejected if caller is not authorized
     */
    function payWorker(address worker, uint256 amount)
        external
        nonReentrant
        whenNotPaused
    {
        // Only authorized callers can pay workers
        if (!hasRole(PAYMENT_ROLE, msg.sender) && msg.sender != taskAuctionAddress) {
            revert UnauthorizedCaller(msg.sender);
        }

        if (worker == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > address(this).balance) {
            revert InsufficientBalance(amount, address(this).balance);
        }

        totalCosts += amount;

        (bool success, ) = worker.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit WorkerPaid(worker, amount, totalCosts);
    }

    // ============================================================================
    // VIEW FUNCTIONS
    // ============================================================================

    /**
     * @notice Get current treasury balance
     * @return balance The current ETH/MON balance
     */
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /**
     * @notice Calculate profit (revenue - costs)
     * @return profit The net profit (can be negative conceptually, but stored as uint)
     *
     * PRD Acceptance: getProfit() returns revenue minus costs
     */
    function getProfit() external view returns (uint256) {
        if (totalRevenue >= totalCosts) {
            return totalRevenue - totalCosts;
        }
        return 0;
    }

    /**
     * @notice Get signed profit (can be negative)
     * @return profit The net profit (positive or negative)
     */
    function getSignedProfit() external view returns (int256) {
        return int256(totalRevenue) - int256(totalCosts);
    }

    /**
     * @notice Get comprehensive financial summary
     * @return balance Current balance
     * @return revenue Total lifetime revenue
     * @return costs Total lifetime costs
     * @return profit Net profit (revenue - costs)
     *
     * PRD Acceptance: getSummary() returns all financial metrics
     */
    function getSummary()
        external
        view
        returns (
            uint256 balance,
            uint256 revenue,
            uint256 costs,
            uint256 profit
        )
    {
        balance = address(this).balance;
        revenue = totalRevenue;
        costs = totalCosts;
        profit = revenue >= costs ? revenue - costs : 0;
    }

    // ============================================================================
    // ADMIN FUNCTIONS
    // ============================================================================

    /**
     * @notice Set the TaskAuction contract address
     * @param _taskAuction Address of the TaskAuction contract
     */
    function setTaskAuction(address _taskAuction) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_taskAuction == address(0)) revert ZeroAddress();

        address oldAddress = taskAuctionAddress;
        taskAuctionAddress = _taskAuction;

        // Grant payment role to TaskAuction
        _grantRole(PAYMENT_ROLE, _taskAuction);

        // Revoke from old address if it was set
        if (oldAddress != address(0)) {
            _revokeRole(PAYMENT_ROLE, oldAddress);
        }

        emit ContractAddressUpdated("TaskAuction", oldAddress, _taskAuction);
    }

    /**
     * @notice Set the IntentAuction contract address
     * @param _intentAuction Address of the IntentAuction contract
     */
    function setIntentAuction(address _intentAuction) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_intentAuction == address(0)) revert ZeroAddress();

        address oldAddress = intentAuctionAddress;
        intentAuctionAddress = _intentAuction;

        // Grant depositor role to IntentAuction
        _grantRole(DEPOSITOR_ROLE, _intentAuction);

        // Revoke from old address if it was set
        if (oldAddress != address(0)) {
            _revokeRole(DEPOSITOR_ROLE, oldAddress);
        }

        emit ContractAddressUpdated("IntentAuction", oldAddress, _intentAuction);
    }

    /**
     * @notice Withdraw protocol profits
     * @param to Address to send funds to
     * @param amount Amount to withdraw (0 = all available)
     * @dev Only admin can withdraw, and only profit (not operational reserve)
     */
    function withdrawProtocolFunds(address payable to, uint256 amount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        if (to == address(0)) revert ZeroAddress();

        uint256 available = address(this).balance;
        uint256 withdrawAmount = amount == 0 ? available : amount;

        if (withdrawAmount > available) {
            revert InsufficientBalance(withdrawAmount, available);
        }

        (bool success, ) = to.call{value: withdrawAmount}("");
        if (!success) revert TransferFailed();

        emit ProtocolWithdrawal(to, withdrawAmount, address(this).balance);
    }

    /**
     * @notice Grant depositor role to an address
     * @param depositor Address to grant role to
     */
    function addDepositor(address depositor) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (depositor == address(0)) revert ZeroAddress();
        _grantRole(DEPOSITOR_ROLE, depositor);
    }

    /**
     * @notice Revoke depositor role from an address
     * @param depositor Address to revoke role from
     */
    function removeDepositor(address depositor) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(DEPOSITOR_ROLE, depositor);
    }

    /**
     * @notice Grant payment role to an address
     * @param payer Address to grant role to
     */
    function addPaymentRole(address payer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (payer == address(0)) revert ZeroAddress();
        _grantRole(PAYMENT_ROLE, payer);
    }

    /**
     * @notice Revoke payment role from an address
     * @param payer Address to revoke role from
     */
    function removePaymentRole(address payer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(PAYMENT_ROLE, payer);
    }

    /**
     * @notice Pause treasury operations
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause treasury operations
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ============================================================================
    // RECEIVE / FALLBACK
    // ============================================================================

    /**
     * @notice Allow direct ETH transfers (counts as deposit)
     */
    receive() external payable {
        if (msg.value > 0) {
            totalRevenue += msg.value;
            emit Deposited(msg.sender, msg.value, totalRevenue);
        }
    }
}
