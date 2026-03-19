// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PronoBet
 * @notice Parimutuel betting contract for Pronos — México vs Sudáfrica, Mundial 2026
 * @dev Bettors deposit USDC on one of 3 outcomes. Winners split the entire pool
 *      proportionally. Admin resolves the market after the match.
 *
 * Outcome encoding:
 *   1 = México gana
 *   2 = Empate
 *   3 = Sudáfrica gana
 */

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract PronoBet {
    // ─── State ────────────────────────────────────────────────────────────────

    address public immutable owner;
    IERC20  public immutable usdc;

    /// @dev 1 = México, 2 = Empate, 3 = Sudáfrica
    uint8  public result;
    bool   public resolved;
    bool   public bettingOpen;

    /// @notice Protocol fee in basis points (200 = 2%)
    uint256 public constant FEE_BPS = 200;

    /// @notice Minimum bet: 1 USDC (6 decimals)
    uint256 public constant MIN_BET = 1e6;

    struct Bet {
        uint8   outcome;   // 1, 2 or 3
        uint256 amount;    // in USDC (6 decimals)
        bool    claimed;
    }

    /// @notice All bets per user
    mapping(address => Bet[]) public bets;

    /// @notice Total USDC wagered on each outcome
    mapping(uint8 => uint256) public outcomePool;

    /// @notice Total USDC in contract
    uint256 public totalPool;

    // ─── Events ───────────────────────────────────────────────────────────────

    event BetPlaced(address indexed bettor, uint8 outcome, uint256 amount);
    event BettingClosed();
    event MarketResolved(uint8 result);
    event WinningsClaimed(address indexed bettor, uint256 payout);
    event EmergencyWithdraw(address indexed to, uint256 amount);

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "PronoBet: not owner");
        _;
    }

    modifier validOutcome(uint8 _outcome) {
        require(_outcome >= 1 && _outcome <= 3, "PronoBet: invalid outcome (use 1, 2 or 3)");
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    /**
     * @param _usdc    USDC token address on Base Sepolia:
     *                 0x036CbD53842c5426634e7929541eC2318f3dCF7e
     * @param _owner   Admin wallet (the one that will call resolve())
     */
    constructor(address _usdc, address _owner) {
        require(_usdc  != address(0), "PronoBet: zero usdc");
        require(_owner != address(0), "PronoBet: zero owner");
        usdc        = IERC20(_usdc);
        owner       = _owner;
        bettingOpen = true;
    }

    // ─── User functions ───────────────────────────────────────────────────────

    /**
     * @notice Place a bet on an outcome.
     * @param _outcome  1 = México gana | 2 = Empate | 3 = Sudáfrica gana
     * @param _amount   USDC amount (6 decimals). Minimum 1 USDC.
     *
     * Caller must approve this contract for at least `_amount` USDC first.
     */
    function placeBet(uint8 _outcome, uint256 _amount)
        external
        validOutcome(_outcome)
    {
        require(bettingOpen,  "PronoBet: betting is closed");
        require(!resolved,    "PronoBet: market already resolved");
        require(_amount >= MIN_BET, "PronoBet: minimum bet is 1 USDC");

        bool ok = usdc.transferFrom(msg.sender, address(this), _amount);
        require(ok, "PronoBet: USDC transfer failed");

        bets[msg.sender].push(Bet({
            outcome: _outcome,
            amount:  _amount,
            claimed: false
        }));

        outcomePool[_outcome] += _amount;
        totalPool             += _amount;

        emit BetPlaced(msg.sender, _outcome, _amount);
    }

    /**
     * @notice Claim winnings after the market has been resolved.
     *         Any unclaimed winning bets are paid out in one call.
     */
    function claimWinnings() external {
        require(resolved, "PronoBet: not resolved yet");

        uint256 winningPool = outcomePool[result];
        require(winningPool > 0, "PronoBet: no winning bets");

        // Net pool after 2% protocol fee
        uint256 netPool = totalPool - (totalPool * FEE_BPS / 10_000);

        uint256 payout = 0;
        Bet[] storage userBets = bets[msg.sender];

        for (uint256 i = 0; i < userBets.length; i++) {
            if (!userBets[i].claimed && userBets[i].outcome == result) {
                // payout = (userBet / winningPool) * netPool
                payout += (userBets[i].amount * netPool) / winningPool;
                userBets[i].claimed = true;
            }
        }

        require(payout > 0, "PronoBet: nothing to claim");

        bool ok = usdc.transfer(msg.sender, payout);
        require(ok, "PronoBet: USDC transfer failed");

        emit WinningsClaimed(msg.sender, payout);
    }

    // ─── Admin functions ──────────────────────────────────────────────────────

    /**
     * @notice Close betting before the match kicks off.
     *         Call this ~15 minutes before kickoff.
     */
    function closeBetting() external onlyOwner {
        require(bettingOpen, "PronoBet: already closed");
        bettingOpen = false;
        emit BettingClosed();
    }

    /**
     * @notice Resolve the market with the final outcome.
     * @param _result  1 = México gana | 2 = Empate | 3 = Sudáfrica gana
     *
     * This is permanent and cannot be changed once set.
     */
    function resolve(uint8 _result)
        external
        onlyOwner
        validOutcome(_result)
    {
        require(!resolved, "PronoBet: already resolved");
        resolved    = true;
        bettingOpen = false;
        result      = _result;
        emit MarketResolved(_result);
    }

    /**
     * @notice Withdraw the 2% protocol fee (only after resolution).
     *         Transfers the remaining USDC balance that exceeds user payouts
     *         to the owner. Should only be called after all users have claimed.
     */
    function collectFee() external onlyOwner {
        require(resolved, "PronoBet: not resolved");
        uint256 fee = totalPool * FEE_BPS / 10_000;
        uint256 bal = usdc.balanceOf(address(this));
        uint256 send = bal < fee ? bal : fee;
        require(send > 0, "PronoBet: no fee");
        usdc.transfer(owner, send);
    }

    /**
     * @notice Emergency: if market is cancelled (e.g. match never happens),
     *         admin can refund all users manually and then withdraw.
     *         NOT for use after resolution.
     */
    function emergencyWithdraw() external onlyOwner {
        require(!resolved, "PronoBet: market is resolved — use collectFee()");
        bettingOpen = false;
        uint256 bal = usdc.balanceOf(address(this));
        usdc.transfer(owner, bal);
        emit EmergencyWithdraw(owner, bal);
    }

    // ─── View functions ───────────────────────────────────────────────────────

    /**
     * @notice Returns current implied odds for each outcome in basis points.
     *         e.g. 6700 = 67%, implying ~1.49x payout.
     *         Returns (0, 0, 0) if no bets yet.
     */
    function getOdds()
        external
        view
        returns (uint256 mexicoPct, uint256 drawPct, uint256 saPct)
    {
        if (totalPool == 0) return (3333, 3333, 3334);
        mexicoPct = (outcomePool[1] * 10_000) / totalPool;
        drawPct   = (outcomePool[2] * 10_000) / totalPool;
        saPct     = (outcomePool[3] * 10_000) / totalPool;
    }

    /**
     * @notice Returns all bets for a given user.
     */
    function getUserBets(address user)
        external
        view
        returns (Bet[] memory)
    {
        return bets[user];
    }

    /**
     * @notice Returns the estimated payout for a bet of `_amount` on `_outcome`
     *         based on current pool sizes (before resolution).
     *         This is indicative — final payout depends on total bets at close.
     */
    function estimatePayout(uint8 _outcome, uint256 _amount)
        external
        view
        validOutcome(_outcome)
        returns (uint256)
    {
        uint256 newOutcomePool = outcomePool[_outcome] + _amount;
        uint256 newTotal       = totalPool + _amount;
        uint256 netPool        = newTotal - (newTotal * FEE_BPS / 10_000);
        return (_amount * netPool) / newOutcomePool;
    }

    /**
     * @notice Returns full market state in one call (for frontend).
     */
    function getMarketState()
        external
        view
        returns (
            bool   _bettingOpen,
            bool   _resolved,
            uint8  _result,
            uint256 _totalPool,
            uint256 _mexicoPool,
            uint256 _drawPool,
            uint256 _saPool
        )
    {
        return (
            bettingOpen,
            resolved,
            result,
            totalPool,
            outcomePool[1],
            outcomePool[2],
            outcomePool[3]
        );
    }
}
