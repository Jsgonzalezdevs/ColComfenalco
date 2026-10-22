import {useEffect,useState} from 'react';
import {supabase} from './repository';
import {listDocuments} from './archive';

export default function ImportSummary({open}:{open:()=>void}){
 const [summary,setSummary]=useState<{documents:number;rows:number}|null>(null);
 useEffect(()=>{let active=true;if(!supabase)return;
  Promise.all([listDocuments(),supabase.from('archive_entries').select('id',{count:'exact',head:true}).eq('kind','asset_candidate')]).then(([docs,result])=>{if(active&&!result.error)setSummary({documents:docs.length,rows:result.count||0});}).catch(()=>{});
  return()=>{active=false;};
 },[]);
 if(!summary?.documents)return null;
 return <section className="panel archive-intro"><div className="section-title"><div><h2>Información importada del colegio</h2><p>{summary.documents} documentos originales · {summary.rows.toLocaleString('es-CO')} filas de activos por conciliar</p></div><button className="primary" onClick={open}>Consultar documentos</button></div><p className="field-help">Toda la información de origen está en la base de datos. Los contadores del inventario incluyen únicamente los activos registrados después de revisar las repeticiones y completar los datos.</p></section>;
}
