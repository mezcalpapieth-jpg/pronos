const ENDPOINT = '/api/polymarket-pilot';
const DECIMAL = /^\d{1,7}(?:\.\d{1,6})?$/;
const ERRORS = {
  polymarket_pilot_disabled: 'El piloto de Polymarket no está habilitado en este entorno.',
  pilot_disabled: 'El piloto de Polymarket no está habilitado en este entorno.',
  invalid_market: 'Selecciona un mercado válido de la lista del piloto.',
  invalid_market_id: 'Selecciona un mercado válido de la lista del piloto.',
  unsupported_market: 'Este mercado no cumple los criterios del piloto deportivo binario.',
  unsupported_cancellation: 'No se pudo confirmar que este mercado pague 50/50 en caso de cancelación. Actualiza la lista de mercados.',
  unsupported_version: 'La versión de este mercado todavía no es compatible con el piloto.',
  market_not_trading: 'Este mercado no acepta nuevas órdenes en este momento.',
  upstream_unavailable: 'Polymarket no respondió. Intenta nuevamente en unos momentos.',
  upstream_malformed: 'Polymarket devolvió datos incompletos. No se generó una cotización.',
  upstream_too_large: 'La respuesta del proveedor no pudo procesarse. Intenta con otro mercado.',
  market_id_mismatch: 'Los datos recibidos no corresponden al mercado seleccionado. Actualiza la lista.',
  book_id_mismatch: 'El libro recibido no corresponde a la opción seleccionada. Vuelve a consultar.',
  book_parameters_changed: 'Las condiciones del mercado cambiaron. Solicita una nueva simulación.',
  stale_book: 'El libro de órdenes está desactualizado. Solicita una nueva simulación.',
  stale_quote: 'La cotización caducó. Solicita una nueva simulación.',
  stale_snapshot: 'Los datos del mercado caducaron. Solicita una nueva simulación.',
  invalid_depth: 'No hay profundidad válida suficiente para simular esta operación.',
  crossed_book: 'El libro muestra precios inconsistentes. Intenta nuevamente.',
  invalid_book_time: 'No se pudo comprobar la vigencia del libro. No se generó una cotización.',
  unsupported_fees: 'No se pudieron verificar las comisiones de este mercado. No se generó una cotización.',
  invalid_decimal: 'Ingresa un monto positivo con hasta seis decimales.',
  invalid_side: 'Selecciona comprar o vender.',
  invalid_outcome: 'Selecciona una de las dos opciones del mercado.',
  fees_exceed_proceeds: 'Las comisiones superan el ingreso de esta venta. Prueba otro monto.',
};

export function polymarketErrorMessage(error, status) {
  const raw = typeof error === 'string' ? error : error?.code || error?.message;
  const code = String(raw || '').toLowerCase();
  if (ERRORS[code]) return ERRORS[code];
  if (/^[a-z]+(?:_[a-z]+)+$/.test(code)) {
    return `No se pudo completar la consulta. Referencia: ${code}.`;
  }
  return typeof error?.message === 'string' ? error.message
    : typeof error === 'string' ? error : `No se pudo consultar Polymarket (HTTP ${status}).`;
}

export function polymarketWarningMessage(warning) {
  const text = String(warning);
  if (text.startsWith('access_eligibility_unverified:')) {
    return 'La consulta pública de este mercado no confirma tu elegibilidad para operar. El acceso debe verificarse antes de habilitar trading.';
  }
  if (/proposed.*fee|fee.*proposed|target.*fee|fee.*target|builder.*unverified/i.test(text)) {
    return 'La simulación usa la tarifa objetivo de Pronos. La tasa efectiva debe verificarse antes de operar; aún no se han verificado abonos de comisiones.';
  }
  if (/rounding|round.*displayed|displayed.*round/i.test(text)) {
    return 'Las comisiones se redondean de forma conservadora por nivel visible del libro.';
  }
  if (/indicative|simulation|guarantee|execution|fill/i.test(text)) {
    return 'La cotización es indicativa y simula la liquidez publicada. No garantiza una ejecución.';
  }
  if (/partial|depth|liquidity|minimum|min.?order/i.test(text)) {
    return 'Revisa el mínimo del mercado y la cobertura mostrada. La liquidez visible puede cubrir solo parte del monto solicitado.';
  }
  return text;
}

export function polymarketTimestamp(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || value.trim() === '') return NaN;
  return /^\d+$/.test(value) ? Number(value) : Date.parse(value);
}

export function validatePolymarketQuote(input) {
  const marketId = String(input?.marketId ?? '').trim();
  const outcomeIndex = Number(input?.outcomeIndex);
  const side = input?.side;
  const amount = String(input?.amount ?? '').trim();
  if (!/^[1-9]\d{0,17}$/.test(marketId)) throw new Error('Selecciona un mercado válido.');
  if (!['0', '1', 0, 1].includes(input?.outcomeIndex) || !Number.isInteger(outcomeIndex)) {
    throw new Error('Selecciona una de las dos opciones del mercado.');
  }
  if (!['buy', 'sell'].includes(side)) throw new Error('Selecciona comprar o vender.');
  if (!DECIMAL.test(amount) || Number(amount) <= 0 || Number(amount) > 1_000_000) {
    throw new Error('Ingresa un monto mayor a cero, hasta 1,000,000 y con hasta seis decimales.');
  }
  const [whole, fraction = ''] = amount.split('.');
  const decimals = fraction.replace(/0+$/, '');
  return { marketId, outcomeIndex, side, amount: `${Number(whole)}${decimals ? `.${decimals}` : ''}` };
}

function cancelled() {
  return new DOMException('La consulta fue reemplazada.', 'AbortError');
}

export function createPolymarketPilot({ fetchImpl = globalThis.fetch, timeoutMs = 12_000 } = {}) {
  async function request(parameters, signal) {
    const controller = new AbortController();
    if (signal?.aborted) throw cancelled();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    try {
      const response = await fetchImpl(`${ENDPOINT}?${new URLSearchParams(parameters)}`, {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { Accept: 'application/json' }, signal: controller.signal,
      });
      let body;
      try { body = await response.json(); } catch { throw new Error('Polymarket no devolvió una respuesta válida.'); }
      if (!response.ok || body?.ok === false || body?.error) {
        throw new Error(polymarketErrorMessage(body?.error, response.status));
      }
      return body;
    } catch (error) {
      if (controller.signal.aborted && !signal?.aborted) {
        throw new Error('La consulta tardó demasiado. Intenta nuevamente.');
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  return Object.freeze({
    async getMarkets({ signal } = {}) {
      const result = await request({ action: 'markets' }, signal);
      if (!Array.isArray(result?.markets) || result.markets.length > 5) {
        throw new Error('La lista de mercados no tiene el formato esperado.');
      }
      return result;
    },
    async getQuote(input, { signal } = {}) {
      const valid = validatePolymarketQuote(input);
      const result = await request({ action: 'quote', ...valid }, signal);
      if (!result?.quote || typeof result.quote !== 'object') {
        throw new Error('La cotización no tiene el formato esperado.');
      }
      return result;
    },
  });
}

/** Ignore replaced responses even if a transport fails to honor AbortSignal. */
export function createPolymarketQuoteSession(client) {
  let current = 0;
  let controller;
  return {
    cancel() {
      current += 1;
      controller?.abort();
    },
    async getQuote(input) {
      const version = ++current;
      controller?.abort();
      controller = new AbortController();
      try {
        const result = await client.getQuote(input, { signal: controller.signal });
        if (version !== current) throw cancelled();
        return result;
      } catch (error) {
        if (version !== current) throw cancelled();
        throw error;
      }
    },
  };
}

export function polymarketQuoteExpired(quote, now = Date.now()) {
  const expiry = polymarketTimestamp(quote?.expiresAt);
  return !Number.isFinite(expiry) || expiry <= now;
}
