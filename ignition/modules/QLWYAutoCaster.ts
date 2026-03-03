import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("QLWYAutoCasterModule", (m) => {
  const fortuneCoreAddress = m.getParameter("fortuneCoreAddress");

  const autoCaster = m.contract("QLWYAutoCaster", [fortuneCoreAddress]);

  return { autoCaster };
});

