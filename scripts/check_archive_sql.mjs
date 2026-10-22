// Local PostgreSQL verification using PGlite installed in a temporary directory.
// Usage: node check_archive_sql.mjs /path/to/pglite/dist/index.js /path/to/import.json
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
await db.exec(`
 create role anon; create role authenticated;
 create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated;
 insert into auth.users values ('00000000-0000-4000-a000-000000000001'),('00000000-0000-4000-a000-000000000002'),('00000000-0000-4000-a000-000000000003');
`);
await db.exec(await readFile(new URL('../supabase/setup.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../supabase/archive.sql',import.meta.url),'utf8'));
await db.exec(`insert into public.members values ('00000000-0000-4000-a000-000000000001','admin'),('00000000-0000-4000-a000-000000000002','viewer');`);
const pack=JSON.parse(await readFile(process.argv[3],'utf8'));
const upload=async(d,entries)=>db.query('select public.import_archive_document($1::jsonb,$2::jsonb)',[JSON.stringify(d),JSON.stringify(entries)]);
await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000001',false);`);
for(const doc of pack.documents)await upload(doc,pack.entries.filter(e=>e.document_id===doc.id));
const d=pack.documents.find(d=>d.entry_count>0), rows=pack.entries.filter(e=>e.document_id===d.id);
await upload(d,rows); // Safe retry, no duplicate originals or rows.
await assert.rejects(upload({...d,original_base64:'YWJj'},rows));
await assert.rejects(upload(d,rows.slice(1)));
await assert.rejects(upload(d,rows.map((e,i)=>i===0?{...e,text:e.text+'tampered'}:e)));
const original=await db.query('select original_base64 from public.archive_originals where document_id=$1',[d.id]);
assert.equal(original.rows[0].original_base64,d.original_base64);
const counts=await db.query('select (select count(*) from public.archive_documents)::int as documents,(select count(*) from public.archive_entries)::int as entries,(select count(*) from public.archive_originals)::int as originals');
assert.equal(counts.rows[0].documents,pack.documents.length);assert.equal(counts.rows[0].entries,pack.entries.length);assert.equal(counts.rows[0].originals,pack.documents.length);
for(const user of ['00000000-0000-4000-a000-000000000002','00000000-0000-4000-a000-000000000003']){
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
 for(const table of ['archive_documents','archive_originals','archive_entries'])assert.equal((await db.query(`select count(*)::int as n from public.${table}`)).rows[0].n,0);
 await assert.rejects(upload(d,rows));
}
await db.exec('reset role; set role anon;');
await assert.rejects(db.query('select * from public.archive_documents'));
await assert.rejects(upload(d,rows));
console.log('PASS: full import, exact counts, safe retry, tamper rejection, originals, admin access, viewer/nonmember/anon denied.',counts.rows[0]);
await db.close();
