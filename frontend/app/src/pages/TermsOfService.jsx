import React from 'react';

/**
 * Terms of Service / Términos y Condiciones
 *
 * Draft tailored to Pronos:
 *   - Prediction-market platform with own AMM contracts on Arbitrum
 *   - MXNB collateral on mainnet, USDC stand-in on testnet (labelled MXNB)
 *   - Mexico-first audience (jurisdictional grey zone — clear disclaimers)
 *   - No-investment-advice / smart-contract-risk / regulatory-uncertainty
 *
 * MUST be reviewed by a Mexican lawyer before launch. The risk
 * disclosures and limitation of liability clauses in particular need
 * a real attorney's eyes.
 */
export default function TermsOfService() {
  const lastUpdated = '6 de mayo de 2026';

  return (
    <div style={{
      maxWidth: 820,
      margin: '0 auto',
      padding: 'clamp(24px, 5vw, 48px) clamp(20px, 5vw, 48px) 80px',
      fontFamily: 'var(--font-body, system-ui, sans-serif)',
      color: 'var(--text-primary)',
      lineHeight: 1.7,
    }}>
      <DraftBanner />

      <Eyebrow>TÉRMINOS · ÚLTIMA ACTUALIZACIÓN {lastUpdated.toUpperCase()}</Eyebrow>
      <H1>Términos y Condiciones de Uso</H1>

      <P>
        Bienvenido a Pronos. Al acceder a la plataforma o utilizar
        cualquiera de sus servicios estás aceptando los siguientes
        términos. Si no estás de acuerdo, te pedimos que no uses la
        plataforma. Estos términos forman un acuerdo legal entre tú y
        Pronos.
      </P>

      <H2>1. Qué es Pronos</H2>
      <P>
        Pronos es una plataforma de mercados de predicciones donde los
        usuarios compran y venden acciones (shares) sobre el resultado
        de eventos futuros: deportes, política, economía, cultura, entre
        otros. Las operaciones se liquidan automáticamente mediante
        contratos inteligentes desplegados en la red Arbitrum, usando
        MXNB (la stablecoin emitida por Bitso) como activo de colateral
        en mainnet. En testnet utilizamos USDC como sustituto, etiquetado
        como “MXNB” en la interfaz.
      </P>

      <H2>2. Elegibilidad</H2>
      <Ul>
        <li>Debes ser mayor de 18 años.</li>
        <li>Debes tener capacidad legal para celebrar contratos en tu jurisdicción.</li>
        <li>Eres responsable de verificar que el uso de mercados de predicción es legal en el país y estado donde te encuentras. Pronos no garantiza que el servicio sea legal en todas las jurisdicciones.</li>
        <li>No debes residir en una jurisdicción sancionada por el Departamento del Tesoro de EE. UU., la ONU o la Unión Europea.</li>
      </Ul>
      <P>
        Si descubrimos que estás incumpliendo cualquiera de los puntos
        anteriores, podemos suspender o cerrar tu cuenta sin previo
        aviso.
      </P>

      <H2>3. Aviso regulatorio (México)</H2>
      <P>
        Los mercados de predicción se encuentran en una zona regulatoria
        gris en México. Pronos no opera bajo licencia de la Comisión
        Federal de Juegos y Sorteos. La plataforma opera de forma
        descentralizada usando contratos inteligentes públicos sobre
        Arbitrum. Te recomendamos consultar con un asesor legal antes de
        usar la plataforma si tienes dudas sobre su aplicabilidad a tu
        situación particular.
      </P>

      <H2>4. Cuenta y autenticación</H2>
      <Ul>
        <li>Tu cuenta se crea mediante un código de un solo uso (OTP) enviado a tu correo electrónico.</li>
        <li>Pronos no almacena contraseñas. La sesión se mantiene mediante una cookie firmada con HMAC, vigente 30 días.</li>
        <li>Eres responsable de la seguridad de tu correo electrónico — quien tenga acceso a él puede acceder a tu cuenta.</li>
        <li>La wallet asociada a tu cuenta se gestiona vía Turnkey (firmas delegadas). No tenemos acceso directo a tus claves privadas.</li>
      </Ul>

      <H2>5. Cómo funcionan los mercados</H2>
      <Ul>
        <li><b>Compra y venta:</b> los precios se calculan mediante una fórmula de producto constante (CPMM, x·y=k). Cada operación incurre en una comisión dinámica que va del 0.05% al 2.5% según el grado de certidumbre del mercado.</li>
        <li><b>Resolución:</b> los mercados se resuelven cuando ocurre el evento. Algunos resuelven automáticamente con datos públicos (resultados deportivos, precios de oráculo en cadena); otros se resuelven manualmente por el equipo de Pronos.</li>
        <li><b>Redención:</b> tras la resolución, los tokens del resultado ganador se canjean 1 a 1 por el colateral. Los tokens del resultado perdedor pierden todo su valor.</li>
        <li><b>Pausa:</b> en casos excepcionales (error grave, evento ambiguo, ataque a la plataforma) podemos pausar un mercado mientras se resuelve la situación.</li>
      </Ul>

      <H2>6. Comisiones</H2>
      <Ul>
        <li><b>Comisión de mercado:</b> dinámica, calculada con la fórmula <code>5 × (1 − P)%</code>, donde P es la probabilidad implícita del resultado que estás comprando. Equivale a 2.5% en mercados 50/50, 0.5% en mercados 90/10, y 0.05% en mercados 99/1. Se descuenta antes de entrar al pool.</li>
        <li><b>Distribución de la comisión:</b> 70% tesorería, 20% reserva de liquidez, 10% reserva de emergencia.</li>
        <li><b>Gas:</b> tú pagas el gas de cada transacción on-chain en ETH de Arbitrum. Pronos puede subsidiar el gas en ciertas promociones — esto se anuncia explícitamente cuando ocurre.</li>
      </Ul>

      <H2>7. Riesgos</H2>
      <P>
        El uso de Pronos implica riesgos. Al participar, declaras
        entender y aceptar los siguientes riesgos:
      </P>
      <Ul>
        <li><b>Pérdida de capital:</b> puedes perder la totalidad del colateral que pongas en juego. Solo arriesga lo que puedas permitirte perder.</li>
        <li><b>Volatilidad:</b> los precios se mueven con la liquidez del mercado y pueden cambiar rápidamente. Los mercados poco líquidos sufren slippage importante.</li>
        <li><b>Riesgo de contratos inteligentes:</b> aunque los contratos están auditados internamente y cubiertos por pruebas de propiedad, no podemos garantizar la ausencia de errores. Un fallo en el código podría resultar en pérdidas no recuperables.</li>
        <li><b>Riesgo de oracle / resolución:</b> el resultado de un mercado depende de fuentes externas (APIs deportivas, equipos humanos). Errores en esa fuente pueden producir resoluciones incorrectas. Tenemos un proceso de revisión pero no estamos exentos de error.</li>
        <li><b>Riesgo regulatorio:</b> cambios en la regulación mexicana o internacional pueden requerir que cerremos servicios o limitemos el acceso desde ciertas jurisdicciones.</li>
        <li><b>Riesgo de stablecoin:</b> MXNB depende de Bitso para mantener su paridad con el peso mexicano. Un evento de despeg afectaría el valor del colateral en tu cuenta.</li>
        <li><b>Riesgo de red:</b> Arbitrum puede sufrir tiempo fuera de servicio o fallas. Durante esos periodos no podrás operar.</li>
      </Ul>
      <P>
        <b>Pronos no es asesor de inversiones.</b> Nada en la plataforma
        constituye consejo financiero, de inversión, legal o fiscal. Las
        decisiones que tomes son tu responsabilidad exclusiva.
      </P>

      <H2>8. Conducta prohibida</H2>
      <P>No puedes:</P>
      <Ul>
        <li>Manipular precios mediante operaciones coordinadas (wash trading, pump-and-dump, spoofing).</li>
        <li>Operar con información privilegiada sobre el resultado de un evento (por ejemplo, un árbitro apostando contra su propio partido).</li>
        <li>Usar bots, scrapers o cualquier automatización no autorizada.</li>
        <li>Suplantar a otra persona o crear múltiples cuentas para evadir restricciones.</li>
        <li>Usar la plataforma para lavar dinero, financiar actividades ilegales o evadir sanciones.</li>
        <li>Atentar contra la integridad técnica del sistema (denegación de servicio, exploits, ingeniería inversa de los contratos con fines maliciosos).</li>
      </Ul>
      <P>
        Pronos puede congelar tu cuenta, cancelar operaciones, y reportar
        a las autoridades correspondientes si detecta cualquiera de los
        comportamientos anteriores.
      </P>

      <H2>9. Propiedad intelectual</H2>
      <P>
        El nombre Pronos, su logotipo y el contenido editorial original
        de la plataforma están protegidos por derechos de autor y marca.
        Los textos generados por usuarios (comentarios, etc.) siguen
        siendo de los usuarios; al publicarlos en Pronos otorgas una
        licencia no exclusiva para mostrarlos públicamente en la
        plataforma.
      </P>
      <P>
        El código de los contratos inteligentes está disponible
        públicamente en GitHub bajo la licencia que ahí se indica. El
        repositorio del frontend también es público.
      </P>

      <H2>10. Contenido de terceros</H2>
      <P>
        La sección de Noticias agrega titulares de medios mexicanos para
        contexto editorial. Cada nota incluye atribución a su fuente
        original y un enlace al artículo completo. Pronos no se
        responsabiliza por el contenido publicado por estos medios. Si
        eres titular de derechos sobre alguno de los contenidos
        agregados y consideras que su uso excede el fair-use editorial,
        escríbenos a{' '}
        <a href="mailto:simon@pronos.io" style={linkStyle}>simon@pronos.io</a>{' '}
        y lo retiraremos.
      </P>

      <H2>11. Disclaimer y limitación de responsabilidad</H2>
      <P>
        La plataforma se ofrece <b>“tal cual”</b>, sin garantías
        explícitas ni implícitas, incluyendo pero no limitado a
        garantías de comerciabilidad, idoneidad para un fin particular,
        precisión, o no infracción.
      </P>
      <P>
        En la máxima medida permitida por la ley, Pronos, sus operadores,
        empleados, contratistas y proveedores no serán responsables por
        daños directos, indirectos, incidentales, especiales,
        consecuentes o ejemplares, incluyendo pérdida de ganancias,
        datos, oportunidades, o reputación, derivados del uso o de la
        imposibilidad de usar la plataforma.
      </P>
      <P>
        Nuestra responsabilidad agregada por cualquier reclamación
        relacionada con el servicio queda limitada al monto efectivamente
        cobrado en comisiones a tu cuenta durante los 6 meses anteriores
        a la reclamación.
      </P>

      <H2>12. Indemnización</H2>
      <P>
        Aceptas indemnizar y mantener indemne a Pronos frente a cualquier
        reclamación de terceros derivada de tu incumplimiento de estos
        términos, tu violación de la ley aplicable, o tu uso indebido de
        la plataforma.
      </P>

      <H2>13. Suspensión y terminación</H2>
      <P>
        Podemos suspender o cancelar tu cuenta en cualquier momento si
        consideramos que has violado estos términos, si lo requiere una
        autoridad competente, o si dejamos de operar el servicio. Tienes
        el derecho de cerrar tu cuenta cuando quieras escribiendo a{' '}
        <a href="mailto:simon@pronos.io" style={linkStyle}>simon@pronos.io</a>.
      </P>
      <P>
        Tras la cancelación, las operaciones ya liquidadas en blockchain
        permanecen registradas. Cualquier saldo en tu wallet sigue siendo
        tuyo y puedes retirarlo a otra dirección.
      </P>

      <H2>14. Cambios a estos términos</H2>
      <P>
        Podemos actualizar estos términos cuando sea necesario. Si los
        cambios son materiales, te avisaremos por email y mostraremos un
        aviso en la plataforma con al menos 7 días de anticipación. Si
        no estás de acuerdo con los nuevos términos, debes dejar de
        usar la plataforma. La fecha al inicio de este documento siempre
        refleja la versión vigente.
      </P>

      <H2>15. Ley aplicable y jurisdicción</H2>
      <P>
        Estos términos se rigen por las leyes de los Estados Unidos
        Mexicanos. Cualquier controversia derivada de o relacionada con
        estos términos será sometida a la jurisdicción de los tribunales
        competentes de Mazatlán, Sinaloa. Las partes renuncian a
        cualquier otro fuero que pudiera corresponderles por su
        domicilio presente o futuro.
      </P>

      <H2>16. Resolución de disputas</H2>
      <P>
        Antes de iniciar cualquier procedimiento legal, ambas partes
        intentarán resolver la disputa de buena fe mediante negociación
        directa. Si en un plazo de 30 días no se logra resolución, se
        podrá acudir a los tribunales mencionados en la sección
        anterior.
      </P>

      <H2>17. Misceláneos</H2>
      <Ul>
        <li>Si alguna disposición de estos términos resulta inválida o inejecutable, las demás disposiciones permanecerán plenamente en vigor.</li>
        <li>El no ejercicio de algún derecho por parte de Pronos no implica renuncia a ejercerlo en el futuro.</li>
        <li>Estos términos, junto con la Política de Privacidad, constituyen el acuerdo completo entre tú y Pronos.</li>
      </Ul>

      <H2>18. Contacto</H2>
      <P>
        ¿Dudas sobre estos términos? Escríbenos a{' '}
        <a href="mailto:simon@pronos.io" style={linkStyle}>simon@pronos.io</a>.
      </P>
    </div>
  );
}

// ─── Shared visual primitives ──────────────────────────────────────────────

function DraftBanner() {
  return (
    <div style={{
      background: 'rgba(255,85,0,0.08)',
      border: '1px solid var(--orange, #FF5500)',
      borderRadius: 10,
      padding: '12px 16px',
      marginBottom: 32,
      fontFamily: 'var(--font-mono, ui-monospace)',
      fontSize: 12,
      color: 'var(--orange, #FF5500)',
      letterSpacing: '0.06em',
    }}>
      BORRADOR · pendiente de revisión legal · no es texto definitivo
    </div>
  );
}
function Eyebrow({ children }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono, ui-monospace)',
      fontSize: 11, letterSpacing: '0.14em',
      color: 'var(--text-muted)',
      marginBottom: 12,
    }}>{children}</div>
  );
}
function H1({ children }) {
  return (
    <h1 style={{
      fontFamily: 'var(--font-display, sans-serif)',
      fontSize: 'clamp(28px, 5vw, 42px)',
      letterSpacing: '0.02em',
      textTransform: 'uppercase',
      margin: '0 0 24px',
    }}>{children}</h1>
  );
}
function H2({ children }) {
  return (
    <h2 style={{
      fontFamily: 'var(--font-display, sans-serif)',
      fontSize: 'clamp(18px, 2.5vw, 22px)',
      letterSpacing: '0.02em',
      marginTop: 32, marginBottom: 12,
    }}>{children}</h2>
  );
}
function P({ children }) {
  return (
    <p style={{
      margin: '0 0 14px',
      fontSize: 15,
      color: 'var(--text-secondary)',
    }}>{children}</p>
  );
}
function Ul({ children }) {
  return (
    <ul style={{
      margin: '0 0 14px',
      paddingLeft: 22,
      fontSize: 15,
      color: 'var(--text-secondary)',
    }}>{children}</ul>
  );
}
const linkStyle = {
  color: 'var(--orange, #FF5500)',
  textDecoration: 'underline',
  textUnderlineOffset: 2,
};
