import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

const BOX = "0x82d75EFbCA8e086565cB2CCEb270B0625dE6b348";
const PRICE = 1_000_000n;

async function main() {
  await fhevm.initializeCLIApi();
  const [signer] = await ethers.getSigners();
  const box = await ethers.getContractAt("MysteryBox", BOX, signer);

  const existing = await box.boxCount(signer.address);
  console.log("boxes-before", existing.toString());
  if (existing > 0n) {
    const prizeHandle = await box.getBox(signer.address, existing);
    const rollHandle = await box.getRoll(signer.address, existing);
    console.log("latest-prize", prizeHandle);
    console.log("latest-roll", rollHandle);
    const prize = await fhevm.userDecryptEuint(FhevmType.euint32, prizeHandle, BOX, signer);
    const roll = await fhevm.publicDecryptEuint(FhevmType.euint32, rollHandle);
    console.log("decrypted-prize", prize.toString());
    console.log("public-roll", roll.toString());
  }

  const encrypted = await fhevm.createEncryptedInput(BOX, signer.address).add64(PRICE).encrypt();
  const buyTx = await box.buyBox(encrypted.handles[0], encrypted.inputProof);
  console.log("buy", buyTx.hash);
  const receipt = await buyTx.wait();
  console.log("buy-status", receipt?.status);

  const boxId = await box.boxCount(signer.address);
  const prizeHandle = await box.getBox(signer.address, boxId);
  const rollHandle = await box.getRoll(signer.address, boxId);
  console.log("prize-handle", prizeHandle);
  console.log("roll-handle", rollHandle);
  const prize = await fhevm.userDecryptEuint(FhevmType.euint32, prizeHandle, BOX, signer);
  const roll = await fhevm.publicDecryptEuint(FhevmType.euint32, rollHandle);
  console.log("decrypted-prize", prize.toString());
  console.log("public-roll", roll.toString());
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
