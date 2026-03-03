# QLWY Core — Smart Contracts on BNB Chain

Core smart contracts for the **QLWY** (潜龙勿用) protocol, deployed on **BNB Smart Chain (BSC)**. Built with Hardhat 3, Solidity, and viem.

## Contracts

| Contract | Description |
|---|---|
| `QLWYFortuneCore` | Core fortune/spirit system |
| `QLWYSpiritAgent` | Onchain spirit agent logic |
| `QLWYSpiritLogic` | Spirit state transitions |
| `QLWYPredictionMarket` | LMSR-based prediction market |
| `QLWYPredictionArbitration` | Dispute resolution via Mythic NFT arbitration |
| `QLWYBattle` / `QLWYBattleV2` | Spirit battle system |
| `QLWYStaking` | Token staking |
| `QLWYRefinery` | Spirit refinement (Chainlink VRF) |
| `QLWYToken` | ERC-20 token |
| `QLWYRenderer` | Onchain SVG renderer |
| `QLWYContentPackV1` | Content pack system |
| `QLWYTreasury` / `BattleTreasury` | Treasury management |

## Tech Stack

- **BNB Smart Chain (BSC)** — primary deployment target (chain ID 56)
- **BNB Chain Testnet** — testnet (chain ID 97)
- [Hardhat 3](https://hardhat.org/) + [viem](https://viem.sh/)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts)
- [Chainlink VRF](https://docs.chain.link/vrf) for verifiable randomness
- Foundry-compatible Solidity unit tests

## Getting Started

```shell
pnpm install
```

### Run Tests

```shell
npx hardhat test
```

### Deploy to BNB Smart Chain

```shell
npx hardhat keystore set BSC_PRIVATE_KEY
npx hardhat ignition deploy --network bsc ignition/modules/<Module>.ts
```

## License

See repository root.
