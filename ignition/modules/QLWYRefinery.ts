import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("QLWYRefineryModule", (m) => {
  const owner = m.getAccount(0);

  const fortuneCoreAddress = m.getParameter("fortuneCoreAddress");
  const qlwyTokenAddress = m.getParameter("qlwyTokenAddress");
  const vrfCoordinatorAddress = m.getParameter("vrfCoordinatorAddress");
  const vrfKeyHash = m.getParameter("vrfKeyHash");
  const vrfSubscriptionId = m.getParameter("vrfSubscriptionId");
  const vrfMinConfirmations = m.getParameter("vrfMinConfirmations");
  const vrfCallbackGasLimit = m.getParameter("vrfCallbackGasLimit");

  const refinery = m.contract("QLWYRefinery", [
    owner,
    fortuneCoreAddress,
    qlwyTokenAddress,
    vrfCoordinatorAddress,
    vrfKeyHash,
    vrfSubscriptionId,
    vrfMinConfirmations,
    vrfCallbackGasLimit,
  ]);

  return { refinery };
});

