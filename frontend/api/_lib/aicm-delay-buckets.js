function normalizeDayCount(days = 1) {
  const n = Number(days);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.max(1, Math.round(n));
}

export function scaleDailyCountBuckets(baseBuckets, days = 1) {
  const dayCount = normalizeDayCount(days);
  if (!Array.isArray(baseBuckets)) return [];

  let previousMax = -1;
  return baseBuckets.map((bucket, index) => {
    const minCount = previousMax + 1;
    const nextBucket = baseBuckets[index + 1];
    let maxCount = null;

    if (bucket?.maxCount != null) {
      const max = Number(bucket.maxCount);
      const nextMin = Number(nextBucket?.minCount);
      if (!Number.isFinite(max)) {
        maxCount = null;
      } else if (index === 0 && Number.isFinite(nextMin)) {
        maxCount = (nextMin * dayCount) - 1;
      } else {
        maxCount = max * dayCount;
      }
    }

    if (maxCount != null) previousMax = maxCount;
    return {
      ...bucket,
      label: maxCount == null ? `${minCount}+` : `${minCount}-${maxCount}`,
      minCount,
      maxCount,
    };
  });
}
