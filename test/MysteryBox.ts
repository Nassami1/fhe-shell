import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { MockCUSDT, MockERC20, MysteryBox, MysteryBox__factory } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

const PRICE = 1_000_000;

async function deployFixture() {
  const erc = (await ethers.deployContract("MockERC20")) as unknown as MockERC20;
  const cusdt = (await ethers.deployContract("MockCUSDT")) as unknown as MockCUSDT;
  const factory = (await ethers.getContractFactory("MysteryBox")) as MysteryBox__factory;
  const box = (await factory.deploy(await cusdt.getAddress(), await erc.getAddress())) as MysteryBox;
  return { box, erc, cusdt, address: await box.getAddress() };
}

describe("MysteryBox", function () {
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let box: MysteryBox;
  let erc: MockERC20;
  let address: string;

  before(async function () {
    const signers = await ethers.getSigners();
    alice = signers[1];
    bob = signers[2];
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("MysteryBox mock tests run on the in-memory FHEVM only");
      this.skip();
    }
    ({ box, erc, address } = await deployFixture());
  });

  it("publishes the prize table", async function () {
    const odds = await box.getOdds();
    expect(odds.names).to.deep.eq(["Common", "Rare", "Epic", "Legendary"]);
    expect(odds.percent.map((n) => Number(n))).to.deep.eq([60, 25, 12, 3]);
    expect(odds.bucketWeight.map((n) => Number(n))).to.deep.eq([614, 256, 123, 31]);
    expect(odds.modulus).to.eq(1024n);
  });

  it("draws an encrypted prize the buyer can decrypt and the roll stays in range", async function () {
    const encrypted = await fhevm.createEncryptedInput(address, alice.address).add64(PRICE).encrypt();

    const tx = await box.connect(alice).buyBox(encrypted.handles[0], encrypted.inputProof);
    const receipt = await tx.wait();
    expect(receipt).to.not.eq(null);

    const prizeHandle = await box.getBox(alice.address, 1);
    const rollHandle = await box.getRoll(alice.address, 1);
    expect(prizeHandle).to.not.eq(ethers.ZeroHash);
    expect(rollHandle).to.not.eq(ethers.ZeroHash);
    expect(await box.paymentKind(alice.address, 1)).to.eq(1);

    const prize = await fhevm.userDecryptEuint(FhevmType.euint32, prizeHandle, address, alice);
    const roll = await fhevm.publicDecryptEuint(FhevmType.euint32, rollHandle);

    expect(prize).to.be.gte(1);
    expect(prize).to.be.lte(4);
    expect(roll).to.be.lt(1024);

    const expected =
      roll < 614 ? 1 : roll < 870 ? 2 : roll < 993 ? 3 : 4;
    expect(prize).to.eq(expected);
  });

  it("stores prize 0 when the encrypted payment is below the price", async function () {
    const encrypted = await fhevm.createEncryptedInput(address, alice.address).add64(1).encrypt();
    await (await box.connect(alice).buyBox(encrypted.handles[0], encrypted.inputProof)).wait();

    const prizeHandle = await box.getBox(alice.address, 1);
    const prize = await fhevm.userDecryptEuint(FhevmType.euint32, prizeHandle, address, alice);
    expect(prize).to.eq(0);
  });

  it("rejects a non-buyer user decryption of the prize", async function () {
    const encrypted = await fhevm.createEncryptedInput(address, alice.address).add64(PRICE).encrypt();
    await (await box.connect(alice).buyBox(encrypted.handles[0], encrypted.inputProof)).wait();
    const prizeHandle = await box.getBox(alice.address, 1);

    await expect(
      fhevm.userDecryptEuint(FhevmType.euint32, prizeHandle, address, bob),
    ).to.be.rejected;
  });

  it("takes the clear ERC-20 fallback payment and still encrypts the prize", async function () {
    await erc.mint(alice.address, PRICE);
    await erc.connect(alice).approve(address, PRICE);

    const tx = await box.connect(alice).buyBoxFallback();
    const receipt = await tx.wait();
    expect(await box.paymentKind(alice.address, 1)).to.eq(2);
    expect(await erc.balanceOf(address)).to.eq(PRICE);

    const opened = receipt?.logs.find((log) => {
      try {
        return box.interface.parseLog(log)?.name === "BoxOpened";
      } catch {
        return false;
      }
    });
    expect(opened).to.not.eq(undefined);

    const prize = await fhevm.userDecryptEuint(
      FhevmType.euint32,
      await box.getBox(alice.address, 1),
      address,
      alice,
    );
    expect(prize).to.be.gte(1);
    expect(prize).to.be.lte(4);
  });
});
