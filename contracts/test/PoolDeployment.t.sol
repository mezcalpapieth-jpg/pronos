// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/MarketFactory.sol";
import "../src/MarketFactoryV2.sol";

contract PoolDeploymentTest is Test {
    function checkStore(address store, bytes memory expected) internal view {
        bytes memory stored = store.code;
        assertEq(stored, bytes.concat(hex"00", expected));
        assertLe(stored.length, 24_576, "creation code store exceeds EIP-170");
    }

    function test_binaryFactoryAndPoolCodeFitChainLimit() public {
        MarketFactory factory = new MarketFactory(address(1), address(2), address(3), address(4), address(5));
        assertLe(address(factory).code.length, 24_576, "factory exceeds EIP-170");
        checkStore(factory.poolCreationCode(), type(PronosAMM).creationCode);
        (bool ok, bytes memory result) = factory.poolCreationCode().call(hex"ffffffff");
        assertTrue(ok, "code store must be inert");
        assertEq(result.length, 0);
    }

    function test_multiFactoryAndPoolCodeFitChainLimit() public {
        MarketFactoryV2 factory = new MarketFactoryV2(address(1), address(2), address(3), address(4), address(5));
        assertLe(address(factory).code.length, 24_576, "factory exceeds EIP-170");
        checkStore(factory.poolCreationCode(), type(PronosAMMMulti).creationCode);
        (bool ok, bytes memory result) = factory.poolCreationCode().call(hex"ffffffff");
        assertTrue(ok, "code store must be inert");
        assertEq(result.length, 0);
    }
}
