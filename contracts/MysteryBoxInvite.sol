// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, eaddress, ebool, euint32, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @notice Confidential ERC-7984 pull and payout. The caller must already be an operator for pulls.
interface IInviteToken {
    function confidentialTransferFrom(address from, address to, euint64 amount) external returns (euint64 transferred);

    function confidentialTransfer(address to, euint64 amount) external returns (euint64 transferred);
}

/// @title Mystery Box Invite
/// @notice Two players join a link that stays open for 48 hours, each plays three shell hands for free,
///         then pays $1 to commit the score. The higher encrypted score wins $2. Scores are not publicly decryptable.
/// @dev `block.timestamp` is only the invite window. The ball and the score come from `FHE.randEuint32`.
contract MysteryBoxInvite is ZamaEthereumConfig {
    uint256 public constant STAKE = 1_000_000;
    uint256 public constant PRIZE = 2_000_000;
    uint256 public constant OPEN_WINDOW = 48 hours;
    uint8 public constant HANDS_PER_PLAYER = 3;
    uint32 public constant ROLL_MODULUS = 1024;
    uint32 public constant COMMON_BELOW = 614;
    uint32 public constant RARE_BELOW = 870;
    uint32 public constant EPIC_BELOW = 993;

    enum Phase {
        Empty,
        Open,
        Sealed,
        Refunded
    }

    struct Invite {
        address host;
        uint64 deadline;
        Phase phase;
        uint8 paymentKind;
        uint256 pot;
        address winner;
        bool claimed;
        eaddress encryptedWinner;
    }

    address public immutable cUsdt;
    address public immutable underlyingToken;
    /// @dev Local tests pass true so they can check the comparison. Sepolia deploys pass false.
    bool public immutable scoreDebug;
    uint256 public inviteCount;

    mapping(uint256 inviteId => Invite) private _invites;
    mapping(uint256 inviteId => address[2]) private _players;
    mapping(uint256 inviteId => euint32) private _score0;
    mapping(uint256 inviteId => euint32) private _score1;
    mapping(uint256 inviteId => euint32) private _ball0;
    mapping(uint256 inviteId => euint32) private _ball1;
    mapping(uint256 inviteId => uint8) private _hands0;
    mapping(uint256 inviteId => uint8) private _hands1;
    mapping(uint256 inviteId => bool) private _committed0;
    mapping(uint256 inviteId => bool) private _committed1;

    event InviteCreated(uint256 indexed inviteId, address indexed host, uint64 deadline);
    event PlayerJoined(uint256 indexed inviteId, address indexed player);
    event PlayerPlayed(uint256 indexed inviteId, address indexed player, uint8 cup);
    event PlayerCommitted(uint256 indexed inviteId, address indexed player);
    event InviteSealed(uint256 indexed inviteId, bytes32 winnerHandle);
    event PrizeClaimed(uint256 indexed inviteId, address indexed winner, uint256 prize);
    event InviteRefunded(uint256 indexed inviteId, address indexed host, uint256 stake);

    error ZeroToken();
    error BadPhase();
    error AlreadyJoined();
    error InviteFull();
    error InviteExpired();
    error InviteStillOpen();
    error PaymentKindMismatch();
    error FallbackPaymentFailed();
    error NoWinner();
    error AlreadyClaimed();
    error PayoutFailed();
    error BadCup();
    error AlreadyPlayed();
    error NotSeated();
    error NeedThreeHands();
    error AlreadyCommitted();

    constructor(address cUsdt_, address underlyingToken_, bool scoreDebug_) {
        if (cUsdt_ == address(0) || underlyingToken_ == address(0)) revert ZeroToken();
        cUsdt = cUsdt_;
        underlyingToken = underlyingToken_;
        scoreDebug = scoreDebug_;
    }

    function getInvite(uint256 inviteId)
        external
        view
        returns (
            address host,
            uint64 deadline,
            Phase phase,
            uint8 paymentKind,
            uint256 pot,
            address winner,
            bool claimed,
            bytes32 winnerHandle
        )
    {
        Invite memory invite = _invites[inviteId];
        return (
            invite.host,
            invite.deadline,
            invite.phase,
            invite.paymentKind,
            invite.pot,
            invite.winner,
            invite.claimed,
            eaddress.unwrap(invite.encryptedWinner)
        );
    }

    function getSeats(uint256 inviteId) external view returns (address player0, address player1) {
        return (_players[inviteId][0], _players[inviteId][1]);
    }

    function getHands(uint256 inviteId) external view returns (uint8 hostHands, uint8 guestHands) {
        return (_hands0[inviteId], _hands1[inviteId]);
    }

    function getCommitted(uint256 inviteId) external view returns (bool hostCommitted, bool guestCommitted) {
        return (_committed0[inviteId], _committed1[inviteId]);
    }

    /// @notice Score handle. Players cannot decrypt it unless the contract was deployed with score debug.
    function getScoreHandle(uint256 inviteId, uint8 slot) external view returns (euint32) {
        return slot == 0 ? _score0[inviteId] : _score1[inviteId];
    }

    /// @notice Ball index 0–2 for the last hand. Only the player who played that seat can decrypt it.
    function getBallHandle(uint256 inviteId, uint8 slot) external view returns (euint32) {
        return slot == 0 ? _ball0[inviteId] : _ball1[inviteId];
    }

    /// @notice Opening the table is free. The $1 stake is paid later, when the score is committed.
    function createInvite() external returns (uint256 inviteId) {
        inviteId = _open(msg.sender);
    }

    /// @notice Taking the open seat is free. The $1 stake is paid when the score is committed.
    function joinInvite(uint256 inviteId) external {
        Invite storage invite = _invites[inviteId];
        if (invite.phase != Phase.Open) revert BadPhase();
        if (block.timestamp > invite.deadline) revert InviteExpired();
        if (_players[inviteId][0] == msg.sender || _players[inviteId][1] == msg.sender) revert AlreadyJoined();
        if (_players[inviteId][1] != address(0)) revert InviteFull();
        _players[inviteId][1] = msg.sender;
        emit PlayerJoined(inviteId, msg.sender);
    }

    /// @notice Play one of three shell hands for free. The score accumulates on ciphertext.
    function play(uint256 inviteId, uint8 cup) external {
        if (cup > 2) revert BadCup();
        Invite storage invite = _invites[inviteId];
        if (invite.phase != Phase.Open) revert BadPhase();
        if (block.timestamp > invite.deadline) revert InviteExpired();
        uint8 slot = _seatOf(inviteId, msg.sender);
        uint8 hands = slot == 0 ? _hands0[inviteId] : _hands1[inviteId];
        if (hands >= HANDS_PER_PLAYER) revert AlreadyPlayed();
        if (slot == 0) _hands0[inviteId] = hands + 1;
        else _hands1[inviteId] = hands + 1;
        _hideScore(inviteId, slot, cup, msg.sender);
        emit PlayerPlayed(inviteId, msg.sender, cup);
    }

    /// @notice Pay the $1 stake and commit the score. The second commit resolves the round.
    function commit(uint256 inviteId, externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        euint64 transferred = _pullConfidential(encryptedAmount, inputProof);
        _commit(inviteId, msg.sender, 1, FHE.ge(transferred, FHE.asEuint64(uint64(STAKE))));
    }

    /// @notice Clear ERC-20 stake. The UI labels this control "Fallback Payment".
    function commitFallback(uint256 inviteId) external {
        _pullUnderlying(msg.sender, STAKE);
        _commit(inviteId, msg.sender, 2, FHE.asEbool(true));
    }

    /// @notice Returns the committed stake after the 48-hour link expires before the round resolves.
    function refundExpired(uint256 inviteId) external {
        Invite storage invite = _invites[inviteId];
        if (invite.phase != Phase.Open) revert BadPhase();
        if (block.timestamp <= invite.deadline) revert InviteStillOpen();
        address refundee;
        if (_committed0[inviteId]) refundee = _players[inviteId][0];
        else if (_committed1[inviteId]) refundee = _players[inviteId][1];
        invite.phase = Phase.Refunded;
        if (refundee != address(0)) {
            uint256 stake = invite.pot;
            invite.pot = 0;
            _payout(invite.paymentKind, refundee, stake);
            emit InviteRefunded(inviteId, refundee, stake);
        }
    }

    /// @notice Pay $2 after a public decryption proof of the winner address. Scores stay encrypted.
    function claim(uint256 inviteId, bytes calldata cleartexts, bytes calldata decryptionProof) external {
        Invite storage invite = _invites[inviteId];
        if (invite.phase != Phase.Sealed) revert BadPhase();
        if (invite.claimed) revert AlreadyClaimed();
        bytes32 handle = eaddress.unwrap(invite.encryptedWinner);
        if (handle == bytes32(0)) revert NoWinner();

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = handle;
        FHE.checkSignatures(handles, cleartexts, decryptionProof);

        address winner = abi.decode(cleartexts, (address));
        invite.winner = winner;
        invite.claimed = true;
        _payout(invite.paymentKind, winner, invite.pot);
        emit PrizeClaimed(inviteId, winner, invite.pot);
    }

    function _open(address host) internal returns (uint256 inviteId) {
        inviteId = ++inviteCount;
        Invite storage invite = _invites[inviteId];
        invite.host = host;
        invite.deadline = uint64(block.timestamp + OPEN_WINDOW);
        invite.phase = Phase.Open;
        _players[inviteId][0] = host;
        emit InviteCreated(inviteId, host, invite.deadline);
        emit PlayerJoined(inviteId, host);
    }

    function _commit(uint256 inviteId, address player, uint8 kind, ebool paid) internal {
        Invite storage invite = _invites[inviteId];
        if (invite.phase != Phase.Open) revert BadPhase();
        if (block.timestamp > invite.deadline) revert InviteExpired();
        uint8 slot = _seatOf(inviteId, player);
        if (slot == 0) {
            if (_hands0[inviteId] != HANDS_PER_PLAYER) revert NeedThreeHands();
            if (_committed0[inviteId]) revert AlreadyCommitted();
        } else {
            if (_hands1[inviteId] != HANDS_PER_PLAYER) revert NeedThreeHands();
            if (_committed1[inviteId]) revert AlreadyCommitted();
        }
        if (invite.paymentKind == 0) invite.paymentKind = kind;
        else if (invite.paymentKind != kind) revert PaymentKindMismatch();

        euint32 score = slot == 0 ? _score0[inviteId] : _score1[inviteId];
        euint32 masked = FHE.select(paid, score, FHE.asEuint32(0));
        if (slot == 0) _score0[inviteId] = masked;
        else _score1[inviteId] = masked;
        FHE.allowThis(masked);
        if (scoreDebug) FHE.allow(masked, player);

        if (slot == 0) _committed0[inviteId] = true;
        else _committed1[inviteId] = true;
        invite.pot += STAKE;

        emit PlayerCommitted(inviteId, player);

        if (_players[inviteId][1] != address(0) && _committed0[inviteId] && _committed1[inviteId]) {
            _seal(inviteId);
        }
    }

    function _seatOf(uint256 inviteId, address player) internal view returns (uint8) {
        if (_players[inviteId][0] == player) return 0;
        if (_players[inviteId][1] == player) return 1;
        revert NotSeated();
    }

    /// @notice A hit scores the hidden power. A miss scores 0. Hands accumulate on the seat's score.
    function _hideScore(uint256 inviteId, uint8 slot, uint8 cup, address player) internal {
        euint32 roll = FHE.randEuint32(ROLL_MODULUS);
        euint32 power = FHE.asEuint32(150);
        power = FHE.select(FHE.lt(roll, EPIC_BELOW), FHE.asEuint32(70), power);
        power = FHE.select(FHE.lt(roll, RARE_BELOW), FHE.asEuint32(30), power);
        power = FHE.select(FHE.lt(roll, COMMON_BELOW), FHE.asEuint32(10), power);

        euint32 ball = FHE.randEuint32(4);
        ball = FHE.select(FHE.eq(ball, FHE.asEuint32(3)), FHE.asEuint32(2), ball);
        ebool hit = FHE.eq(ball, FHE.asEuint32(cup));
        euint32 handScore = FHE.select(hit, power, FHE.asEuint32(0));

        if (slot == 0) {
            _score0[inviteId] = FHE.add(_score0[inviteId], handScore);
            _ball0[inviteId] = ball;
            FHE.allowThis(_score0[inviteId]);
        } else {
            _score1[inviteId] = FHE.add(_score1[inviteId], handScore);
            _ball1[inviteId] = ball;
            FHE.allowThis(_score1[inviteId]);
        }
        FHE.allowThis(ball);
        FHE.allow(ball, player);
        if (scoreDebug) FHE.allow(slot == 0 ? _score0[inviteId] : _score1[inviteId], player);
    }

    /// @notice Strict greater-than. An equal score keeps the earlier player. The score ciphertext is not published.
    function _seal(uint256 inviteId) internal {
        Invite storage invite = _invites[inviteId];
        euint32 hostScore = _score0[inviteId];
        euint32 guestScore = _score1[inviteId];
        ebool guestHigher = FHE.gt(guestScore, hostScore);
        eaddress leader = FHE.select(guestHigher, FHE.asEaddress(_players[inviteId][1]), FHE.asEaddress(_players[inviteId][0]));
        FHE.allowThis(leader);
        FHE.makePubliclyDecryptable(leader);
        invite.encryptedWinner = leader;
        invite.phase = Phase.Sealed;
        emit InviteSealed(inviteId, eaddress.unwrap(leader));
    }

    function _pullConfidential(externalEuint64 encryptedAmount, bytes calldata inputProof) internal returns (euint64 transferred) {
        euint64 quoted = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowThis(quoted);
        FHE.allowTransient(quoted, cUsdt);
        transferred = IInviteToken(cUsdt).confidentialTransferFrom(msg.sender, address(this), quoted);
    }

    function _pullUnderlying(address from, uint256 amount) internal {
        (bool success, bytes memory data) = underlyingToken.call(
            abi.encodeWithSelector(bytes4(keccak256("transferFrom(address,address,uint256)")), from, address(this), amount)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert FallbackPaymentFailed();
    }

    function _payout(uint8 kind, address to, uint256 amount) internal {
        if (amount == 0 || to == address(0)) revert PayoutFailed();
        if (kind == 2) {
            (bool success, bytes memory data) = underlyingToken.call(
                abi.encodeWithSelector(bytes4(keccak256("transfer(address,uint256)")), to, amount)
            );
            if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert PayoutFailed();
            return;
        }
        euint64 encrypted = FHE.asEuint64(uint64(amount));
        FHE.allowThis(encrypted);
        FHE.allowTransient(encrypted, cUsdt);
        IInviteToken(cUsdt).confidentialTransfer(to, encrypted);
    }
}
