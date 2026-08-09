# Modo grabación — instrucciones para Fabian

**Link:** https://pronos.io/points/video
**Contraseña:** `FABIAN`

Entras una vez y quedas adentro. Todo lo que veas es información inventada
para grabar: no toca la base de datos real y no lo ve ningún usuario.

---

## Las tres tomas

**1. Mercado en vivo con el porcentaje moviéndose**
Entra a cualquier mercado desde la portada. El porcentaje se mueve solo.
Si lo quieres más rápido, en el panel sube **Velocidad** hasta 10.

**2. Tabla del torneo con usuarios subiendo**
Ve a **Torneo Pronos** en el menú de arriba. Las filas se reacomodan solas
cada pocos segundos y se deslizan al cambiar de lugar. Tu usuario (`fabian`)
sube hasta el primer lugar, y cuando llega arriba lo regresamos al medio para
que la subida se pueda grabar otra vez.

**3. Predicción colocada**
Abre un mercado → elige Sí o No → escribe un monto → confirma. El balance
baja, aparece tu posición y el precio se mueve de verdad.

> Los montos dicen **MXNP**, no pesos. Son los puntos del torneo y así se
> llaman en el producto real.

---

## El panel

El botón naranja de abajo a la derecha lo abre.

| Control | Qué hace |
|---|---|
| **Balance** | Cuántos MXNP tienes para gastar |
| **Mover los porcentajes solos** | Prende/apaga el movimiento de las gráficas |
| **Velocidad** | Qué tan rápido se mueven (1 lento, 10 rápido) |
| **Mover posiciones solas** | Prende/apaga el movimiento de la tabla del torneo |
| **Cambia cada Ns** | Cada cuánto se reacomoda la tabla |
| **Crear mercado** | Pregunta, opciones, categoría, porcentaje y volumen |
| **Lista de mercados** | Cambia volumen y porcentaje de cualquiera, o bórralo |
| **Guardar / Cargar archivo** | Guarda el escenario para repetirlo otro día |
| **Reset** | Deja todo como al principio |

**`Ctrl + Shift + D` esconde el panel y el botón** para que no salgan en
cámara. La misma combinación los regresa.

---

## Si algo se traba

Recarga la página. Si sigue raro, dale **Reset** en el panel y recarga.
Nada de lo que hagas aquí puede romper Pronos.

Después de crear o borrar un mercado, recarga para verlo en la portada.

---

## Notas para el equipo

- Se activa solo en la sesión del navegador que pasó por `/points/video`.
  Otra pestaña, o alguien más, ve el Pronos normal.
- El código vive en `frontend/app/points/src/demo/` y viaja en chunks
  aparte que un visitante normal nunca descarga.
- La contraseña se cambia con la variable `VIDEO_ACCESS_PASSWORD` en Vercel.
- La página está bloqueada en `robots.txt` y manda `noindex`.
