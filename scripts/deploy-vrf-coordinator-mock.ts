import hre from "hardhat";
import VRFCoordinatorMock from "../ignition/modules/VRFCoordinatorMock.js";

async function main() {
  const connection = await hre.network.connect();
  const { vrfCoordinatorMock } = await connection.ignition.deploy(VRFCoordinatorMock);

  console.log(`VRF Coordinator mock deployed to: ${vrfCoordinatorMock.address}`);
}

main().catch(console.error);
