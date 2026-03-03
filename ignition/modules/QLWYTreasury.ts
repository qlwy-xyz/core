import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("QLWYTreasuryModule", (m) => {
  const owner = m.getAccount(0);

  const treasury = m.contract("QLWYTreasury", [owner]);

  return { treasury };
});

