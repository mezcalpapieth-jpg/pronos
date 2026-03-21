# pronos.io — Contexto para Claude

## Qué es
Mercado de predicciones on-chain para LATAM. Base Sepolia testnet.
Netlify → pronos.io. Repo: mezcalpapieth-jpg/pronos

## Stack
HTML/CSS/JS vanilla. Sin frameworks. Sin bundler.
Ethers.js v5.7.2 en `frontend/js/ethers.min.js`. USDC en Base Sepolia.
Netlify auto-deploy desde rama main, build dir: `frontend/`

## Estructura de archivos
```
frontend/index.html          → estructura HTML principal (sin CSS ni JS inline)
frontend/css/base.css        → variables :root, reset, keyframes, utilidades
frontend/css/components.css  → navbar, cards, botones, filtros, portafolio UI
frontend/css/sections.css    → hero, market section, portfolio section, how-it-works, partners, footer
frontend/js/ethers.min.js    → ethers.js v5.7.2 (no modificar)
frontend/js/markets.js       → datos de mercados mock (EDITAR AQUÍ para agregar mercados)
frontend/js/app.js           → lógica: contrato on-chain, filtros, render cards, wallet, portafolio
CONTEXT.md                   → este archivo
```

## Paleta y estilo
- Fondo: `#080808` (negro)
- Acento principal: `#00E87A` (verde neón) → var(--green)
- Acento secundario: `#F5C842` (dorado) → var(--gold)
- Rojo: `#FF4545` → var(--red)
- Texto: `#F0F0F0` → var(--text-primary)
- Cards: `#111111` con border `rgba(255,255,255,0.07)` → var(--surface1), var(--border)
- Tipografía display: Bebas Neue (uppercase, tracking amplio)
- Tipografía body: DM Sans
- Tipografía mono: DM Mono

## Mercado on-chain activo
- **México vs Sudáfrica** (Mundial 2026, partido inaugural)
- Contrato: `0x9a03F59DD857856d930b12f5da63c586d824804D` en Base Sepolia
- USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- 3 resultados: México gana / Empate / Sudáfrica gana
- Odds en tiempo real desde el contrato. Pool actual visible en el hero.

## Mercados mock en markets.js
Organizados en 4 categorías (filtro `data-filter`):

| data-filter | Label |
|-------------|-------|
| `musica`    | MÚSICA & FARÁNDULA |
| `mexico`    | MÉXICO & CDMX |
| `politica`  | POLÍTICA INTERNACIONAL |
| `deportes`  | DEPORTES & CRYPTO |

Mercados actuales (en `frontend/js/markets.js`):
- Bad Bunny sencillo, Peso Pluma anillo, Nodal divorcio → musica
- Sismo CDMX, Tren Maya descarrila, Dólar a $22 → mexico
- Trump visita México, Venezuela elecciones, Cuba embargo → politica
- Checo puntos F1, Bitcoin $120k → deportes

## Reglas de estilo para Claude
1. **Nunca** cambiar el diseño visual sin pedirlo explícitamente
2. Para agregar mercados mock: solo editar `frontend/js/markets.js`
3. Para cambios de estilo: solo editar el archivo CSS relevante
4. **Nunca** tocar `index.html` a menos que sea cambio estructural
5. `frontend/js/ethers.min.js` es solo lectura — nunca modificar
6. Siempre hacer commit con mensaje descriptivo después de cada cambio

## Secciones del sitio
1. **Ticker** — strip animado con datos en tiempo real del contrato
2. **Nav** — logo + links (El mercado / Portafolio / Cómo funciona) + wallet button
3. **Hero** — headline + wc-card con odds en vivo + wallet connect
4. **El Mercado** — filtros por categoría + card on-chain + grid de cards mock
5. **Portafolio** — apuestas activas del wallet conectado (mock data actualmente)
6. **Cómo Funciona** — 3 pasos + tech strip
7. **Partners** — Base, Mazatlán FC, Marco Verde OLY
8. **Footer**

## Estado del deploy
Netlify conectado a rama main. Push a main = deploy automático a pronos.io.
Rama de trabajo actual: `claude/clever-cohen` — hacer PR a main para deployar.
