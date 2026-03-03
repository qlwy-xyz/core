import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("QLWYPredictionArbitrationModule", (m) => {
  const owner = m.getAccount(0);

  const fortuneCoreAddress = m.getParameter("fortuneCoreAddress");
  const stablecoinAddress = m.getParameter("stablecoinAddress");
  const qlwyTokenAddress = m.getParameter("qlwyTokenAddress");

  const predictionArbitration = m.contract("QLWYPredictionArbitration", [
    owner,
    fortuneCoreAddress,
    stablecoinAddress,
    qlwyTokenAddress,
  ]);

  return { predictionArbitration };
});

