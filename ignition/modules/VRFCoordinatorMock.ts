import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("VRFCoordinatorMockModule", (m) => {
  const vrfCoordinatorMock = m.contract("VRFCoordinatorMock");

  return { vrfCoordinatorMock };
});
