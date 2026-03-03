import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("QLWYBattleV2Module", (m) => {
  const qlwyTokenAddress = m.getParameter("qlwyTokenAddress");
  const fortuneCoreAddress = m.getParameter("fortuneCoreAddress");
  const treasuryAddress = m.getParameter("treasuryAddress");
  const vrfCoordinatorAddress = m.getParameter("vrfCoordinatorAddress");
  const vrfKeyHash = m.getParameter("vrfKeyHash");
  const vrfSubscriptionId = m.getParameter("vrfSubscriptionId");

  const battleV2 = m.contract("QLWYBattleV2", [
    qlwyTokenAddress,
    fortuneCoreAddress,
    treasuryAddress,
    vrfCoordinatorAddress,
    vrfKeyHash,
    vrfSubscriptionId,
  ]);

  return { battleV2 };
});

