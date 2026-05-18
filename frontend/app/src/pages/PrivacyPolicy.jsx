import React from 'react';
import { useLang } from '../lib/i18n.js';

/**
 * Privacy Policy / Política de Privacidad
 *
 * Draft tailored to Pronos's actual stack:
 *   - Auth: Turnkey email-OTP (no passwords stored on Pronos)
 *   - Storage: Neon (Postgres), Vercel (hosting), Sentry (errors)
 *   - Wallet: Turnkey-managed sub-organizations
 *   - Audience: Mexico-first (LFPDPPP applies)
 *
 * Review with a Mexican privacy lawyer before going live. The
 * "BORRADOR" banner at the top is a visible cue that this isn't
 * legally cleared yet.
 */
export default function PrivacyPolicy() {
  const lang = useLang();
  const isEn = lang === 'en';
  const lastUpdated = isEn ? 'May 6, 2026' : '6 de mayo de 2026';

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
        <DraftBanner lang="en" />

        <Eyebrow>PRIVACY · LAST UPDATED {lastUpdated.toUpperCase()}</Eyebrow>
        <H1>Privacy Policy</H1>

        <P>
          At Pronos, we respect your privacy. This policy explains what data
          we collect, why we collect it, and what rights you have as the owner
          of that information. It applies to all services offered at
          <a href="https://pronos.io" style={linkStyle}> pronos.io</a> and
          associated subdomains (together, "Pronos", "we", or "the platform").
        </P>

        <H2>1. Who is responsible for processing your data</H2>
        <P>
          The Pronos operating team is responsible for processing your personal
          data. For anything related to this policy, you can contact us at{' '}
          <a href="mailto:simon@pronos.io" style={linkStyle}>simon@pronos.io</a>.
        </P>

        <H2>2. What data we collect</H2>

        <H3>2.1 Data you provide directly</H3>
        <Ul>
          <li><b>Email address:</b> required to create your account through OTP. We do not store passwords.</li>
          <li><b>Username:</b> the public name you choose to identify yourself on the platform.</li>
          <li><b>Linked accounts (optional):</b> if you connect X, Instagram, or TikTok, we receive the public identifier those platforms expose through OAuth.</li>
          <li><b>Comments and messages:</b> content you publish in markets or send to us by email.</li>
        </Ul>

        <H3>2.2 Data generated when you use the platform</H3>
        <Ul>
          <li><b>Associated wallet:</b> Pronos uses Turnkey to create and sign transactions from a sub-organization linked to your email. Your public Arbitrum wallet address is recorded so we can process your activity.</li>
          <li><b>Activity history:</b> trades, positions, payouts, redemptions, and outcomes. This information is also recorded on the Arbitrum blockchain, publicly and permanently.</li>
          <li><b>Technical data:</b> IP address (to limit abuse and apply IP-based rate rules), browser type, operating system, and referrer.</li>
        </Ul>

        <H3>2.3 Cookies and local storage</H3>
        <Ul>
          <li><b>Session cookie (`pronos-session`):</b> HMAC-signed, HttpOnly + Secure + SameSite=Lax, valid for 30 days. We use it only to keep you signed in.</li>
          <li><b>MVP access cookie (`pronos_mvp_access`):</b> while the platform is in pre-launch, a soft password protects public access; this cookie indicates that you passed that gate.</li>
          <li><b>localStorage:</b> we store some client preferences (news filters, hidden sources) that never leave your browser.</li>
          <li>We do not use advertising tracking cookies or third-party profiling cookies.</li>
        </Ul>

        <H2>3. Why we collect this data</H2>
        <Ul>
          <li>To authenticate you and keep your session active.</li>
          <li>To record your activity and show your history.</li>
          <li>To issue blockchain transactions on your behalf.</li>
          <li>To prevent fraud, abusive automation, and market manipulation.</li>
          <li>To comply with applicable legal obligations.</li>
          <li>To communicate important service changes through transactional email.</li>
        </Ul>

        <H2>4. Who we share information with</H2>
        <P>
          We do not sell your data. We share information with the following
          providers only as needed to operate the platform:
        </P>
        <Ul>
          <li><b>Turnkey:</b> self-custodial wallet and delegated signing provider.</li>
          <li><b>Vercel:</b> hosting for the frontend and serverless functions.</li>
          <li><b>Neon:</b> managed PostgreSQL database for account and transaction records.</li>
          <li><b>Sentry:</b> production error monitoring. It is configured not to capture sensitive content such as emails, cookie values, or request bodies with PII.</li>
          <li><b>Resend:</b> transactional email delivery (OTP codes, notifications).</li>
          <li><b>X, Meta (Instagram), TikTok:</b> only if you choose to link those accounts; we receive the public data each platform exposes through OAuth.</li>
        </Ul>
        <P>
          Each provider operates under its own privacy policies and contractual
          terms that limit use of the data to the processing we request.
        </P>

        <H2>5. Information published on blockchain</H2>
        <P>
          Market activity is settled in smart contracts deployed on Arbitrum.
          Because EVM chains are public and immutable, the following data is
          recorded on-chain and visible to anyone:
        </P>
        <Ul>
          <li>Your wallet address (not your email or username).</li>
          <li>The amount and date of each purchase, sale, and redemption.</li>
          <li>The markets you are exposed to.</li>
        </Ul>
        <P>
          Pronos cannot erase or modify blockchain records. If that public
          exposure concerns you, consider not using the platform or using a
          dedicated wallet that is not linked to your identity.
        </P>

        <H2>6. Your rights (ARCO)</H2>
        <P>
          Under Mexico's Federal Law on Protection of Personal Data Held by
          Private Parties (LFPDPPP), you have the right to:
        </P>
        <Ul>
          <li><b>Access</b> the personal data we process about you.</li>
          <li><b>Rectify</b> inaccurate or incomplete information.</li>
          <li><b>Cancel</b> processing when it is no longer necessary.</li>
          <li><b>Object</b> to processing for specific purposes.</li>
        </Ul>
        <P>
          To exercise any of these rights, write to{' '}
          <a href="mailto:simon@pronos.io" style={linkStyle}>simon@pronos.io</a>{' '}
          with the subject "ARCO Request". We commit to responding within the
          applicable legal period (20 business days).
        </P>
        <P>
          Important: because blockchain records are immutable, we cannot delete
          confirmed on-chain transaction records. We can delete account data in
          our database, such as email, username, and social account links.
        </P>

        <H2>7. Data retention</H2>
        <Ul>
          <li>Account data: while your account is active, plus 12 months for accounting and abuse-prevention obligations.</li>
          <li>Session cookies: 30 days from last activity.</li>
          <li>Error logs (Sentry): 90 days.</li>
          <li>Blockchain data: permanent due to the nature of the network.</li>
        </Ul>

        <H2>8. Security</H2>
        <P>
          We apply reasonable security measures: TLS encryption for all
          communications, HSTS with preload, HttpOnly+Secure cookies, strict
          CSP headers, delegated wallet key storage through Turnkey (we never
          see or store private keys), and continuous code review by our team.
          No security measure is infallible - we recommend using unique
          passwords on your email account and enabling multi-factor
          authentication there.
        </P>

        <H2>9. Minors</H2>
        <P>
          Pronos is not intended for people under 18. We do not knowingly
          collect data from minors. If we discover that a minor created an
          account, we close it and delete the associated data.
        </P>

        <H2>10. Changes to this policy</H2>
        <P>
          We may update this policy to reflect changes in our services or in
          applicable regulation. When we make material changes, we will notify
          you by email and show a notice on the platform. The date at the top
          of this document always reflects the current version.
        </P>

        <H2>11. Contact</H2>
        <P>
          Questions, complaints, or ARCO requests? Write to{' '}
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
      <DraftBanner />

      <Eyebrow>POLÍTICA · ÚLTIMA ACTUALIZACIÓN {lastUpdated.toUpperCase()}</Eyebrow>
      <H1>Política de Privacidad</H1>

      <P>
        En Pronos respetamos tu privacidad. Esta política describe qué datos
        recolectamos, por qué lo hacemos y cuáles son tus derechos como
        titular de la información. Aplica a todos los servicios ofrecidos en
        <a href="https://pronos.io" style={linkStyle}> pronos.io</a> y los
        subdominios asociados (en adelante, “Pronos”, “nosotros”, “la
        plataforma”).
      </P>

      <H2>1. Quién es responsable del tratamiento</H2>
      <P>
        El responsable del tratamiento de tus datos personales es el equipo
        operador de Pronos. Para cualquier asunto relacionado con esta
        política puedes escribirnos a{' '}
        <a href="mailto:simon@pronos.io" style={linkStyle}>simon@pronos.io</a>.
      </P>

      <H2>2. Qué datos recolectamos</H2>

      <H3>2.1 Datos que tú nos proporcionas directamente</H3>
      <Ul>
        <li><b>Correo electrónico:</b> requerido para crear tu cuenta vía OTP. No almacenamos contraseñas.</li>
        <li><b>Nombre de usuario:</b> el que eliges públicamente para identificarte en la plataforma.</li>
        <li><b>Cuentas vinculadas (opcional):</b> si decides conectar X, Instagram o TikTok, recibimos tu identificador público de esas plataformas vía OAuth.</li>
        <li><b>Comentarios y mensajes:</b> contenido que publicas en mercados o nos envías por email.</li>
      </Ul>

      <H3>2.2 Datos generados al usar la plataforma</H3>
      <Ul>
        <li><b>Wallet asociada:</b> Pronos utiliza Turnkey para crear y firmar transacciones desde una sub-organización vinculada a tu correo. La dirección pública de tu wallet en Arbitrum queda registrada para procesar tus operaciones.</li>
        <li><b>Historial de actividad:</b> operaciones realizadas, posiciones, pagos, redenciones y resultados. Esta información también queda registrada en la blockchain (Arbitrum), de manera pública y permanente.</li>
        <li><b>Datos técnicos:</b> dirección IP (para limitar abuso y aplicar reglas de tarifa por IP), tipo de navegador, sistema operativo y referer.</li>
      </Ul>

      <H3>2.3 Cookies y almacenamiento local</H3>
      <Ul>
        <li><b>Cookie de sesión (`pronos-session`):</b> firmada con HMAC, marcada HttpOnly + Secure + SameSite=Lax, vigencia 30 días. La usamos exclusivamente para mantener tu sesión iniciada.</li>
        <li><b>Cookie de acceso al MVP (`pronos_mvp_access`):</b> mientras la plataforma está en pre-lanzamiento, una contraseña suave protege el acceso público; esta cookie indica que pasaste esa puerta.</li>
        <li><b>localStorage:</b> guardamos algunas preferencias del cliente (filtros de noticias, fuentes ocultadas) que nunca salen de tu navegador.</li>
        <li>No utilizamos cookies de seguimiento publicitario ni de terceros con fines de perfilamiento.</li>
      </Ul>

      <H2>3. Por qué recolectamos estos datos</H2>
      <Ul>
        <li>Para autenticarte y mantener tu sesión.</li>
        <li>Para registrar tus operaciones y mostrarte tu historial.</li>
        <li>Para emitir las transacciones en blockchain en tu nombre.</li>
        <li>Para prevenir fraude, automatización abusiva y manipulación de mercados.</li>
        <li>Para cumplir obligaciones legales aplicables.</li>
        <li>Para comunicarte cambios importantes en el servicio (vía email transaccional).</li>
      </Ul>

      <H2>4. Con quién compartimos información</H2>
      <P>
        No vendemos tus datos. Compartimos información con los siguientes
        proveedores únicamente en la medida necesaria para operar la
        plataforma:
      </P>
      <Ul>
        <li><b>Turnkey:</b> proveedor de wallets autocustodiadas y firmas delegadas.</li>
        <li><b>Vercel:</b> hospedaje del frontend y de las funciones serverless.</li>
        <li><b>Neon:</b> base de datos PostgreSQL gestionada donde residen los registros transaccionales y de cuenta.</li>
        <li><b>Sentry:</b> servicio de monitoreo de errores en producción. Configurado para no capturar contenido sensible (correos, valores de cookies, cuerpos de petición con PII).</li>
        <li><b>Resend:</b> envío de correos transaccionales (códigos OTP, notificaciones).</li>
        <li><b>X, Meta (Instagram), TikTok:</b> sólo si optas por vincular esas cuentas; recibimos los datos públicos que cada plataforma expone vía OAuth.</li>
      </Ul>
      <P>
        Cada proveedor opera bajo sus propias políticas de privacidad y
        términos contractuales que limitan el uso de los datos al
        procesamiento que les encomendamos.
      </P>

      <H2>5. Información publicada en blockchain</H2>
      <P>
        Las operaciones de mercado se liquidan en contratos inteligentes
        desplegados en Arbitrum. Por la naturaleza pública e inmutable de
        las cadenas EVM, los siguientes datos quedan registrados en la
        blockchain y son visibles para cualquier persona:
      </P>
      <Ul>
        <li>Tu dirección de wallet (no tu correo ni tu nombre de usuario).</li>
        <li>El monto y la fecha de cada compra, venta y redención.</li>
        <li>Los mercados a los que estás expuesto.</li>
      </Ul>
      <P>
        Pronos no puede borrar ni modificar registros en blockchain. Si esa
        exposición pública te preocupa, considera no usar la plataforma o
        usar una wallet dedicada que no esté vinculada a tu identidad.
      </P>

      <H2>6. Tus derechos (ARCO)</H2>
      <P>
        Bajo la Ley Federal de Protección de Datos Personales en Posesión
        de los Particulares (LFPDPPP) tienes derecho a:
      </P>
      <Ul>
        <li><b>Acceder</b> a tus datos personales que tratamos.</li>
        <li><b>Rectificar</b> información inexacta o incompleta.</li>
        <li><b>Cancelar</b> el tratamiento cuando ya no sea necesario.</li>
        <li><b>Oponerte</b> al tratamiento para fines específicos.</li>
      </Ul>
      <P>
        Para ejercer cualquiera de estos derechos, escríbenos a{' '}
        <a href="mailto:simon@pronos.io" style={linkStyle}>simon@pronos.io</a>{' '}
        con el asunto “Solicitud ARCO”. Nos comprometemos a responder
        dentro del plazo legal aplicable (20 días hábiles).
      </P>
      <P>
        Importante: por la inmutabilidad de la blockchain, no podemos
        eliminar registros transaccionales ya confirmados. Lo que sí
        podemos eliminar son los datos asociados a tu cuenta en nuestra
        base de datos (correo, nombre de usuario, vinculación de redes
        sociales).
      </P>

      <H2>7. Retención de datos</H2>
      <Ul>
        <li>Datos de cuenta: mientras tu cuenta esté activa, más 12 meses por obligaciones contables y de prevención de abuso.</li>
        <li>Cookies de sesión: 30 días desde la última actividad.</li>
        <li>Logs de error (Sentry): 90 días.</li>
        <li>Datos en blockchain: permanentes por la naturaleza de la red.</li>
      </Ul>

      <H2>8. Seguridad</H2>
      <P>
        Aplicamos medidas razonables de seguridad: cifrado TLS en todas
        las comunicaciones, HSTS con preload, cookies HttpOnly+Secure,
        cabeceras CSP estrictas, almacenamiento de claves de wallet
        delegadas a Turnkey (jamás vemos ni almacenamos claves privadas),
        y revisión continua del código por nuestro equipo. Ninguna
        medida de seguridad es infalible — recomendamos usar contraseñas
        únicas en tu correo y activar autenticación multifactor en él.
      </P>

      <H2>9. Menores de edad</H2>
      <P>
        Pronos no está dirigido a menores de 18 años. No recolectamos
        deliberadamente datos de menores. Si descubrimos que un menor ha
        creado una cuenta, la cerramos y eliminamos los datos asociados.
      </P>

      <H2>10. Cambios a esta política</H2>
      <P>
        Podemos actualizar esta política para reflejar cambios en nuestros
        servicios o en la regulación aplicable. Cuando hagamos cambios
        materiales, te notificaremos por email y mostraremos un aviso en
        la plataforma. La fecha al inicio de este documento siempre
        refleja la versión vigente.
      </P>

      <H2>11. Contacto</H2>
      <P>
        ¿Dudas, quejas, solicitudes ARCO? Escríbenos a{' '}
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
function H3({ children }) {
  return (
    <h3 style={{
      fontFamily: 'var(--font-body, sans-serif)',
      fontSize: 16, fontWeight: 700,
      marginTop: 20, marginBottom: 8,
    }}>{children}</h3>
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
