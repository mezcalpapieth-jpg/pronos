// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITradingRouterFactory {
    function tradingRouter() external view returns (address);
}

interface ITradingRouterBinding {
    function factoryV1() external view returns (address);
    function factoryV2() external view returns (address);
    function collateral() external view returns (address);
    function tokenV1() external view returns (address);
    function tokenV2() external view returns (address);
}
