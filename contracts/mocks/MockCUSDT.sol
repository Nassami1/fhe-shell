// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {euint64} from "@fhevm/solidity/lib/FHE.sol";

/// @notice Returns the ciphertext unchanged so MysteryBox can run the homomorphic price check.
contract MockCUSDT {
    function confidentialTransferFrom(address, address, euint64 amount) external pure returns (euint64) {
        return amount;
    }
}
