const ENDPOINT = '/api/mxn-checkout';

export const VENUES = { hip4: 'HIP-4', polymarket: 'Polymarket' };
export const TICKETS_MXN = [100, 300, 1000];
export const QUOTE_STATUS = {
  eligible: 'Pasa el límite de comisiones',
  fee_cap_exceeded: 'Supera el límite de comisiones',
  partial_depth: 'Liquidez visible insuficiente',
  below_minimum: 'Por debajo del mínimo del mercado',
  below_one_share: 'El monto no alcanza una participación',
};

const API_ERRORS = {
  mxn_checkout_disabled: 'La cotización en pesos no está habilitada en este entorno.',
  stale_book: 'El libro está desactualizado. Solicita una nueva cotización.',
  stale_fx: 'El tipo de cambio está desactualizado. Intenta nuevamente.',
  stale_quote: 'La cotización caducó. Solicita una nueva.',
  stale_snapshot: 'La cotización caducó. Solicita una nueva.',
  unsupported_cancellation: 'Las reglas de cancelación cambiaron. Actualiza la lista de mercados.',
  market_not_trading: 'El mercado ya no acepta órdenes. Actualiza la lista de mercados.',
  unsupported_market: 'El mercado ya no está disponible. Actualiza la lista de mercados.',
  upstream_unavailable: 'El proveedor no respondió. Intenta nuevamente.',
};

const validVenue = value => typeof value === 'string' && Object.hasOwn(VENUES, value);
const validId = value => /^[#a-zA-Z0-9_-]{1,40}$/.test(String(value ?? ''));
const validMarket = market => validVenue(market?.venue) && validId(market.id)
  && typeof market.title === 'string' && market.title.trim() && market.cancellationPayoutPerShare === '0.50'
  && Array.isArray(market.outcomes) && market.outcomes.length === 2
  && new Set(market.outcomes.map(outcome => outcome?.index)).size === 2
  && market.outcomes.every(outcome => [0, 1].includes(outcome?.index) && typeof outcome.label === 'string' && outcome.label.trim());

export const checkoutMarketKey = market => `${market.venue}:${market.id}`;

export function checkoutQuoteExpired(quote, now = Date.now()) {
  const expires = Date.parse(quote?.expiresAt);
  return !Number.isFinite(expires) || expires <= now;
}

export function createMxnCheckoutClient({ fetchImpl = globalThis.fetch, timeoutMs = 12_000 } = {}) {
  async function request(parameters, signal) {
    const controller = new AbortController();
    if (signal?.aborted) throw new DOMException('La consulta fue reemplazada.', 'AbortError');
    const abort = () => controller.abort();
    const timeout = setTimeout(abort, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetchImpl(`${ENDPOINT}?${new URLSearchParams(parameters)}`, {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { Accept: 'application/json' }, signal: controller.signal,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.ok !== true) {
        throw new Error(API_ERRORS[body?.error] || 'No se pudo completar la consulta. Intenta nuevamente.');
      }
      return body;
    } catch (error) {
      if (controller.signal.aborted && !signal?.aborted) throw new Error('La consulta tardó demasiado. Intenta nuevamente.');
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }

  return {
    async getMarkets({ signal } = {}) {
      const body = await request({ action: 'markets' }, signal);
      if (!Array.isArray(body.markets) || !body.markets.every(validMarket)
        || new Set(body.markets.map(checkoutMarketKey)).size !== body.markets.length) {
        throw new Error('No se pudieron verificar los mercados. Intenta nuevamente.');
      }
      const unavailableVenues = Array.isArray(body.unavailableVenues) ? body.unavailableVenues.filter(validVenue) : [];
      return { markets: body.markets, unavailableVenues };
    },
    async getQuote({ market, outcomeIndex, side, amountMxn }, { signal } = {}) {
      const outcome = market?.outcomes?.find(item => item.index === outcomeIndex);
      if (!validMarket(market) || !outcome || !['buy', 'sell'].includes(side) || !TICKETS_MXN.includes(amountMxn)) {
        throw new Error('Selecciona un mercado, una opción y un monto válido.');
      }
      const body = await request({
        action: 'quote', venue: market.venue, marketId: market.id, outcomeIndex, side, amountMxn,
      }, signal);
      const { market: refreshed, quote } = body;
      if (!validMarket(refreshed) || checkoutMarketKey(refreshed) !== checkoutMarketKey(market)
        || refreshed.outcomes.find(item => item.index === outcomeIndex)?.label !== outcome.label) {
        throw new Error('El mercado o la opción cambiaron. Actualiza la lista de mercados.');
      }
      if (!quote || !Object.hasOwn(QUOTE_STATUS, quote.status) || quote.eligible !== (quote.status === 'eligible')
        || quote.executable !== false || quote.side !== side || quote.ticketMxn !== amountMxn
        || quote.feeCapBps !== 500 || !Number.isFinite(Date.parse(quote.expiresAt))
        || (quote.eligible && (!Number.isFinite(quote.feeBps) || quote.feeBps < 0 || quote.feeBps > quote.feeCapBps))) {
        throw new Error('No se pudo verificar la cotización. Solicita una nueva.');
      }
      return { market: refreshed, quote };
    },
  };
}
