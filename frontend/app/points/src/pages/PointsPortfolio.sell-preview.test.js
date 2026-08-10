import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./PointsPortfolio.jsx', import.meta.url), 'utf8');
const sellModalSource = await readFile(new URL('../components/PointsSellPreviewModal.jsx', import.meta.url), 'utf8');
const detailSource = await readFile(new URL('./PointsMarketDetail.jsx', import.meta.url), 'utf8');
const earnSource = await readFile(new URL('./PointsEarn.jsx', import.meta.url), 'utf8');
const i18nSource = await readFile(new URL('../../../src/lib/i18n.js', import.meta.url), 'utf8');
const winShareSource = await readFile(new URL('../components/PointsWinShareButton.jsx', import.meta.url), 'utf8');

test('portfolio sell flow previews the real AMM quote before executing', () => {
  assert.match(source, /setSellPreview\(/);
  assert.match(source, /quoteSell\(\{/);
  assert.match(source, /buildSellPreview\(/);
  assert.match(source, /normalizeSellShares/);
  assert.match(source, /function handleSellPreviewSharesChange\(shares\)/);
  assert.match(source, /shares:\s*preview\.shares/);
  assert.match(source, /minCollateralOut:\s*preview\.minCollateralOut/);
  assert.match(source, /PointsSellPreviewModal/);
  assert.match(source, /onSharesChange=\{handleSellPreviewSharesChange\}/);
  assert.match(sellModalSource, /SALIDA REAL/);
  assert.match(sellModalSource, /IMPACTO POR LIQUIDEZ/);
  assert.match(sellModalSource, /Acciones a vender/);
  assert.match(sellModalSource, /type="range"/);
  assert.match(sellModalSource, /onSharesChange/);
});

test('market detail opens the same sell preview in place instead of routing to portfolio', () => {
  assert.match(detailSource, /handleSellClick\(p\)/);
  assert.match(detailSource, /quoteSell\(\{/);
  assert.match(detailSource, /buildSellPreview\(position,\s*quote\)/);
  assert.match(detailSource, /executeSell\(\{/);
  assert.match(detailSource, /function handleSellPreviewSharesChange\(shares\)/);
  assert.match(detailSource, /shares:\s*preview\.shares/);
  assert.match(detailSource, /onSharesChange=\{handleSellPreviewSharesChange\}/);
  assert.match(detailSource, /PointsSellPreviewModal/);
  assert.doesNotMatch(detailSource, /navigate\('\/portfolio'\)/);
});

test('market detail lets winning resolved positions claim in place', () => {
  assert.match(detailSource, /redeemWinnings/);
  assert.match(detailSource, /async function handleRedeemPosition\(position\)/);
  assert.match(detailSource, /isResolved && p\.canRedeem/);
  assert.match(detailSource, /points\.detail\.claim/);
  assert.match(i18nSource, /'points\.detail\.claim':\s*\{\s*es:\s*'Reclamar',\s*en:\s*'Claim'/);
});

test('portfolio history displays losing PnL instead of hiding lost rows', () => {
  assert.match(source, /historyPnlValue\(m\)/);
  assert.doesNotMatch(source, /outcomeStatus\s*!==\s*'lost'/);
});

test('portfolio history displays the option selected by the user', () => {
  assert.match(source, /function pickedOutcomeLabelFromTransactions\(transactions = \[\]\)/);
  assert.match(source, /tx\?\.side !== 'buy'/);
  assert.match(source, /m\.pickedOutcomeLabel \|\| pickedOutcomeLabelFromTransactions\(m\.transactions\)/);
  assert.match(source, /Elegiste:/);
});

test('portfolio uses responsive class hooks for mobile layout', () => {
  assert.match(source, /points-portfolio-layout/);
  assert.match(source, /points-portfolio-stats/);
  assert.match(source, /points-portfolio-sidebar/);
  assert.match(source, /points-daily-claim-card/);
  assert.match(source, /points-history-summary-grid/);
});

test('portfolio and earn page labels use points translations', () => {
  assert.match(source, /useT\(\)/);
  assert.match(source, /points\.portfolio\.title/);
  assert.match(source, /points\.portfolio\.tab\.open/);
  assert.match(source, /points\.portfolio\.tab\.history/);
  assert.match(source, /points\.portfolio\.tab\.rewards/);
  assert.match(earnSource, /useT\(\)/);
  assert.match(earnSource, /points\.earn\.title/);
  assert.match(i18nSource, /'points\.portfolio\.title':\s*\{\s*es:\s*'Portafolio',\s*en:\s*'Portfolio'/);
  assert.match(i18nSource, /'points\.portfolio\.tab\.rewards':\s*\{\s*es:\s*'Recompensas',\s*en:\s*'Rewards'/);
  assert.match(i18nSource, /'points\.nav\.earn':\s*\{\s*es:\s*'Gana MXNP',\s*en:\s*'Earn MXNP'/);
  assert.match(i18nSource, /'points\.earn\.title':\s*\{\s*es:\s*'Gana MXNP',\s*en:\s*'Earn MXNP'/);
});

test('portfolio active and history markets link back to market detail', () => {
  assert.match(source, /function portfolioMarketHref\(item\)/);
  assert.match(source, /item\?\.parentMarketId\s*\|\|\s*item\?\.marketId/);
  assert.match(source, /`\/market\?id=\$\{encodeURIComponent\(id\)\}`/);
  assert.match(source, /to=\{marketHref\}/);
  assert.match(source, /Ver mercado/);
});

test('portfolio shows maker reward payouts in their own market-linked tab', () => {
  assert.match(source, /fetchMakerRewards/);
  assert.match(source, /function RewardsView/);
  assert.match(source, /rewardSummary/);
  assert.match(source, /points\.portfolio\.rewards\.today/);
  assert.match(source, /points\.portfolio\.rewards\.total/);
  assert.match(source, /points\.portfolio\.rewards\.empty/);
  assert.match(source, /<RewardsView rewards=\{rewards\} summary=\{rewardSummary\} loading=\{loading\}/);
});

test('portfolio separates open PnL from total account PnL', () => {
  assert.match(source, /Promise\.all\(\[\s*fetchPositions\(\),\s*fetchHistory\(\)\.catch\(\(\) => null\),\s*\]\)/s);
  assert.match(source, /const openPnl = Number\(summary\?\.pnl \|\| 0\)/);
  assert.match(source, /const totalPnl = Number\(historySummary\?\.totalPnl \?\? openPnl\)/);
  assert.match(source, /label: 'PnL abierto'/);
  assert.match(source, /label: 'PnL total'/);
});

test('portfolio won markets generate a Pronos ticket share card with cash-out details', () => {
  assert.match(source, /PointsWinShareButton/);
  assert.match(source, /m\.outcomeStatus === 'won'/);
  assert.match(source, /canRedeem \?/);
  assert.match(winShareSource, /fetchPriceHistory/);
  assert.match(winShareSource, /document\.createElement\('canvas'\)/);
  assert.match(winShareSource, /canvas\.toBlob/);
  assert.match(winShareSource, /navigator\.canShare\?\.\(\{ files: \[file\] \}\)/);
  assert.match(winShareSource, /new File\(\[blob\]/);
  assert.match(winShareSource, /Cash Out/);
  assert.match(winShareSource, /marketShareUrl/);
  assert.match(winShareSource, /\/api\/share\/market/);
  assert.match(winShareSource, /displayHandle\(username\)/);
});
