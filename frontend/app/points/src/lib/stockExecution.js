// A single user action still obtains an immutable server quote before execution.
// Keep an interrupted execution's identity so retrying can replay its result.
export async function executeStockOrder({ request, pendingAttempt = null, quoteStock, tradeStock,
  onQuote = () => {}, isCurrent = () => true, createIdempotencyKey = () => crypto.randomUUID() }) {
  let attempt = pendingAttempt;
  if (!attempt) {
    const quote = await quoteStock(request);
    if (!isCurrent()) return null;
    attempt = { quoteId: quote.quoteId, idempotencyKey: createIdempotencyKey() };
    onQuote(quote, attempt);
  }
  if (!isCurrent()) return null;
  return tradeStock(request.side, attempt);
}

export function stockTradeNeedsRetry(error, pendingAttempt) {
  return Boolean(pendingAttempt && (!error?.status || error.status >= 500));
}
