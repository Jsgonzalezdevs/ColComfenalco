import type { Data, Asset, Person, Location } from './domain';
import { createDemo } from './demo';
import { normalize, saveLocal } from './domain';
import { cloudflare } from './cloudflareClient';
const env = import.meta.env;
export const configured = Boolean(env.VITE_API_URL);
export const supabase = configured ? cloudflare : null;
const KEY = 'comfenalco-demo-v1';
export function readDemo(): Data {
 const raw = localStorage.getItem(KEY);
 if (!raw) return createDemo();
 try { const d = JSON.parse(raw); if (!Array.isArray(d.assets) || !Array.isArray(d.people) || !Array.isArray(d.locations) || !Array.isArray(d.movements)) throw Error(); return d; }
 catch { throw new Error('No se pudieron leer los datos locales. Descarga o conserva el almacenamiento del navegador antes de restablecerlo.'); }
}
function persist(data: Data) { localStorage.setItem(KEY, JSON.stringify(data)); return data; }
export async function loadData(): Promise<Data> {
 if (!supabase) return readDemo();
 async function readTable(table:string) {
  const rows: unknown[] = [];
  for (let offset=0;;) {
   const result = await supabase!.from(table).select('*').order(table==='assets'||table==='movements'?'created_at':'name', {ascending: !(table==='assets'||table==='movements')}).order('id').range(offset,offset+999);
   if (result.error) throw result.error;
   const batch=result.data || []; rows.push(...batch);
   if (!batch.length) break;
   offset+=batch.length;
  }
  return rows;
 }
 const results = await Promise.all(['assets','people','locations','movements'].map(readTable));
 return {assets:results[0],people:results[1],locations:results[2],movements:results[3]} as Data;
}
export async function saveAsset(data: Data, asset: Asset) {
 if (!supabase) return persist(saveLocal(readDemoPersisted(data), asset));
 const exists = data.assets.some(a => a.id === asset.id);
 const { id, version, created_at, updated_at, ...payload } = asset;
 const query = exists ? supabase.from('assets').update({...payload,version:version+1}).eq('id',id).eq('version',version).select('id') : supabase.from('assets').insert({...payload,id,version:1}).select('id');
 const result = await query;
 if (result.error) throw result.error;
 if (!result.data?.length) throw new Error('El registro cambió o no tienes permisos. Actualiza antes de continuar.');
 return loadData();
}
function readDemoPersisted(fallback:Data) { return localStorage.getItem(KEY) ? readDemo() : fallback; }
export async function saveCatalog(data:Data, kind:'people'|'locations', item:Person|Location, editId?:string) {
 const duplicate = (rows:Array<Person|Location>) => rows.some(row => row.id !== editId && normalize(row.name) === normalize(item.name));
 if (!supabase) {
  const fresh=readDemoPersisted(data);
  if(editId&&!fresh[kind].some(row=>row.id===editId)) throw new Error('Este registro ya no existe. Actualiza la página e inténtalo de nuevo.');
  if(duplicate(fresh[kind])) throw new Error(kind==='locations'?'Ya existe una ubicación con ese nombre.':'Ya existe una persona con ese nombre.');
  const next=fresh[kind].map(row=>editId&&row.id===editId?item:row);
  return persist({...fresh,[kind]:editId?next:[...fresh[kind],item]});
 }
 const existing=await supabase.from(kind).select('id,name');
 if(existing.error) throw existing.error;
 if(editId&&!(existing.data||[]).some((row:{id:string})=>row.id===editId)) throw new Error('Este registro ya no existe. Actualiza la página e inténtalo de nuevo.');
 if(duplicate((existing.data||[]) as Array<Person|Location>)) throw new Error(kind==='locations'?'Ya existe una ubicación con ese nombre.':'Ya existe una persona con ese nombre.');
 if(editId){const {id:_id,...fields}=item;const result=await supabase.from(kind).update(fields).eq('id',editId).select('id');if(result.error)throw result.error;if(!result.data?.length)throw new Error('No se pudo actualizar el registro. Actualiza la página e inténtalo de nuevo.');}
 else {const result=kind==='people'?await supabase.from('people').insert(item as Person):await supabase.from('locations').insert(item as Location);if(result.error)throw result.error;}
 return loadData();
}
