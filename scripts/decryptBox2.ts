import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

const BOX = "0x82d75EFbCA8e086565cB2CCEb270B0625dE6b348";
const PRIZE = "0x696b81460698f3f25ff71088f192faa5cc0e0bcc97ff0000000000aa36a70400";
const ROLL = "0x3dd0d917de13b438e1a3652c5e354050e8741fc463ff0000000000aa36a70400";

async function main() {
  await fhevm.initializeCLIApi();
  const [signer] = await ethers.getSigners();
  const prize = await fhevm.userDecryptEuint(FhevmType.euint32, PRIZE, BOX, signer);
  const roll = await fhevm.publicDecryptEuint(FhevmType.euint32, ROLL);
  console.log("box2-prize", prize.toString());
  console.log("box2-roll", roll.toString());
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
