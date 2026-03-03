import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("QLWYSpiritLogicModule", (m) => {
  const spiritAgentAddress = m.getParameter("spiritAgentAddress");
  const battleContractAddress = m.getParameter("battleContractAddress");
  const qlwyTokenAddress = m.getParameter("qlwyTokenAddress");

  const spiritLogic = m.contract("QLWYSpiritLogic", [
    spiritAgentAddress,
    battleContractAddress,
    qlwyTokenAddress,
  ]);

  return { spiritLogic };
});

