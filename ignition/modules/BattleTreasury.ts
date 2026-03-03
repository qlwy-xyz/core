import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("BattleTreasuryModule", (m) => {
  const owner = m.getAccount(0);
  const qlwyTokenAddress = m.getParameter("qlwyTokenAddress");
  const fortuneCoreAddress = m.getParameter("fortuneCoreAddress");

  const battleTreasury = m.contract("BattleTreasury", [
    owner,
    qlwyTokenAddress,
    fortuneCoreAddress,
  ]);

  return { battleTreasury };
});

