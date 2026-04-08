# PRONOS

## Plataforma de Mercados de Predicción Web3

**Documento de Requerimientos del Producto (PRD)**
Versión 2.0 — Abril 2026
Confidencial

---

> **Sobre este documento**
>
> Este PRD describe la visión completa de PRONOS, qué se ha construido internamente, y qué necesitamos de un equipo de desarrollo externo para llegar a mainnet. Las secciones marcan claramente lo que ya existe (✅ CONSTRUIDO) vs. lo que se necesita (🔨 POR CONSTRUIR).

---

## 01  Información General y Alcance

### Nombre del Proyecto

**PRONOS** — Primer mercado de predicción on-chain enfocado en América Latina.

### Visión

Construir la plataforma de predicciones más accesible para el mercado latinoamericano, donde cualquier persona pueda apostar sobre deportes, política y cultura — sin necesidad de conocimientos cripto, wallets complejas, ni conversión de divisas.

### Meta de Lanzamiento

**Mainnet activo antes del Mundial FIFA 2026 (14 de junio de 2026).**
Presupuesto asignado: $30,000 USD.

### URL del producto actual

**https://pronos.io/mvp/** — protegido con contraseña (ambiente de staging).

---

### Red Blockchain: Arbitrum (Layer 2 de Ethereum)

La red seleccionada para el despliegue es **Arbitrum**, la Layer 2 optimistic rollup de Ethereum.

| Criterio | Detalle |
|----------|---------|
| **Gas** | ~$0.01 USD por transacción — viable para micro-apuestas |
| **Velocidad** | Confirmación en ~250ms |
| **Compatibilidad** | EVM total — contratos OpenZeppelin sin reescritura |
| **Ecosistema** | USDC nativo (Circle), Privy con soporte completo, Safe multisig disponible |
| **Liquidez** | Segundo L2 por TVL (~$20B+), amplia disponibilidad de USDC |

**Nota:** El draft original proponía Base (Coinbase L2) por disponibilidad de MXNB (Bitso). Se migró a Arbitrum por mayor madurez del ecosistema, mejor soporte de herramientas (Safe SDK, Privy) y disponibilidad directa de USDC como colateral.

### Activo Colateral

| Parámetro | Especificación |
|-----------|---------------|
| **Activo principal** | USDC — stablecoin de Circle, desplegado nativamente en Arbitrum |
| **Soporte multiactivo** | No requerido en v1. La arquitectura permite agregar activos (MXNB, DAI) sin redeploy |

### On-ramps (Depósito de Fondos)

Se contemplan múltiples vías para que usuarios depositen dinero en la plataforma:

| Vía | Método | Estado | Prioridad |
|-----|--------|--------|-----------|
| **MoonPay** | Apple Pay, Google Pay, tarjeta de crédito/débito | 🔨 Por integrar | Alta — MVP |
| **SPEI** | Transferencia bancaria MXN (vía Bitso o similar) | 🔨 Por integrar | Alta — MVP |
| **Bridge nativo** | Arbitrum Bridge (para usuarios cripto) | ✅ Link implementado | Media |
| **Bitso directo** | Compra USDC en Bitso → envío a wallet | 🔨 Evaluando | Post-MVP |

**Flujo objetivo para usuario no-cripto:**
Abrir app → login con email → depositar con tarjeta/Apple Pay/SPEI → apostar. Tiempo < 3 minutos.

MoonPay maneja todo el KYC (verificación de identidad con INE/pasaporte), procesamiento de pago, y entrega de USDC directamente a la wallet del usuario en Arbitrum. El usuario nunca necesita entender blockchain.

---

## 02  Arquitectura de Contratos Inteligentes

### ✅ CONSTRUIDO — Sistema de Contratos

Se desarrollaron contratos propios desde cero usando **Solidity 0.8.24**, **Foundry** y **OpenZeppelin v5.6.1**. Es una arquitectura original optimizada para mercados binarios con fees dinámicos.

#### PronosToken.sol — Tokens Condicionales (ERC-1155)

Cada mercado genera dos tokens: **YES** (`marketId * 2`) y **NO** (`marketId * 2 + 1`).

- Estándar ERC-1155 (múltiples mercados en un solo contrato, eficiente en gas)
- Solo pools autorizados (minters) pueden acuñar/quemar tokens
- `mintPair()`: depositar colateral → recibir YES + NO en proporción 1:1
- `burnPair()`: devolver YES + NO → recuperar colateral
- `burn()`: quemar tokens ganadores durante redención
- Ownership transferido al MarketFactory tras despliegue

#### MarketFactory.sol — Fábrica de Mercados

Hub central para crear y administrar mercados de predicción.

- `createMarket()`: despliega un nuevo pool AMM con liquidez semilla
- `resolveMarket()`: declara el resultado (YES=1, NO=2)
- `pauseMarket()`: suspender/reanudar operaciones
- `distributeFees()`: distribuye comisiones acumuladas (70/20/10)
- Control de acceso: **owner** (multisig Safe) y **resolver** (puede ser multisig separado)
- Direcciones configurables: treasury, liquidity reserve, emergency reserve, fee collector

#### PronosAMM.sol — Market Maker Automático (CPMM)

AMM con fórmula **Constant Product (x · y = k)** y comisiones dinámicas.

- **Fórmula base:** `x · y = k` donde x, y son las reservas YES/NO del pool
- **Compra:** usuario deposita USDC → pool acuña pares YES/NO → CPMM calcula tokens de salida
- **Venta:** usuario devuelve tokens → fórmula cuadrática calcula colateral de salida → pool quema pares
- **Redención:** tras resolución, tokens ganadores se canjean 1:1 por USDC
- Funciones de estimación on-chain: `estimateBuy()`, `estimateSell()`, `priceYes()`, `priceNo()`
- Toda la lógica vive on-chain — sin infraestructura off-chain

#### Testing

| Métrica | Estado |
|---------|--------|
| Tests totales | **43 passing** |
| Cobertura PronosToken | 100% |
| Cobertura MarketFactory | 87% |
| Cobertura PronosAMM | 82% |
| Test de ciclo completo | ✅ crear → fondear → tradear → resolver → redimir |
| Framework | Foundry (forge test) |

### Comisión Dinámica

La fórmula de fee ajusta automáticamente la comisión según la probabilidad del mercado:

```
fee% = 5 × (1 - P)
```

Donde P es la probabilidad implícita del lado que se compra.

| Probabilidad del mercado | Fee por operación |
|--------------------------|-------------------|
| 50/50 (máxima incertidumbre) | 2.5% |
| 70/30 | 1.5% |
| 90/10 | 0.5% |
| 99/1 (casi decidido) | 0.05% |

**Principio:** cobrar más cuando hay más riesgo/incertidumbre, menos cuando el mercado ya tiene consenso fuerte. Las comisiones se deducen **antes** de entrar al pool y se envían directamente al `feeCollector` — nunca tocan las reservas del AMM.

### Distribución de Ingresos

| Destino | Porcentaje |
|---------|-----------|
| Tesorería (operaciones y desarrollo) | 70% |
| Fondo de liquidez (incentivos LP) | 20% |
| Fondo de reserva (seguridad/emergencias) | 10% |

### Tipos de Mercados

| Tipo | Estado | Descripción |
|------|--------|-------------|
| **Binario (Sí/No)** | ✅ Implementado | Cubre deportes, política, cultura. Ej: "¿México gana vs. Argentina?" |
| **Categórico (múltiples opciones)** | 🔜 v2 | Para "¿Quién gana La Casa de los Famosos?" con 5+ candidatos. Requiere extensión del AMM |
| **Escalar (rango numérico)** | 🔜 v2 | Mercados económicos: tipo de cambio, inflación, etc. |

### 🔨 POR CONSTRUIR — Contratos

| Item | Detalle |
|------|---------|
| **Deploy a Arbitrum Sepolia** | Script listo (`DeployProtocol.s.sol`), falta ejecutar con RPC + deployer wallet |
| **Deploy a Arbitrum One (mainnet)** | Mismo script, cambiar RPC y verificar en Arbiscan |
| **Fuzz testing** | Edge cases del AMM (montos extremos, reentrancy, overflow) |
| **Integración UMA** | Conectar resolución a UMA Optimistic Oracle (ver sección 03) |
| **Mercados categóricos** | Extender AMM para soportar 3+ outcomes (v2) |

---

## 03  Resolución y Oráculos

### Mecanismo Dual de Resolución

La plataforma implementará **dos mecanismos de resolución** según la categoría del mercado:

| Categoría | Mecanismo | Justificación |
|-----------|-----------|---------------|
| **Deportes / Reality TV** (La Casa de los Famosos, Liga MX, Exatlón, FIFA) | Oráculo Multi-Sig custodial 2-de-3 | Resultados públicos y verificables (TV + fuentes oficiales). No requiere oráculo descentralizado |
| **Política / Economía** (elecciones, legislación, nombramientos, indicadores) | UMA Optimistic Oracle | Maneja eventos arbitrarios del mundo real con sistema de disputas on-chain. Estándar de la industria |
| **Mercados especiales** (eventos internacionales, cultura) | Evaluar caso por caso | Multi-Sig o UMA según complejidad |

### ✅ CONSTRUIDO — Resolución Multi-Sig

| Componente | Especificación |
|------------|---------------|
| **Tipo** | Gnosis Safe multisig (2-de-3 o 3-de-5) |
| **Firmantes** | Fundador, co-fundador, tercero de confianza |
| **Proceso** | Resolver propone resultado → se requieren N firmas → transacción ejecuta `resolveMarket()` |
| **Herramienta** | Safe SDK integrado en panel admin (protocol-kit + api-kit) |
| **Cadenas soportadas** | Arbitrum Sepolia + Arbitrum One |
| **UI de admin** | Crear Safe, conectar existente, proponer/firmar/ejecutar — todo desde `/mvp/admin` |

### 🔨 POR CONSTRUIR — UMA Optimistic Oracle

Integrar UMA para mercados políticos y complejos donde la resolución no sea obvia:

| Componente | Requerimiento |
|------------|---------------|
| **Interfaz con UMA** | Contrato adapter que conecte MarketFactory con UMA's OptimisticOracleV3 |
| **Propuesta de resultado** | Cualquier persona puede proponer una resolución con un bond en USDC |
| **Período de disputa** | 48 horas — si nadie disputa, el resultado se acepta |
| **Escalación** | Si hay disputa, escala al DVM (Data Verification Mechanism) de UMA: holders de tokens UMA votan on-chain |
| **Auto-resolución** | Tras período de disputa sin objeciones, `resolveMarket()` se ejecuta automáticamente |
| **Reglas de resolución** | Se especifican en la descripción del mercado al crearlo (ancillary data de UMA) |

**Nota:** Las interfaces y comentarios para UMA ya están preparados en el código de los contratos. La integración requiere escribir un contrato adapter y conectar los callbacks.

### Proceso de Disputa

| Oráculo | Proceso |
|---------|---------|
| **Multi-Sig (deportes/TV)** | Si se detecta error, los firmantes deliberan y corrigen por mayoría (2/3). Comité de curaduría es árbitro final |
| **UMA (política)** | Cualquier tenedor de tokens puede disputar durante el período de disputa. La disputa escala al DVM: holders de tokens UMA votan on-chain. La mayoría determina el resultado |

**Casos ambiguos** (show cancelado, empate técnico, evento pospuesto): las reglas de resolución se especifican en la descripción del mercado al crearlo — el comité/oráculo aplica la regla preestablecida sin discrecionalidad.

### Tiempos de Ejecución

| Fase | Multi-Sig | UMA |
|------|-----------|-----|
| Período de reporte | 24h tras el evento | 24h tras el evento |
| Período de disputa | N/A (resolución directa) | 48h tras propuesta |
| Resolución sin disputa | 24-48h | Automática al cierre del período |
| Resolución con disputa | 24-48h (deliberación 2-de-3) | 5-7 días hábiles (votación DVM) |
| Liberación de fondos | Inmediata tras resolución | Inmediata tras resolución |
| Fee de oráculo UMA | N/A | ~1.5% sobre valor del mercado (absorbido por protocolo, no el usuario) |

---

## 04  Frontend y Experiencia de Usuario

### ✅ CONSTRUIDO — Stack Técnico

| Capa | Tecnología |
|------|-----------|
| **Framework** | React 18 + Vite 5 (SPA, mobile-first) |
| **Routing** | React Router v6 (basename `/mvp`) |
| **Auth/Wallet** | Privy (`@privy-io/react-auth`) — email, Google, wallet |
| **Blockchain** | ethers.js v5.7.2 |
| **Estilos** | CSS custom (design system propio, dark theme, responsive) |
| **Monitoreo** | Sentry (`@sentry/react`, ErrorBoundary, privacy-safe) |
| **Hosting** | Vercel (static + serverless functions) |
| **Idioma** | Español únicamente |

### ✅ CONSTRUIDO — Páginas y Componentes

#### Página Principal (`/mvp/`)
- Hero carousel con mercados destacados
- Grid de mercados con datos en vivo (API Gamma de Polymarket + mercados propios)
- Sección "Cómo funciona" — explicación visual del flujo
- Ticker animado de mercados
- Barra de búsqueda con filtro por mercado
- Footer con links
- Responsive: tablet (≤1024px) y mobile

#### Página de Mercado (`/mvp/market?id=`)
- Gráfica de probabilidad en anillo (ring chart SVG)
- Panel de apuesta con selección de outcome y monto
- Preview de payout con fee dinámico calculado en tiempo real
- Tabs: Reglas, Contexto de mercado, Comentarios, Top Holders, Posiciones, Actividad
- Sidebar sticky con panel de apuesta rápida
- Soporte para mercados resueltos (vista de resultado final con ganador)

#### Portafolio (`/mvp/portfolio`)
- Balance USDC del usuario (chain-aware)
- Lista de posiciones abiertas con P&L individual
- Resumen: total invertido, valor actual, ganancia/pérdida

#### Panel de Administración (`/mvp/admin`)
- Acceso restringido (auth server-side via `/api/user`)
- Toggle de modo protocolo (Polymarket ↔ Protocolo propio)
- Formulario de creación de mercado (pregunta, categoría, fecha, oráculo, liquidez)
- Lista de mercados con acciones: pausar, resolver
- Display de fórmula de fees y distribución (70/20/10)
- Panel de estado de contratos desplegados
- Integración Safe SDK completa: crear Safe, conectar existente, proponer/firmar/ejecutar
- Usuarios no-admin ven página 404 (ruta indiscoverable)

#### Bet Slip (Modal de Apuesta)
- Selección de monto rápido ($5, $10, $25, $50) o manual
- Cálculo dinámico: comisión, pago estimado, ganancia potencial, probabilidad implícita
- Auto-switch de red (detecta cadena incorrecta y cambia)
- Flujo completo: verificar balance → aprobar USDC → firmar → enviar orden
- Usuarios no autenticados ven botón "Únete a la lista" (waitlist via Tally)

### ✅ CONSTRUIDO — Autenticación y Onboarding

| Característica | Estado |
|---------------|--------|
| Login con email | ✅ Privy |
| Login con Google | ✅ Privy |
| Login con wallet (MetaMask, Coinbase Wallet, etc.) | ✅ Privy |
| Embedded wallet automática (ERC-4337) | ✅ Invisible para el usuario |
| Registro de username | ✅ Con opción "Saltar" (auto-genera) |
| Sesiones persistentes | ✅ Privy embedded wallets |
| Multi-chain | ✅ Polygon + Arbitrum + Arbitrum Sepolia |
| Auto-switch de red | ✅ Detecta red incorrecta, cambia automáticamente |
| Balance USDC chain-aware | ✅ Muestra balance de la red activa |
| Link de depósito | ✅ Bridge según protocolo activo |

### ✅ CONSTRUIDO — Modo Dual: Polymarket + Protocolo Propio

La plataforma opera en dos modos, configurable desde el panel admin:

| Modo | Descripción |
|------|-------------|
| **Polymarket** | Muestra mercados de Polymarket (API Gamma), trades via CLOB en Polygon |
| **Protocolo propio** | Mercados creados por admin, trades en PronosAMM en Arbitrum |

El switch es reactivo en toda la app (custom event). En la fase actual, el modo Polymarket permite validar la UX con mercados reales mientras los contratos propios se despliegan.

### 🔨 POR CONSTRUIR — Frontend

| Item | Detalle | Prioridad |
|------|---------|-----------|
| **Conectar frontend a contratos propios** | Library `contracts.js` para interactuar con PronosAMM (buy/sell/redeem) | Alta |
| **Panel buy/sell para protocolo propio** | Detectar si mercado es Polymarket o propio, rutear al AMM correcto | Alta |
| **Precio en tiempo real del AMM** | Leer `priceYes()`/`priceNo()` del contrato, mostrar en UI | Alta |
| **Preview de slippage** | Usar `estimateBuy()`/`estimateSell()` antes de confirmar trade | Alta |
| **Portfolio unificado** | Merge de posiciones Polymarket + protocolo propio en una sola vista | Media |
| **Gráfica de precio histórica** | Chart de línea/OHLC usando price_snapshots de la DB | Media |
| **MoonPay widget** | Embed widget para depósitos con tarjeta/Apple Pay/Google Pay | Alta |
| **Notificaciones push** | Alertas de apertura/resolución de mercados (WhatsApp/SMS/push) | Baja — post-MVP |
| **Gas sponsoring** | Activar Privy paymaster para que usuario no pague gas | Media |
| **Responsive final** | Revisión final de mobile y tablet | Media |
| **PWA** | Service worker para experiencia app-like en mobile | Baja |

### Interfaz de Visualización — Visión Completa

Estos son todos los componentes de UI que la plataforma debe tener en su versión completa:

| Componente | Estado | Descripción |
|-----------|--------|-------------|
| Gráfica de probabilidad en tiempo real | ✅ Ring chart | Chart de línea mostrando movimiento YES/NO desde apertura |
| Historial de precios | 🔨 Por construir | Vista OHLC por hora/día para análisis de tendencias |
| Panel de posiciones (P&L) | ✅ Básico | Dashboard: mercados activos, invertido, valor actual, ganancia flotante |
| Feed de mercados activos | ✅ Implementado | Lista con filtros por categoría, volumen y fecha de cierre |
| Vista de mercado individual | ✅ Implementado | Detalle: reglas, oráculo, actividad, comentarios |
| Notificaciones push | 🔨 Por construir | Alertas: apertura, resolución próxima, resultado final |
| Leaderboard | 🔨 Por construir | Ranking de usuarios por P&L / volumen |

---

## 05  Backend e Infraestructura

### ✅ CONSTRUIDO — API Serverless (Vercel Functions)

| Endpoint | Función |
|----------|---------|
| `GET /api/markets` | Lista mercados del protocolo propio con precio actual |
| `GET /api/market?id=` | Detalle de mercado + 50 snapshots de precio + 20 trades recientes + volumen total |
| `GET /api/positions?address=` | Posiciones del usuario con cálculo de P&L (distingue mercados activos vs. resueltos) |
| `GET /api/user?privyId=` | Datos de usuario + flag admin (server-side, no expuesto en frontend) |
| `GET /api/indexer` | Indexador de eventos on-chain (Vercel Cron, cada minuto) |
| `GET /api/migrate?key=` | Migración de base de datos (auth por key) |
| `GET /api/bitso?action=` | Stub de cotización MXN↔USDC (mock, preparado para integración real) |

### ✅ CONSTRUIDO — Base de Datos (Neon PostgreSQL)

| Tabla | Propósito |
|-------|----------|
| `users` | Usuarios registrados (privyId, username, admin flag) |
| `protocol_markets` | Mercados del protocolo propio (chain_id, pool_address, question, status, outcome) |
| `trades` | Historial de compras/ventas indexadas on-chain (con dedup por tx_hash + log_index) |
| `positions` | Posiciones materializadas por usuario/mercado (yes_shares, no_shares, total_cost) |
| `price_snapshots` | Snapshots de precio del AMM para gráficas (yes_price, no_price, liquidity) |
| `indexer_state` | Último bloque procesado por cadena |

6 índices para queries rápidos. Migración automatizada via endpoint protegido.

### ✅ CONSTRUIDO — Indexador On-Chain

Lee eventos del blockchain y escribe a PostgreSQL:

- **MarketCreated** → registra nuevo mercado
- **SharesBought / SharesSold** → registra trade + actualiza posición del usuario
- **MarketResolved** → actualiza estado del mercado
- **Price snapshots** → lee `reserveYes()` / `reserveNo()` del AMM, calcula precio CPMM

Ejecutado via Vercel Cron (cada minuto) o trigger manual con key de autenticación.

### ✅ CONSTRUIDO — Monitoreo

| Herramienta | Uso |
|-------------|-----|
| **Sentry** | Error tracking frontend (React ErrorBoundary, privacy-safe, solo producción) |
| **Structured logger** | JSON logging en API routes con duración, CORS automático, stack traces |

### 🔨 POR CONSTRUIR — Backend

| Item | Detalle | Prioridad |
|------|---------|-----------|
| **API de Bitso real** | Reemplazar stub con integración real para cotizaciones MXN↔USDC y on-ramp SPEI | Media |
| **Webhook MoonPay** | Recibir confirmación de depósitos y actualizar estado en DB | Alta |
| **Rate limiting** | Protección contra abuso en endpoints públicos | Alta |
| **Input validation** | Sanitización de todos los inputs de usuario en API | Alta |
| **CSRF protection** | Tokens CSRF en endpoints POST | Media |
| **Leaderboard API** | Endpoint para ranking de usuarios por P&L/volumen | Baja |

---

## 06  Seguridad

### ✅ CONSTRUIDO — Headers de Seguridad

| Header | Valor | Estado |
|--------|-------|--------|
| X-Frame-Options | DENY | ✅ |
| X-Content-Type-Options | nosniff | ✅ |
| Referrer-Policy | strict-origin-when-cross-origin | ✅ |
| Permissions-Policy | camera=(), microphone=(), geolocation=(), payment=(), usb=() | ✅ |
| Strict-Transport-Security | max-age=63072000; includeSubDomains; preload | ✅ |
| CORS | Restringido a pronos.io + localhost | ✅ |
| X-XSS-Protection | 0 (deshabilitado, reemplazado por CSP) | ✅ |

### Auditoría de Seguridad Interna — Hallazgos

Se realizó una auditoría completa del código. Estado de hallazgos:

#### Resueltos ✅
- C1: Auth de admin movido a server-side
- C4: Lista de admin eliminada del bundle de frontend
- H2: X-Frame-Options: DENY
- M1-M5: Headers de seguridad completos + CORS restrictivo

#### 🔨 Por Resolver (Pendientes)

| ID | Severidad | Descripción |
|----|-----------|-------------|
| C2 | Crítico | Credenciales CLOB en body del POST — derivar server-side |
| C3 | Crítico | DATABASE_URL accesible desde frontend API — separar tiers |
| H1 | Alto | Sin Content-Security-Policy (CSP) |
| H3 | Alto | `/mvp/admin` sin auth server-side completo |
| H4 | Alto | `/api/user` enumerable sin autenticación |
| M6 | Medio | Sin SRI (Subresource Integrity) en scripts externos |
| M7 | Medio | Sin CSRF protection en POST requests |
| M8 | Medio | `localStorage` como source of truth para protocol mode |
| M9 | Medio | Vite dev proxy apuntando a producción |
| M10 | Medio | ethers.js v5.7.2 outdated — upgrade a v6 |

### Roles de Administrador y Multisig

| Rol | Control | Implementación |
|-----|---------|---------------|
| **Owner** (Safe 3/5) | Pausar contratos, crear mercados, distribuir fees, actualizar direcciones | Gnosis Safe en Arbitrum |
| **Resolver** (Safe 2/3) | Resolver mercados (declarar resultado ganador) | Puede ser el mismo Safe u otro |
| **Admin UI** | Gestión via panel web `/mvp/admin` | Server-side auth (username-based) |

**Sin upgradability arbitraria:** cualquier cambio de lógica de contratos requiere las firmas del multisig. Los contratos son immutable — un cambio de lógica requiere nuevo deploy y migración.

### 🔨 POR CONSTRUIR — Seguridad

| Item | Detalle | Prioridad |
|------|---------|-----------|
| **Resolver C2, C3** | Separar credenciales CLOB y DB del frontend | Crítico |
| **CSP headers** | Content-Security-Policy restrictivo | Alto |
| **Auth completo en admin** | Server-side middleware, no solo username check | Alto |
| **Rate limiting** | En todos los endpoints API | Alto |
| **Fuzz testing contratos** | Edge cases del AMM (reentrancy, overflow, montos extremos) | Alto |
| **Auditoría externa** | Por firma especializada antes de mainnet con volumen significativo | Post-launch |
| **Bug bounty** | Programa de recompensas post-lanzamiento | Post-launch |

---

## 07  Curaduría de Mercados

### v1 — Mercados Administrados

En v1 la creación de mercados está restringida a administradores con acceso al panel de control. No hay mercados creados por usuarios hasta v2.

#### ✅ CONSTRUIDO — Panel de Administración

- Crear mercado: pregunta, opciones, fecha de cierre, oráculo, liquidez inicial, reglas de resolución
- Pausar / reanudar mercado ante eventos inesperados
- Resolver mercado: seleccionar resultado ganador
- Display de métricas: fees, distribución, estado de contratos
- Integración Safe: proponer/firmar/ejecutar transacciones desde la UI

#### 🔨 POR CONSTRUIR

| Item | Detalle | Prioridad |
|------|---------|-----------|
| **Wire forms a contratos** | Conectar el form de crear mercado a `MarketFactory.createMarket()` via Safe | Alta |
| **Wire resolve/pause** | Botones de resolver/pausar ejecuten transacciones via Safe multisig | Alta |
| **Dashboard de métricas** | Volumen por mercado, participantes, fees acumulados, liquidez | Media |
| **Gestión de usuarios** | Pausar cuentas ante actividad sospechosa | Baja |
| **Mercados user-generated** | Permitir que usuarios propongan mercados (v2, con moderación) | Post-MVP |

### Mercados de Lanzamiento (Target: FIFA World Cup 2026)

| Categoría | Ejemplos |
|-----------|----------|
| **FIFA World Cup** | ¿México pasa a octavos? ¿Quién gana el grupo? ¿Argentina bicampeón? |
| **Liga MX** | ¿Quién gana el Clausura 2026? ¿Descenso? |
| **Política MX** | Elecciones intermedias, reformas, nombramientos |
| **Reality TV** | La Casa de los Famosos, Exatlón, La Academia |
| **Crypto/Economía** | Precio de Bitcoin, tipo de cambio, inflación |

Se planean **5-10 mercados curados** para el lanzamiento, con seed liquidity en USDC.

---

## 08  Roadmap y Estado Actual

### Fase 1: Fundación y Contratos — ~85% Completo

| Item | Estado |
|------|--------|
| Arquitectura definida (hybrid: Polymarket + protocolo propio) | ✅ |
| Contratos core: PronosToken, PronosAMM, MarketFactory | ✅ |
| 43 tests passing (Foundry) | ✅ |
| Deploy script reproducible (`DeployProtocol.s.sol`) | ✅ |
| Safe SDK integrado en admin panel | ✅ |
| Config Arbitrum Sepolia en foundry.toml | ✅ |
| **Deploy a Arbitrum Sepolia** | 🔨 Por hacer |
| **Crear Safe multisig en testnet** | 🔨 Por hacer |
| **Transferir ownership a Safe** | 🔨 Por hacer |

### Fase 2: Features y UI — ~75% Completo

| Item | Estado |
|------|--------|
| Frontend completo (Home, Market, Portfolio, Admin) | ✅ |
| Polymarket integration (API Gamma, CLOB trading) | ✅ |
| Panel admin con CRUD de mercados + Safe SDK | ✅ |
| Wallet & onboarding (Privy, multi-chain, auto-switch) | ✅ |
| Backend: DB schema, indexer, APIs, price snapshots | ✅ |
| Monitoring: Sentry, structured logging | ✅ |
| Bet slip con fee dinámico y preview | ✅ |
| Responsive (tablet + mobile) | ✅ |
| OG metadata, Twitter cards, favicon | ✅ |
| Waitlist gate (Tally form) | ✅ |
| **Conectar frontend a contratos propios** | 🔨 Por hacer |
| **Wire admin forms a contratos via Safe** | 🔨 Por hacer |
| **Integrar MoonPay (on-ramp)** | 🔨 Por hacer |
| **Integrar UMA Oracle** | 🔨 Por hacer |
| **Cargar 5-10 mercados curados** | 🔨 Por hacer |
| **E2E testing en testnet** | 🔨 Bloqueado por deploy |

### Fase 3: Hardening y Mainnet — Target: 31 mayo 2026

| Item | Prioridad |
|------|-----------|
| Deploy a Arbitrum One (mainnet) | Crítico |
| Verificar contratos en Arbiscan | Crítico |
| Resolver hallazgos de seguridad (C2, C3, H1, H3, H4) | Crítico |
| Seed liquidity para mercados de lanzamiento | Crítico |
| Mercados World Cup 2026 listos | Crítico |
| Test de estabilidad 48h sin intervención | Alto |
| Documentación técnica y runbook | Alto |
| Rate limiting + input validation | Alto |
| Mobile responsiveness final check | Medio |

### Post-MVP — Visión Completa

Estas son las features planeadas para después del lanzamiento del Mundial:

| Item | Descripción | Estimación |
|------|-------------|-----------|
| **Bitso directo** | On/off ramp MXN via SPEI, comprar/vender USDC dentro de la app | $10-15K |
| **Mercados categóricos** | Soporte para 3+ outcomes (AMM extendido) | $10-15K |
| **Mercados escalares** | Rangos numéricos (tipo de cambio, inflación) | $10-15K |
| **Auditoría externa** | Por firma especializada (Trail of Bits, OpenZeppelin, etc.) | $25-50K |
| **Market making bot** | Liquidez algorítmica para mantener spreads tight | $5-10K |
| **Push notifications** | Alertas via WhatsApp/SMS/push (apertura, resolución, resultado) | $3-5K |
| **User-generated markets** | Permitir que usuarios propongan mercados con moderación | $10-15K |
| **Leaderboard** | Ranking público de traders por P&L y volumen | $3-5K |
| **Apps nativas** | iOS/Android (React Native o PWA avanzado) | $15-25K |
| **Programa de referidos** | Incentivos por invitar nuevos usuarios | $5-8K |
| **Analytics dashboard** | Panel público de métricas del protocolo (TVL, volumen, usuarios) | $5-8K |

---

## 09  Resumen del Stack Técnico

| Capa | Tecnología | Razón de elección |
|------|-----------|-------------------|
| **Blockchain** | Arbitrum (L2 de Ethereum) | Gas bajo, EVM-compatible, USDC nativo, ecosistema maduro |
| **Contratos** | Solidity 0.8.24 + OpenZeppelin + Foundry | Arquitectura propia, ERC-1155, AMM CPMM con fees dinámicos |
| **Tokens** | PronosToken (ERC-1155) | Un contrato para todos los mercados, gas-eficiente |
| **AMM** | PronosAMM (x·y=k) | Sin motor off-chain, liquidez automática, fees dinámicos |
| **Oráculo (deportes)** | Multi-sig custodial (Safe 2-de-3) | Resultados públicos, control directo, resolución rápida |
| **Oráculo (política)** | UMA Optimistic Oracle | Estándar industria, sistema de disputas on-chain |
| **Colateral** | USDC (Circle) | Stablecoin más líquida en Arbitrum |
| **On-ramp** | MoonPay + SPEI | Apple Pay, Google Pay, tarjetas, transferencia bancaria MXN |
| **Wallet/Auth** | Privy (Account Abstraction EIP-4337) | Email/Google/wallet, sin seed phrases, gas sponsoring |
| **Frontend** | React 18 + Vite 5 (SPA, mobile-first) | Iteración rápida, español únicamente |
| **Backend** | Vercel Serverless Functions | Zero-config, auto-scaling, cron jobs integrados |
| **Base de datos** | Neon PostgreSQL (serverless) | Compatible con Vercel, sin servidor que mantener |
| **Monitoreo** | Sentry + structured logging | Error tracking privacy-safe |
| **Multisig** | Gnosis Safe (2-de-3 / 3-de-5) | Estándar de la industria, SDK integrado |
| **Testing** | Foundry (forge test) | 43 tests, >75% coverage |

---

## 10  Diferenciadores vs. Competencia

| Feature | Polymarket | Myriad Markets | Pronos |
|---------|-----------|---------------|--------|
| Mercados LATAM curados | ❌ Enfoque global/US | ❌ Enfoque global | ✅ Liga MX, política MX, cultura, FIFA |
| Idioma | Inglés | Inglés | Español nativo |
| Onboarding sin cripto | ❌ Requiere wallet + bridging | Parcial | ✅ Email/Google → embedded wallet |
| On-ramp MXN | ❌ | ❌ | ✅ MoonPay + SPEI |
| Fees transparentes | 0% (spread oculto) | Variable | Fee dinámico explícito (0.05-2.5%) |
| Resolución | UMA (lento) | Centralizado | Multisig rápido (24-48h) + UMA para política |
| Mercado target | Global, traders cripto | Global | LATAM, usuarios no-cripto |

---

## 11  Lo que Necesitamos del Dev Shop

### Resumen Ejecutivo

Tenemos ~75% del producto construido. Los contratos inteligentes están escritos y testeados. El frontend es funcional con modo Polymarket activo. El backend con indexador, APIs y base de datos está operativo.

**Lo que falta para llegar a mainnet:**

#### Prioridad Crítica (antes del 14 de junio)
1. Deploy de contratos a Arbitrum Sepolia → testear → deploy a Arbitrum One
2. Conectar el frontend a los contratos propios (buy/sell/redeem via PronosAMM)
3. Wire el panel admin a contratos via Safe multisig
4. Integrar MoonPay para depósitos (Apple Pay, Google Pay, tarjetas)
5. Integrar UMA Optimistic Oracle para mercados políticos
6. Resolver vulnerabilidades de seguridad críticas/altas (C2, C3, H1, H3, H4)
7. E2E testing del flujo completo en testnet
8. Cargar 5-10 mercados curados (World Cup + Liga MX + política)

#### Prioridad Media (puede ser post-launch)
- Gas sponsoring (activar Privy paymaster)
- Gráfica de precio histórica (OHLC)
- Portfolio unificado (Polymarket + propio)
- Rate limiting y input validation en APIs
- Responsive final check
- On-ramp SPEI

#### Nice to Have (post-MVP)
- Mercados categóricos (3+ outcomes)
- Push notifications
- Leaderboard
- Market making bot
- User-generated markets
- Apps nativas

### Repositorio y Acceso

| Recurso | URL/Ubicación |
|---------|--------------|
| Repo GitHub | `github.com/mezcalpapieth-jpg/pronos` (privado) |
| Frontend (staging) | `pronos.io/mvp/` |
| Contratos | `contracts/src/` (Solidity 0.8.24, Foundry) |
| Deploy scripts | `contracts/script/DeployProtocol.s.sol` |
| API serverless | `frontend/api/` |
| Base de datos | Neon PostgreSQL (connection string en Vercel env vars) |
| Tests | `contracts/test/` — 43 tests, `forge test` para ejecutar |

---

*Documento preparado por Simon Lacy — Fundador, PRONOS*
*Última actualización: Abril 2026*
*Confidencial — Para uso exclusivo en contexto de evaluación de desarrollo. No distribuir.*
