export const CRYPTO_TICK_BUCKET_MS = 5_000;
export const CRYPTO_TICK_RETENTION_HOURS = 72;
export const CRYPTO_TICK_CLEANUP_INTERVAL_MS = 60 * 60_000;
export const CRYPTO_TICK_CLEANUP_GRACE_MS = 60_000;

function rowsFromQuery(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.rows)) return result.rows;
  return [];
}

export function cryptoTickBucketIso(capturedAt = Date.now(), bucketMs = CRYPTO_TICK_BUCKET_MS) {
  const ms = capturedAt instanceof Date
    ? capturedAt.getTime()
    : (typeof capturedAt === 'number' ? capturedAt : new Date(capturedAt).getTime());
  if (!Number.isFinite(ms)) throw new Error('crypto-ticks: invalid capturedAt');
  const bucket = Math.max(1, Math.floor(Number(bucketMs) || CRYPTO_TICK_BUCKET_MS));
  return new Date(Math.floor(ms / bucket) * bucket).toISOString();
}

export function shouldPruneCryptoTicks({
  stored,
  bucketIso,
  cleanupIntervalMs = CRYPTO_TICK_CLEANUP_INTERVAL_MS,
  cleanupGraceMs = CRYPTO_TICK_CLEANUP_GRACE_MS,
} = {}) {
  if (!stored) return false;
  const bucketMs = bucketIso ? new Date(bucketIso).getTime() : NaN;
  if (!Number.isFinite(bucketMs)) return false;
  const interval = Math.max(1, Math.floor(Number(cleanupIntervalMs) || CRYPTO_TICK_CLEANUP_INTERVAL_MS));
  const grace = Math.max(1, Math.floor(Number(cleanupGraceMs) || CRYPTO_TICK_CLEANUP_GRACE_MS));
  return bucketMs % interval < grace;
}

export async function insertCryptoTick(sql, {
  asset,
  price,
  capturedAt = Date.now(),
  bucketMs = CRYPTO_TICK_BUCKET_MS,
} = {}) {
  if (!sql) throw new Error('crypto-ticks: sql client required');
  const normalizedAsset = String(asset || '').trim().toLowerCase();
  if (!normalizedAsset) throw new Error('crypto-ticks: asset required');
  const normalizedPrice = Number(price);
  if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
    throw new Error('crypto-ticks: invalid price');
  }

  const bucketIso = cryptoTickBucketIso(capturedAt, bucketMs);
  const inserted = await sql`
    INSERT INTO crypto_ticks (asset, captured_at, price)
    VALUES (${normalizedAsset}, ${bucketIso}::timestamptz, ${normalizedPrice})
    ON CONFLICT (asset, captured_at) DO NOTHING
    RETURNING id
  `;

  return {
    stored: rowsFromQuery(inserted).length > 0,
    bucket: bucketIso,
  };
}

export async function pruneCryptoTicks(sql, {
  asset,
  retentionHours = CRYPTO_TICK_RETENTION_HOURS,
} = {}) {
  if (!sql) throw new Error('crypto-ticks: sql client required');
  const normalizedAsset = String(asset || '').trim().toLowerCase();
  if (!normalizedAsset) throw new Error('crypto-ticks: asset required');
  const hours = Math.max(1, Math.floor(Number(retentionHours) || CRYPTO_TICK_RETENTION_HOURS));

  const deleted = await sql`
    WITH deleted AS (
      DELETE FROM crypto_ticks
      WHERE asset = ${normalizedAsset}
        AND captured_at < NOW() - (${hours}::int * INTERVAL '1 hour')
      RETURNING 1
    )
    SELECT COUNT(*)::int AS deleted
    FROM deleted
  `;
  const row = rowsFromQuery(deleted)[0] || {};
  return Number(row.deleted || 0);
}

export async function maybePruneCryptoTicks(sql, {
  asset,
  stored,
  bucketIso,
  retentionHours = CRYPTO_TICK_RETENTION_HOURS,
  cleanupIntervalMs = CRYPTO_TICK_CLEANUP_INTERVAL_MS,
  cleanupGraceMs = CRYPTO_TICK_CLEANUP_GRACE_MS,
} = {}) {
  if (!shouldPruneCryptoTicks({ stored, bucketIso, cleanupIntervalMs, cleanupGraceMs })) {
    return { pruned: false, deleted: 0 };
  }
  const deleted = await pruneCryptoTicks(sql, { asset, retentionHours });
  return { pruned: true, deleted };
}
