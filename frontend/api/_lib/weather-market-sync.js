function asObject(value, fallback = null) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function ymdFromDate(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function extractDateYmdFromQuestion(question) {
  const q = String(question || '');
  const slash = q.match(/\b([0-3]?\d)\/([01]?\d)\/(\d{4})\b/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    const year = Number(slash[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }

  const iso = q.match(/\b(\d{4})-([01]\d)-([0-3]\d)\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function isWeatherConfig(cfg) {
  if (!cfg) return false;
  if (String(cfg.source || '') === 'open-meteo') return true;
  return Boolean(cfg.forecastDateYmd && Array.isArray(cfg.buckets));
}

export function syncWeatherDateFromMarket({
  question,
  endTime,
  resolverConfig,
  sourceData,
} = {}) {
  const cfg = asObject(resolverConfig, null);
  if (!isWeatherConfig(cfg)) {
    return {
      resolverConfig,
      sourceData,
      changed: false,
    };
  }

  const nextDateYmd = extractDateYmdFromQuestion(question) || ymdFromDate(endTime);
  if (!nextDateYmd) {
    return {
      resolverConfig: cfg,
      sourceData,
      changed: false,
    };
  }

  const data = asObject(sourceData, {}) || {};
  const configChanged = cfg.forecastDateYmd !== nextDateYmd;
  const sourceDataChanged = data.forecastDateYmd !== nextDateYmd;
  if (!configChanged && !sourceDataChanged) {
    return {
      resolverConfig: cfg,
      sourceData: data,
      changed: false,
    };
  }

  const nextConfig = {
    ...cfg,
    forecastDateYmd: nextDateYmd,
  };
  const nextSourceData = {
    ...data,
    forecastDateYmd: nextDateYmd,
  };

  return {
    resolverConfig: nextConfig,
    sourceData: nextSourceData,
    forecastDateYmd: nextDateYmd,
    changed: true,
  };
}
