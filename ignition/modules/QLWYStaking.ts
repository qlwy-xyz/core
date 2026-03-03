import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("QLWYStakingModule", (m) => {
  const owner = m.getAccount(0);

  const qlwyTokenAddress = m.getParameter("qlwyTokenAddress");
  const treasuryAddress = m.getParameter("treasuryAddress");

  const staking = m.contract("QLWYStaking", [
    owner,
    qlwyTokenAddress,
    treasuryAddress,
  ]);

  return { staking };
});

