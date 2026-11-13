// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, eaddress, ebool, euint32, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @notice Confidential ERC-7984 pull and payout. The caller must already be an operator for pulls.
interface IShowdownToken {
    function confidentialTransferFrom(address from, address to, euint64 amount) external returns (euint64 transferred);

    function confidentialTransfer(address to, euint64 amount) external returns (euint64 transferred);
}

/// @title Mystery Box Showdown
/// @notice 2–5 players buy a box, decrypt only their own power, then challenge or fold.
///         The highest remaining power wins on ciphertext. The roll handle is publicly decryptable.
/// @dev Powers: Common 10, Rare 30, Epic 70, Legendary 150. A failed confidential payment stores power 0.
contract MysteryBoxShowdown is ZamaEthereumConfig {
    uint64 public constant ENTRY_FEE = 1_000_000;
    uint64 public constant CHALLENGE_STAKE = 1_000_000;
    uint256 public constant ENTRY_FEE_CLEAR = 1_000_000;
    uint256 public constant CHALLENGE_STAKE_CLEAR = 1_000_000;
    uint8 public constant MIN_PLAYERS = 2;
    uint8 public constant MAX_PLAYERS = 5;
    uint32 public constant ROLL_MODULUS = 1024;
    uint32 public constant COMMON_BELOW = 614;
    uint32 public constant RARE_BELOW = 870;
    uint32 public constant EPIC_BELOW = 993;

    enum Phase {
        Empty,
        Open,
        Challenge,
        Resolved
    }

    struct Round {
        address host;
        Phase phase;
        uint8 paymentKind;
        uint256 pot;
        address winner;
        bool claimed;
        eaddress encryptedWinner;
    }

    address public immutable cUsdt;
    address public immutable underlyingToken;
    uint256 public roundCount;

    mapping(uint256 roundId => Round) private _rounds;
    mapping(uint256 roundId => address[]) private _players;
    mapping(uint256 roundId => mapping(address player => bool)) public joined;
    mapping(uint256 roundId => mapping(address player => euint32)) private _power;
    mapping(uint256 roundId => mapping(address player => euint32)) private _roll;
    /// @dev 0 = waiting, 1 = challenge, 2 = fold.
    mapping(uint256 roundId => mapping(address player => uint8)) public decision;

    event RoundCreated(uint256 indexed roundId, address indexed host);
    event PlayerJoined(uint256 indexed roundId, address indexed player, bytes32 powerHandle, bytes32 randHandle);
    event ChallengePhaseStarted(uint256 indexed roundId, uint256 playerCount);
    event PlayerChallenged(uint256 indexed roundId, address indexed player);
    event PlayerFolded(uint256 indexed roundId, address indexed player);
    event RoundResolved(uint256 indexed roundId, bytes32 winnerHandle, bytes32 winningPowerHandle);
    event PotClaimed(uint256 indexed roundId, address indexed winner, uint256 pot);

    error ZeroToken();
    error BadPhase();
    error AlreadyJoined();
    error RoundFull();
    error NotSeated();
    error AlreadyDecided();
    error NeedTwoPlayers();
    error WaitingOnPlayers();
    error PaymentKindMismatch();
    error FallbackPaymentFailed();
    error NoWinner();
    error AlreadyClaimed();
    error PayoutFailed();

    constructor(address cUsdt_, address underlyingToken_) {
        if (cUsdt_ == address(0) || underlyingToken_ == address(0)) revert ZeroToken();
        cUsdt = cUsdt_;
        underlyingToken = underlyingToken_;
    }

    /// @notice Published odds and the power each bucket awards. Buckets sum to 1024.
    function getOdds()
        external
        pure
        returns (
            string[4] memory names,
            uint256[4] memory percent,
            uint256[4] memory power,
            uint256[4] memory bucketWeight,
            uint256 modulus
        )
    {
        names = ["Common", "Rare", "Epic", "Legendary"];
        percent = [uint256(60), 25, 12, 3];
        power = [uint256(10), 30, 70, 150];
        bucketWeight = [uint256(614), 256, 123, 31];
        modulus = ROLL_MODULUS;
    }

    function getRound(uint256 roundId)
        external
        view
        returns (address host, Phase phase, uint8 paymentKind, uint256 pot, uint256 playerCount, address winner, bool claimed)
    {
        Round storage round = _rounds[roundId];
        return (round.host, round.phase, round.paymentKind, round.pot, _players[roundId].length, round.winner, round.claimed);
    }

    function getPlayers(uint256 roundId) external view returns (address[] memory) {
        return _players[roundId];
    }

    /// @notice Encrypted power handle. Only that player can user-decrypt it.
    function getPlayerBox(address player, uint256 roundId) external view returns (euint32) {
        return _power[roundId][player];
    }

    /// @notice Publicly decryptable fairness roll in [0, 1024).
    function getRoll(address player, uint256 roundId) external view returns (euint32) {
        return _roll[roundId][player];
    }

    function getWinnerHandle(uint256 roundId) external view returns (eaddress) {
        return _rounds[roundId].encryptedWinner;
    }

    function createRound() external returns (uint256 roundId) {
        roundId = ++roundCount;
        _rounds[roundId].host = msg.sender;
        _rounds[roundId].phase = Phase.Open;
        emit RoundCreated(roundId, msg.sender);
    }

    function joinRound(uint256 roundId, externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        euint64 quoted = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowThis(quoted);
        FHE.allowTransient(quoted, cUsdt);
        euint64 transferred = IShowdownToken(cUsdt).confidentialTransferFrom(msg.sender, address(this), quoted);
        _seat(roundId, msg.sender, 1, ENTRY_FEE_CLEAR, FHE.ge(transferred, ENTRY_FEE));
    }

    /// @notice Clear ERC-20 entry. The UI labels this control "Fallback Payment".
    function joinRoundFallback(uint256 roundId) external {
        _pullUnderlying(msg.sender, ENTRY_FEE_CLEAR);
        _seat(roundId, msg.sender, 2, ENTRY_FEE_CLEAR, FHE.asEbool(true));
    }

    function beginChallenge(uint256 roundId) external {
        Round storage round = _rounds[roundId];
        if (round.phase != Phase.Open) revert BadPhase();
        if (_players[roundId].length < MIN_PLAYERS) revert NeedTwoPlayers();
        round.phase = Phase.Challenge;
        emit ChallengePhaseStarted(roundId, _players[roundId].length);
    }

    function challenge(uint256 roundId, externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        Round storage round = _rounds[roundId];
        if (round.phase != Phase.Challenge) revert BadPhase();
        if (round.paymentKind != 1) revert PaymentKindMismatch();
        _requireUndecided(roundId, msg.sender);
        euint64 quoted = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowThis(quoted);
        FHE.allowTransient(quoted, cUsdt);
        euint64 transferred = IShowdownToken(cUsdt).confidentialTransferFrom(msg.sender, address(this), quoted);
        ebool paid = FHE.ge(transferred, CHALLENGE_STAKE);
        _power[roundId][msg.sender] = FHE.select(paid, _power[roundId][msg.sender], FHE.asEuint32(0));
        FHE.allowThis(_power[roundId][msg.sender]);
        FHE.allow(_power[roundId][msg.sender], msg.sender);
        decision[roundId][msg.sender] = 1;
        round.pot += CHALLENGE_STAKE_CLEAR;
        emit PlayerChallenged(roundId, msg.sender);
    }

    /// @notice Clear ERC-20 challenge stake. The UI labels this control "Fallback Payment".
    function challengeFallback(uint256 roundId) external {
        Round storage round = _rounds[roundId];
        if (round.phase != Phase.Challenge) revert BadPhase();
        if (round.paymentKind != 2) revert PaymentKindMismatch();
        _requireUndecided(roundId, msg.sender);
        _pullUnderlying(msg.sender, CHALLENGE_STAKE_CLEAR);
        decision[roundId][msg.sender] = 1;
        round.pot += CHALLENGE_STAKE_CLEAR;
        emit PlayerChallenged(roundId, msg.sender);
    }

    function fold(uint256 roundId) external {
        if (_rounds[roundId].phase != Phase.Challenge) revert BadPhase();
        _requireUndecided(roundId, msg.sender);
        decision[roundId][msg.sender] = 2;
        emit PlayerFolded(roundId, msg.sender);
    }

    /// @notice Compares the encrypted powers of players who challenged. Does not reveal those powers.
    function resolve(uint256 roundId) external {
        Round storage round = _rounds[roundId];
        if (round.phase != Phase.Challenge) revert BadPhase();
        address[] storage players = _players[roundId];
        uint256 challengers = 0;
        for (uint256 i = 0; i < players.length; ++i) {
            uint8 choice = decision[roundId][players[i]];
            if (choice == 0) revert WaitingOnPlayers();
            if (choice == 1) ++challengers;
        }

        euint32 best = FHE.asEuint32(0);
        eaddress leader = FHE.asEaddress(address(0));
        if (challengers > 0) {
            for (uint256 i = 0; i < players.length; ++i) {
                if (decision[roundId][players[i]] != 1) continue;
                euint32 power = _power[roundId][players[i]];
                ebool higher = FHE.gt(power, best);
                best = FHE.select(higher, power, best);
                leader = FHE.select(higher, FHE.asEaddress(players[i]), leader);
            }
            FHE.allowThis(leader);
            FHE.makePubliclyDecryptable(leader);
            FHE.allowThis(best);
            round.encryptedWinner = leader;
        }

        round.phase = Phase.Resolved;
        emit RoundResolved(roundId, eaddress.unwrap(leader), euint32.unwrap(best));
    }

    /// @notice Pay the pot after a public decryption proof of the winner handle.
    function claim(uint256 roundId, bytes calldata cleartexts, bytes calldata decryptionProof) external {
        Round storage round = _rounds[roundId];
        if (round.phase != Phase.Resolved) revert BadPhase();
        if (round.claimed) revert AlreadyClaimed();
        bytes32 handle = eaddress.unwrap(round.encryptedWinner);
        if (handle == bytes32(0)) revert NoWinner();

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = handle;
        FHE.checkSignatures(handles, cleartexts, decryptionProof);

        address winner = abi.decode(cleartexts, (address));
        round.winner = winner;
        round.claimed = true;
        _payout(round.paymentKind, winner, round.pot);
        emit PotClaimed(roundId, winner, round.pot);
    }

    function _seat(uint256 roundId, address player, uint8 kind, uint256 fee, ebool paid) internal {
        Round storage round = _rounds[roundId];
        if (round.phase != Phase.Open) revert BadPhase();
        if (joined[roundId][player]) revert AlreadyJoined();
        if (_players[roundId].length >= MAX_PLAYERS) revert RoundFull();
        if (round.paymentKind == 0) round.paymentKind = kind;
        else if (round.paymentKind != kind) revert PaymentKindMismatch();

        joined[roundId][player] = true;
        _players[roundId].push(player);
        round.pot += fee;
        _assignPower(roundId, player, paid);
    }

    function _assignPower(uint256 roundId, address player, ebool paid) internal {
        euint32 roll = FHE.randEuint32(ROLL_MODULUS);
        euint32 score = FHE.asEuint32(150);
        score = FHE.select(FHE.lt(roll, EPIC_BELOW), FHE.asEuint32(70), score);
        score = FHE.select(FHE.lt(roll, RARE_BELOW), FHE.asEuint32(30), score);
        score = FHE.select(FHE.lt(roll, COMMON_BELOW), FHE.asEuint32(10), score);
        score = FHE.select(paid, score, FHE.asEuint32(0));

        _power[roundId][player] = score;
        _roll[roundId][player] = roll;
        FHE.allowThis(score);
        FHE.allow(score, player);
        FHE.allowThis(roll);
        FHE.makePubliclyDecryptable(roll);
        emit PlayerJoined(roundId, player, euint32.unwrap(score), euint32.unwrap(roll));
    }

    function _requireUndecided(uint256 roundId, address player) internal view {
        if (!joined[roundId][player]) revert NotSeated();
        if (decision[roundId][player] != 0) revert AlreadyDecided();
    }

    function _pullUnderlying(address from, uint256 amount) internal {
        (bool success, bytes memory data) = underlyingToken.call(
            abi.encodeWithSelector(bytes4(keccak256("transferFrom(address,address,uint256)")), from, address(this), amount)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert FallbackPaymentFailed();
    }

    function _payout(uint8 kind, address winner, uint256 pot) internal {
        if (pot == 0 || winner == address(0)) revert PayoutFailed();
        if (kind == 2) {
            (bool success, bytes memory data) = underlyingToken.call(
                abi.encodeWithSelector(bytes4(keccak256("transfer(address,uint256)")), winner, pot)
            );
            if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert PayoutFailed();
            return;
        }
        euint64 amount = FHE.asEuint64(uint64(pot));
        FHE.allowThis(amount);
        FHE.allowTransient(amount, cUsdt);
        IShowdownToken(cUsdt).confidentialTransfer(winner, amount);
    }
}
