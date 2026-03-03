import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("RouterMockModule", (m) => {
  const tokenAddress = m.getParameter("tokenAddress");
  const mockRate = m.getParameter("mockRate");
  const routerMock = m.contract("RouterMock", [tokenAddress, mockRate]);

  return { routerMock };
});
