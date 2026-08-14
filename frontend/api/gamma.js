/**
 * @deprecated DO NOT USE — Polymarket Gamma proxy removed.
 *
 * Pronos no longer integrates Polymarket. This endpoint stays as a
 * 410 Gone responder so old clients get a clear "this is deliberately
 * gone" signal instead of a CORS error or a silent timeout. Delete
 * the file once no production traffic hits it (check Vercel logs).
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.status(410).json({
    error: 'gone',
    message: 'Pronos no longer proxies Polymarket. We run our own contracts on Arbitrum.',
  });
}
