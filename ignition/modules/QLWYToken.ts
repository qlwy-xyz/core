import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("QLWYTokenModule", (m) => {
  const owner = m.getAccount(0);

  const initialSupply = 1_000_000_000n * 10n ** 18n;
  
  const token = m.contract("QLWYToken", [
    "潜龙勿用",
    "潜龙勿用",
    initialSupply,
    owner,
  ]);

  return { token };
});
