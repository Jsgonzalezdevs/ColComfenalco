import { createClient } from '@supabase/supabase-js';
import type { Data, Asset, Person, Location } from './domain';
import { createDemo } from './demo';
import { saveLocal } from './domain';
const env = import.meta.env;
export const configured = Boolean(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY);
export const supabase = configured ? createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY) : null;
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
export async function saveCatalog(data:Data, kind:'people'|'locations', item:Person|Location) {
 if (!supabase) { const fresh=readDemoPersisted(data); if(fresh[kind].some(x=>x.name.trim().toLowerCase()===item.name.trim().toLowerCase())) throw new Error('Este nombre ya existe.'); return persist({...fresh,[kind]:[...fresh[kind],item]}); }
 const result = kind==='people' ? await supabase.from('people').insert(item as Person) : await supabase.from('locations').insert(item as Location); if(result.error) throw result.error; return loadData();
}
