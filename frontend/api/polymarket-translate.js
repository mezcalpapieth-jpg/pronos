/**
 * @deprecated DO NOT USE — Polymarket integration removed.
 * See api/gamma.js for the full deprecation notice.
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.status(410).json({
    error: 'gone',
    message: 'Polymarket translation removed. Pronos markets are authored in Spanish.',
  });
}
