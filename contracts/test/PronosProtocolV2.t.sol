// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PronosTokenV2.sol";
import "../src/PronosAMMMulti.sol";
import "../src/MarketFactoryV2.sol";

contract MockUSDCV2 {
    string public name = "USD Coin";
    string public symbol = "USDC";
    uint8 public decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient balance");
        require(allowance[from][msg.sender] >= amount, "insufficient allowance");
        balanceOf[from] -= amount;
        allowance[from][msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract PronosProtocolV2Test is Test {
    MockUSDCV2 public usdc;
    PronosTokenV2 public token;
    MarketFactoryV2 public factory;

    address admin = address(0xAD);
    address treasury = address(0x111);
    address liqRes = address(0x222);
    address emerRes = address(0x333);
    address feeColl = address(0x444);
    address alice = address(0xA);
    address bob = address(0xB);

    uint256 constant ONE_USDC = 1e6;

    function setUp() public {
        vm.startPrank(admin);
        usdc = new MockUSDCV2();
        token = new PronosTokenV2();
        factory = new MarketFactoryV2(address(token), address(usdc), treasury, liqRes, emerRes);
        factory.setFeeCollector(feeColl);
        token.setMinter(address(factory), true);
        token.transferOwnership(address(factory));
        vm.stopPrank();

        usdc.mint(admin, 1_000_000 * ONE_USDC);
        usdc.mint(alice, 100_000 * ONE_USDC);
        usdc.mint(bob, 100_000 * ONE_USDC);
    }

    function _outcomes() internal pure returns (string[] memory outcomes) {
        outcomes = new string[](3);
        outcomes[0] = "Mexico";
        outcomes[1] = "Draw";
        outcomes[2] = "South Africa";
    }

    function _createThreeWayMarket(uint256 seed) internal returns (uint256 marketId, PronosAMMMulti pool) {
        vm.startPrank(admin);
        usdc.approve(address(factory), seed);
        marketId = factory.createMarket(
            "Who wins Mexico vs South Africa?",
            "deportes",
            block.timestamp + 30 days,
            "FIFA official results",
            _outcomes(),
            seed
        );
        vm.stopPrank();

        (address poolAddr,,,,,,) = factory.getMarket(marketId);
        pool = PronosAMMMulti(poolAddr);
    }

    function test_createMultiOutcomeMarket() public {
        (uint256 marketId, PronosAMMMulti pool) = _createThreeWayMarket(4 * ONE_USDC);

        assertEq(marketId, 0);
        assertEq(factory.marketCount(), 1);
        assertEq(pool.outcomeCount(), 3);
        assertEq(pool.reserves(0), 4 * ONE_USDC);
        assertEq(pool.reserves(1), 4 * ONE_USDC);
        assertEq(pool.reserves(2), 4 * ONE_USDC);
        assertEq(token.outcomeCounts(marketId), 3);
    }

    function test_initialPricesAreEqual() public {
        (, PronosAMMMulti pool) = _createThreeWayMarket(4 * ONE_USDC);
        uint256[] memory prices = pool.prices();

        assertEq(prices.length, 3);
        assertApproxEqAbs(prices[0], 333_333, 1);
        assertApproxEqAbs(prices[1], 333_333, 1);
        assertApproxEqAbs(prices[2], 333_333, 1);
    }

    function test_buyOutcomeMovesOnlyThatOutcomeUp() public {
        (uint256 marketId, PronosAMMMulti pool) = _createThreeWayMarket(4 * ONE_USDC);

        uint256 beforePrice = pool.price(0);

        vm.startPrank(alice);
        usdc.approve(address(pool), 5 * ONE_USDC);
        uint256 shares = pool.buy(0, 5 * ONE_USDC);
        vm.stopPrank();

        assertTrue(shares > 0);
        assertEq(token.balanceOf(alice, token.tokenId(marketId, 0)), shares);
        assertTrue(pool.price(0) > beforePrice);
        assertEq(usdc.balanceOf(feeColl), (5 * ONE_USDC * 200) / 10_000);
    }

    function test_sellOutcomeExitsBeforeResolution() public {
        (, PronosAMMMulti pool) = _createThreeWayMarket(10_000 * ONE_USDC);

        vm.startPrank(alice);
        usdc.approve(address(pool), 100 * ONE_USDC);
        uint256 shares = pool.buy(2, 100 * ONE_USDC);
        token.setApprovalForAll(address(pool), true);

        uint256 beforeBalance = usdc.balanceOf(alice);
        uint256 collateralOut = pool.sell(2, shares / 2);
        uint256 afterBalance = usdc.balanceOf(alice);
        vm.stopPrank();

        assertTrue(collateralOut > 0);
        assertEq(afterBalance - beforeBalance, collateralOut);
    }

    function test_resolveAndRedeemWinningOutcome() public {
        (uint256 marketId, PronosAMMMulti pool) = _createThreeWayMarket(10_000 * ONE_USDC);

        vm.startPrank(bob);
        usdc.approve(address(pool), 500 * ONE_USDC);
        uint256 bobShares = pool.buy(1, 500 * ONE_USDC);
        vm.stopPrank();

        vm.prank(admin);
        factory.resolveMarket(marketId, 1);

        uint256 beforeBalance = usdc.balanceOf(bob);
        vm.prank(bob);
        pool.redeem(bobShares);

        assertEq(usdc.balanceOf(bob) - beforeBalance, bobShares);
    }

    function test_revertsInvalidOutcome() public {
        (, PronosAMMMulti pool) = _createThreeWayMarket(4 * ONE_USDC);

        vm.startPrank(alice);
        usdc.approve(address(pool), 1 * ONE_USDC);
        vm.expectRevert("PronosAMMMulti: invalid outcome");
        pool.buy(3, 1 * ONE_USDC);
        vm.stopPrank();
    }
}
