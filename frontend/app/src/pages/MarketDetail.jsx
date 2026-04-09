import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import Nav from '../components/Nav.jsx';
import BetModal from '../components/BetModal.jsx';
import { gmFetchBySlug } from '../lib/gamma.js';
import { fetchResolutions } from '../lib/resolutions.js';
import Sparkline from '../components/Sparkline.jsx';
import MARKETS from '../lib/markets.js';
import { generateMockData } from '../lib/mockTabData.js';

/* ── Ring chart ─────────────────────────────────────────────── */
function ProbabilityChart({ options, resolved, winner }) {
  if (!options?.length) return null;
  const top=options[0], pct=resolved?(top.label===winner?100:0):top.pct;
  const radius=54, circ=2*Math.PI*radius, dash=(pct/100)*circ;
  const color='var(--yes)';
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:16,padding:'24px 0'}}>
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--surface3)" strokeWidth="12"/>
        <circle cx="70" cy="70" r={radius} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`} transform="rotate(-90 70 70)"
          style={{filter:`drop-shadow(0 0 8px ${color})`}}/>
        {resolved?(<>
          <text x="70" y="63" textAnchor="middle" fill="var(--yes)" fontSize="26" fontFamily="var(--font-display)">✓</text>
          <text x="70" y="82" textAnchor="middle" fill="var(--text-muted)" fontSize="8" fontFamily="var(--font-mono)" letterSpacing="0.1em">GANADOR</text>
        </>):(<>
          <text x="70" y="66" textAnchor="middle" fill="var(--text-primary)" fontSize="22" fontFamily="var(--font-display)">{pct}%</text>
          <text x="70" y="84" textAnchor="middle" fill="var(--text-muted)" fontSize="9" fontFamily="var(--font-mono)" letterSpacing="0.1em">{top.label}</text>
        </>)}
      </svg>
      <div style={{display:'flex',gap:12,flexWrap:'wrap',justifyContent:'center'}}>
        {options.map((opt,i)=>(
          <div key={i} style={{display:'flex',alignItems:'center',gap:6,fontFamily:'var(--font-mono)',fontSize:12,
            color:resolved&&opt.label===winner?'var(--yes)':'var(--text-secondary)'}}>
            <span style={{width:8,height:8,borderRadius:'50%',display:'inline-block',background:i===0?'var(--yes)':'var(--red)'}}/>
            {opt.label} · {opt.pct}%
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Two-row tab system (Polymarket style) ───────────────────── */
function TabsSection({mock,opt0,opt1,comments}){
  const [topTab,setTopTab]   = useState('Reglas');
  const [botTab,setBotTab]   = useState('Actividad');

  const tabBtn = (label,active,onClick,count) => (
    <button onClick={onClick} style={{
      fontFamily:'var(--font-mono)',fontSize:12,letterSpacing:'0.04em',
      padding:'10px 16px',background:'none',border:'none',cursor:'pointer',whiteSpace:'nowrap',
      color:active?'var(--text-primary)':'var(--text-muted)',fontWeight:active?600:400,
      borderBottom:active?'2px solid var(--text-primary)':'2px solid transparent',
      transition:'color 0.15s',
    }}>
      {label}{count!=null?<span style={{fontFamily:'var(--font-mono)',fontSize:10,marginLeft:4,color:'var(--text-muted)'}}>({count.toLocaleString()})</span>:null}
    </button>
  );

  return(
    <div>
      {/* Row 1: Rules | Market Context */}
      <div style={{display:'flex',borderBottom:'1px solid var(--border)',marginBottom:24}}>
        {tabBtn('Reglas',    topTab==='Reglas',       ()=>setTopTab('Reglas'))}
        {tabBtn('Contexto de mercado', topTab==='Contexto', ()=>setTopTab('Contexto'))}
      </div>
      {topTab==='Reglas'   && <RulesTab   data={mock.rules}/>}
      {topTab==='Contexto' && <ContextTab data={mock.context}/>}

      {/* Row 2: Comments | Top Holders | Positions | Activity */}
      <div style={{display:'flex',borderBottom:'1px solid var(--border)',margin:'40px 0 24px',overflowX:'auto'}}>
        {tabBtn('Comentarios', botTab==='Comentarios', ()=>setBotTab('Comentarios'), comments.length*437)}
        {tabBtn('Top Holders', botTab==='Top Holders', ()=>setBotTab('Top Holders'))}
        {tabBtn('Posiciones',  botTab==='Posiciones',  ()=>setBotTab('Posiciones'))}
        {tabBtn('Actividad',   botTab==='Actividad',   ()=>setBotTab('Actividad'))}
      </div>
      {botTab==='Comentarios' && <CommentsTab comments={comments}/>}
      {botTab==='Top Holders' && <HoldersTab  yes={mock.yesHolders} no={mock.noHolders} opt0={opt0} opt1={opt1}/>}
      {botTab==='Posiciones'  && <PositionsTab yes={mock.yesPositions} no={mock.noPositions} opt0={opt0} opt1={opt1}/>}
      {botTab==='Actividad'   && <ActivityTab  activity={mock.activity} opt0={opt0} opt1={opt1}/>}
    </div>
  );
}

/* ── Rules ───────────────────────────────────────────────────── */
function RulesTab({data}){
  return(
    <div style={{fontSize:14,color:'var(--text-secondary)',lineHeight:1.8}}>
      <p style={{marginBottom:20}}>{data.resolution}</p>
      <div style={{border:'1px solid var(--border)',borderRadius:10,overflow:'hidden',marginBottom:20}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',background:'var(--surface2)',borderBottom:'1px solid var(--border)'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,fontSize:13,fontWeight:500}}>
            <span style={{fontSize:16}}>ℹ️</span> Contexto adicional
          </div>
          <span style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--text-muted)'}}>Actualizado hoy</span>
        </div>
        {data.additional.map((rule,i)=>(
          <div key={i} style={{padding:'12px 16px',borderBottom:i<data.additional.length-1?'1px solid var(--border)':'none',fontSize:13,color:'var(--text-secondary)',lineHeight:1.6}}>{rule}</div>
        ))}
      </div>
      <p style={{fontSize:13,color:'var(--text-secondary)',marginBottom:8}}>{data.resolution}</p>
      {data.additional.map((r,i)=><p key={i} style={{fontSize:13,color:'var(--text-secondary)',marginBottom:8}}>{r}</p>)}
      {data.closes&&<p style={{fontSize:12,color:'var(--text-muted)',marginTop:16}}>Mercado abierto: 1 Ene 2026, 12:00 AM · Cierra: {data.closes}</p>}
    </div>
  );
}

/* ── Context ─────────────────────────────────────────────────── */
function ContextTab({data}){
  const now = new Date().toLocaleDateString('es-MX',{day:'numeric',month:'short',year:'numeric'});
  return(
    <div>
      <p style={{fontSize:14,color:'var(--text-secondary)',lineHeight:1.85,marginBottom:16}}>{data}</p>
      <p style={{fontSize:12,color:'var(--text-muted)'}}>
        Resumen experimental generado con IA referenciando datos de Pronos · Actualizado {now}
      </p>
    </div>
  );
}

/* ── Comments ────────────────────────────────────────────────── */
function CommentsTab({comments}){
  const [liked,setLiked]=useState({});
  return(
    <div>
      <div style={{display:'flex',gap:8,marginBottom:20,alignItems:'center'}}>
        <div style={{flex:1,background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:8,
          padding:'10px 14px',fontFamily:'var(--font-mono)',fontSize:12,color:'var(--text-muted)'}}>
          Agrega un comentario...
        </div>
        <button className="btn-primary" style={{padding:'10px 18px',fontSize:12}} disabled>Publicar</button>
      </div>
      <div style={{display:'flex',gap:8,marginBottom:20}}>
        {['Recientes','Top Holders','Holders'].map(f=>(
          <button key={f} style={{padding:'6px 12px',background:'var(--surface2)',border:'1px solid var(--border)',
            borderRadius:6,color:'var(--text-muted)',cursor:'pointer',fontFamily:'var(--font-mono)',fontSize:11}}>{f}</button>
        ))}
        <div style={{marginLeft:'auto',fontFamily:'var(--font-mono)',fontSize:10,color:'var(--text-muted)',display:'flex',alignItems:'center'}}>⚠️ Cuidado con links externos</div>
      </div>
      {comments.map(c=>(
        <div key={c.id} style={{padding:'16px 0',borderBottom:'1px solid var(--border)'}}>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
            <div style={{width:32,height:32,borderRadius:'50%',background:`hsl(${c.id*47%360},60%,45%)`,
              display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,color:'#fff',fontWeight:700,flexShrink:0}}>
              {c.user[0]}
            </div>
            <div>
              <span style={{fontWeight:600,fontSize:13,marginRight:8}}>{c.user}</span>
              <span style={{fontFamily:'var(--font-mono)',fontSize:10,padding:'2px 7px',borderRadius:4,marginRight:8,
                background:c.side==='yes'?'rgba(22,163,74,0.12)':'rgba(220,38,38,0.12)',
                color:c.side==='yes'?'var(--yes)':'var(--no)',
                border:`1px solid ${c.side==='yes'?'rgba(22,163,74,0.25)':'rgba(220,38,38,0.25)'}`}}>
                {c.holding.toLocaleString()} {c.side==='yes'?'Sí':'No'}
              </span>
              <span style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--text-muted)'}}>{c.time} atrás</span>
            </div>
          </div>
          <p style={{fontSize:13,color:'var(--text-secondary)',lineHeight:1.6,marginLeft:42,marginBottom:8}}>{c.text}</p>
          <div style={{display:'flex',gap:16,marginLeft:42}}>
            <button onClick={()=>setLiked(p=>({...p,[c.id]:!p[c.id]}))} style={{background:'none',border:'none',cursor:'pointer',
              display:'flex',alignItems:'center',gap:4,fontFamily:'var(--font-mono)',fontSize:11,
              color:liked[c.id]?'var(--green)':'var(--text-muted)'}}>
              ♥ {c.likes+(liked[c.id]?1:0)}
            </button>
            <button style={{background:'none',border:'none',cursor:'pointer',fontFamily:'var(--font-mono)',fontSize:11,color:'var(--text-muted)'}}>
              ↩ {c.replies} Respuestas
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Top Holders ─────────────────────────────────────────────── */
function HoldersTab({yes,no,opt0,opt1}){
  return(
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:24}}>
      {[{label:opt0,data:yes,color:'var(--yes)'},{label:opt1,data:no,color:'var(--no)'}].map(col=>(
        <div key={col.label}>
          <div style={{fontFamily:'var(--font-mono)',fontSize:11,letterSpacing:'0.08em',color:col.color,marginBottom:12,display:'flex',justifyContent:'space-between'}}>
            <span>Holders {col.label}</span><span>ACCIONES</span>
          </div>
          {col.data.map((h,i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
              <div style={{width:28,height:28,borderRadius:'50%',flexShrink:0,background:`hsl(${(i*61+17)%360},55%,45%)`,
                display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,color:'#fff',fontWeight:700}}>
                {h.user[0]}
              </div>
              <span style={{flex:1,fontSize:13,fontWeight:500}}>{h.user}</span>
              <span style={{fontFamily:'var(--font-mono)',fontSize:12,color:col.color}}>{h.shares.toLocaleString()}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ── Positions ───────────────────────────────────────────────── */
function PositionsTab({yes,no,opt0,opt1}){
  return(
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:24}}>
      {[{label:opt0,data:yes,color:'var(--yes)'},{label:opt1,data:no,color:'var(--no)'}].map(col=>(
        <div key={col.label}>
          <div style={{display:'flex',justifyContent:'space-between',fontFamily:'var(--font-mono)',fontSize:11,letterSpacing:'0.08em',color:'var(--text-muted)',marginBottom:12}}>
            <span style={{color:col.color}}>{col.label}</span><span>PNL</span>
          </div>
          {col.data.map((p,i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
              <div style={{width:28,height:28,borderRadius:'50%',flexShrink:0,background:`hsl(${(i*79+43)%360},55%,40%)`,
                display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,color:'#fff',fontWeight:700}}>
                {p.user[0]}
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:500}}>{p.user}</div>
                <div style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--text-muted)'}}>avg {p.avg}</div>
              </div>
              <span style={{fontFamily:'var(--font-mono)',fontSize:12,color:col.color}}>
                +${p.pnl.toLocaleString('es-MX',{maximumFractionDigits:2})}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ── Activity ────────────────────────────────────────────────── */
function ActivityTab({activity, opt0, opt1}){
  const [filter,setFilter]=useState('Todos');
  const filtered = filter==='Todos' ? activity : activity.filter(a=> filter==='Sí' ? a.isYes : !a.isYes);
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const fakeDate = (id) => { const d=new Date(2026,2+Math.floor(id/7),1+(id*13)%28); return `${months[d.getMonth()]} ${d.getDate()}`; };
  const mxnVal = (amt,price) => Math.round(amt*parseFloat(price)).toLocaleString('es-MX');

  return(
    <div>
      {/* Filters row */}
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16}}>
        {['Todos','Sí','No'].map(f=>(
          <button key={f} onClick={()=>setFilter(f)} style={{
            padding:'6px 14px',borderRadius:20,fontFamily:'var(--font-mono)',fontSize:11,cursor:'pointer',
            border:'1px solid var(--border)',transition:'all 0.15s',
            background: filter===f ? 'var(--surface3)' : 'var(--surface2)',
            color: filter===f ? 'var(--text-primary)' : 'var(--text-muted)',
          }}>
            {f} {f!=='Todos'&&<span style={{color:f==='Sí'?'var(--yes)':'var(--no)'}}>▾</span>}
          </button>
        ))}
        <button style={{padding:'6px 14px',borderRadius:20,fontFamily:'var(--font-mono)',fontSize:11,cursor:'pointer',
          border:'1px solid var(--border)',background:'var(--surface2)',color:'var(--text-muted)'}}>
          Monto mín ▾
        </button>
        <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:6,fontFamily:'var(--font-mono)',fontSize:11}}>
          <span style={{width:7,height:7,borderRadius:'50%',background:'#ef4444',display:'inline-block',boxShadow:'0 0 6px #ef4444'}}/>
          <span style={{color:'var(--text-secondary)'}}>En vivo</span>
        </div>
      </div>

      {/* Activity rows */}
      {filtered.map(a=>{
        const priceMXN = (parseFloat(a.price)*18.5).toFixed(1);
        const totalMXN = mxnVal(a.amount, a.price);
        return(
          <div key={a.id} style={{display:'flex',alignItems:'center',gap:10,padding:'12px 0',borderBottom:'1px solid var(--border)'}}>
            {/* Avatar */}
            <div style={{width:32,height:32,borderRadius:'50%',flexShrink:0,
              background:`hsl(${(a.id*97+29)%360},55%,45%)`,
              display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,color:'#fff',fontWeight:700}}>
              {a.user[0]}
            </div>
            {/* Text */}
            <div style={{flex:1,fontSize:13,lineHeight:1.5}}>
              <span style={{fontWeight:600}}>{a.user.length>12?a.user.slice(0,10)+'...':a.user}</span>
              {' '}
              <span style={{color:a.action==='Compró'?'var(--yes)':'var(--no)'}}>{a.action}</span>
              {' '}
              <span style={{fontWeight:600,color:a.isYes?'var(--yes)':'var(--no)'}}>{a.amount} {a.isYes?opt0:opt1}</span>
              {' para '}
              <span style={{fontWeight:600}}>{fakeDate(a.id)}</span>
              {' a '}
              <span style={{color:'var(--text-secondary)'}}>${priceMXN}¢</span>
              {' '}
              <span style={{color:'var(--text-muted)',fontSize:12}}>(${totalMXN} MXN)</span>
            </div>
            {/* Time + link */}
            <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
              <span style={{fontFamily:'var(--font-mono)',fontSize:11,color:'var(--text-muted)'}}>{a.time} atrás</span>
              <span style={{color:'var(--text-muted)',fontSize:14,cursor:'pointer'}}>↗</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Main ────────────────────────────────────────────────────── */
export default function MarketDetail() {
  const [searchParams]=useSearchParams(), navigate=useNavigate();
  const marketId=searchParams.get('id');
  const [market,setMarket]=useState(null);
  const [loading,setLoading]=useState(true);
  const [betModal,setBetModal]=useState({open:false,outcome:'',pct:0,clobTokenId:null,isNegRisk:false});
  const [isMobile,setIsMobile]=useState(()=>window.innerWidth<768);
  useEffect(()=>{const h=()=>setIsMobile(window.innerWidth<768);window.addEventListener('resize',h);return()=>window.removeEventListener('resize',h);},[]);

  useEffect(()=>{
    if(!marketId){navigate('/');return;}
    let cancelled=false;
    async function load(){
      setLoading(true);
      try{
        const [live, resolutions] = await Promise.all([
          gmFetchBySlug(marketId).catch(()=>null),
          fetchResolutions().catch(()=>[]),
        ]);
        if(cancelled) return;
        let m = live || MARKETS.find(m=>m.id===marketId) || null;
        // Apply resolution data if exists
        if(m){
          const r = resolutions.find(r=>r.market_id===m.id);
          if(r){
            m = {...m, _resolved:true, _winner:r.winner, _winnerShort:r.winner_short||r.winner,
              _resolvedDate:new Date(r.resolved_at).toLocaleDateString('es-MX',{day:'numeric',month:'short',year:'numeric'}),
              _resolvedBy:r.resolved_by, _description:r.description};
          }
        }
        setMarket(m);
      }
      catch(_){if(!cancelled)setMarket(MARKETS.find(m=>m.id===marketId)||null);}
      finally{if(!cancelled)setLoading(false);}
    }
    load();
    return()=>{cancelled=true;};
  },[marketId,navigate]);

  const openBet=(outcome,pct,idx)=>setBetModal({open:true,outcome,pct,clobTokenId:market?._clobTokenIds?.[idx??0]??null,isNegRisk:market?._isNegRisk??false});

  if(loading)return(<><Nav/><div style={{textAlign:'center',padding:'100px 48px',fontFamily:'var(--font-mono)',fontSize:12,color:'var(--text-muted)',letterSpacing:'0.1em'}}>CARGANDO MERCADO…</div></>);
  if(!market)return(<><Nav/><div style={{textAlign:'center',padding:'100px 48px'}}><h2 style={{fontFamily:'var(--font-display)',fontSize:32,color:'var(--text-primary)',marginBottom:16}}>Mercado no encontrado</h2><button className="btn-ghost" onClick={()=>navigate('/')}>← Volver</button></div></>);

  const resolved=!!market._resolved;
  const mock=generateMockData(market);
  const opt0=market.options?.[0]?.label??'Sí';
  const opt1=market.options?.[1]?.label??'No';

  return(
    <>
      <Nav/>
      <main style={{maxWidth:1100,margin:'0 auto',padding:isMobile?'24px 16px':'40px 48px'}}>
        <button onClick={()=>navigate('/')} style={{fontFamily:'var(--font-mono)',fontSize:11,color:'var(--text-muted)',letterSpacing:'0.06em',background:'none',border:'none',cursor:'pointer',marginBottom:28,display:'flex',alignItems:'center',gap:6}}>
          ← MERCADOS
        </button>

        {resolved&&(
          <div style={{background:'rgba(22,163,74,0.08)',border:'1px solid rgba(22,163,74,0.25)',borderRadius:14,padding:'18px 24px',marginBottom:32,display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:12}}>
            <div style={{display:'flex',alignItems:'center',gap:14}}>
              <span style={{fontSize:28}}>{market.icon}</span>
              <div>
                <div style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--text-muted)',letterSpacing:'0.12em',marginBottom:4}}>MERCADO CERRADO · {market._resolvedDate}</div>
                <div style={{fontFamily:'var(--font-display)',fontSize:22,color:'var(--yes)',letterSpacing:'0.04em'}}>🏆 {market._winnerShort} — Ganador</div>
                <div style={{fontFamily:'var(--font-mono)',fontSize:11,color:'var(--text-secondary)',marginTop:3}}>{market._resolvedBy}</div>
              </div>
            </div>
            <span style={{fontFamily:'var(--font-mono)',fontSize:10,letterSpacing:'0.1em',padding:'6px 14px',borderRadius:6,background:'rgba(22,163,74,0.12)',border:'1px solid rgba(22,163,74,0.3)',color:'var(--yes)'}}>RESUELTO</span>
          </div>
        )}

        <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 360px',gap:isMobile?24:48,alignItems:'start'}}>
          <div>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16}}>
              <span style={{fontSize:18}}>{market.icon}</span>
              <span style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--text-muted)',letterSpacing:'0.1em'}}>{market.categoryLabel}</span>
              {resolved?(
                <span style={{fontFamily:'var(--font-mono)',fontSize:9,letterSpacing:'0.1em',padding:'3px 8px',borderRadius:4,background:'rgba(184,144,10,0.1)',border:'1px solid rgba(184,144,10,0.25)',color:'var(--gold)'}}>CERRADO</span>
              ):(
                <>{market._source==='polymarket'&&<span className="mock-card-badge live">LIVE</span>}{market.trending&&<span className="mock-card-badge trending">🔥 TRENDING</span>}</>
              )}
            </div>

            <h1 style={{fontFamily:'var(--font-display)',fontSize:'clamp(28px,3.5vw,44px)',letterSpacing:'0.03em',color:'var(--text-primary)',marginBottom:24,lineHeight:1.15}}>{market.title}</h1>

            {resolved&&market._description&&(
              <p style={{fontSize:14,color:'var(--text-secondary)',lineHeight:1.7,marginBottom:28,borderLeft:'3px solid var(--yes)',paddingLeft:16}}>{market._description}</p>
            )}

            <div style={{display:'flex',flexWrap:'wrap',gap:0,borderTop:'1px solid var(--border)',borderBottom:'1px solid var(--border)',marginBottom:36}}>
              <div style={{padding:'12px 16px 12px 0',marginRight:16,borderRight:'1px solid var(--border)'}}>
                <div style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--text-muted)',letterSpacing:'0.1em',marginBottom:4}}>VOLUMEN</div>
                <div style={{fontFamily:'var(--font-mono)',fontSize:isMobile?13:16,color:'var(--text-primary)'}}>${market.volume}</div>
              </div>
              <div style={{padding:'12px 16px 12px 0',marginRight:16,borderRight:'1px solid var(--border)'}}>
                <div style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--text-muted)',letterSpacing:'0.1em',marginBottom:4}}>{resolved?'CERRÓ':'CIERRA'}</div>
                <div style={{fontFamily:'var(--font-mono)',fontSize:isMobile?13:16,color:'var(--text-primary)'}}>{market.deadline}</div>
              </div>
              <div style={{padding:'12px 0'}}>
                <div style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--text-muted)',letterSpacing:'0.1em',marginBottom:4}}>ESTADO</div>
                <div style={{fontFamily:'var(--font-mono)',fontSize:13,color:resolved?'var(--gold)':'var(--green)'}}>{resolved?'CERRADO':'ACTIVO'}</div>
              </div>
            </div>

            {/* Price history chart — one line per option */}
            <div style={{background:'var(--surface1)',border:'1px solid var(--border)',borderRadius:16,marginBottom:24}}>
              <div style={{padding:'16px 20px',borderBottom:'1px solid var(--border)',fontFamily:'var(--font-mono)',fontSize:10,letterSpacing:'0.1em',color:'var(--text-muted)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span>{resolved?'HISTORIAL DE PRECIO':'PRECIO EN TIEMPO REAL'}</span>
                <div style={{display:'flex',gap:12}}>
                  {(market.options||[]).map((opt,i)=>{
                    const colors=['var(--yes)','var(--red)','var(--gold)','#8b5cf6'];
                    return(<span key={i} style={{display:'flex',alignItems:'center',gap:4}}>
                      <span style={{width:8,height:3,borderRadius:2,background:colors[i]||'var(--text-muted)',display:'inline-block'}}/>
                      <span style={{color:colors[i]||'var(--text-muted)',fontSize:10}}>{opt.label} {opt.pct}%</span>
                    </span>);
                  })}
                </div>
              </div>
              <div style={{padding:'20px 20px 16px',display:'flex',flexDirection:'column',gap:4}}>
                {(market.options||[]).map((opt,i)=>{
                  const colors=['var(--yes)','var(--red)','var(--gold)','#8b5cf6'];
                  return(
                    <div key={i} style={{display:'flex',alignItems:'center',gap:10}}>
                      <span style={{fontFamily:'var(--font-mono)',fontSize:10,color:colors[i]||'var(--text-muted)',width:50,textAlign:'right',flexShrink:0}}>
                        {opt.label.length>10?opt.label.slice(0,9)+'…':opt.label}
                      </span>
                      <Sparkline
                        width={isMobile?240:510}
                        height={market.options.length>2?50:70}
                        color={colors[i]||'var(--text-muted)'}
                        strokeWidth={2}
                        fill={i===0}
                        targetPct={opt.pct}
                        seed={`${market.id}-${opt.label}`}
                        style={{width:'100%'}}
                      />
                      <span style={{fontFamily:'var(--font-mono)',fontSize:12,color:colors[i]||'var(--text-muted)',fontWeight:600,flexShrink:0}}>
                        {opt.pct}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{background:'var(--surface1)',border:'1px solid var(--border)',borderRadius:16,marginBottom:24}}>
              <div style={{padding:'16px 20px',borderBottom:'1px solid var(--border)',fontFamily:'var(--font-mono)',fontSize:10,letterSpacing:'0.1em',color:'var(--text-muted)'}}>
                {resolved?'PROBABILIDADES FINALES':'PROBABILIDAD ACTUAL'}
              </div>
              <ProbabilityChart options={market.options} resolved={resolved} winner={market._winner}/>
            </div>

            <div style={{marginBottom:40}}>
              <div style={{fontFamily:'var(--font-mono)',fontSize:10,letterSpacing:'0.1em',color:'var(--text-muted)',marginBottom:12}}>{resolved?'RESULTADOS FINALES':'RESULTADOS'}</div>
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {(market.options||[]).map((opt,i)=>{
                  const isWinner=resolved&&opt.label===market._winner;
                  const isLoser=resolved&&opt.label!==market._winner;
                  return(
                    <div key={i} style={{background:isWinner?'rgba(22,163,74,0.06)':i===0?'rgba(0,201,107,0.05)':'rgba(255,59,59,0.04)',border:`1px solid ${isWinner?'rgba(22,163,74,0.3)':i===0?'rgba(0,201,107,0.25)':'rgba(255,59,59,0.2)'}`,borderRadius:12,padding:'16px 20px',display:'flex',alignItems:'center',gap:16,opacity:isLoser?0.45:1,cursor:resolved?'default':'pointer',transition:'border-color 0.2s'}}
                      onClick={()=>!resolved&&openBet(opt.label,opt.pct,i)}
                      onMouseOver={e=>!resolved&&(e.currentTarget.style.borderColor=i===0?'rgba(0,201,107,0.6)':'rgba(255,59,59,0.5)')}
                      onMouseOut={e=>!resolved&&(e.currentTarget.style.borderColor=isWinner?'rgba(22,163,74,0.3)':i===0?'rgba(0,201,107,0.25)':'rgba(255,59,59,0.2)')}>
                      <div style={{flex:1}}>
                        <div style={{display:'flex',justifyContent:'space-between',marginBottom:8,alignItems:'center'}}>
                          <div style={{display:'flex',alignItems:'center',gap:8}}>
                            {isWinner&&<span style={{fontSize:16}}>🏆</span>}
                            <span style={{fontWeight:600,fontSize:15,color:isWinner?'var(--yes)':i===0?'var(--yes)':'var(--red)'}}>{opt.label}</span>
                          </div>
                          <span style={{fontFamily:'var(--font-mono)',fontSize:15,fontWeight:500,color:isWinner?'var(--yes)':i===0?'var(--yes)':'var(--red)'}}>{opt.pct}%</span>
                        </div>
                        <div style={{height:4,background:'var(--surface3)',borderRadius:2,overflow:'hidden'}}>
                          <div style={{height:'100%',width:`${opt.pct}%`,background:isWinner?'var(--yes)':i===0?'var(--yes)':'var(--red)',borderRadius:2}}/>
                        </div>
                      </div>
                      {!resolved&&(
                        <button className={i===0?'btn-yes':'btn-danger'} style={{padding:'8px 16px',fontSize:12,flexShrink:0,whiteSpace:'nowrap'}}
                          onClick={e=>{e.stopPropagation();openBet(opt.label,opt.pct,i);}}>
                          Comprar
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <TabsSection mock={mock} opt0={opt0} opt1={opt1} comments={mock.comments}/>
          </div>

          <div style={{position:isMobile?'static':'sticky',top:88}}>
            {resolved?(
              <div style={{background:'var(--surface1)',border:'1px solid rgba(22,163,74,0.3)',borderRadius:16,padding:24}}>
                <div style={{fontFamily:'var(--font-display)',fontSize:20,letterSpacing:'0.04em',color:'var(--yes)',marginBottom:8}}>MERCADO RESUELTO</div>
                <div style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--text-muted)',letterSpacing:'0.08em',marginBottom:20}}>{market._resolvedDate} · {market._resolvedBy}</div>
                <div style={{background:'var(--surface2)',borderRadius:10,padding:16,marginBottom:20}}>
                  <div style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--text-muted)',letterSpacing:'0.1em',marginBottom:10}}>GANADOR OFICIAL</div>
                  <div style={{fontFamily:'var(--font-display)',fontSize:24,color:'var(--yes)',letterSpacing:'0.04em',marginBottom:4}}>🏆 {market._winnerShort}</div>
                  <div style={{fontFamily:'var(--font-mono)',fontSize:11,color:'var(--text-secondary)'}}>{market._resolvedBy}</div>
                </div>
                <div style={{borderTop:'1px solid var(--border)',paddingTop:16}}>
                  {(market.options||[]).map((opt,i)=>(
                    <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid var(--border)',fontFamily:'var(--font-mono)',fontSize:12}}>
                      <span style={{color:opt.label===market._winner?'var(--yes)':'var(--text-muted)'}}>{opt.label===market._winner?'✓':'✗'} {opt.label}</span>
                      <span style={{color:'var(--text-secondary)'}}>{opt.pct}% pre-cierre</span>
                    </div>
                  ))}
                </div>
                <button disabled style={{width:'100%',marginTop:20,padding:'12px 0',background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:8,fontFamily:'var(--font-mono)',fontSize:11,color:'var(--text-muted)',letterSpacing:'0.08em',cursor:'not-allowed'}}>GANANCIAS YA LIQUIDADAS</button>
                <p style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--text-muted)',textAlign:'center',marginTop:10}}>Liquidado on-chain · MXNB</p>
              </div>
            ):(
              <div style={{background:'var(--surface1)',border:'1px solid var(--border-active)',borderRadius:16,padding:24}}>
                <div style={{fontFamily:'var(--font-display)',fontSize:20,letterSpacing:'0.04em',color:'var(--text-primary)',marginBottom:20}}>COMPRAR</div>
                <p style={{fontSize:13,color:'var(--text-muted)',marginBottom:20}}>Elige un resultado para comprar tu posición.</p>
                <div style={{borderTop:'1px solid var(--border)',paddingTop:20}}>
                  {(market.options||[]).map((opt,i)=>(
                    <button key={i} className={i===0?'btn-yes':'btn-danger'} style={{width:'100%',marginBottom:10}} onClick={()=>openBet(opt.label,opt.pct,i)}>
                      {opt.label} · {opt.pct}%
                    </button>
                  ))}
                </div>
                <p style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--text-muted)',textAlign:'center',marginTop:8}}>On-chain · MXNB</p>
              </div>
            )}
          </div>
        </div>
      </main>

      <BetModal open={betModal.open} onClose={()=>setBetModal(b=>({...b,open:false}))}
        outcome={betModal.outcome} outcomePct={betModal.pct} marketId={market.id}
        marketTitle={market.title} clobTokenId={betModal.clobTokenId} isNegRisk={betModal.isNegRisk} market={market}/>
    </>
  );
}
