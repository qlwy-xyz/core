import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("CoreMockModule", (m) => {
  const coreMock = m.contract("CoreMock");

  return { coreMock };
});
