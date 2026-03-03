import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("QLWYFortuneCoreModule", (m) => {
  const owner = m.getAccount(0);

  const tokenAddress = m.getParameter("tokenAddress");
  const routerAddress = m.getParameter("routerAddress");
  const routerType = m.getParameter("routerType");
  const routerPoolFee = m.getParameter("routerPoolFee");
  const wbnbAddress = m.getParameter("wbnbAddress");
  const vrfCoordinatorAddress = m.getParameter("vrfCoordinatorAddress");
  const vrfKeyHash = m.getParameter("vrfKeyHash");
  const vrfSubscriptionId = m.getParameter("vrfSubscriptionId");
  const vrfMinConfirmations = m.getParameter("vrfMinConfirmations");
  const vrfCallbackGasLimit = m.getParameter("vrfCallbackGasLimit");

  const core = m.contract("QLWYFortuneCore", [
    "QLWY Fortune",
    "QLWY",
    owner,
    tokenAddress,
    routerType,
    routerAddress,
    wbnbAddress,
    routerPoolFee,
    vrfCoordinatorAddress,
    vrfKeyHash,
    vrfSubscriptionId,
    vrfMinConfirmations,
    vrfCallbackGasLimit,
  ]);

  return { core };
});
