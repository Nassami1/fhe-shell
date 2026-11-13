import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const SEPOLIA_CUSDT = "0x4E7B06D78965594eB5EF5414c357ca21E1554491";
const SEPOLIA_UNDERLYING = "0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const cUsdt = process.env.CUSDT_ADDRESS || SEPOLIA_CUSDT;
  const underlying = process.env.UNDERLYING_USDT || SEPOLIA_UNDERLYING;

  const deployed = await deploy("MysteryBoxInvite", {
    from: deployer,
    args: [cUsdt, underlying, false],
    log: true,
  });

  console.log(`MysteryBoxInvite: ${deployed.address}`);
};
export default func;
func.id = "deploy_mystery_box_invite";
func.tags = ["MysteryBoxInvite"];
