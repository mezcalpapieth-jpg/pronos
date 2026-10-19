import React from 'react';
import { Link } from 'react-router-dom';

const card={padding:20,border:'1px solid var(--border)',borderRadius:12,background:'var(--surface1)',marginBottom:18};
const number=n=>Number(n||0).toLocaleString('es-MX',{maximumFractionDigits:2});
const date=(value,lang)=>new Date(value).toLocaleString(lang==='en'?'en-US':'es-MX',{timeZone:'America/Mexico_City',dateStyle:'medium',timeStyle:'short'});
const statusCopy={scheduled:['Programado','Scheduled'],active:['En curso','In progress'],
  awaiting_close:['Cerrado · resultados en revisión','Closed · results under review'],closed:['Resultados finales','Final results']};
const eligibilityCopy={pending_review:['Elegibilidad pendiente de revisión','Eligibility awaiting review'],
  eligible:['Elegible para consideración de premio','Eligible for reward consideration'],
  on_hold:['Elegibilidad en revisión','Eligibility under review'],ineligible:['No elegible para premios','Ineligible for rewards'],
  not_qualified:['No se cumplió el requisito de mercados','Market qualification requirement not met']};

function Standings({result,lang}) {
  const en=lang==='en',me=result.me,provisional=result.status==='provisional';
  const title=provisional?(en?'Provisional standings':'Clasificación provisional'):(en?'Final standings':'Clasificación final');
  return <>
    <section style={card} aria-label={title}>
      <h2>{title}</h2>
      {provisional?<>
        <p>{en?'Scores can change before the closing review.':'Los puntajes pueden cambiar antes de la revisión de cierre.'}</p>
        <p>{en?'Updated through':'Actualizado hasta'}: {date(result.asOf,lang)} ({en?'Mexico City':'Ciudad de México'})</p>
        {result.freshness==='stale'&&<p role="status">{en?'Update delayed. These scores reflect the time shown above.':'Actualización demorada. Estos puntajes corresponden a la hora indicada.'}</p>}
      </>:<p>{en?'Frozen at tournament close. Later trades, transfers and claims do not change these scores.':'Clasificación fijada al cierre. Operaciones, transferencias y cobros posteriores no cambian estos puntajes.'}</p>}
      <p>{en?'Participants':'Participantes'}: {number(result.totalParticipants)} · {en?'Rewards pending approval':'Premios pendientes de aprobación'}</p>
      {result.top.length===0?<p>{en?'No participants.':'Sin participantes.'}</p>:<div style={{overflowX:'auto'}}>
        <table style={{width:'100%',textAlign:'left',borderCollapse:'collapse'}}>
          <caption style={{textAlign:'left',paddingBottom:10}}>{en?'Top 20':'Primeros 20'}</caption>
          <thead><tr>{['#',en?'Player':'Jugador',en?'Score':'Puntaje',en?'Markets':'Mercados',en?'Qualification':'Clasificación'].map(h=><th key={h} scope="col" style={{padding:8}}>{h}</th>)}</tr></thead>
          <tbody>{result.top.map(row=><tr key={row.username} style={{background:me?.username===row.username?'var(--surface2)':undefined}}>
            <td style={{padding:8}}>{row.rank}</td><td style={{padding:8}}><Link to={`/u/${encodeURIComponent(row.username)}`}>@{row.username}</Link></td>
            <td style={{padding:8,whiteSpace:'nowrap'}}>{number(row.score)}</td><td style={{padding:8}}>{row.qualifyingMarkets}</td>
            <td style={{padding:8}}>{row.qualified?(en?'Qualified':'Califica'):(en?'Not qualified':'No califica')}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    </section>
    <section style={card}>
      <h2>{provisional?(en?'Your provisional score':'Tu puntaje provisional'):(en?'Your final score':'Tu puntaje final')}</h2>
      {me?<>
        <p>#{me.rank} · @{me.username} · <strong>{number(me.score)}</strong></p>
        {!provisional&&result.rewardEligibility&&<div role="status">
          <p>{eligibilityCopy[result.rewardEligibility.status]?.[en?1:0]}</p>
          {result.rewardEligibility.eligibilityRank&&<p>{en?'Eligible placement':'Posición entre elegibles'}: #{result.rewardEligibility.eligibilityRank}</p>}
          <p>{en?'Eligibility is reviewed separately from payment approval. No prize or payment is confirmed.':'La elegibilidad se revisa por separado de la aprobación del pago. No confirma un premio ni un pago.'}</p>
        </div>}
        <dl style={{display:'grid',gridTemplateColumns:'1fr auto',gap:10}}>
          {[[en?'Market PnL':'PnL de mercados',me.marketPnl],[en?'Conviction bonus':'Bono por convicción',me.convictionBonus],
            [en?'Inactivity penalty':'Penalización por inactividad',-me.inactivityPenalty],
            [en?'Qualifying markets':'Mercados para calificar',me.qualifyingMarkets]].map(([label,value])=><React.Fragment key={label}><dt>{label}</dt><dd style={{margin:0}}>{number(value)}</dd></React.Fragment>)}
        </dl>
      </>:<p>{en?'Sign in with a participating account to see your personal result.':'Inicia sesión con una cuenta participante para ver tu resultado personal.'}</p>}
    </section>
  </>;
}

// Export the view for fixture rendering; real loading stays in the route wrapper.
export function TournamentPresentation({data,lang='es',choose}) {
  const en=lang==='en',{overview,result,selected}=data,current=overview.current;
  const rules=result?.rules||current.rules;
  const title=result?.label||current.label,cutoff=result?.cutoffAt||current.cutoffAt;
  const archives=overview.history.seasons.filter(s=>s.cycleId!==current.cycleId);
  const visible=selected===current.cycleId;
  return <main style={{maxWidth:1000,margin:'32px auto',padding:'0 20px'}}>
    <h1>{title}</h1>
    <p>{result?.status==='closed'?(en?'Final results':'Resultados finales'):statusCopy[current.status]?.[en?1:0]}</p>
    <label>{en?'Season':'Temporada'} <select value={selected} onChange={event=>choose(event.target.value)} style={{maxWidth:'100%'}}>
      <option value={current.cycleId}>{current.label}</option>
      {archives.map(s=><option key={s.cycleId} value={s.cycleId}>{s.label}</option>)}
      {!visible&&!archives.some(s=>s.cycleId===selected)&&<option value={selected}>{title}</option>}
    </select></label>
    <p>{en?'Closes':'Cierre'}: {date(cutoff,lang)} ({en?'Mexico City':'Ciudad de México'})</p>
    {result&&result.status!=='pending'?<Standings result={result} lang={lang}/>:<section style={card}>
      <h2>{en?'Tournament status':'Estado del torneo'}</h2>
      <p>{current.status==='scheduled'?(en?`Starts ${date(current.startsAt,lang)} (Mexico City).`:`Inicia el ${date(current.startsAt,lang)} (Ciudad de México).`)
        :current.status==='active'?(en?'The tournament is in progress. Final scores will appear here after the closing review.':'El torneo está en curso. Los puntajes finales aparecerán aquí después de la revisión de cierre.')
        :(en?'Trading has closed. Results are awaiting review before publication.':'Las operaciones han cerrado. Los resultados están pendientes de revisión antes de publicarse.')}</p>
      {current.status==='active'&&<Link to="/">{en?'View markets':'Ver mercados'}</Link>}
      {result?.status==='pending'&&<p>{en?'Provisional standings are awaiting their first reviewed update.':'La clasificación provisional está pendiente de su primera actualización revisada.'}</p>}
    </section>}
    <section style={card}>
      <h2>{en?'Scoring':'Puntaje'}</h2>
      <p>{en?'Market PnL + conviction bonus − inactivity penalty.':'PnL de mercados + bono por convicción − penalización por inactividad.'}</p>
      <p>{en?`Enter at least ${rules.minEntryMxnp} MXNP per qualifying buy across ${rules.qualifyingMarkets} distinct market groups. Each inactive day costs ${rules.inactivityPenalty} points.`
        :`Compra al menos ${rules.minEntryMxnp} MXNP por entrada para calificar en ${rules.qualifyingMarkets} grupos de mercados distintos. Cada día inactivo resta ${rules.inactivityPenalty} puntos.`}</p>
      <p>{en?'Incoming gifts do not increase your score. Later trades count only their eligible share.':'Los regalos recibidos no aumentan tu puntaje. Las operaciones posteriores cuentan solo por su parte elegible.'}</p>
      <p>{en?'Qualification does not confirm a prize. Rewards require a separate approval.':'Calificar no confirma un premio. Los premios requieren una aprobación adicional.'}</p>
    </section>
    {overview.history.hasMore&&<p>{en?'Showing the 20 most recent archived seasons.':'Se muestran las 20 temporadas archivadas más recientes.'}</p>}
  </main>;
}
