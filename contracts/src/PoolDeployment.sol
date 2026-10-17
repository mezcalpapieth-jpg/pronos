// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Immutable bytecode storage. The leading STOP makes calls inert.
contract PoolCreationCode {
    constructor(bytes memory creationCode) {
        bytes memory runtime = bytes.concat(hex"00", creationCode);
        assembly ("memory-safe") {
            return(add(runtime, 0x20), mload(runtime))
        }
    }
}

/// @dev Keeps pool initcode out of the factory's EIP-170-limited runtime.
/// CREATE still executes in the factory, preserving the pool's factory role.
library PoolDeployment {
    function deploy(address codeStore, bytes memory constructorArgs) internal returns (address pool) {
        uint256 size = codeStore.code.length;
        require(size > 1, "PoolDeployment: missing code");
        bytes memory creationCode = new bytes(size - 1);
        assembly ("memory-safe") {
            extcodecopy(codeStore, add(creationCode, 0x20), 1, sub(size, 1))
        }
        bytes memory initcode = bytes.concat(creationCode, constructorArgs);
        assembly ("memory-safe") {
            pool := create(0, add(initcode, 0x20), mload(initcode))
            if iszero(pool) {
                let failure := mload(0x40)
                returndatacopy(failure, 0, returndatasize())
                revert(failure, returndatasize())
            }
        }
    }
}
