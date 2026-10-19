import React,{useEffect,useState} from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLang } from '@app/lib/i18n.js';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { getJson } from '../lib/pointsApi.js';
import { loadTournamentPresentation } from '../lib/tournamentResults.js';

import { TournamentPresentation } from './OnchainTournamentView.jsx';

export default function OnchainTournament() {
  const {lang}=useLang(),{user}=usePointsAuth(),[params,setParams]=useSearchParams();
  const cycleId=params.get('season')||'';
  const [attempt,setAttempt]=useState(0),[state,setState]=useState({loading:true});
  useEffect(()=>{
    let canceled=false;
    let sequence=0;
    async function load(){
      const current=++sequence;
      try {
        const data=await loadTournamentPresentation(getJson,cycleId);
        if (!canceled && current===sequence) setState({loading:false,data});
      } catch {if(!canceled && current===sequence)setState({loading:false,error:true});}
    }
    setState({loading:true});load();
    const timer=window.setInterval(load,60000);
    return ()=>{canceled=true;window.clearInterval(timer);};
  },[cycleId,user?.username,attempt]);
  if(state.loading)return <p role="status" style={{padding:32}}>{lang==='en'?'Loading tournament…':'Cargando torneo…'}</p>;
  if(state.error)return <main role="alert" style={{padding:32}}><p>{lang==='en'?'Tournament results are unavailable.':'No se pudieron cargar los resultados del torneo.'}</p>
    <button onClick={()=>setAttempt(n=>n+1)}>{lang==='en'?'Retry':'Reintentar'}</button></main>;
  return <TournamentPresentation data={state.data} lang={lang} choose={id=>setParams(id===state.data.overview.current.cycleId?{}:{season:id})}/>;
}
