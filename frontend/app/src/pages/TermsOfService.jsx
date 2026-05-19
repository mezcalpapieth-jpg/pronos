import React, { useEffect } from 'react';
import LegalLanguageSwitch from '../components/LegalLanguageSwitch.jsx';
import { useLang, useT } from '../lib/i18n.js';

/**
 * Terms of Service / Términos y Condiciones
 *
 * Draft tailored to Pronos:
 *   - Prediction-market platform with own AMM contracts on Arbitrum
 *   - MXNB collateral on mainnet, MockMXNB on testnet
 *   - Mexico-first audience (jurisdictional grey zone — clear disclaimers)
 *   - No-investment-advice / smart-contract-risk / regulatory-uncertainty
 *
 * MUST be reviewed by a Mexican lawyer before launch. The risk
 * disclosures and limitation of liability clauses in particular need
 * a real attorney's eyes.
 */
export default function TermsOfService() {
  const lang = useLang();
  const t = useT();
  const title = t('legal.terms.title');
  const isEn = lang === 'en';
  const lastUpdated = isEn ? 'May 6, 2026' : '6 de mayo de 2026';

  useEffect(() => {
    document.title = title;
  }, [title]);

  if (isEn) {
    return (
      <div style={{
        maxWidth: 820,
        margin: '0 auto',
        padding: 'clamp(24px, 5vw, 48px) clamp(20px, 5vw, 48px) 80px',
        fontFamily: 'var(--font-body, system-ui, sans-serif)',
        color: 'var(--text-primary)',
        lineHeight: 1.7,
      }}>
        <LegalLanguageSwitch currentLang={lang} />
        <DraftBanner lang="en" />

        <Eyebrow>TERMS · LAST UPDATED {lastUpdated.toUpperCase()}</Eyebrow>
        <H1>{title}</H1>

        <P>
          Welcome to Pronos. By accessing the platform or using any of its
          services, you accept these terms. If you do not agree, please do not
          use the platform. These terms form a legal agreement between you and
          Pronos.
        </P>

        <H2>1. What Pronos is</H2>
        <P>
          Pronos is a prediction-market platform where users buy and sell
          shares on the outcome of future events: sports, politics, economics,
          culture, and more. Activity settles automatically through smart
          contracts deployed on Arbitrum, using MXNB (the stablecoin issued by
          Bitso) as collateral on mainnet. On testnet we use MockMXNB to test
          the flow without pointing the app at a real token.
        </P>

        <H2>2. Eligibility</H2>
        <Ul>
          <li>You must be at least 18 years old.</li>
          <li>You must have legal capacity to enter into contracts in your jurisdiction.</li>
          <li>You are responsible for verifying that using prediction markets is legal in the country and state where you are located. Pronos does not guarantee that the service is legal in every jurisdiction.</li>
          <li>You must not reside in a jurisdiction sanctioned by the U.S. Department of the Treasury, the United Nations, or the European Union.</li>
        </Ul>
        <P>
          If we discover that you are violating any of the points above, we may
          suspend or close your account without prior notice.
        </P>

        <H2>3. Regulatory notice (Mexico)</H2>
        <P>
          Prediction markets are in a regulatory grey area in Mexico. Pronos
          does not operate under a license from the Federal Commission of Games
          and Raffles. The platform operates in a decentralized manner using
          public smart contracts on Arbitrum. We recommend consulting a legal
          adviser before using the platform if you have questions about its
          applicability to your specific situation.
        </P>

        <H2>4. Account and authentication</H2>
        <Ul>
          <li>Your account is created through a one-time code (OTP) sent to your email.</li>
          <li>Pronos does not store passwords. Your session is maintained through an HMAC-signed cookie valid for 30 days.</li>
          <li>You are responsible for securing your email account - whoever has access to it may access your Pronos account.</li>
          <li>The wallet associated with your account is managed through Turnkey delegated signing. We do not have direct access to your private keys.</li>
        </Ul>

        <H2>5. How markets work</H2>
        <Ul>
          <li><b>Buying and selling:</b> prices are calculated through a constant-product formula (CPMM, x*y=k). Each trade includes a dynamic fee from 0.05% to 2.5%, depending on the certainty level of the market.</li>
          <li><b>Resolution:</b> markets resolve when the event occurs. Some resolve automatically with public data (sports results, on-chain oracle prices); others are resolved manually by the Pronos team.</li>
          <li><b>Redemption:</b> after resolution, winning outcome tokens are redeemed 1 to 1 for collateral. Losing outcome tokens lose all value.</li>
          <li><b>Pauses:</b> in exceptional cases (serious error, ambiguous event, platform attack) we may pause a market while the situation is resolved.</li>
        </Ul>

        <H2>6. Fees</H2>
        <Ul>
          <li><b>Market fee:</b> dynamic, calculated with the formula <code>5 × (1 − P)%</code>, where P is the implied probability of the outcome you are buying. It equals 2.5% in 50/50 markets, 0.5% in 90/10 markets, and 0.05% in 99/1 markets. It is deducted before entering the pool.</li>
          <li><b>Fee distribution:</b> 70% treasury, 20% liquidity reserve, 10% emergency reserve.</li>
          <li><b>Gas:</b> you pay the gas for each on-chain transaction in Arbitrum ETH. Pronos may subsidize gas in certain promotions - this will be announced explicitly when it happens.</li>
        </Ul>

        <H2>7. Risks</H2>
        <P>
          Using Pronos involves risk. By participating, you state that you
          understand and accept the following risks:
        </P>
        <Ul>
          <li><b>Loss of capital:</b> you may lose all collateral you put at risk. Only risk what you can afford to lose.</li>
          <li><b>Volatility:</b> prices move with market liquidity and may change quickly. Low-liquidity markets can suffer significant slippage.</li>
          <li><b>Smart contract risk:</b> although contracts are internally reviewed and covered by property tests, we cannot guarantee that they are error-free. A code failure could result in unrecoverable losses.</li>
          <li><b>Oracle / resolution risk:</b> a market's outcome depends on external sources (sports APIs, human teams). Errors in those sources can produce incorrect resolutions. We have a review process, but we are not immune to error.</li>
          <li><b>Regulatory risk:</b> changes in Mexican or international regulation may require us to close services or limit access from certain jurisdictions.</li>
          <li><b>Stablecoin risk:</b> MXNB depends on Bitso to maintain its peg to the Mexican peso. A depeg event would affect the value of collateral in your account.</li>
          <li><b>Network risk:</b> Arbitrum may suffer downtime or failures. During those periods you may not be able to trade.</li>
        </Ul>
        <P>
          <b>Pronos is not an investment adviser.</b> Nothing on the platform
          is financial, investment, legal, or tax advice. The decisions you make
          are your sole responsibility.
        </P>

        <H2>8. Prohibited conduct</H2>
        <P>You may not:</P>
        <Ul>
          <li>Manipulate prices through coordinated activity (wash trading, pump-and-dump, spoofing).</li>
          <li>Trade using privileged information about an event outcome (for example, a referee betting against their own match).</li>
          <li>Use bots, scrapers, or any unauthorized automation.</li>
          <li>Impersonate another person or create multiple accounts to evade restrictions.</li>
          <li>Use the platform to launder money, finance illegal activities, or evade sanctions.</li>
          <li>Attack the technical integrity of the system (denial of service, exploits, malicious reverse engineering of contracts).</li>
        </Ul>
        <P>
          Pronos may freeze your account, cancel activity, and report to the
          appropriate authorities if it detects any of the conduct above.
        </P>

        <H2>9. Intellectual property</H2>
        <P>
          The Pronos name, logo, and original editorial content on the platform
          are protected by copyright and trademark rights. User-generated text
          (comments, etc.) remains owned by users; by publishing it on Pronos,
          you grant us a non-exclusive license to display it publicly on the
          platform.
        </P>

        <H2>10. Third-party content</H2>
        <P>
          The News section aggregates headlines from Mexican media for
          editorial context. Each item includes attribution to its original
          source and a link to the full article. Pronos is not responsible for
          content published by those media outlets. If you own rights to any
          aggregated content and believe its use exceeds editorial fair use,
          write to{' '}
          <a href="mailto:simon@pronos.io" style={linkStyle}>simon@pronos.io</a>{' '}
          and we will remove it.
        </P>

        <H2>11. Disclaimer and limitation of liability</H2>
        <P>
          The platform is provided <b>"as is"</b>, without express or implied
          warranties, including but not limited to warranties of merchantability,
          fitness for a particular purpose, accuracy, or non-infringement.
        </P>
        <P>
          To the maximum extent permitted by law, Pronos, its operators,
          employees, contractors, and providers will not be liable for direct,
          indirect, incidental, special, consequential, or exemplary damages,
          including loss of profits, data, opportunities, or reputation, arising
          from the use of or inability to use the platform.
        </P>
        <P>
          Our aggregate liability for any claim related to the service is
          limited to the amount actually charged in fees to your account during
          the 6 months before the claim.
        </P>

        <H2>12. Indemnification</H2>
        <P>
          You agree to indemnify and hold Pronos harmless from any third-party
          claim arising from your breach of these terms, your violation of
          applicable law, or your misuse of the platform.
        </P>

        <H2>13. Suspension and termination</H2>
        <P>
          We may suspend or cancel your account at any time if we believe you
          violated these terms, if a competent authority requires it, or if we
          stop operating the service. You may close your account whenever you
          want by writing to{' '}
          <a href="mailto:simon@pronos.io" style={linkStyle}>simon@pronos.io</a>.
        </P>
        <P>
          After cancellation, activity already settled on blockchain remains
          recorded. Any balance in your wallet remains yours, and you may
          withdraw it to another address.
        </P>

        <H2>14. Changes to these terms</H2>
        <P>
          We may update these terms when necessary. If changes are material, we
          will notify you by email and show a notice on the platform at least 7
          days in advance. If you do not agree with the new terms, you must stop
          using the platform. The date at the top of this document always
          reflects the current version.
        </P>

        <H2>15. Governing law and jurisdiction</H2>
        <P>
          These terms are governed by the laws of the United Mexican States.
          Any dispute arising from or related to these terms will be submitted
          to the jurisdiction of the competent courts of Mazatlan, Sinaloa. The
          parties waive any other venue that may correspond to them because of
          present or future domicile.
        </P>

        <H2>16. Dispute resolution</H2>
        <P>
          Before starting any legal proceeding, both parties will try to resolve
          the dispute in good faith through direct negotiation. If no resolution
          is reached within 30 days, either party may go to the courts described
          in the previous section.
        </P>

        <H2>17. Miscellaneous</H2>
        <Ul>
          <li>If any provision of these terms is invalid or unenforceable, the remaining provisions will remain fully in effect.</li>
          <li>Pronos's failure to exercise any right does not waive its right to exercise it in the future.</li>
          <li>These terms, together with the Privacy Policy, constitute the complete agreement between you and Pronos.</li>
        </Ul>

        <H2>18. Contact</H2>
        <P>
          Questions about these terms? Write to{' '}
          <a href="mailto:simon@pronos.io" style={linkStyle}>simon@pronos.io</a>.
        </P>
      </div>
    );
  }

  return (
    <div style={{
      maxWidth: 820,
      margin: '0 auto',
      padding: 'clamp(24px, 5vw, 48px) clamp(20px, 5vw, 48px) 80px',
      fontFamily: 'var(--font-body, system-ui, sans-serif)',
      color: 'var(--text-primary)',
      lineHeight: 1.7,
    }}>
      <LegalLanguageSwitch currentLang={lang} />
      <DraftBanner />

      <Eyebrow>TÉRMINOS · ÚLTIMA ACTUALIZACIÓN {lastUpdated.toUpperCase()}</Eyebrow>
      <H1>{title}</H1>

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
        en mainnet. En testnet utilizamos MockMXNB para ensayar el flujo
        sin apuntar la aplicación a un token real.
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

function DraftBanner({ lang = 'es' }) {
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
      {lang === 'en'
        ? 'DRAFT · pending legal review · not final text'
        : 'BORRADOR · pendiente de revisión legal · no es texto definitivo'}
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
