import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("QLWYContentPackV1Module", (m) => {
  const baseImageUri = m.getParameter("baseImageUri");
  const font1Uri = m.getParameter("font1Uri");
  const font2Uri = m.getParameter("font2Uri");
  const contentPack = m.contract("QLWYContentPackV1", [
    baseImageUri,
    font1Uri,
    font2Uri,
  ]);

  return { contentPack };
});
