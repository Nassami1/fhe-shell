// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, ebool, euint32, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @notice Confidential ERC-7984 pull used by buyBox. The caller must already be an operator.
interface IConfidentialToken {
    function confidentialTransferFrom(address from, address to, euint64 amount) external returns (euint64 transferred);
}

/// @title Provable Mystery Box
/// @notice Public odds, on-chain FHE draw, buyer-only prize. The fairness roll is publicly decryptable.
/// @dev Prize ids: 0 = no prize (confidential payment check failed), 1 = Common, 2 = Rare, 3 = Epic, 4 = Legendary.
contract MysteryBox is ZamaEthereumConfig {
    uint64 public constant BOX_PRICE = 1_000_000;
    uint256 public constant FALLBACK_PRICE = 1_000_000;
    uint32 public constant ROLL_MODULUS = 1024;
    uint32 public constant COMMON_BELOW = 614;
    uint32 public constant RARE_BELOW = 870;
    uint32 public constant EPIC_BELOW = 993;

    address public immutable cUsdt;
    address public immutable underlyingToken;

    mapping(address buyer => uint256 count) public boxCount;
    mapping(address buyer => mapping(uint256 boxId => euint32 prize)) private _prizes;
    mapping(address buyer => mapping(uint256 boxId => euint32 roll)) private _rolls;
    /// @dev 1 = confidential cUSDT, 2 = clear ERC-20 fallback.
    mapping(address buyer => mapping(uint256 boxId => uint8 kind)) public paymentKind;

    event BoxOpened(address indexed buyer, uint256 indexed boxId, bytes32 prizeHandle, bytes32 randHandle);

    error ZeroToken();
    error FallbackPaymentFailed();

    constructor(address cUsdt_, address underlyingToken_) {
        if (cUsdt_ == address(0) || underlyingToken_ == address(0)) revert ZeroToken();
        cUsdt = cUsdt_;
        underlyingToken = underlyingToken_;
    }

    /// @notice Published odds (percent) and the exact power-of-two buckets used on ciphertext.
    /// @dev FHE.randEuint32 requires a power-of-two bound, so the draw uses 1024 slots:
    ///      Common 614, Rare 256, Epic 123, Legendary 31. Those are the auditable odds.
    function getOdds()
        external
        pure
        returns (
            string[4] memory names,
            uint256[4] memory percent,
            uint256[4] memory bucketWeight,
            uint256 modulus
        )
    {
        names = ["Common", "Rare", "Epic", "Legendary"];
        percent = [uint256(60), 25, 12, 3];
        bucketWeight = [uint256(614), 256, 123, 31];
        modulus = ROLL_MODULUS;
    }

    /// @notice Encrypted prize handle for a buyer's box. Only the buyer can user-decrypt it.
    function getBox(address buyer, uint256 boxId) external view returns (euint32) {
        return _prizes[buyer][boxId];
    }

    /// @notice Publicly decryptable fairness roll in [0, 1024).
    function getRoll(address buyer, uint256 boxId) external view returns (euint32) {
        return _rolls[buyer][boxId];
    }

    /// @notice Buy with confidential cUSDT. The encrypted amount is checked on ciphertext.
    /// @dev Encrypt BOX_PRICE for this contract. Approve this contract as a cUSDT operator first.
    function buyBox(externalEuint64 encryptedAmount, bytes calldata inputProof) external returns (uint256 boxId) {
        euint64 quoted = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowThis(quoted);
        FHE.allowTransient(quoted, cUsdt);

        euint64 transferred = IConfidentialToken(cUsdt).confidentialTransferFrom(msg.sender, address(this), quoted);
        ebool paid = FHE.ge(transferred, BOX_PRICE);
        boxId = _draw(msg.sender, paid, 1);
    }

    /// @notice Clear ERC-20 payment. The UI labels this control "Fallback Payment".
    function buyBoxFallback() external returns (uint256 boxId) {
        _pullUnderlying(msg.sender, FALLBACK_PRICE);
        boxId = _draw(msg.sender, FHE.asEbool(true), 2);
    }

    function _pullUnderlying(address from, uint256 amount) internal {
        (bool success, bytes memory data) = underlyingToken.call(
            abi.encodeWithSelector(bytes4(keccak256("transferFrom(address,address,uint256)")), from, address(this), amount)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert FallbackPaymentFailed();
    }

    /// @dev Maps the encrypted roll to a prize id with FHE.select only. No cleartext branch on the outcome.
    function _draw(address buyer, ebool paid, uint8 kind) internal returns (uint256 boxId) {
        euint32 roll = FHE.randEuint32(ROLL_MODULUS);

        euint32 prize = FHE.asEuint32(4);
        prize = FHE.select(FHE.lt(roll, EPIC_BELOW), FHE.asEuint32(3), prize);
        prize = FHE.select(FHE.lt(roll, RARE_BELOW), FHE.asEuint32(2), prize);
        prize = FHE.select(FHE.lt(roll, COMMON_BELOW), FHE.asEuint32(1), prize);
        prize = FHE.select(paid, prize, FHE.asEuint32(0));

        boxId = ++boxCount[buyer];
        _prizes[buyer][boxId] = prize;
        _rolls[buyer][boxId] = roll;
        paymentKind[buyer][boxId] = kind;

        FHE.allowThis(prize);
        FHE.allow(prize, buyer);
        FHE.allowThis(roll);
        FHE.makePubliclyDecryptable(roll);

        emit BoxOpened(buyer, boxId, euint32.unwrap(prize), euint32.unwrap(roll));
    }
}
