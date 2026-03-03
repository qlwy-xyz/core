import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("QLWYBattleModule", (m) => {
  const qlwyTokenAddress = m.getParameter("qlwyTokenAddress");
  const fortuneCoreAddress = m.getParameter("fortuneCoreAddress");
  const treasuryAddress = m.getParameter("treasuryAddress");
  const vrfCoordinatorAddress = m.getParameter("vrfCoordinatorAddress");
  const vrfKeyHash = m.getParameter("vrfKeyHash");
  const vrfSubscriptionId = m.getParameter("vrfSubscriptionId");

  const battle = m.contract("QLWYBattle", [
    qlwyTokenAddress,
    fortuneCoreAddress,
    treasuryAddress,
    vrfCoordinatorAddress,
    vrfKeyHash,
    vrfSubscriptionId,
  ]);

  return { battle };
});

