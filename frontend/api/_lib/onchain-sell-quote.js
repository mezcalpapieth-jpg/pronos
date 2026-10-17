// Match PronosAMM.estimateSell's integer rounding, including the ceiling
// square root. Floating-point math can move the gross payout by one unit.
function binarySellGross(reserveYes, reserveNo, shares, sellYes) {
  const a = (sellYes ? reserveYes : reserveNo) + shares;
  const b = sellYes ? reserveNo : reserveYes;
  const discriminant = (a - b) ** 2n + 4n * reserveYes * reserveNo;
  let root = discriminant;
  let next = (root + 1n) / 2n;
  while (next < root) {
    root = next;
    next = (root + discriminant / root) / 2n;
  }
  if (root * root < discriminant) root += 1n;
  return (a + b - root) / 2n;
}

export async function readSellQuoteAmounts({ amm, binary, outcomeIndex, sharesUnits, blockTag }) {
  const overrides = { blockTag };
  const side = binary ? outcomeIndex === 0 : outcomeIndex;
  if (!binary) {
    // PronosAMMMulti charges on buys only; its sell estimate is both gross
    // and net. Calling its calculateFee here would invent a sell fee.
    const out = BigInt((await amm.estimateSell(side, sharesUnits, overrides)).toString());
    return { gross: out, fee: 0n, collateralOut: out };
  }

  const [estimatedOut, yes, no] = await Promise.all([
    amm.estimateSell(side, sharesUnits, overrides),
    amm.reserveYes(overrides),
    amm.reserveNo(overrides),
  ]);
  const gross = binarySellGross(BigInt(yes.toString()), BigInt(no.toString()), BigInt(sharesUnits.toString()), side);
  // Selling YES uses the fee for buying NO, and vice versa. Ask the
  // contract for the exact dynamic fee, including its minimum-unit fee.
  const fee = BigInt((await amm.calculateFee(gross.toString(), !side, overrides)).toString());
  const collateralOut = BigInt(estimatedOut.toString());
  if (gross - fee !== collateralOut) throw new Error('sell_quote_inconsistent');
  return { gross, fee, collateralOut };
}
