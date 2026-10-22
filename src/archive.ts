import { supabase } from './repository';

export type ArchiveDocument = { id:string; path:string; sha256:string; byte_size:number; format:string; category:string; entry_count:number; extraction_status:'complete'|'original_only'|'error' };
export type ArchiveEntry = { id:string; document_id:string; ordinal:number; locator:string; kind:string; payload:Record<string,unknown>; text:string };
export type ArchivePackage = { format:'colegio-source-archive'; version:1; documents:(ArchiveDocument & {original_base64:string})[]; entries:ArchiveEntry[] };
export const archivePageSize=50;

export function validateArchive(value:unknown): asserts value is ArchivePackage {
 if(!value||typeof value!=='object')throw new Error('Paquete de importación inválido.');
 const p=value as ArchivePackage;
 if(p.format!=='colegio-source-archive'||p.version!==1||!Array.isArray(p.documents)||!p.documents.length||!Array.isArray(p.entries))throw new Error('Formato de importación no reconocido.');
 const ids=new Set<string>(), rows=new Set<string>(), ordinals=new Set<string>();
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 for(const d of p.documents){
  if(!d||!uuid.test(d.id)||ids.has(d.id)||typeof d.path!=='string'||!d.path||typeof d.original_base64!=='string'||!/^[0-9a-f]{64}$/.test(d.sha256)||!Number.isSafeInteger(d.entry_count)||d.entry_count<0||!Number.isSafeInteger(d.byte_size)||d.byte_size<0||typeof d.category!=='string'||typeof d.format!=='string'||!['complete','original_only','error'].includes(d.extraction_status))throw new Error('Metadatos incompletos o archivos repetidos.');
  ids.add(d.id);
 }
 const counts=new Map<string,number>();
 for(const e of p.entries){
  const order=e?.document_id+':'+e?.ordinal;
  if(!e||!uuid.test(e.id)||rows.has(e.id)||ordinals.has(order)||!ids.has(e.document_id)||!Number.isSafeInteger(e.ordinal)||e.ordinal<0||typeof e.text!=='string'||typeof e.locator!=='string'||typeof e.kind!=='string'||!e.payload||typeof e.payload!=='object'||Array.isArray(e.payload))throw new Error('El paquete contiene filas inválidas.');
  rows.add(e.id);ordinals.add(order);counts.set(e.document_id,(counts.get(e.document_id)||0)+1);
 }
 for(const d of p.documents)if((counts.get(d.id)||0)!==d.entry_count)throw new Error('Faltan filas del archivo '+d.path);
}
export function originalBytes(base64:string){return Uint8Array.from(atob(base64),c=>c.charCodeAt(0));}
export async function verifyOriginal(d:ArchiveDocument,base64:string){
 const bytes=originalBytes(base64);
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 const sha=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
 if(bytes.length!==d.byte_size||sha!==d.sha256)throw new Error('El original no coincide: '+d.path);
 return bytes;
}
export async function listDocuments(){
 if(!supabase)throw new Error('Conecta la base de datos del colegio para consultar documentos.');
 const result=await supabase.from('archive_documents').select('id,path,sha256,byte_size,format,category,entry_count,extraction_status').order('path');
 if(result.error)throw result.error;return result.data as ArchiveDocument[];
}
export async function findEntries(documentId:string,search:string,page:number,kind=''){
 if(!supabase)throw new Error('No hay conexión.');
 let query=supabase.from('archive_entries').select('*',{count:'exact'});
 if(documentId)query=query.eq('document_id',documentId);
 if(kind)query=query.eq('kind',kind);
 if(search.trim())query=query.ilike('text','%'+search.trim().replace(/[\\%_]/g,'\\$&')+'%');
 const result=await query.order('document_id').order('ordinal').range(page*archivePageSize,(page+1)*archivePageSize-1);
 if(result.error)throw result.error;return {entries:result.data as ArchiveEntry[],count:result.count||0};
}
export async function importPackage(p:ArchivePackage,onProgress:(completed:number,total:number)=>void){
 if(!supabase)throw new Error('La importación requiere Supabase y una cuenta administradora.');
 validateArchive(p);
 // Check every original before starting writes. Retries are safe after interruptions.
 for(const d of p.documents)await verifyOriginal(d,d.original_base64);
 const groups=new Map<string,ArchiveEntry[]>();
 for(const e of p.entries){const group=groups.get(e.document_id)||[];group.push(e);groups.set(e.document_id,group);}
 let completed=0;
 for(const document of p.documents){
  const result=await supabase.rpc('import_archive_document',{document,entries:groups.get(document.id)||[]});
  if(result.error)throw new Error(`${completed}/${p.documents.length} archivos cargados. Falló ${document.path}: ${result.error.message}. Puedes reintentar el mismo paquete.`);
  onProgress(++completed,p.documents.length);
 }
 const stored=await listDocuments();
 for(const d of p.documents)if(!stored.some(s=>s.id===d.id&&s.sha256===d.sha256&&s.entry_count===d.entry_count))throw new Error('La verificación final no coincide con el paquete.');
}
export async function downloadOriginal(document:ArchiveDocument){
 const blob=await getOriginalBlob(document);
 const url=URL.createObjectURL(blob);
 const a=window.document.createElement('a');a.href=url;a.download=document.path.split('/').pop()!;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function getOriginalBlob(document:ArchiveDocument){
 if(!supabase)throw new Error('No hay conexión.');
 const result=await supabase.from('archive_originals').select('original_base64').eq('document_id',document.id).single();
 if(result.error)throw result.error;
 const bytes=await verifyOriginal(document,result.data.original_base64);
 const mime:Record<string,string>={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',xls:'application/vnd.ms-excel'};
 return new Blob([bytes],{type:mime[document.format.toLowerCase()]||'application/octet-stream'});
}
