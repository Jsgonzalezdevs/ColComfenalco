import { useEffect, useRef, useState } from 'react';
import { Download, Search, Upload, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { archivePageSize, downloadOriginal, findEntries, importPackage, listDocuments, validateArchive } from './archive';
import type { ArchiveDocument, ArchiveEntry } from './archive';
import { configured } from './repository';

const message=(error:unknown)=>error instanceof Error?error.message:typeof error==='object'&&error&&'message' in error?String(error.message):'No se pudo completar la operación.';
export default function Archive({isAdmin,onPrepare}:{isAdmin:boolean;onPrepare:(entry:ArchiveEntry,document:ArchiveDocument)=>void}) {
 const [documents,setDocuments]=useState<ArchiveDocument[]>([]),[entries,setEntries]=useState<ArchiveEntry[]>([]);
 const [documentId,setDocumentId]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(0),[count,setCount]=useState(0);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0);
 const [progress,setProgress]=useState(''),[selected,setSelected]=useState<ArchiveEntry|null>(null);
 const [kind,setKind]=useState('');
 const input=useRef<HTMLInputElement>(null);
 useEffect(()=>{
  if(!configured||!isAdmin){setLoading(false);return;}
  let active=true;setError('');
  listDocuments().then(rows=>{if(active)setDocuments(rows);}).catch(e=>{if(active)setError(message(e));});
  return()=>{active=false;};
 },[isAdmin,revision]);
 useEffect(()=>{
  if(!configured||!isAdmin)return;
  let active=true;setLoading(true);setError('');
  const timer=setTimeout(()=>void findEntries(documentId,search,page,kind).then(result=>{if(active){setEntries(result.entries);setCount(result.count);}}).catch(e=>{if(active){setEntries([]);setCount(0);setError(message(e));}}).finally(()=>{if(active)setLoading(false);}),250);
  return()=>{active=false;clearTimeout(timer);};
 },[documentId,search,page,kind,isAdmin,revision]);
 if(!configured)return <section className="panel archive-intro"><FileText/><h2>Documentos del colegio</h2><p>Conecta Supabase e ingresa con una cuenta administradora para consultar o importar los archivos originales. La demostración no almacena documentos institucionales.</p></section>;
 if(!isAdmin)return <section className="panel archive-intro"><h2>Acceso de administradores</h2><p>Los documentos originales y sus datos están disponibles únicamente para cuentas con rol administrador.</p></section>;
 async function upload(file:File){
  setBusy(true);setError('');setNotice('');setProgress('Verificando originales…');
  try{
   const value:unknown=JSON.parse(await file.text());validateArchive(value);
   await importPackage(value,(done,total)=>setProgress(`${done} de ${total} archivos cargados`));
   setNotice(`Carga verificada: ${value.documents.length} archivos y ${value.entries.length} fragmentos de información.`);setRevision(r=>r+1);setPage(0);
  }catch(e){setError(message(e));}finally{setBusy(false);setProgress('');if(input.current)input.current.value='';}
 }
 async function original(d:ArchiveDocument){setError('');try{await downloadOriginal(d);}catch(e){setError(message(e));}}
 const chosen=documents.find(d=>d.id===documentId);
 return <>
  <section className="panel archive-intro"><div className="section-title"><div><h2>Archivo institucional</h2><p>Consulta los Excel, actas, inventarios y soportes con su ubicación original.</p></div><button className="primary" disabled={busy} onClick={()=>input.current?.click()}><Upload size={17}/>{busy?'Importando…':'Importar archivos preparados'}</button></div>
   <input ref={input} type="file" accept="application/json,.json" hidden onChange={event=>{const file=event.target.files?.[0];if(file)void upload(file);}}/>
   <p>{documents.length} documentos · {documents.reduce((s,d)=>s+d.entry_count,0).toLocaleString('es-CO')} fragmentos archivados</p>
   <p className="field-help">Las filas de origen se conservan para revisión. No se suman como bienes confirmados: pueden incluir totales, traslados y registros repetidos. Cada original se comprueba mediante SHA-256 al cargarlo y descargarlo.</p>
   {progress&&<p role="status">{progress}</p>}{notice&&<p role="status">{notice}</p>}
  </section>
  {error&&<div className="error-panel" role="alert"><span>{error}</span><button disabled={busy} onClick={()=>setRevision(r=>r+1)}>Reintentar consulta</button></div>}
  <section className="panel archive-content"><div className="filters"><label className="search"><Search size={19}/><input aria-label="Buscar en documentos" value={search} placeholder="Buscar una placa, descripción, persona o texto…" onChange={e=>{setSearch(e.target.value);setPage(0);setSelected(null);}}/></label><select aria-label="Archivo de origen" value={documentId} onChange={e=>{setDocumentId(e.target.value);setPage(0);setSelected(null);}}><option value="">Todos los documentos</option>{documents.map(d=><option key={d.id} value={d.id}>{d.path}</option>)}</select>{chosen&&<button className="secondary" onClick={()=>void original(chosen)}><Download size={16}/>Original</button>}</div>
   <div className="archive-kind"><label>Contenido<select aria-label="Tipo de contenido" value={kind} onChange={event=>{setKind(event.target.value);setPage(0);setSelected(null);}}><option value="">Toda la información</option><option value="asset_candidate">Filas de activos por conciliar</option><option value="ocr_image">Texto de imágenes por verificar</option><option value="paragraph">Texto de documentos</option><option value="pdf_page">Páginas PDF</option></select></label></div>
   {chosen&&<div className="archive-document"><strong>{chosen.path}</strong><span>{chosen.category} · {chosen.format.toUpperCase()} · {chosen.entry_count} fragmentos</span>{chosen.extraction_status!=='complete'&&<p>El archivo original está conservado. Su contenido necesita revisión adicional.</p>}</div>}
   <div className="results-label" aria-live="polite">{loading?'Consultando…':`${count.toLocaleString('es-CO')} resultados · página ${page+1} de ${Math.max(1,Math.ceil(count/archivePageSize))}`}</div>
   {!loading&&<div className="archive-results">{entries.map(entry=>{const doc=documents.find(d=>d.id===entry.document_id);const proposal=entry.payload.asset_proposal as {review_flags:string[]}|undefined;return <article key={entry.id} className="archive-row"><div><strong>{doc?.path||'Documento'}</strong><small>{entry.locator}{entry.kind==='ocr_image'?' · Transcripción de imagen por verificar':''}</small>{proposal&&<div className="archive-flags"><strong>Activo de origen · pendiente de conciliación</strong><ul>{proposal.review_flags.map(flag=><li key={flag}>{flag}</li>)}</ul></div>}<p>{entry.text.length>700?entry.text.slice(0,700)+'…':entry.text}</p></div><div className="archive-row-actions">{proposal&&doc&&<button className="secondary" onClick={()=>onPrepare(entry,doc)}>Preparar activo</button>}<button className="text-button" onClick={()=>setSelected(selected?.id===entry.id?null:entry)}>Ver contenido completo</button>{doc&&<button className="icon-button" aria-label={`Descargar ${doc.path}`} onClick={()=>void original(doc)}><Download size={17}/></button>}</div>{selected?.id===entry.id&&<div className="archive-full"><pre>{entry.text}</pre><details><summary>Datos y coordenadas de origen</summary><pre>{JSON.stringify(entry.payload,null,2)}</pre></details></div>}</article>;})}{!entries.length&&<div className="empty"><FileText/><h3>No hay resultados</h3><p>{documents.length?'Prueba con otra búsqueda.':'Importa el paquete preparado para consultar los documentos.'}</p></div>}</div>}
   <div className="archive-pagination"><button className="secondary" disabled={loading||page===0} onClick={()=>{setPage(p=>p-1);setSelected(null);}}><ChevronLeft size={17}/>Anterior</button><button className="secondary" disabled={loading||(page+1)*archivePageSize>=count} onClick={()=>{setPage(p=>p+1);setSelected(null);}}>Siguiente<ChevronRight size={17}/></button></div>
  </section>
 </>;
}
