/**
 * Shared API logger for Vercel serverless functions.
 *
 * Logs are visible in Vercel's Runtime Logs dashboard.
 * Structured JSON format for easy filtering and search.
 *
 * Usage:
 *   import { logger } from './_lib/logger.js';
 *   logger.info('markets', 'Fetched 10 markets', { count: 10 });
 *   logger.error('indexer', 'Failed to process block', { block: 123 }, err);
 */

function formatLog(level, service, message, meta = {}, error = null) {
  const entry = {
    level,
    service: `pronos-api/${service}`,
    message,
    timestamp: new Date().toISOString(),
    ...meta,
  };

  if (error) {
    entry.error = {
      name: error.name,
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
    };
  }

  return JSON.stringify(entry);
}

export const logger = {
  info(service, message, meta) {
    console.log(formatLog('info', service, message, meta));
  },

  warn(service, message, meta) {
    console.warn(formatLog('warn', service, message, meta));
  },

  error(service, message, meta, error) {
    console.error(formatLog('error', service, message, meta, error));
  },
};

/**
 * Wrap an API handler with error logging and CORS.
 * Catches unhandled errors, logs them, and returns 500.
 */
export function withLogging(service, handler) {
  return async (req, res) => {
    const start = Date.now();
    const origin = req.headers.origin;
    const allowed = origin === 'https://pronos.io' || origin === 'http://localhost:3333';
    res.setHeader('Access-Control-Allow-Origin', allowed ? origin : 'https://pronos.io');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
      await handler(req, res);
      logger.info(service, `${req.method} ${req.url}`, {
        method: req.method,
        status: res.statusCode,
        duration: Date.now() - start,
      });
    } catch (err) {
      logger.error(service, `Unhandled error: ${req.method} ${req.url}`, {
        method: req.method,
        duration: Date.now() - start,
      }, err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  };
}
