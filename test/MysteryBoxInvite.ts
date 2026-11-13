import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { MockCUSDT, MockERC20, MysteryBoxInvite } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

const STAKE = 1_000_000n;
const HANDS = 3;
const POWERS = [0n, 10n, 30n, 70n, 150n];
const validScores = new Set<bigint>();
for (const a of POWERS) for (const b of POWERS) for (const c of POWERS) validScores.add(a + b + c);

async function deployFixture(scoreDebug: boolean) {
  const erc = await ethers.deployContract("MockERC20");
  const cusdt = await ethers.deployContract("MockCUSDT");
  const invite = await ethers.deployContract("MysteryBoxInvite", [
    await cusdt.getAddress(),
    await erc.getAddress(),
    scoreDebug,
  ]);
  return { invite, erc, cusdt, address: await invite.getAddress() };
}

describe("MysteryBoxInvite", function () {
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let invite: MysteryBoxInvite;
  let erc: MockERC20;
  let address: string;

  before(async function () {
    const signers = await ethers.getSigners();
    alice = signers[1];
    bob = signers[2];
  });

  async function fund(player: HardhatEthersSigner, box: string) {
    await erc.mint(player.address, STAKE);
    await erc.connect(player).approve(box, STAKE);
  }

  async function playThree(inviteId: bigint, player: HardhatEthersSigner, cups: number[]) {
    for (const cup of cups) {
      await (await invite.connect(player).play(inviteId, cup)).wait();
    }
  }

  it("pays $2 to the higher score after three free hands and keeps both scores sealed", async function () {
    if (!fhevm.isMock) this.skip();
    ({ invite, erc, address } = await deployFixture(true));
    await fund(alice, address);
    await fund(bob, address);

    const inviteId = await invite.connect(alice).createInvite.staticCall();
    await (await invite.connect(alice).createInvite()).wait();
    const opened = await invite.getInvite(inviteId);
    expect(opened.phase).to.eq(1n);
    expect(opened.pot).to.eq(0n);
    expect(Number(opened.deadline)).to.be.greaterThan((await ethers.provider.getBlock("latest"))!.timestamp);

    // Three free hands for the host.
    await playThree(inviteId, alice, [0, 1, 2]);
    const afterHost = await invite.getInvite(inviteId);
    const hostHands = await invite.getHands(inviteId);
    expect(afterHost.phase).to.eq(1n);
    expect(hostHands.hostHands).to.eq(HANDS);
    expect(hostHands.guestHands).to.eq(0n);
    await expect(invite.connect(alice).play(inviteId, 0)).to.be.revertedWithCustomError(invite, "AlreadyPlayed");

    // Committing the score is the $1 stake.
    await (await invite.connect(alice).commitFallback(inviteId)).wait();
    const committed = await invite.getCommitted(inviteId);
    expect(committed.hostCommitted).to.eq(true);
    expect(committed.guestCommitted).to.eq(false);
    expect((await invite.getInvite(inviteId)).pot).to.eq(STAKE);

    await ethers.provider.send("evm_increaseTime", [2 * 60 * 60]);
    await ethers.provider.send("evm_mine", []);
    await (await invite.connect(bob).joinInvite(inviteId)).wait();
    await playThree(inviteId, bob, [2, 1, 0]);
    await (await invite.connect(bob).commitFallback(inviteId)).wait();

    // The second commit seals the round.
    const sealed = await invite.getInvite(inviteId);
    expect(sealed.phase).to.eq(2n);
    expect(sealed.pot).to.eq(STAKE * 2n);
    const seats = await invite.getSeats(inviteId);
    expect(seats.player0).to.eq(alice.address);
    expect(seats.player1).to.eq(bob.address);

    const aliceScore = await fhevm.userDecryptEuint(
      FhevmType.euint32,
      await invite.getScoreHandle(inviteId, 0),
      address,
      alice,
    );
    const bobScore = await fhevm.userDecryptEuint(
      FhevmType.euint32,
      await invite.getScoreHandle(inviteId, 1),
      address,
      bob,
    );
    expect(validScores.has(aliceScore)).to.eq(true);
    expect(validScores.has(bobScore)).to.eq(true);
    await expect(
      fhevm.userDecryptEuint(FhevmType.euint32, await invite.getScoreHandle(inviteId, 0), address, bob),
    ).to.be.rejected;
    await expect(
      fhevm.publicDecryptEuint(FhevmType.euint32, await invite.getScoreHandle(inviteId, 0)),
    ).to.be.rejected;

    const expected = bobScore > aliceScore ? bob.address : alice.address;
    const revealed = await fhevm.publicDecrypt([sealed.winnerHandle]);
    expect(revealed.clearValues[sealed.winnerHandle]).to.eq(expected);

    await (await invite.claim(inviteId, revealed.abiEncodedClearValues, revealed.decryptionProof)).wait();
    const paid = await invite.getInvite(inviteId);
    expect(paid.winner).to.eq(expected);
    expect(paid.claimed).to.eq(true);
    expect(await erc.balanceOf(expected)).to.eq(STAKE * 2n);
    expect(await erc.balanceOf(expected === alice.address ? bob.address : alice.address)).to.eq(0n);
  });

  it("rejects score decryption when debug access is off", async function () {
    if (!fhevm.isMock) this.skip();
    ({ invite, erc, address } = await deployFixture(false));
    await fund(alice, address);
    const inviteId = await invite.connect(alice).createInvite.staticCall();
    await (await invite.connect(alice).createInvite()).wait();
    await playThree(inviteId, alice, [2, 0, 1]);
    await (await invite.connect(alice).commitFallback(inviteId)).wait();
    const ball = await fhevm.userDecryptEuint(
      FhevmType.euint32,
      await invite.getBallHandle(inviteId, 0),
      address,
      alice,
    );
    expect(ball).to.be.oneOf([0n, 1n, 2n]);
    await expect(
      fhevm.userDecryptEuint(FhevmType.euint32, await invite.getBallHandle(inviteId, 0), address, bob),
    ).to.be.rejected;
    await expect(
      fhevm.userDecryptEuint(FhevmType.euint32, await invite.getScoreHandle(inviteId, 0), address, alice),
    ).to.be.rejected;
    await expect(
      fhevm.publicDecryptEuint(FhevmType.euint32, await invite.getScoreHandle(inviteId, 0)),
    ).to.be.rejected;
  });

  it("requires three hands before committing", async function () {
    if (!fhevm.isMock) this.skip();
    ({ invite, erc, address } = await deployFixture(false));
    await fund(alice, address);
    const inviteId = await invite.connect(alice).createInvite.staticCall();
    await (await invite.connect(alice).createInvite()).wait();
    await (await invite.connect(alice).play(inviteId, 1)).wait();
    await expect(invite.connect(alice).commitFallback(inviteId)).to.be.revertedWithCustomError(invite, "NeedThreeHands");
  });

  it("refunds the committed stake after the 48 hour link expires before the round resolves", async function () {
    if (!fhevm.isMock) this.skip();
    ({ invite, erc, address } = await deployFixture(false));
    await fund(alice, address);
    await fund(bob, address);
    const inviteId = await invite.connect(alice).createInvite.staticCall();
    await (await invite.connect(alice).createInvite()).wait();
    await playThree(inviteId, alice, [1, 1, 1]);
    await (await invite.connect(alice).commitFallback(inviteId)).wait();

    await expect(invite.refundExpired(inviteId)).to.be.revertedWithCustomError(invite, "InviteStillOpen");
    await ethers.provider.send("evm_increaseTime", [48 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);
    await expect(invite.connect(bob).joinInvite(inviteId)).to.be.revertedWithCustomError(invite, "InviteExpired");

    await (await invite.refundExpired(inviteId)).wait();
    const closed = await invite.getInvite(inviteId);
    expect(closed.phase).to.eq(3n);
    expect(closed.pot).to.eq(0n);
    expect(await erc.balanceOf(alice.address)).to.eq(STAKE);
  });

  it("commits a confidential $1 stake after three hands", async function () {
    if (!fhevm.isMock) this.skip();
    ({ invite, erc, address } = await deployFixture(true));
    await fund(alice, address);
    const inviteId = await invite.connect(alice).createInvite.staticCall();
    await (await invite.connect(alice).createInvite()).wait();
    await playThree(inviteId, alice, [0, 1, 2]);
    const encrypted = await fhevm.createEncryptedInput(address, alice.address).add64(STAKE).encrypt();
    await (await invite.connect(alice).commit(inviteId, encrypted.handles[0], encrypted.inputProof)).wait();
    const score = await fhevm.userDecryptEuint(
      FhevmType.euint32,
      await invite.getScoreHandle(inviteId, 0),
      address,
      alice,
    );
    expect(validScores.has(score)).to.eq(true);
  });
});
