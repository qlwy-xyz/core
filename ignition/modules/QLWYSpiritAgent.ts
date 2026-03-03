import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("QLWYSpiritAgentModule", (m) => {
  const fortuneCoreAddress = m.getParameter("fortuneCoreAddress");
  const defaultLogicAddress = m.getParameter("defaultLogicAddress");
  const qlwyTokenAddress = m.getParameter("qlwyTokenAddress");

  const spiritAgent = m.contract("QLWYSpiritAgent", [
    fortuneCoreAddress,
    defaultLogicAddress,
    qlwyTokenAddress,
  ]);

  return { spiritAgent };
});

