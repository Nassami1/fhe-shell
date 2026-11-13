import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { MockCUSDT, MockERC20, MysteryBoxShowdown } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

const FEE = 1_000_000n;

function powerFromRoll(roll: bigint) {
  if (roll < 614n) return 10n;
  if (roll < 870n) return 30n;
  if (roll < 993n) return 70n;
  return 150n;
}

async function deployFixture() {
  const erc = await ethers.deployContract("MockERC20");
  const cusdt = await ethers.deployContract("MockCUSDT");
  const showdown = await ethers.deployContract("MysteryBoxShowdown", [await cusdt.getAddress(), await erc.getAddress()]);
  return { showdown, erc, cusdt, address: await showdown.getAddress() };
}

describe("MysteryBoxShowdown", function () {
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let carol: HardhatEthersSigner;
  let showdown: MysteryBoxShowdown;
  let erc: MockERC20;
  let address: string;

  before(async function () {
    const signers = await ethers.getSigners();
    alice = signers[1];
    bob = signers[2];
    carol = signers[3];
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      this.skip();
    }
    ({ showdown, erc, address } = await deployFixture());
  });

  it("publishes the power table", async function () {
    const odds = await showdown.getOdds();
    expect(odds.names).to.deep.eq(["Common", "Rare", "Epic", "Legendary"]);
    expect(odds.percent.map(Number)).to.deep.eq([60, 25, 12, 3]);
    expect(odds.power.map(Number)).to.deep.eq([10, 30, 70, 150]);
    expect(odds.bucketWeight.map(Number)).to.deep.eq([614, 256, 123, 31]);
  });

  async function seatFallback(player: HardhatEthersSigner, roundId: bigint) {
    await erc.mint(player.address, FEE * 2n);
    await erc.connect(player).approve(address, FEE * 2n);
    await (await showdown.connect(player).joinRoundFallback(roundId)).wait();
  }

  async function readPower(player: HardhatEthersSigner, roundId: bigint) {
    const handle = await showdown.getPlayerBox(player.address, roundId);
    const rollHandle = await showdown.getRoll(player.address, roundId);
    const power = await fhevm.userDecryptEuint(FhevmType.euint32, handle, address, player);
    const roll = await fhevm.publicDecryptEuint(FhevmType.euint32, rollHandle);
    expect(power).to.eq(powerFromRoll(roll));
    return power;
  }

  it("pays the higher encrypted power after both players challenge", async function () {
    const roundId = await showdown.connect(alice).createRound.staticCall();
    await (await showdown.connect(alice).createRound()).wait();
    await seatFallback(alice, roundId);
    await seatFallback(bob, roundId);
    await (await showdown.beginChallenge(roundId)).wait();
    await (await showdown.connect(alice).challengeFallback(roundId)).wait();
    await (await showdown.connect(bob).challengeFallback(roundId)).wait();

    const alicePower = await readPower(alice, roundId);
    const bobPower = await readPower(bob, roundId);
    await expect(fhevm.userDecryptEuint(FhevmType.euint32, await showdown.getPlayerBox(alice.address, roundId), address, bob))
      .to.be.rejected;

    await (await showdown.resolve(roundId)).wait();
    const winnerHandle = await showdown.getWinnerHandle(roundId);
    const revealed = await fhevm.publicDecrypt([winnerHandle]);
    const expected = alicePower > bobPower ? alice.address : alicePower < bobPower ? bob.address : alice.address;
    expect(revealed.clearValues[winnerHandle]).to.eq(expected);

    const claimTx = await showdown.claim(roundId, revealed.abiEncodedClearValues, revealed.decryptionProof);
    await claimTx.wait();
    const round = await showdown.getRound(roundId);
    expect(round.winner).to.eq(expected);
    expect(round.claimed).to.eq(true);
    expect(await erc.balanceOf(expected)).to.eq(FEE * 4n);
  });

  it("gives the pot to the only player who challenges", async function () {
    const roundId = await showdown.connect(alice).createRound.staticCall();
    await (await showdown.connect(alice).createRound()).wait();
    await seatFallback(alice, roundId);
    await seatFallback(bob, roundId);
    await (await showdown.beginChallenge(roundId)).wait();
    await (await showdown.connect(alice).challengeFallback(roundId)).wait();
    await (await showdown.connect(bob).fold(roundId)).wait();
    await (await showdown.resolve(roundId)).wait();

    const winnerHandle = await showdown.getWinnerHandle(roundId);
    const revealed = await fhevm.publicDecrypt([winnerHandle]);
    expect(revealed.clearValues[winnerHandle]).to.eq(alice.address);
    await (await showdown.claim(roundId, revealed.abiEncodedClearValues, revealed.decryptionProof)).wait();
    expect((await showdown.getRound(roundId)).winner).to.eq(alice.address);
    expect(await erc.balanceOf(alice.address)).to.eq(FEE * 3n);
  });

  it("stores a buyer-only power when the confidential entry is paid", async function () {
    const roundId = await showdown.connect(carol).createRound.staticCall();
    await (await showdown.connect(carol).createRound()).wait();
    const encrypted = await fhevm.createEncryptedInput(address, carol.address).add64(FEE).encrypt();
    await (await showdown.connect(carol).joinRound(roundId, encrypted.handles[0], encrypted.inputProof)).wait();
    const power = await readPower(carol, roundId);
    expect(power).to.be.oneOf([10n, 30n, 70n, 150n]);
  });
});
