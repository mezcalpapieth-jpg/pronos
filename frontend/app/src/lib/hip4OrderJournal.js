const CLOID = /^0x[0-9a-f]{32}$/;
const COIN = /^#[1-9]\d{0,7}[01]$/;
const STATES = ['unknown', 'accepted', 'filled', 'partial', 'canceled', 'rejected'];
const STORAGE_ERROR = 'No se pudo acceder al historial de órdenes de este navegador. Revisa el almacenamiento y el estado de las órdenes.';
const CANCELED = new Set(['canceled', 'scheduledCancel', 'iocCancel']);
const ACCEPTED = new Set(['open', 'triggered']);

export const isPendingHip4Order = order => order.state === 'unknown' || order.state === 'accepted';

function shares(value) {
  const n = typeof value === 'string' && /^\d+(\.0+)?$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function price(value) {
  const n = typeof value === 'string' && /^\d+\.\d+$/.test(value) ? Number(value) : NaN;
  return n > 0 && n < 1 ? n : null;
}

function oid(value) {
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  return typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value) ? value : null;
}

function withinLimit(paid, entry) {
  return paid != null && (entry.side === 'buy' ? paid <= price(entry.price) : paid >= price(entry.price));
}

function validEntry(entry, cloid, network) {
  return entry?.cloid === cloid && entry.network === network && CLOID.test(cloid)
    && COIN.test(entry.coin) && ['buy', 'sell'].includes(entry.side) && price(entry.price) != null
    && shares(entry.size) > 0 && Number.isSafeInteger(entry.nonce) && entry.nonce > 0
    && Number.isSafeInteger(entry.expiresAfter) && entry.expiresAfter > entry.nonce
    && STATES.includes(entry.state);
}

export function createHip4OrderJournal({ owner, network, storage, locks = globalThis.navigator?.locks }) {
  const prefix = `pronos:hip4:orders:v1:${network}:${owner}:`;
  const locked = action => locks ? locks.request(prefix, async () => action()) : action();

  function access(action) {
    try {
      return action(storage ?? globalThis.localStorage);
    } catch (error) {
      if (error?.message === STORAGE_ERROR) throw error;
      throw new Error(STORAGE_ERROR, { cause: error });
    }
  }

  function read(store, cloid) {
    const raw = store.getItem(prefix + cloid);
    if (raw == null) return null;
    const entry = JSON.parse(raw);
    if (!validEntry(entry, cloid, network)) throw new Error(STORAGE_ERROR);
    return entry;
  }

  function entries(store) {
    const result = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key?.startsWith(prefix)) {
        const entry = read(store, key.slice(prefix.length));
        if (entry) result.push(entry);
      }
    }
    return result.sort((a, b) => b.nonce - a.nonce);
  }

  function write(store, entry) {
    const key = prefix + entry.cloid;
    const value = JSON.stringify(entry);
    store.setItem(key, value);
    if (store.getItem(key) !== value) throw new Error(STORAGE_ERROR);
    return entry;
  }

  return {
    list: () => access(entries),
    get: cloid => CLOID.test(cloid) ? access(store => read(store, cloid)) : null,
    async begin(intent) {
      return locked(() => {
        const pending = access(entries).find(order =>
          order.cloid === intent.cloid
          || (isPendingHip4Order(order) && order.coin === intent.coin && order.side === intent.side));
        if (pending) {
          throw new Error(`Consulta el estado de la orden pendiente ${pending.cloid} antes de enviar otra en el mismo sentido.`);
        }
        return access(store => write(store, { ...intent, network, state: 'unknown' }));
      });
    },
    async update(cloid, observation) {
      return locked(() => access(store => {
        const entry = read(store, cloid);
        if (!entry) throw new Error(STORAGE_ERROR);
        if (!isPendingHip4Order(entry) || (entry.oid && observation.oid && entry.oid !== observation.oid)) return entry;
        if (entry.state === 'accepted' && observation.state === 'unknown') {
          return write(store, { ...entry, checkedAt: observation.checkedAt ?? entry.checkedAt });
        }
        return write(store, { ...entry, ...observation });
      }));
    },
  };
}

export function hip4SubmissionResult(response, intent) {
  if (response?.status === 'err' && typeof response.response === 'string' && response.response) {
    return { state: 'rejected', error: response.response.slice(0, 500) };
  }
  if (response?.status !== 'ok') return { state: 'unknown' };
  const statuses = response.response?.data?.statuses;
  const order = Array.isArray(statuses) && statuses.length === 1 ? statuses[0] : null;
  if (typeof order?.error === 'string' && order.error) {
    return { state: 'rejected', error: order.error.slice(0, 500) };
  }
  if (order?.filled) {
    const filledSize = shares(order.filled.totalSz);
    const averagePrice = price(order.filled.avgPx);
    const orderId = oid(order.filled.oid);
    if (orderId && filledSize > 0 && filledSize <= shares(intent.size) && withinLimit(averagePrice, intent)) {
      return {
        state: filledSize === shares(intent.size) ? 'filled' : 'partial',
        filledSize: String(filledSize), averagePrice: order.filled.avgPx, oid: orderId,
      };
    }
  }
  const orderId = oid(order?.resting?.oid);
  return orderId ? { state: 'accepted', oid: orderId } : { state: 'unknown' };
}

function fillSummary(fills, orderId, entry) {
  if (!Array.isArray(fills)) return null;
  const direction = entry.side === 'buy' ? 'Buy' : 'Sell';
  const side = entry.side === 'buy' ? 'B' : 'A';
  const tradeIds = new Set();
  let size = 0;
  let notional = 0;

  for (const fill of fills) {
    if (oid(fill?.oid) !== orderId || (fill.dir !== 'Buy' && fill.dir !== 'Sell')) continue;
    const quantity = shares(fill.sz);
    const paid = price(fill.px);
    const tradeId = oid(fill.tid);
    if (fill.coin !== entry.coin || fill.side !== side || fill.dir !== direction || !quantity
      || !withinLimit(paid, entry) || tradeId == null || tradeIds.has(tradeId)) return null;
    tradeIds.add(tradeId);
    size += quantity;
    notional += quantity * paid;
  }
  if (size > shares(entry.size)) return null;
  return {
    filledSize: String(size),
    averagePrice: size ? String(Number((notional / size).toFixed(8))) : null,
  };
}

export async function readHip4OrderStatus(info, entry) {
  const result = await info('orderStatus', { oid: entry.cloid });
  const detail = result?.order;
  const order = detail?.order;
  const requested = shares(entry.size);
  const orderId = oid(order?.oid);
  if (result?.status !== 'order' || !orderId || typeof detail.status !== 'string'
    || typeof order.cloid !== 'string' || order.cloid.toLowerCase() !== entry.cloid || order.coin !== entry.coin
    || order.side !== (entry.side === 'buy' ? 'B' : 'A') || shares(order.origSz) !== requested
    || price(order.limitPx) !== price(entry.price) || (entry.oid && entry.oid !== orderId)) return { state: 'unknown' };

  const { status } = detail;
  const accepted = { state: 'accepted', oid: orderId, venueStatus: status.slice(0, 80) };
  if (status === 'rejected' || status.endsWith('Rejected')) {
    return { ...accepted, state: 'rejected', error: accepted.venueStatus };
  }
  if (ACCEPTED.has(status)) return accepted;
  const canceled = CANCELED.has(status) || status.endsWith('Canceled');
  if (status !== 'filled' && !canceled) return accepted;

  let fills;
  try {
    fills = await info('userFillsByTime', {
      startTime: Math.max(0, entry.nonce - 1000),
      endTime: (Number.isSafeInteger(detail.statusTimestamp) ? detail.statusTimestamp : entry.expiresAfter) + 1000,
      aggregateByTime: false,
    });
  } catch {
    fills = null;
  }
  const summary = fillSummary(fills, orderId, entry);
  if (status === 'filled') {
    return {
      ...accepted, state: 'filled', filledSize: entry.size,
      averagePrice: summary?.filledSize === entry.size ? summary.averagePrice : null,
    };
  }
  // Cancelled IOC orders can have fills. Wait when the fills do not yet match the remaining size.
  const remaining = shares(order.sz);
  if (!summary || remaining == null || remaining > requested
    || shares(summary.filledSize) !== requested - remaining) return accepted;

  return { ...accepted, ...summary, state: summary.filledSize === '0' ? 'canceled' : 'partial' };
}
