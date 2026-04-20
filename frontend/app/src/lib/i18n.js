// ─── I18N ────────────────────────────────────────────────────────────────────
// Tiny dictionary-based translation layer for the Pronos UI chrome.
// Market titles themselves are NOT translated — they come from Polymarket
// (English) or the hardcoded MARKETS file (Spanish) and stay in their source
// language. This module only handles the surrounding UI: nav, buttons, banners,
// modal copy, etc.
//
// Usage:
//   import { useT, setLang } from '../lib/i18n.js';
//   function MyButton() {
//     const t = useT();
//     return <button>{t('nav.predict')}</button>;
//   }
//
// To add a string: add a key under STRINGS with both `es` and `en`. Missing
// keys fall back to Spanish, then to the raw key, so it's safe to ship a
// partial translation.

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'pronos-lang';
const CHANGE_EVENT = 'pronos-lang-change';

export const LANGS = ['es', 'en'];
export const DEFAULT_LANG = 'es';

// Read saved language. Defaults to Spanish — switching is opt-in via the toggle
// so existing users see no change unless they explicitly choose English.
export function getLang() {
  if (typeof window === 'undefined') return DEFAULT_LANG;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return LANGS.includes(v) ? v : DEFAULT_LANG;
  } catch (_) {
    return DEFAULT_LANG;
  }
}

export function setLang(lang) {
  if (!LANGS.includes(lang)) return;
  try { window.localStorage.setItem(STORAGE_KEY, lang); } catch (_) {}
  // Broadcast so every useT() subscriber re-renders without prop-drilling
  // through Privy / Router providers.
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: lang }));
}

// React hook: returns a `t(key, vars)` function and re-renders the calling
// component whenever the language changes.
export function useT() {
  const [lang, setLocalLang] = useState(getLang);
  useEffect(() => {
    const handler = (e) => setLocalLang(e.detail || getLang());
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, []);
  return (key, vars) => translate(key, lang, vars);
}

// Same as useT but exposes the language string itself (for conditional copy
// or formatting that doesn't fit a single key).
export function useLang() {
  const [lang, setLocalLang] = useState(getLang);
  useEffect(() => {
    const handler = (e) => setLocalLang(e.detail || getLang());
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, []);
  return lang;
}

// ─── Market title / option localization ─────────────────────────────────────
// Polymarket markets carry both `title_en` (Gamma original) and `title_es`
// (admin-approved Spanish translation). These helpers pick the right one based
// on the active language, falling back to whatever `title` holds.

/**
 * Pick the language-appropriate title for a market object.
 */
export function localizedTitle(market, lang) {
  if (!market) return '';
  if (lang === 'en' && market.title_en) return market.title_en;
  if (lang === 'es' && market.title_es) return market.title_es;
  return market.title || '';
}

// Common option labels that should auto-translate even when no explicit
// options_en / options_es exists (e.g. Polymarket markets whose translation
// failed or wasn't cached yet).
const LABEL_EN_TO_ES = { 'Yes': 'Sí', 'yes': 'sí', 'Draw': 'Empate', 'Other': 'Otro' };
const LABEL_ES_TO_EN = { 'Sí': 'Yes', 'sí': 'yes', 'Empate': 'Draw', 'Otro': 'Other' };

/**
 * Pick the language-appropriate options array. Merges localized labels onto
 * the base `market.options` so live `pct` values are always preserved.
 * When no explicit alt array exists, common labels (Yes/No, Sí/No) are
 * auto-translated so markets never show mixed-language labels.
 */
export function localizedOptions(market, lang) {
  if (!market || !Array.isArray(market.options)) return market?.options || [];
  const alt = lang === 'en' ? market.options_en
            : lang === 'es' ? market.options_es
            : null;
  if (Array.isArray(alt)) {
    return market.options.map((opt, i) => ({
      ...opt,
      label: alt[i]?.label ?? opt.label,
    }));
  }
  // Fallback: auto-translate common labels when no explicit alt exists
  const fallback = lang === 'es' ? LABEL_EN_TO_ES : lang === 'en' ? LABEL_ES_TO_EN : null;
  if (!fallback) return market.options;
  return market.options.map(opt => ({
    ...opt,
    label: fallback[opt.label] ?? opt.label,
  }));
}

// Pure translator — usable outside React components if needed.
export function translate(key, lang, vars) {
  const entry = STRINGS[key];
  if (!entry) return key;
  let str = entry[lang] || entry[DEFAULT_LANG] || key;
  if (vars && typeof str === 'string') {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return str;
}

// ─── DICTIONARY ──────────────────────────────────────────────────────────────
// Keys are organized by component prefix (nav.*, hero.*, bet.*, etc.) so it's
// easy to find what needs translating when adding a new feature.
const STRINGS = {
  // ── Nav ────────────────────────────────────────────────────────────────────
  'nav.search.placeholder':   { es: 'Buscar mercados…',     en: 'Search markets…' },
  'nav.search.empty':         { es: 'No se encontraron mercados', en: 'No markets found' },
  'nav.search.aria':          { es: 'Buscar',               en: 'Search' },
  'nav.market':               { es: 'El mercado',           en: 'Markets' },
  'nav.portfolio':            { es: 'Portafolio',           en: 'Portfolio' },
  'nav.howItWorks':           { es: 'Cómo funciona',        en: 'How it works' },
  'nav.theme':                { es: 'Cambiar tema',         en: 'Toggle theme' },
  'nav.deposit':              { es: 'Depositar',            en: 'Deposit' },
  'nav.switchTo':             { es: 'Cambiar a {chain}',    en: 'Switch to {chain}' },
  'nav.signOut':              { es: 'Cerrar sesión',        en: 'Sign out' },
  'nav.predict':              { es: 'Predecir',             en: 'Predict' },
  'nav.admin':                { es: 'Admin',                en: 'Admin' },

  // ── Hero ───────────────────────────────────────────────────────────────────
  'hero.badge':               { es: 'Beta · Powered by Polymarket', en: 'Beta · Powered by Polymarket' },
  'hero.headline.line1':      { es: 'El primer mercado',    en: 'The first' },
  'hero.headline.line2':      { es: 'de predicciones',      en: 'on-chain prediction' },
  'hero.headline.line3':      { es: 'on-chain',             en: 'market' },
  'hero.sub':                 { es: 'Predice eventos de política, deportes, cultura y crypto en Latinoamérica. Gana USDC cuando aciertas. Sin intermediarios. Sin MetaMask.',
                                en: 'Predict politics, sports, culture and crypto events in Latin America. Earn USDC when you\'re right. No middlemen. No MetaMask.' },
  'hero.cta.viewMarkets':     { es: 'Ver Mercados',         en: 'View Markets' },
  'hero.cta.start':            { es: 'Empezar a Predecir',  en: 'Start Predicting' },
  'hero.cta.howItWorks':      { es: 'Cómo funciona',        en: 'How it works' },
  'hero.stats.volumeLabel':   { es: 'volumen Polymarket',   en: 'Polymarket volume' },
  'hero.stats.activeLabel':   { es: 'mercados activos',     en: 'active markets' },
  'hero.stats.feeLabel':      { es: 'comisión · sin gas',   en: 'fee · gas-free' },
  'hero.featured':            { es: 'DESTACADOS',           en: 'FEATURED' },
  'hero.live':                { es: 'LIVE',                 en: 'LIVE' },

  // ── MarketsGrid / MarketCard ──────────────────────────────────────────────
  'grid.loading':             { es: 'CARGANDO MERCADOS…',   en: 'LOADING MARKETS…' },
  'grid.empty':               { es: 'No hay mercados en esta categoría.', en: 'No markets in this category.' },
  'grid.fallback':            { es: 'Usando datos locales — API no disponible.', en: 'Using local data — API unavailable.' },
  'card.resolved':            { es: '🏆 RESUELTO',          en: '🏆 RESOLVED' },
  'card.closed':              { es: '🔒 CERRADO',           en: '🔒 CLOSED' },
  'card.trending':            { es: '🔥 TRENDING',          en: '🔥 TRENDING' },
  'card.live':                { es: 'LIVE',                 en: 'LIVE' },

  // ── Categories ────────────────────────────────────────────────────────────
  'cat.trending':             { es: '🔥 Trending',          en: '🔥 Trending' },
  'cat.all':                  { es: 'Todos',                en: 'All' },
  'cat.mexico':               { es: '🇲🇽 México & LATAM',   en: '🇲🇽 Mexico & LATAM' },
  'cat.politica':             { es: '🌎 Política Internacional', en: '🌎 World Politics' },
  'cat.deportes':             { es: '⚽ Deportes',          en: '⚽ Sports' },
  'cat.finanzas':             { es: '$ Finanzas',           en: '$ Finance' },
  'cat.crypto':               { es: '₿ Crypto',             en: '₿ Crypto' },
  'cat.musica':               { es: '🎵 Música & Farándula', en: '🎵 Music & Pop Culture' },
  'cat.resueltos':            { es: '🏆 Resueltos',         en: '🏆 Resolved' },

  // ── BetModal ───────────────────────────────────────────────────────────────
  'bet.title':                { es: 'COLOCAR APUESTA',      en: 'PLACE BET' },
  'bet.balance':              { es: 'Balance USDC',         en: 'USDC Balance' },
  'bet.amount':               { es: 'MONTO (USDC)',         en: 'AMOUNT (USDC)' },
  'bet.fee':                  { es: 'Comisión ({pct}%)',    en: 'Fee ({pct}%)' },
  'bet.estimatedPayout':      { es: 'Pago estimado',        en: 'Estimated payout' },
  'bet.profit':               { es: 'Ganancia potencial',   en: 'Potential profit' },
  'bet.implied':              { es: 'Probabilidad implícita', en: 'Implied probability' },
  'bet.priceAfter':           { es: 'Precio tras tu compra', en: 'Price after your trade' },
  'bet.slippage':             { es: 'Slippage',             en: 'Slippage' },
  'bet.previewLoading':       { es: 'Calculando on-chain…', en: 'Calculating on-chain…' },
  'bet.previewUnavailable':   { es: 'Vista previa no disponible', en: 'Preview unavailable' },
  'bet.btn.join':             { es: 'ÚNETE A LA LISTA',     en: 'JOIN THE WAITLIST' },
  'bet.btn.checking':         { es: 'Verificando…',         en: 'Checking…' },
  'bet.btn.approving':        { es: 'Aprobando USDC…',      en: 'Approving USDC…' },
  'bet.btn.signing':          { es: 'Firmando…',            en: 'Signing…' },
  'bet.btn.placing':          { es: 'Enviando orden…',      en: 'Submitting order…' },
  'bet.btn.success':          { es: '✓ COMPRA REALIZADA',   en: '✓ TRADE COMPLETE' },
  'bet.btn.buyAmount':        { es: 'COMPRAR ${amt} USDC',  en: 'BUY ${amt} USDC' },
  'bet.btn.buy':              { es: 'COMPRAR',              en: 'BUY' },
  'bet.btn.unavailable':      { es: 'SIN TRADING EN VIVO',  en: 'LIVE TRADING UNAVAILABLE' },
  'bet.invalidAmount':        { es: 'Ingresa un monto válido.', en: 'Enter a valid amount.' },
  'bet.noWallet':             { es: 'No se encontró wallet. Reconecta tu cuenta.',
                                en: 'No wallet found. Reconnect your account.' },
  'bet.checking':             { es: 'Verificando balance y permisos…',
                                en: 'Checking balance and permissions…' },
  'bet.switchingChain':       { es: 'Cambiando de red…',    en: 'Switching network…' },
  'bet.switchChain':          { es: 'Cambia a {chain} para continuar.',
                                en: 'Switch to {chain} to continue.' },
  'bet.insufficient':         { es: 'Balance insuficiente. Tienes ${bal} USDC.',
                                en: 'Insufficient balance. You have ${bal} USDC.' },
  'bet.approving':            { es: 'Aprobando USDC… (confirma en tu wallet)',
                                en: 'Approving USDC… (confirm in your wallet)' },
  'bet.approved':             { es: 'USDC aprobado ✓',      en: 'USDC approved ✓' },
  'bet.signing':              { es: 'Firmando autenticación… (1 firma)',
                                en: 'Signing auth… (1 signature)' },
  'bet.placing':              { es: 'Enviando orden a Polymarket…',
                                en: 'Submitting order to Polymarket…' },
  'bet.placingProtocol':      { es: 'Enviando transacción al protocolo…',
                                en: 'Submitting protocol transaction…' },
  'bet.placed':               { es: '¡Apuesta colocada! ${amt} USDC en "{outcome}"',
                                en: 'Bet placed! ${amt} USDC on "{outcome}"' },
  'bet.warn.lowVolume':       { es: '⚠️ Volumen bajo: tu compra mueve el precio de {start}% a {end}% (+{pts} pts). Considera reducir el monto.',
                                en: '⚠️ Low volume: your trade moves the price from {start}% to {end}% (+{pts} pts). Consider reducing the amount.' },
  'bet.warn.lowLiquidity':    { es: '⚠️ Liquidez insuficiente: solo ${filled} USDC pueden ejecutarse al precio actual. La orden podría fallar.',
                                en: '⚠️ Low liquidity: only ${filled} USDC can fill at the current price. The order might fail.' },
  'bet.warn.demoMarket':      { es: '📊 Mercado demo: sin libro de órdenes en vivo, no podemos previsualizar slippage para este mercado.',
                                en: '📊 Demo market: no live order book, slippage preview unavailable for this market.' },
  'bet.noLiveTrading':        { es: 'Este mercado es informativo por ahora; todavía no tiene trading en vivo.',
                                en: 'This market is informational for now; live trading is not connected yet.' },
  'bet.protocolUnavailable':  { es: 'Este mercado del protocolo todavía no tiene pool o contratos configurados.',
                                en: 'This protocol market does not have a configured pool or contracts yet.' },
  'bet.protocol.poly':        { es: 'Polymarket · Polygon', en: 'Polymarket · Polygon' },
  'bet.protocol.own':         { es: 'Pronos Protocol · Arbitrum Sepolia', en: 'Pronos Protocol · Arbitrum Sepolia' },

  // ── MarketDetail ──────────────────────────────────────────────────────────
  'detail.loading':           { es: 'CARGANDO MERCADO…',    en: 'LOADING MARKET…' },
  'detail.notFound':          { es: 'Mercado no encontrado', en: 'Market not found' },
  'detail.back':              { es: '← Volver',             en: '← Back' },
  'detail.markets':           { es: '← MERCADOS',           en: '← MARKETS' },
  'detail.winner':            { es: 'Ganador',              en: 'Winner' },
  'detail.resolvedDate':      { es: 'MERCADO CERRADO · {date}', en: 'MARKET CLOSED · {date}' },
  'detail.resolved':          { es: 'RESUELTO',             en: 'RESOLVED' },
  'detail.awaitingTitle':     { es: 'Esperando resolución oficial', en: 'Awaiting official resolution' },
  'detail.awaitingSub':       { es: 'El resultado se publicará automáticamente cuando esté disponible',
                                en: 'The outcome will be published automatically when available' },
  'detail.toResolve':         { es: 'POR RESOLVER',         en: 'TO RESOLVE' },
  'detail.closed':            { es: 'CERRADO',              en: 'CLOSED' },
  'detail.lockedClosed':      { es: '🔒 CERRADO',           en: '🔒 CLOSED' },
  'detail.volume':            { es: 'VOLUMEN',              en: 'VOLUME' },
  'detail.liquidity':         { es: 'LIQUIDEZ',             en: 'LIQUIDITY' },
  'detail.closesOn':          { es: 'CIERRA',               en: 'CLOSES' },
  'detail.closedOn':          { es: 'CERRÓ',                en: 'CLOSED' },
  'detail.status':            { es: 'ESTADO',               en: 'STATUS' },
  'detail.statusActive':      { es: 'ACTIVO',               en: 'ACTIVE' },
  'detail.statusClosed':      { es: 'CERRADO',              en: 'CLOSED' },
  'detail.statusToResolve':   { es: 'POR RESOLVER',         en: 'TO RESOLVE' },
  'detail.priceHistory':      { es: 'HISTORIAL DE PRECIO',  en: 'PRICE HISTORY' },
  'detail.realtime':          { es: 'PRECIO EN TIEMPO REAL', en: 'REAL-TIME PRICE' },
  'detail.last30days':        { es: 'ÚLT. 30 DÍAS',         en: 'LAST 30 DAYS' },
  'detail.actions':           { es: 'ACCIONES',             en: 'ACTIONS' },
  'detail.waitingResult':     { es: 'ESPERANDO RESULTADO',  en: 'AWAITING RESULT' },
  'detail.rules':             { es: 'Reglas',               en: 'Rules' },
  'detail.context':           { es: 'Contexto de mercado',  en: 'Market context' },
  'detail.contextExtra':      { es: 'Contexto adicional',   en: 'Additional context' },
  'detail.updatedToday':      { es: 'Actualizado hoy',      en: 'Updated today' },
  'detail.aiSummary':         { es: 'Resumen experimental generado con IA referenciando datos de Pronos · Actualizado {date}',
                                en: 'Experimental AI-generated summary referencing Pronos data · Updated {date}' },
  'detail.comments':          { es: 'Comentarios',          en: 'Comments' },
  'detail.topHolders':        { es: 'Top Holders',          en: 'Top Holders' },
  'detail.positions':         { es: 'Posiciones',           en: 'Positions' },
  'detail.activity':          { es: 'Actividad',            en: 'Activity' },
  'detail.commentPlaceholder':{ es: 'Agrega un comentario...', en: 'Add a comment...' },
  'detail.publish':           { es: 'Publicar',             en: 'Publish' },
  'detail.externalWarn':      { es: '⚠️ Cuidado con links externos', en: '⚠️ Be careful with external links' },
  'detail.replies':           { es: '↩ {n} Respuestas',     en: '↩ {n} Replies' },
  'detail.timeAgo':           { es: '{t} atrás',            en: '{t} ago' },
  'detail.pnl':               { es: 'PNL',                  en: 'PnL' },
  'detail.all':               { es: 'Todos',                en: 'All' },
  'detail.minAmount':         { es: 'Monto mín ▾',          en: 'Min amount ▾' },
  'detail.live':              { es: 'En vivo',              en: 'Live' },
  'detail.boughtSold':        { es: 'Compró',               en: 'Bought' },
  'detail.finalProbs':        { es: 'PROBABILIDADES FINALES', en: 'FINAL PROBABILITIES' },
  'detail.closedAwaiting':    { es: 'CERRADO · ESPERANDO RESULTADO', en: 'CLOSED · AWAITING RESULT' },
  'detail.currentProb':       { es: 'PROBABILIDAD ACTUAL',  en: 'CURRENT PROBABILITY' },
  'detail.finalResults':      { es: 'RESULTADOS FINALES',   en: 'FINAL RESULTS' },
  'detail.results':           { es: 'RESULTADOS',           en: 'RESULTS' },
  'detail.buy':               { es: 'Comprar',              en: 'Buy' },
  'detail.marketResolved':    { es: 'MERCADO RESUELTO',     en: 'MARKET RESOLVED' },
  'detail.officialWinner':    { es: 'GANADOR OFICIAL',      en: 'OFFICIAL WINNER' },
  'detail.winningsPaid':      { es: 'GANANCIAS YA LIQUIDADAS', en: 'WINNINGS ALREADY PAID' },
  'detail.settledOnchain':    { es: 'Liquidado on-chain · USDC', en: 'Settled on-chain · USDC' },
  'detail.marketClosed':      { es: 'MERCADO CERRADO',      en: 'MARKET CLOSED' },
  'detail.closedAt':          { es: 'Cerró el {date}',      en: 'Closed on {date}' },
  'detail.officialSoon':      { es: 'El resultado oficial se publicará automáticamente en los próximos minutos.',
                                en: 'The official result will be posted automatically in the next few minutes.' },
  'detail.betsClosed':        { es: 'Las apuestas ya están cerradas', en: 'Betting is now closed' },
  'detail.buyTitle':          { es: 'COMPRAR',              en: 'BUY' },
  'detail.pickOutcome':       { es: 'Elige un resultado para comprar tu posición.',
                                en: 'Pick an outcome to buy your position.' },
  'detail.onchain':           { es: 'On-chain · USDC',      en: 'On-chain · USDC' },

  // ── Admin ─────────────────────────────────────────────────────────────────
  'admin.markets':            { es: 'Mercados',              en: 'Markets' },
  'admin.createMarket':       { es: 'Crear mercado',         en: 'Create market' },
  'admin.question':           { es: 'Pregunta',              en: 'Question' },
  'admin.questionPh':         { es: 'Ej: ¿México gana el Mundial 2026?', en: 'E.g. Will Mexico win the 2026 World Cup?' },
  'admin.category':           { es: 'Categoría',             en: 'Category' },
  'admin.icon':               { es: 'Icono',                 en: 'Icon' },
  'admin.closeDate':          { es: 'Fecha de cierre',       en: 'Close date' },
  'admin.options':            { es: 'OPCIONES',              en: 'OPTIONS' },
  'admin.addOption':          { es: '+ Agregar',             en: '+ Add' },
  'admin.optionPh':           { es: 'Opción',                en: 'Option' },
  'admin.creating':           { es: 'Creando…',              en: 'Creating…' },
  'admin.createBtn':          { es: 'Crear mercado',         en: 'Create market' },
  'admin.created':            { es: 'Mercado creado — aparecerá en la página principal.', en: 'Market created — will appear on the main page.' },
  'admin.optionsNeedName':    { es: 'Todas las opciones necesitan un nombre.', en: 'All options need a name.' },
  'admin.pendingTab':         { es: 'PENDIENTES',            en: 'PENDING' },
  'admin.open':               { es: 'ABIERTOS',              en: 'OPEN' },
  'admin.closed':             { es: 'CERRADOS',              en: 'CLOSED' },
  'admin.resolved':           { es: 'RESUELTOS',             en: 'RESOLVED' },
  'admin.all':                { es: 'Todos',                 en: 'All' },
  'admin.local':              { es: 'Locales',               en: 'Local' },
  'admin.market':             { es: 'Mercado',               en: 'Market' },
  'admin.source':             { es: 'Fuente',                en: 'Source' },
  'admin.deadline':           { es: 'Fecha límite',          en: 'Deadline' },
  'admin.status':             { es: 'Estado',                en: 'Status' },
  'admin.actions':            { es: 'Acciones',              en: 'Actions' },
  'admin.noMarkets':          { es: 'No hay mercados en esta categoría.', en: 'No markets in this category.' },
  'admin.active':             { es: 'Activo',                en: 'Active' },
  'admin.approve':            { es: 'Aprobar',               en: 'Approve' },
  'admin.reject':             { es: 'Rechazar',              en: 'Reject' },
  'admin.resolve':            { es: 'Resolver',              en: 'Resolve' },
  'admin.revoke':             { es: 'Revocar',               en: 'Revoke' },
  'admin.translating':        { es: 'Traduciendo…',          en: 'Translating…' },
  'admin.approved':           { es: '✓ Aprobado',            en: '✓ Approved' },
  'admin.pending':            { es: '○ Pendiente',           en: '○ Pending' },
  'admin.autoResolve':        { es: '▶ AUTO-RESOLVER AHORA', en: '▶ AUTO-RESOLVE NOW' },
  'admin.running':            { es: '⟳ CORRIENDO…',         en: '⟳ RUNNING…' },
  'admin.autoDesc':           { es: 'Cierra automáticamente los mercados que pasaron su fecha límite y resuelve los de Polymarket cuyo resultado ya está confirmado.',
                                en: 'Auto-closes markets past their deadline and resolves Polymarket markets whose outcome is already confirmed.' },
  'admin.pendingApproval':    { es: '{n} mercado{s} de Polymarket esperando aprobación · No aparecen en pronos.io hasta que los apruebes',
                                en: '{n} Polymarket market{s} awaiting approval · Not visible on pronos.io until approved' },
  'admin.translatingBanner':  { es: 'Traduciendo mercados al español…',  en: 'Translating markets to Spanish…' },
  'admin.translatedBanner':   { es: '{n} mercado{s} traducido{s} al español', en: '{n} market{s} translated to Spanish' },
  'admin.resolveTitle':       { es: 'RESOLVER MERCADO',      en: 'RESOLVE MARKET' },
  'admin.winnerOutcome':      { es: 'RESULTADO GANADOR',     en: 'WINNING OUTCOME' },
  'admin.resolvedBy':         { es: 'RESUELTO POR',          en: 'RESOLVED BY' },
  'admin.descOptional':       { es: 'DESCRIPCIÓN (OPCIONAL)', en: 'DESCRIPTION (OPTIONAL)' },
  'admin.selectOutcome':      { es: 'Selecciona un resultado', en: 'Select an outcome' },
  'admin.confirm':            { es: 'CONFIRMAR',             en: 'CONFIRM' },
  'admin.resolving':          { es: 'Resolviendo…',          en: 'Resolving…' },
  'admin.cancel':             { es: 'Cancelar',              en: 'Cancel' },

  // ── Footer ────────────────────────────────────────────────────────────────
  'footer.copyright':         { es: '© 2026 Pronos · El primer mercado de predicciones on-chain para LATAM',
                                en: '© 2026 Pronos · The first on-chain prediction market for LATAM' },
  'footer.home':              { es: 'Inicio',               en: 'Home' },
  'footer.contact':           { es: 'Contacto',             en: 'Contact' },

  // ── HowItWorks ────────────────────────────────────────────────────────────
  'how.label':                { es: 'Simple · Rápido · On-chain', en: 'Simple · Fast · On-chain' },
  'how.title':                { es: 'Cómo funciona',        en: 'How it works' },
  'how.step1.title':          { es: 'Crea tu cuenta',       en: 'Create your account' },
  'how.step1.desc':           { es: 'Regístrate con email o Google en segundos. Pronos crea automáticamente una wallet on-chain para ti — sin extensiones, sin seed phrases.',
                                en: 'Sign up with email or Google in seconds. Pronos automatically creates an on-chain wallet for you — no extensions, no seed phrases.' },
  'how.step2.title':          { es: 'Elige un mercado',     en: 'Pick a market' },
  'how.step2.desc':           { es: 'Explora mercados de política, deportes, cultura y crypto. Elige un resultado y cuánto quieres apostar en USDC.',
                                en: 'Browse politics, sports, culture and crypto markets. Pick an outcome and how much you want to bet in USDC.' },
  'how.step3.title':          { es: 'Cobra tus ganancias',  en: 'Collect your winnings' },
  'how.step3.desc':           { es: 'Si tu predicción es correcta, el contrato te paga automáticamente en USDC. Sin intermediarios, sin esperas.',
                                en: 'If your prediction is right, the contract pays you automatically in USDC. No middlemen, no waiting.' },
  'how.cta':                  { es: 'Crear cuenta gratis',  en: 'Create free account' },
  'how.quiz':                 { es: '¿Sabes cómo funcionan?', en: 'Think you know how they work?' },
  'how.quizLink':             { es: 'Haz un test',          en: 'Take a quiz' },

  // ── Portfolio ─────────────────────────────────────────────────────────────
  'pf.title':                 { es: 'Portafolio',           en: 'Portfolio' },
  'pf.subtitle':              { es: 'Tus posiciones activas en Polymarket y Pronos Protocol', en: 'Your active positions on Polymarket and Pronos Protocol' },
  'pf.connect':               { es: 'Conecta tu cuenta para ver tus posiciones',
                                en: 'Connect your account to see your positions' },
  'pf.connectBtn':            { es: 'Conectar',             en: 'Connect' },
  'pf.balanceMxnb':           { es: 'Balance USDC',         en: 'USDC Balance' },
  'pf.inPositions':           { es: 'En Posiciones',        en: 'In Positions' },
  'pf.activeMarkets':         { es: 'Mercados Activos',     en: 'Active Markets' },
  'pf.loading':               { es: 'Cargando posiciones…', en: 'Loading positions…' },
  'pf.error':                 { es: 'Error: {msg}',         en: 'Error: {msg}' },
  'pf.empty':                 { es: 'No tienes posiciones abiertas todavía.', en: 'You don\'t have any open positions yet.' },
  'pf.viewMarkets':           { es: 'Ver mercados',         en: 'View markets' },
  'pf.staked':                { es: 'APOSTADO',             en: 'STAKED' },
  'pf.pnl':                   { es: 'GANANCIA / PÉRDIDA',   en: 'PROFIT / LOSS' },
  'pf.shares':                { es: '{n} tokens',           en: '{n} shares' },
  'pf.currentValue':          { es: 'Valor actual: ${v} USDC', en: 'Current value: ${v} USDC' },
  'pf.exit':                  { es: 'Retirar ahora',        en: 'Exit now' },
  'pf.exitPreview':           { es: 'CONFIRMAR RETIRO',     en: 'CONFIRM EXIT' },
  'pf.exitEstimate':          { es: 'Recibes estimado',     en: 'Estimated receive' },
  'pf.exitSpot':              { es: 'Valor spot actual',    en: 'Current spot value' },
  'pf.exitFee':               { es: 'Fee de salida ({pct}%)', en: 'Exit fee ({pct}%)' },
  'pf.exitImpact':            { es: 'Impacto / slippage',   en: 'Impact / slippage' },
  'pf.exitAfterPrice':        { es: 'Precio después de salir', en: 'Price after exit' },
  'pf.exitWarning':           { es: 'El monto puede cambiar si otra operación entra antes de que tu transacción confirme.', en: 'The amount can still move if another trade lands before your transaction confirms.' },
  'pf.exitLoading':           { es: 'Calculando cuánto recibirías si sales ahora…', en: 'Calculating how much you would receive if you exit now…' },
  'pf.exitConfirm':           { es: 'Confirmar retiro',     en: 'Confirm exit' },
  'pf.exitPreviewError':      { es: 'No se pudo calcular el retiro en este momento.', en: 'Could not calculate the exit right now.' },
  'pf.exiting':               { es: 'Retirando…',           en: 'Exiting…' },
  'pf.switchingChain':        { es: 'Cambiando a la red del mercado…', en: 'Switching to the market network…' },
  'pf.protocolConfigMissing': { es: 'Falta configurar el token o pool de este mercado.', en: 'This market is missing token or pool configuration.' },
  'pf.exitSuccess':           { es: 'Posición retirada. Tx: {tx}', en: 'Position exited. Tx: {tx}' },
  'pf.exitError':             { es: 'No se pudo retirar: {msg}', en: 'Could not exit: {msg}' },

  // ── PasswordGate ──────────────────────────────────────────────────────────
  'gate.badge':               { es: 'BETA · ACCESO ANTICIPADO', en: 'BETA · EARLY ACCESS' },
  'gate.title':               { es: 'Ingresa la contraseña para continuar', en: 'Enter the password to continue' },
  'gate.password':            { es: 'Contraseña',           en: 'Password' },
  'gate.wrong':               { es: 'Contraseña incorrecta', en: 'Incorrect password' },
  'gate.enter':               { es: 'Entrar',               en: 'Enter' },

  // ── UsernameModal ─────────────────────────────────────────────────────────
  'um.title':                 { es: 'Elige tu username',    en: 'Pick your username' },
  'um.subtitle1':             { es: 'Este será tu identidad en Pronos.', en: 'This will be your identity on Pronos.' },
  'um.subtitle2':             { es: 'No lo podrás cambiar después.', en: 'You won\'t be able to change it later.' },
  'um.placeholder':           { es: 'tu_username',          en: 'your_username' },
  'um.help':                  { es: '3–20 caracteres · letras, números y _', en: '3–20 chars · letters, numbers and _' },
  'um.taken':                 { es: '❌ Ese username ya está en uso', en: '❌ That username is already taken' },
  'um.error':                 { es: '❌ {msg}',             en: '❌ {msg}' },
  'um.saving':                { es: 'Guardando...',         en: 'Saving...' },
  'um.enter':                 { es: 'Entrar a Pronos →',    en: 'Enter Pronos →' },
  'um.generating':            { es: 'Generando...',         en: 'Generating...' },
  'um.skip':                  { es: 'Saltar — generar automáticamente', en: 'Skip — generate automatically' },

  // ── Home / generic ────────────────────────────────────────────────────────
  'home.banner':              { es: '⚡ BETA — Mercados en vivo · Powered by Polymarket · Trading con USDC real',
                                en: '⚡ BETA — Live markets · Powered by Polymarket · Real USDC trading' },
  'home.markets':             { es: 'Mercados',             en: 'Markets' },
  'home.live':                { es: 'EN VIVO',              en: 'LIVE' },
  'home.subtitle':            { es: 'Predicciones en tiempo real de Polymarket + mercados locales.',
                                en: 'Real-time predictions from Polymarket + local markets.' },

  // ── Leaderboard ───────────────────────────────────────────────────────────
  'lb.campaign':              { es: 'COMPETENCIA MXNP',     en: 'MXNP COMPETITION' },
  'lb.cycle':                 { es: 'CICLO 1',              en: 'CYCLE 1' },
  'lb.title':                 { es: 'MXNP POINTS',          en: 'MXNP POINTS' },
  'lb.prize':                 { es: 'Premio: $500 USD · Top 10 sorpresas', en: 'Prize: $500 USD · Top 10 surprises' },
  'lb.ends':                  { es: 'FIN DE CICLO',         en: 'CYCLE ENDS' },
  'lb.demo':                  { es: 'DATOS DE DEMOSTRACIÓN', en: 'DEMO DATA' },
  'lb.earn':                  { es: 'GANAR MXNP',           en: 'EARN MXNP' },

  // ── Points-app ────────────────────────────────────────────────────────────
  // Scoped under points.* so they don't collide with MVP keys. Reuses existing
  // nav.* / cat.* where the copy is identical (EN/ES toggle, search, category
  // emoji pills). First-pass coverage: nav + home categories + market card +
  // portfolio/admin/earn tab names. Longer prose stays Spanish-only for now.
  'points.nav.markets':       { es: 'El mercado',            en: 'Markets' },
  'points.nav.portfolio':     { es: 'Portafolio',            en: 'Portfolio' },
  'points.nav.earn':          { es: 'Ganar MXNP',            en: 'Earn MXNP' },
  'points.nav.admin':         { es: 'Admin',                 en: 'Admin' },
  'points.nav.signIn':        { es: 'Iniciar sesión',        en: 'Sign in' },
  'points.nav.signOut':       { es: 'Cerrar sesión',         en: 'Sign out' },
  'points.nav.balance':       { es: 'Balance',               en: 'Balance' },
  'points.nav.search':        { es: 'Buscar mercado…',       en: 'Search market…' },
  'points.nav.theme':         { es: 'Cambiar tema',          en: 'Toggle theme' },
  'points.nav.lang':          { es: 'Idioma',                en: 'Language' },
  'points.nav.howItWorks':    { es: 'Cómo funciona',         en: 'How it works' },
  'points.nav.signUp':        { es: 'Crear cuenta',          en: 'Sign up' },

  // Hero + home copy
  'points.hero.badge':        { es: 'Beta · Competencia MXNP', en: 'Beta · MXNP competition' },
  'points.hero.headline.a':   { es: 'Predice, gana',         en: 'Predict, win' },
  'points.hero.headline.b':   { es: 'MXNP',                  en: 'MXNP' },
  'points.hero.headline.c':   { es: 'compite por premios',   en: 'compete for prizes' },
  'points.hero.sub':          { es: 'Compra acciones en eventos reales con MXNP — la moneda de Pronos. Cada dos semanas los {strong}3 mejores{/strong} del leaderboard ganan {strong}$5,000, $3,000 y $2,000 MXN{/strong} en efectivo. Puestos 4–10 reciben premios sorpresa.',
                                en: 'Buy shares on real events with MXNP — the Pronos currency. Every two weeks the {strong}top 3{/strong} on the leaderboard win {strong}$5,000, $3,000 and $2,000 MXN{/strong} in cash. Positions 4–10 get surprise prizes.' },
  'points.hero.cta.createAccount': { es: 'Crear cuenta gratis', en: 'Create free account' },
  'points.hero.cta.myPortfolio':  { es: 'Ver mi portafolio',   en: 'View my portfolio' },
  'points.hero.stats.welcomeBonus': { es: 'bono de bienvenida', en: 'welcome bonus' },
  'points.hero.stats.dailyClaim':   { es: 'reclamo diario + racha', en: 'daily claim + streak' },
  'points.hero.stats.activeMarkets':{ es: 'mercados activos',  en: 'active markets' },
  'points.hero.currentCycle': { es: 'CICLO ACTUAL · PREMIOS', en: 'CURRENT CYCLE · PRIZES' },
  'points.hero.top10Text':    { es: 'Top 10 del leaderboard cada quincena', en: 'Leaderboard top 10 every two weeks' },
  'points.hero.closePending': { es: '⏳ Cierre pendiente',    en: '⏳ Closing soon' },
  'points.hero.surprisePrize':{ es: '🎁 Premio sorpresa',     en: '🎁 Surprise prize' },
  'points.hero.eligibility':  { es: 'Para calificar al premio debes participar en al menos {n} mercados durante el ciclo.',
                                en: 'To qualify for the prize you must participate in at least {n} markets during the cycle.' },
  'points.hero.rankBy':       { es: 'RANKING POR CARTERA',   en: 'RANKED BY PORTFOLIO' },
  'points.hero.cashPrizes':   { es: 'PREMIOS EN EFECTIVO',   en: 'CASH PRIZES' },

  'points.home.loadError':    { es: 'No pudimos cargar los mercados · {err}', en: 'Could not load markets · {err}' },

  // Admin
  'points.admin.filter.all':       { es: 'Todos',          en: 'All' },
  'points.admin.filter.active':    { es: 'Activos',        en: 'Active' },
  'points.admin.filter.pending':   { es: 'Por resolver',   en: 'To resolve' },
  'points.admin.filter.resolved':  { es: 'Resueltos',      en: 'Resolved' },

  // How-it-works section on home
  'points.how.eyebrow':       { es: 'Simple · Rápido · Justo', en: 'Simple · Fast · Fair' },
  'points.how.title':         { es: 'Cómo funciona',         en: 'How it works' },
  'points.how.step1.t':       { es: 'Crea tu cuenta',         en: 'Create your account' },
  'points.how.step1.d':       { es: 'Email + código. Nada más. Recibes 500 MXNP de bienvenida.', en: 'Email + code. Nothing more. Get 500 MXNP as a welcome bonus.' },
  'points.how.step2.t':       { es: 'Predice eventos',        en: 'Predict events' },
  'points.how.step2.d':       { es: 'Compra acciones en mercados de deportes, política, crypto y más. Los precios se mueven con la demanda.', en: 'Buy shares on sports, politics, crypto and more. Prices move with demand.' },
  'points.how.step3.t':       { es: 'Gana premios reales',    en: 'Win real prizes' },
  'points.how.step3.d':       { es: 'Acumula MXNP acertando predicciones. Los Top 10 del leaderboard quincenal reciben premios en efectivo.', en: 'Stack MXNP by getting predictions right. The top 10 on the bi-weekly leaderboard win cash prizes.' },

  // Partners section
  'points.partners.eyebrow':  { es: 'Construido con',        en: 'Built with' },
  'points.partners.title':    { es: 'Partners',              en: 'Partners' },
  'points.partners.turnkey.role':     { es: 'Wallet & auth infra',  en: 'Wallet & auth infra' },
  'points.partners.turnkey.desc':     { es: 'Custodia segura y auth con email.', en: 'Secure custody and email-based auth.' },
  'points.partners.bitso.role':       { es: 'Exchange · LATAM',     en: 'Exchange · LATAM' },
  'points.partners.bitso.desc':       { es: 'Rampa de entrada y salida en pesos.', en: 'On/off-ramp in Mexican pesos.' },
  'points.partners.mxnb.role':        { es: 'Stablecoin peso',      en: 'Peso stablecoin' },
  'points.partners.mxnb.desc':        { es: 'Peso mexicano pegged on-chain.', en: 'Mexican peso pegged on-chain.' },
  'points.partners.chainlink.role':   { es: 'Oráculos & precios',   en: 'Oracles & pricing' },
  'points.partners.chainlink.desc':   { es: 'Feeds de precios y datos verificados para resolución de mercados.', en: 'Verified price feeds and data for market resolution.' },

  // Market detail
  'points.detail.resolvedBadge':   { es: '· RESUELTO',        en: '· RESOLVED' },
  'points.detail.pendingBadge':    { es: '· ⏳ PENDIENTE',    en: '· ⏳ PENDING' },
  'points.detail.resultOfficial': { es: 'RESULTADO OFICIAL',  en: 'OFFICIAL RESULT' },
  'points.detail.redeemInstructions': { es: 'Los ganadores pueden reclamar 1 MXNP por cada acción.', en: 'Winners can claim 1 MXNP per share.' },
  'points.detail.probNow':         { es: 'PROBABILIDAD ACTUAL · SÍ', en: 'CURRENT PROBABILITY · YES' },
  'points.detail.probExplain':     { es: 'La probabilidad se ajusta con cada trade. Compra más barato cuando hay desacuerdo, más caro cuando hay consenso.', en: 'Probability adjusts on every trade. Cheaper when there\'s disagreement, more expensive when there\'s consensus.' },
  'points.detail.priceHistory':    { es: 'HISTORIAL DE PRECIO', en: 'PRICE HISTORY' },
  'points.detail.priceRealtime':   { es: 'PRECIO EN TIEMPO REAL', en: 'REAL-TIME PRICE' },
  'points.detail.last30d':         { es: 'ÚLT. 30 DÍAS',       en: 'LAST 30 DAYS' },
  'points.detail.closesLabel':     { es: 'CIERRA',             en: 'CLOSES' },
  'points.detail.closedLabel':     { es: 'CERRÓ',              en: 'CLOSED' },
  'points.detail.volumeLabel':     { es: 'VOLUMEN',            en: 'VOLUME' },
  'points.detail.stateLabel':      { es: 'ESTADO',             en: 'STATE' },
  'points.detail.stateResolved':   { es: 'RESUELTO',           en: 'RESOLVED' },
  'points.detail.statePending':    { es: 'PENDIENTE',          en: 'PENDING' },
  'points.detail.stateActive':     { es: 'ACTIVO',             en: 'ACTIVE' },
  'points.detail.resolverLabel':   { es: 'RESUELTO POR',       en: 'RESOLVED BY' },
  'points.detail.resolverAdmin':   { es: 'Admin',              en: 'Admin' },
  'points.detail.marketNotFound':  { es: 'Mercado no encontrado', en: 'Market not found' },
  'points.detail.back':            { es: '← Volver',            en: '← Back' },
  'points.detail.closedHint':      { es: 'Este mercado ya cerró. Los ganadores pueden reclamar su pago en el portafolio.', en: 'This market is closed. Winners can claim their payout in the portfolio.' },
  'points.detail.pendingHint':     { es: 'Las inversiones están cerradas. El resultado se publicará pronto.', en: 'Trading is closed. The outcome will be published soon.' },
  'points.detail.shares':          { es: '{n} acciones',       en: '{n} shares' },
  'points.detail.valueLabel':      { es: 'Valor',              en: 'Value' },
  'points.detail.buyMore':         { es: 'Comprar más',        en: 'Buy more' },
  'points.detail.sell':            { es: 'Vender',             en: 'Sell' },
  'points.detail.mxnpNote':        { es: '💡 MXNP son puntos de la competencia. Los Top 10 del leaderboard quincenal reciben premios en efectivo.', en: '💡 MXNP are competition points. The top 10 on the bi-weekly leaderboard win cash prizes.' },

  // Comments
  'points.comments.title':         { es: 'Comentarios',         en: 'Comments' },
  'points.comments.one':           { es: '{n} mensaje',         en: '{n} message' },
  'points.comments.many':          { es: '{n} mensajes',        en: '{n} messages' },
  'points.comments.placeholderAuth': { es: 'Comparte tu análisis o pregunta…', en: 'Share your analysis or question…' },
  'points.comments.placeholderAnon': { es: 'Inicia sesión para comentar.', en: 'Sign in to comment.' },
  'points.comments.login':         { es: 'Iniciar sesión',      en: 'Sign in' },
  'points.comments.post':          { es: 'Publicar',            en: 'Post' },
  'points.comments.posting':       { es: 'Publicando…',         en: 'Posting…' },
  'points.comments.empty':         { es: 'Aún no hay comentarios. Sé el primero.', en: 'No comments yet. Be the first.' },
  'points.comments.loading':       { es: 'Cargando comentarios…', en: 'Loading comments…' },
  'points.comments.delete':        { es: 'eliminar',            en: 'delete' },
  'points.comments.confirmDelete': { es: '¿Eliminar este comentario?', en: 'Delete this comment?' },
  'points.comments.deleteFail':    { es: 'No se pudo eliminar: {err}', en: 'Could not delete: {err}' },

  // Top holders
  'points.top.title':              { es: 'Top holders',         en: 'Top holders' },
  'points.top.loading':            { es: 'Cargando…',           en: 'Loading…' },

  'points.cat.trending':      { es: '🔥 Trending',            en: '🔥 Trending' },
  'points.cat.musica':        { es: '🎵 Música & Farándula',  en: '🎵 Music & Culture' },
  'points.cat.mexico':        { es: '🇲🇽 México & CDMX',      en: '🇲🇽 Mexico & CDMX' },
  'points.cat.politica':      { es: '🌎 Política Intl.',      en: '🌎 World Politics' },
  'points.cat.deportes':      { es: '⚽ Deportes',            en: '⚽ Sports' },
  'points.cat.crypto':        { es: '₿ Crypto',               en: '₿ Crypto' },
  'points.cat.porresolver':   { es: '⏳ Por resolver',         en: '⏳ To resolve' },
  'points.cat.resueltos':     { es: '🏆 Resueltos',            en: '🏆 Resolved' },

  'points.card.resolved':     { es: 'RESUELTO',              en: 'RESOLVED' },
  'points.card.pending':      { es: 'PENDIENTE',             en: 'PENDING' },
  'points.card.live':         { es: '🔴 EN VIVO',            en: '🔴 LIVE' },
  'points.card.yourPos':      { es: '✓ Tu posición',         en: '✓ Your position' },
  'points.card.moreOptions':  { es: '+ {n} opciones más',    en: '+ {n} more options' },
  'points.card.ifYouWin':     { es: 'si ganas',              en: 'if you win' },

  'points.home.empty':        { es: 'No hay mercados en esta categoría.', en: 'No markets in this category.' },
  'points.home.emptySearch':  { es: '🔍 No hay resultados para "{q}".', en: '🔍 No results for "{q}".' },
  'points.home.emptyPending': { es: 'No hay mercados por resolver.', en: 'No markets to resolve.' },
  'points.home.loading':      { es: 'Cargando mercados…',    en: 'Loading markets…' },

  'points.detail.loading':    { es: 'Cargando mercado…',     en: 'Loading market…' },
  'points.detail.backToMarkets': { es: '← MERCADOS',          en: '← MARKETS' },
  'points.detail.chooseOutcome': { es: 'Elige un resultado',  en: 'Pick an outcome' },
  'points.detail.oddsNow':    { es: 'Odds actuales',         en: 'Current odds' },
  'points.detail.marketClosed': { es: 'Mercado cerrado',      en: 'Market closed' },
  'points.detail.awaitingResult': { es: 'Esperando resolución', en: 'Awaiting resolution' },
  'points.detail.yourPos':    { es: 'Tu posición',           en: 'Your position' },
  'points.detail.topHolders': { es: 'Top holders',           en: 'Top holders' },
  'points.detail.comments':   { es: 'Comentarios',           en: 'Comments' },
  'points.detail.optionsVote': { es: 'Opciones · elige Sí o No', en: 'Options · pick Yes or No' },

  'points.portfolio.title':   { es: 'Portafolio',            en: 'Portfolio' },
  'points.portfolio.tab.open': { es: 'Abiertas',             en: 'Open' },
  'points.portfolio.tab.history': { es: 'Historial',         en: 'History' },
  'points.portfolio.tab.claim': { es: 'Reclamar',            en: 'Claim' },

  'points.status.won':        { es: '🏆 GANADO',             en: '🏆 WON' },
  'points.status.lost':       { es: 'PERDIDO',               en: 'LOST' },
  'points.status.exited':     { es: 'SALIDO',                en: 'EXITED' },
  'points.status.open':       { es: 'ABIERTA',               en: 'OPEN' },
  'points.status.pending':    { es: 'PENDIENTE',             en: 'PENDING' },
};
