// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AgentToken
 * @notice ERC-20 token with bonding curve mechanism for agent economies
 * @dev Implements a linear bonding curve where price increases with supply
 *
 * Each agent in the Inomy ecosystem has their own token that represents
 * ownership stake in the agent's earnings. The bonding curve ensures:
 * - Early supporters get lower prices
 * - Price increases with demand (linear growth)
 * - Built-in liquidity (can always buy/sell to curve)
 * - 75% of profits distributed to holders, 25% retained by agent
 *
 * Bonding Curve Formula (Linear):
 * - Price = BASE_PRICE + (PRICE_INCREMENT * supply)
 * - Buy Cost = integral from supply to supply+amount
 * - Sell Refund = integral from supply-amount to supply
 */
contract AgentToken is ERC20, Ownable, ReentrancyGuard {

    // ============ Constants ============

    /// @notice Base price for the first token (0.001 MON)
    uint256 public constant BASE_PRICE = 1e15; // 0.001 ether

    /// @notice Price increment per token (0.0001 MON per token)
    uint256 public constant PRICE_INCREMENT = 1e14; // 0.0001 ether

    /// @notice Minimum purchase amount (prevents dust attacks)
    uint256 public constant MIN_PURCHASE = 1e18; // 1 token

    /// @notice Protocol fee percentage (in basis points, 250 = 2.5%)
    uint256 public constant PROTOCOL_FEE_BPS = 250;

    /// @notice Basis points denominator
    uint256 public constant BPS_DENOMINATOR = 10000;

    /// @notice Minimum investor share (50% = 5000 bps)
    uint256 public constant MIN_INVESTOR_SHARE_BPS = 5000;

    /// @notice Maximum investor share (95% = 9500 bps)
    uint256 public constant MAX_INVESTOR_SHARE_BPS = 9500;

    /// @notice Default creator allocation (100 tokens = 100e18 wei)
    uint256 public constant DEFAULT_CREATOR_ALLOCATION = 100e18;

    /// @notice Maximum creator allocation (1000 tokens)
    uint256 public constant MAX_CREATOR_ALLOCATION = 1000e18;

    // ============ State Variables ============

    /// @notice Agent ID this token represents
    uint256 public immutable agentId;

    /// @notice Agent's wallet address (receives retained profits)
    address public agentWallet;

    /// @notice Protocol treasury address (receives protocol fees)
    address public protocolTreasury;

    /// @notice Investor share of profits (in basis points, e.g., 7500 = 75%)
    uint256 public investorShareBps;

    /// @notice Reserve balance held for bonding curve liquidity
    uint256 public reserveBalance;

    /// @notice Accumulated protocol fees
    uint256 public protocolFees;

    /// @notice Total profits distributed to holders
    uint256 public totalDistributed;

    /// @notice Profits per token (scaled by 1e18 for precision)
    uint256 public profitsPerTokenScaled;

    /// @notice Last profits per token claimed by each holder
    mapping(address => uint256) public lastProfitsPerToken;

    /// @notice Unclaimed profits for each holder
    mapping(address => uint256) public unclaimedProfits;

    // ============ Events ============

    event TokensPurchased(
        address indexed buyer,
        uint256 amount,
        uint256 cost,
        uint256 newSupply
    );

    event TokensSold(
        address indexed seller,
        uint256 amount,
        uint256 refund,
        uint256 newSupply
    );

    event ProfitsDeposited(
        uint256 totalAmount,
        uint256 investorShare,
        uint256 agentShare
    );

    event ProfitsClaimed(address indexed holder, uint256 amount);

    event AgentWalletUpdated(address indexed oldWallet, address indexed newWallet);

    event ProtocolFeesWithdrawn(address indexed recipient, uint256 amount);

    event InvestorShareUpdated(uint256 oldShare, uint256 newShare);

    event CreatorAllocationMinted(address indexed creator, uint256 amount);

    // ============ Errors ============

    error InsufficientPayment(uint256 required, uint256 provided);
    error InsufficientBalance(uint256 required, uint256 available);
    error InsufficientReserve(uint256 required, uint256 available);
    error BelowMinimumPurchase(uint256 amount, uint256 minimum);
    error ZeroAmount();
    error ZeroAddress();
    error TransferFailed();
    error InvalidInvestorShare(uint256 share, uint256 min, uint256 max);

    // ============ Constructor ============

    /**
     * @notice Creates a new agent token with optional creator allocation
     * @param _agentId The unique identifier for the agent
     * @param _name Token name (e.g., "Agent Alice Token")
     * @param _symbol Token symbol (e.g., "ALICE")
     * @param _agentWallet The agent's wallet address for retained profits
     * @param _protocolTreasury Address where protocol fees are sent
     * @param _investorShareBps Investor share of profits in basis points (e.g., 7500 = 75%)
     * @param _owner Initial owner (the agent's wallet)
     * @param _creator Address that receives the creator allocation (founder tokens)
     * @param _creatorAllocation Amount of tokens to mint to creator (0 for none, max 1000 tokens)
     */
    constructor(
        uint256 _agentId,
        string memory _name,
        string memory _symbol,
        address _agentWallet,
        address _protocolTreasury,
        uint256 _investorShareBps,
        address _owner,
        address _creator,
        uint256 _creatorAllocation
    ) ERC20(_name, _symbol) Ownable(_owner) {
        if (_agentWallet == address(0)) revert ZeroAddress();
        if (_protocolTreasury == address(0)) revert ZeroAddress();
        if (_investorShareBps < MIN_INVESTOR_SHARE_BPS || _investorShareBps > MAX_INVESTOR_SHARE_BPS) {
            revert InvalidInvestorShare(_investorShareBps, MIN_INVESTOR_SHARE_BPS, MAX_INVESTOR_SHARE_BPS);
        }
        if (_creatorAllocation > MAX_CREATOR_ALLOCATION) {
            revert BelowMinimumPurchase(_creatorAllocation, MAX_CREATOR_ALLOCATION);
        }

        agentId = _agentId;
        agentWallet = _agentWallet;
        protocolTreasury = _protocolTreasury;
        investorShareBps = _investorShareBps;

        // Mint creator allocation (founder tokens) - these are FREE
        // The bonding curve price will reflect this initial supply
        if (_creatorAllocation > 0 && _creator != address(0)) {
            _mint(_creator, _creatorAllocation);
            emit CreatorAllocationMinted(_creator, _creatorAllocation);
            // Note: reserveBalance stays at 0 since creator doesn't pay
            // This means the bonding curve starts at a higher price point
        }
    }

    // ============ Bonding Curve View Functions ============

    /**
     * @notice Get the current spot price for the next token
     * @return price Current price in wei
     */
    function getCurrentPrice() public view returns (uint256 price) {
        return BASE_PRICE + (PRICE_INCREMENT * totalSupply() / 1e18);
    }

    /**
     * @notice Calculate cost to buy tokens from the bonding curve
     * @dev Uses linear bonding curve: cost = integral of (BASE_PRICE + INCREMENT * s) ds
     *      = BASE_PRICE * amount + INCREMENT * (s1^2 - s0^2) / 2
     * @param amount Number of tokens to purchase (in wei, 18 decimals)
     * @return cost Amount of native token (MON) required
     */
    function calculatePurchaseCost(uint256 amount) public view returns (uint256 cost) {
        if (amount == 0) return 0;

        uint256 supply = totalSupply();
        uint256 supplyScaled = supply / 1e18;
        uint256 amountScaled = amount / 1e18;
        uint256 newSupplyScaled = supplyScaled + amountScaled;

        // Linear integral: BASE_PRICE * amount + INCREMENT * (new^2 - old^2) / 2
        uint256 baseCost = BASE_PRICE * amountScaled;
        uint256 incrementCost = PRICE_INCREMENT * (newSupplyScaled * newSupplyScaled - supplyScaled * supplyScaled) / 2;

        cost = baseCost + incrementCost;
    }

    /**
     * @notice Calculate refund for selling tokens back to the bonding curve
     * @dev Uses same formula as purchase but in reverse
     * @param amount Number of tokens to sell (in wei, 18 decimals)
     * @return refund Amount of native token (MON) to receive
     */
    function calculateSaleRefund(uint256 amount) public view returns (uint256 refund) {
        if (amount == 0) return 0;
        if (amount > totalSupply()) return reserveBalance;

        uint256 supply = totalSupply();
        uint256 supplyScaled = supply / 1e18;
        uint256 amountScaled = amount / 1e18;
        uint256 newSupplyScaled = supplyScaled - amountScaled;

        // Linear integral (reverse): BASE_PRICE * amount + INCREMENT * (old^2 - new^2) / 2
        uint256 baseCost = BASE_PRICE * amountScaled;
        uint256 incrementCost = PRICE_INCREMENT * (supplyScaled * supplyScaled - newSupplyScaled * newSupplyScaled) / 2;

        refund = baseCost + incrementCost;

        // Cap refund at reserve balance
        if (refund > reserveBalance) {
            refund = reserveBalance;
        }
    }

    /**
     * @notice Calculate how many tokens can be bought with a given amount of MON
     * @param paymentAmount Amount of MON to spend
     * @return tokenAmount Number of tokens that can be purchased
     */
    function calculateTokensForPayment(uint256 paymentAmount) public view returns (uint256 tokenAmount) {
        if (paymentAmount == 0) return 0;

        // Binary search for the amount of tokens
        uint256 low = 0;
        uint256 high = paymentAmount * 1e18 / BASE_PRICE; // Upper bound estimate

        while (low < high) {
            uint256 mid = (low + high + 1) / 2;
            uint256 cost = calculatePurchaseCost(mid * 1e18);
            if (cost <= paymentAmount) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }

        tokenAmount = low * 1e18;
    }

    // ============ Buy/Sell Functions ============

    /**
     * @notice Purchase tokens from the bonding curve
     * @param minTokens Minimum tokens to receive (slippage protection)
     */
    function buy(uint256 minTokens) external payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();

        // Calculate tokens for payment (minus protocol fee)
        uint256 fee = (msg.value * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        uint256 netPayment = msg.value - fee;

        uint256 tokenAmount = calculateTokensForPayment(netPayment);
        if (tokenAmount < MIN_PURCHASE) revert BelowMinimumPurchase(tokenAmount, MIN_PURCHASE);
        if (tokenAmount < minTokens) revert InsufficientPayment(minTokens, tokenAmount);

        // Update state before external calls
        uint256 actualCost = calculatePurchaseCost(tokenAmount);
        reserveBalance += actualCost;
        protocolFees += fee;

        // Update profit tracking for buyer
        _updateProfits(msg.sender);

        // Mint tokens to buyer
        _mint(msg.sender, tokenAmount);

        // Refund excess payment
        uint256 excess = netPayment - actualCost;
        if (excess > 0) {
            (bool success, ) = payable(msg.sender).call{value: excess}("");
            if (!success) revert TransferFailed();
        }

        emit TokensPurchased(msg.sender, tokenAmount, actualCost + fee, totalSupply());
    }

    /**
     * @notice Purchase exact amount of tokens
     * @param amount Exact number of tokens to buy (in wei)
     */
    function buyExact(uint256 amount) external payable nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (amount < MIN_PURCHASE) revert BelowMinimumPurchase(amount, MIN_PURCHASE);

        uint256 cost = calculatePurchaseCost(amount);
        uint256 fee = (cost * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        uint256 totalRequired = cost + fee;

        if (msg.value < totalRequired) revert InsufficientPayment(totalRequired, msg.value);

        // Update state
        reserveBalance += cost;
        protocolFees += fee;

        // Update profit tracking for buyer
        _updateProfits(msg.sender);

        // Mint tokens
        _mint(msg.sender, amount);

        // Refund excess
        uint256 excess = msg.value - totalRequired;
        if (excess > 0) {
            (bool success, ) = payable(msg.sender).call{value: excess}("");
            if (!success) revert TransferFailed();
        }

        emit TokensPurchased(msg.sender, amount, totalRequired, totalSupply());
    }

    /**
     * @notice Sell tokens back to the bonding curve
     * @param amount Number of tokens to sell (in wei)
     * @param minRefund Minimum refund to accept (slippage protection)
     */
    function sell(uint256 amount, uint256 minRefund) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (balanceOf(msg.sender) < amount) {
            revert InsufficientBalance(amount, balanceOf(msg.sender));
        }

        uint256 refund = calculateSaleRefund(amount);
        uint256 fee = (refund * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        uint256 netRefund = refund - fee;

        if (netRefund < minRefund) revert InsufficientPayment(minRefund, netRefund);
        if (refund > reserveBalance) revert InsufficientReserve(refund, reserveBalance);

        // Update profit tracking before burn
        _updateProfits(msg.sender);

        // Update state before external calls
        reserveBalance -= refund;
        protocolFees += fee;

        // Burn tokens
        _burn(msg.sender, amount);

        // Transfer refund
        (bool success, ) = payable(msg.sender).call{value: netRefund}("");
        if (!success) revert TransferFailed();

        emit TokensSold(msg.sender, amount, netRefund, totalSupply());
    }

    // ============ Profit Distribution ============

    /**
     * @notice Deposit profits to be distributed to token holders
     * @dev Split based on investorShareBps (e.g., 75% to holders, 25% to agent)
     */
    function depositProfits() external payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        if (totalSupply() == 0) {
            // No holders, all goes to agent
            (bool success, ) = payable(agentWallet).call{value: msg.value}("");
            if (!success) revert TransferFailed();
            return;
        }

        uint256 investorShare = (msg.value * investorShareBps) / BPS_DENOMINATOR;
        uint256 agentShare = msg.value - investorShare;

        // Update profits per token for holders
        profitsPerTokenScaled += (investorShare * 1e18) / totalSupply();
        totalDistributed += investorShare;

        // Send agent's share
        if (agentShare > 0) {
            (bool success, ) = payable(agentWallet).call{value: agentShare}("");
            if (!success) revert TransferFailed();
        }

        emit ProfitsDeposited(msg.value, investorShare, agentShare);
    }

    /**
     * @notice Claim accumulated profits
     */
    function claimProfits() external nonReentrant {
        _updateProfits(msg.sender);

        uint256 amount = unclaimedProfits[msg.sender];
        if (amount == 0) revert ZeroAmount();

        unclaimedProfits[msg.sender] = 0;

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        if (!success) revert TransferFailed();

        emit ProfitsClaimed(msg.sender, amount);
    }

    /**
     * @notice Get pending profits for a holder
     * @param holder Address to check
     * @return pending Unclaimed profit amount
     */
    function getPendingProfits(address holder) external view returns (uint256 pending) {
        uint256 balance = balanceOf(holder);
        uint256 newProfits = (balance * (profitsPerTokenScaled - lastProfitsPerToken[holder])) / 1e18;
        pending = unclaimedProfits[holder] + newProfits;
    }

    /**
     * @dev Internal function to update profit tracking before balance changes
     */
    function _updateProfits(address holder) internal {
        uint256 balance = balanceOf(holder);
        if (balance > 0) {
            uint256 newProfits = (balance * (profitsPerTokenScaled - lastProfitsPerToken[holder])) / 1e18;
            unclaimedProfits[holder] += newProfits;
        }
        lastProfitsPerToken[holder] = profitsPerTokenScaled;
    }

    // ============ ERC20 Overrides ============

    /**
     * @dev Update profit tracking on transfers
     */
    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0)) {
            _updateProfits(from);
        }
        if (to != address(0)) {
            _updateProfits(to);
        }
        super._update(from, to, amount);
    }

    // ============ Admin Functions ============

    /**
     * @notice Update the agent's wallet address
     * @param newWallet New wallet address
     */
    function setAgentWallet(address newWallet) external onlyOwner {
        if (newWallet == address(0)) revert ZeroAddress();
        address oldWallet = agentWallet;
        agentWallet = newWallet;
        emit AgentWalletUpdated(oldWallet, newWallet);
    }

    /**
     * @notice Withdraw accumulated protocol fees to protocol treasury
     * @dev Can be called by anyone - fees always go to protocolTreasury
     */
    function withdrawProtocolFees() external {
        uint256 amount = protocolFees;
        if (amount == 0) revert ZeroAmount();

        protocolFees = 0;

        (bool success, ) = payable(protocolTreasury).call{value: amount}("");
        if (!success) revert TransferFailed();

        emit ProtocolFeesWithdrawn(protocolTreasury, amount);
    }

    /**
     * @notice Update protocol treasury address
     * @param newTreasury New treasury address
     */
    function setProtocolTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        protocolTreasury = newTreasury;
    }

    /**
     * @notice Update investor share percentage
     * @dev Agent can adjust dividend rate to attract/retain investors
     * @param newShareBps New investor share in basis points (5000-9500)
     */
    function setInvestorShare(uint256 newShareBps) external onlyOwner {
        if (newShareBps < MIN_INVESTOR_SHARE_BPS || newShareBps > MAX_INVESTOR_SHARE_BPS) {
            revert InvalidInvestorShare(newShareBps, MIN_INVESTOR_SHARE_BPS, MAX_INVESTOR_SHARE_BPS);
        }
        uint256 oldShare = investorShareBps;
        investorShareBps = newShareBps;
        emit InvestorShareUpdated(oldShare, newShareBps);
    }

    // ============ View Functions ============

    /**
     * @notice Get token statistics
     * @return supply Current total supply
     * @return reserve Current reserve balance
     * @return price Current spot price
     * @return marketCap Estimated market cap (supply * price)
     */
    function getTokenStats() external view returns (
        uint256 supply,
        uint256 reserve,
        uint256 price,
        uint256 marketCap
    ) {
        supply = totalSupply();
        reserve = reserveBalance;
        price = getCurrentPrice();
        marketCap = (supply * price) / 1e18;
    }

    /**
     * @notice Check if contract can receive ETH
     */
    receive() external payable {
        // Accept ETH deposits (for profits)
    }
}
