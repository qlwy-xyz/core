import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("QLWYRendererModule", (m) => {
  const owner = m.getAccount(0);
  const coreAddress = m.getParameter("coreAddress");
  const contentPackAddress = m.getParameter("contentPackAddress");
  const renderer = m.contract("QLWYRenderer", [owner, coreAddress, contentPackAddress]);

  return { renderer };
});
