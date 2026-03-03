import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("QLWYPredictionMarketModule", (m) => {
  const owner = m.getAccount(0);

  const stablecoinAddress = m.getParameter("stablecoinAddress");
  const protocolFeeRecipient = m.getParameter("protocolFeeRecipient");

  const predictionMarket = m.contract("QLWYPredictionMarket", [
    owner,
    stablecoinAddress,
    protocolFeeRecipient,
  ]);

  return { predictionMarket };
});

