import { keccak256, toBytes, slice } from "viem";

const errors = [
  // PredictionMarket custom errors
  "MarketNotTrading()", "MarketNotExpired()", "MarketExpired()",
  "InvalidOutcome()", "InsufficientShares()", "BelowMinSubsidy()",
  "InvalidMetadata()", "DurationTooShort()", "NotCreator()",
  "NotInPhase(uint8)", "DisputePeriodNotOver()", "DisputePeriodOver()",
  "AlreadyResolved()", "NothingToClaim()", "ZeroShares()",
  "NotZombieMarket()", "MarketHasDeadline()",
  // Previous errors
  "AlreadyClaimed()", "BattleNotBetting()", "BattleNotFilling()", "BattleNotPending()",
  "BattleNotResolved()", "BettingEnded()", "BettingNotEnded()", "CannotJoinOwnSide()",
  "CreatorCannotLeave()", "InvalidBattle()", "InvalidBetAmount()", "InvalidNFTCount()",
  "InvalidSlotIndex()", "NotAuthorized()", "NotCreator()", "NotExpired()",
  "NotOwnerOfNFT()", "NotParticipant()", "NothingToClaim()", "SideAlreadyFull()",
  "SlotAlreadyFilled()", "SlotCountMismatch()", "TooManyNFTs()",
  // SpiritLogic errors
  "NotOperator()", "SpiritNotActive(uint256)", "InvalidAction(bytes4)", "ActionFailed(string)",
  // ERC errors
  "ERC721InsufficientApproval(address,uint256)", "ERC721InvalidReceiver(address)",
  "ERC20InsufficientAllowance(address,uint256,uint256)", "ERC20InsufficientBalance(address,uint256,uint256)",
  // OZ
  "OwnableInvalidOwner(address)", "OwnableUnauthorizedAccount(address)",
  "EnforcedPause()", "ExpectedPause()", "ReentrancyGuardReentrantCall()",
  "SafeERC20FailedOperation(address)",
  // ERC20 transfer errors
  "ERC20InvalidSender(address)", "ERC20InvalidReceiver(address)",
  "ERC20InvalidApprover(address)", "ERC20InvalidSpender(address)",
  // FixedPointMathLib errors (solady)
  "MulWadFailed()", "DivWadFailed()", "FullMulDivFailed()",
  "MulDivFailed()", "Overflow()", "ExpOverflow()", "LnWadUndefined()",
  // Misc
  "FailedInnerCall()", "AddressEmptyCode(address)",
  "InsufficientBalance(uint256,uint256)", "FailedCall()",
  "AddressInsufficientBalance(address)",
];

const target = "0x25c36367";
let found = false;
for (const sig of errors) {
  const sel = slice(keccak256(toBytes(sig)), 0, 4);
  if (sel === target) {
    console.log("FOUND:", sig, "->", sel);
    found = true;
  }
}
if (!found) {
  console.log("Not found in known errors. Printing all selectors:");
  for (const sig of errors) {
    const sel = slice(keccak256(toBytes(sig)), 0, 4);
    console.log(sig, "->", sel);
  }
}

