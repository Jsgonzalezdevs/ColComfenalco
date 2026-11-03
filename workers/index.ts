/// <reference types="@cloudflare/workers-types" />

interface Env { DB: D1Database; BOOTSTRAP_TOKEN: string; }
type Role = 'admin' | 'editor' | 'viewer';
type Member = { user_id: string; email: string; role: Role; password_salt: string; password_hash: string };
type Filter = { column: string; op: 'eq' | 'in' | 'ilike'; value: unknown };
type Query = { table: string; operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert'; columns?: string; filters?: Filter[]; order?: Array<{ column: string; ascending: boolean }>; offset?: number; limit?: number; count?: string; head?: boolean; payload?: unknown; onConflict?: string; ignoreDuplicates?: boolean };

const tableColumns: Record<string, string[]> = {
  members: ['user_id','email','role','created_at'],
  locations: ['id','name','block'],
  people: ['id','name','position'],
  assets: ['id','plate','name','category','location_id','person_id','quantity','status','notes','version','last_action','action_note','created_at','updated_at','review_due_date','last_reviewed_at','source_entry_id','source_document_id','source_data'],
  movements: ['id','asset_id','asset_name','action','note','actor','created_at','before','after'],
  archive_documents: ['id','path','sha256','byte_size','format','category','entry_count','extraction_status','imported_at'],
  archive_entries: ['id','document_id','ordinal','locator','kind','payload','text'],
  asset_documents: ['id','asset_id','archive_document_id','storage_path','filename','mime_type','byte_size','preview_text','created_at'],
};
const jsonColumns = new Set(['source_data','before','after','payload']);
const allowedOrigins = new Set(['https://colcomfenalco.vercel.app','http://127.0.0.1:5188','http://localhost:5188']);
const json = (data: unknown, status = 200, origin = '') => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(origin && allowedOrigins.has(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Setup-Token', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Vary': 'Origin' } : {}) } });
const encode = (data: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(data)));
const decode = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const fileChunkSize = 750_000; // Multiple of four; each base64 chunk decodes independently.
function encodeBytes(bytes: Uint8Array) { let binary = ''; for (let i = 0; i < bytes.length; i += 32_768) binary += String.fromCharCode(...bytes.subarray(i, i + 32_768)); return btoa(binary); }
function splitBase64(value: string) { const chunks: string[] = []; for (let i = 0; i < value.length; i += fileChunkSize) chunks.push(value.slice(i, i + fileChunkSize)); return chunks; }
const digest = async (text: string) => encode(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const parseRow = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, jsonColumns.has(key) && typeof value === 'string' ? tryParse(value) : value]));
function tryParse(value: string) { try { return JSON.parse(value); } catch { return value; } }
function sqlValue(column: string, value: unknown) { return jsonColumns.has(column) && value != null && typeof value !== 'string' ? JSON.stringify(value) : value; }
function memberView(member: Member) { return { id: member.user_id, email: member.email, role: member.role }; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Error interno del servicio.'; }
function randomToken() { return `${crypto.randomUUID().replaceAll('-','')}${crypto.randomUUID().replaceAll('-','')}`; }
async function passwordHash(password: string, salt: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: decode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
  return encode(bits);
}
function preflight(request: Request) {
  const origin = request.headers.get('Origin') || '';
  return new Response(null, { status: 204, headers: { ...(allowedOrigins.has(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Setup-Token', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Max-Age': '86400', 'Vary': 'Origin' } : {}) } });
}
async function currentMember(request: Request, env: Env) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  return await env.DB.prepare(`SELECT m.user_id,m.email,m.role,m.password_salt,m.password_hash FROM sessions s JOIN members m ON m.user_id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).bind(await digest(token), now()).first<Member>();
}
function allowed(table: string, operation: Query['operation'], member: Member, query: Query) {
  if (table === 'members') return operation === 'select' && (member.role === 'admin' || query.filters?.some(f => f.column === 'user_id' && f.op === 'eq' && f.value === member.user_id));
  if (table.startsWith('archive_')) return member.role === 'admin';
  if (table === 'asset_documents') return member.role === 'admin';
  if (operation === 'select') return ['assets','people','locations','movements'].includes(table);
  if (operation === 'delete') return table === 'locations' && member.role === 'admin';
  return ['admin','editor'].includes(member.role) && ['assets','people','locations'].includes(table) || table === 'asset_documents' && member.role === 'admin';
}
function compileFilters(table: string, filters: Filter[] = []) {
  const allowedColumns = tableColumns[table];
  const clauses: string[] = [];
  const values: unknown[] = [];
  for (const filter of filters) {
    if (!allowedColumns.includes(filter.column)) throw new Error('Filtro no permitido.');
    const col = `"${filter.column}"`;
    if (filter.op === 'eq' && filter.value === null) clauses.push(`${col} IS NULL`);
    else if (filter.op === 'eq') { clauses.push(`${col} = ?`); values.push(sqlValue(filter.column, filter.value)); }
    else if (filter.op === 'in') {
      const items = Array.isArray(filter.value) ? filter.value : [];
      if (!items.length) clauses.push('0');
      else { clauses.push(`${col} IN (${items.map(() => '?').join(',')})`); values.push(...items.map(item => sqlValue(filter.column, item))); }
    } else if (filter.op === 'ilike') { clauses.push(`${col} LIKE ? ESCAPE '\\' COLLATE NOCASE`); values.push(filter.value); }
  }
  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', values };
}
async function runQuery(request: Request, env: Env, member: Member) {
  const query = await request.json<Query>();
  const { table, operation } = query;
  const columns = tableColumns[table];
  if (!columns) return json({ error: 'Tabla no disponible.' }, 404);
  if (!allowed(table, operation, member, query)) return json({ error: 'Tu cuenta no tiene permiso para esta operación.' }, 403);
  const selected = (query.columns || '*') === '*' ? columns : (query.columns || '*').split(',').map(s => s.trim());
  if (selected.some(col => !columns.includes(col))) return json({ error: 'Columna no disponible.' }, 400);
  const filters = compileFilters(table, query.filters);
  if (operation === 'select') {
    const count = query.count === 'exact' ? await env.DB.prepare(`SELECT COUNT(*) AS n FROM "${table}"${filters.sql}`).bind(...filters.values).first<{n:number}>() : null;
    if (query.head) return json({ data: null, count: count?.n || 0 });
    const ordering = (query.order || []).map(item => { if (!columns.includes(item.column)) throw new Error('Orden no permitido.'); return `"${item.column}" ${item.ascending ? 'ASC' : 'DESC'}`; });
    const limit = Math.min(Math.max(query.limit ?? 5000, 0), 5000);
    const sql = `SELECT ${selected.map(s => `"${s}"`).join(',')} FROM "${table}"${filters.sql}${ordering.length ? ` ORDER BY ${ordering.join(',')}` : ''} LIMIT ? OFFSET ?`;
    const result = await env.DB.prepare(sql).bind(...filters.values, limit, query.offset || 0).all<Record<string, unknown>>();
    return json({ data: (result.results || []).map(parseRow), count: count?.n });
  }
  if (operation === 'delete') {
    if (table === 'locations') {
      const target = await env.DB.prepare(`SELECT id FROM locations${filters.sql}`).bind(...filters.values).all<{id:string}>();
      for (const location of target.results || []) {
        const use = await env.DB.prepare('SELECT 1 AS yes FROM assets WHERE location_id=? LIMIT 1').bind(location.id).first();
        if (use) return json({ error: 'No se puede quitar una ubicación que todavía tiene activos asignados.' }, 409);
      }
    }
    const result = await env.DB.prepare(`DELETE FROM "${table}"${filters.sql} RETURNING ${selected.map(s => `"${s}"`).join(',')}`).bind(...filters.values).all<Record<string,unknown>>();
    return json({ data: (result.results || []).map(parseRow) });
  }
  const rows = Array.isArray(query.payload) ? query.payload : [query.payload];
  if (!rows.length || rows.some(r => !r || typeof r !== 'object' || Array.isArray(r))) return json({ data: [] });
  if (rows.length > 500) return json({ error: 'Envía lotes de 500 registros o menos.' }, 413);
  const writes = [] as D1PreparedStatement[];
  const originals = new Map<string, Record<string,unknown>>();
  const updatedAssets: Array<{ asset: Record<string,unknown>; before: Record<string,unknown> | null }> = [];
  for (const raw of rows as Record<string,unknown>[]) {
    const row = { ...raw };
    for (const key of Object.keys(row)) if (!columns.includes(key)) return json({ error: 'Campo no disponible.' }, 400);
    if (['people','locations','assets','asset_documents'].includes(table)) row.id ||= id();
    if (table === 'assets') {
      row.created_at ||= now(); row.updated_at = now(); row.version = Number(row.version || 1);
      if (!row.last_action) row.last_action = 'Registro';
    }
    if (table === 'asset_documents') row.created_at ||= now();
    if (operation === 'insert' || operation === 'upsert') {
      const keys = Object.keys(row);
      if (!keys.length) continue;
      const values = keys.map(k => sqlValue(k, row[k]));
      const conflict = (query.onConflict || 'id').split(',').map(s => s.trim());
      if (conflict.some(k => !columns.includes(k))) return json({ error: 'Clave de actualización no válida.' }, 400);
      const ignore = operation === 'upsert' && query.ignoreDuplicates;
      const conflictSql = operation === 'upsert' ? (ignore ? ` ON CONFLICT(${conflict.map(k=>`"${k}"`).join(',')}) DO NOTHING` : ` ON CONFLICT(${conflict.map(k=>`"${k}"`).join(',')}) DO UPDATE SET ${keys.filter(k=>!conflict.includes(k)).map(k=>`"${k}"=excluded."${k}"`).join(',') || `"${conflict[0]}"=excluded."${conflict[0]}"`}`) : '';
      writes.push(env.DB.prepare(`INSERT ${operation === 'upsert' && query.ignoreDuplicates ? 'OR IGNORE ' : ''}INTO "${table}" (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})${operation === 'upsert' && !query.ignoreDuplicates ? conflictSql : ''}`).bind(...values));
      if (table === 'assets') updatedAssets.push({ asset: row, before: null });
    } else if (operation === 'update') {
      const targetSql = `SELECT * FROM "${table}"${filters.sql}`;
      const targets = await env.DB.prepare(targetSql).bind(...filters.values).all<Record<string,unknown>>();
      if ((targets.results || []).length > 500) return json({ error: 'La actualización afecta demasiados registros; reduce el lote.' }, 413);
      for (const target of targets.results || []) {
        if (table === 'assets' && row.version !== undefined && Number(target.version) + 1 !== Number(row.version)) continue;
        const next = { ...target, ...row };
        if (table === 'assets') {
          next.updated_at = now();
          next.last_action = target.location_id !== next.location_id || target.person_id !== next.person_id ? 'Traslado' : (row.last_action || 'Edición');
          updatedAssets.push({ asset: next, before: target });
        }
        const keys = Object.keys(row).filter(k => k !== 'id' && k !== 'created_at');
        if (table === 'assets' && !keys.includes('last_action')) keys.push('last_action');
        if (table === 'assets' && !keys.includes('updated_at')) keys.push('updated_at');
        if (table === 'assets' && !keys.includes('version')) { next.version = Number(target.version || 0) + 1; keys.push('version'); }
        const sets = keys.map(k => `"${k}"=?`).join(',');
        writes.push(env.DB.prepare(`UPDATE "${table}" SET ${sets} WHERE id=? AND ${table === 'assets' ? 'version=?' : 'id=?'}`).bind(...keys.map(k=>sqlValue(k,next[k])), target.id, ...(table === 'assets' ? [target.version] : [])));
      }
    }
  }
  try {
    for (let i=0;i<writes.length;i+=100) await env.DB.batch(writes.slice(i,i+100));
    if (table === 'assets' && updatedAssets.length) {
      const logs = updatedAssets.map(({asset,before}) => env.DB.prepare('INSERT INTO movements(id,asset_id,asset_name,action,note,actor,created_at,before,after) VALUES(?,?,?,?,?,?,?,?,?)').bind(id(), asset.id, asset.name, asset.last_action, asset.action_note || '', member.user_id, now(), before ? JSON.stringify(parseRow(before)) : null, JSON.stringify(parseRow(asset))));
      for (let i=0;i<logs.length;i+=100) await env.DB.batch(logs.slice(i,i+100));
    }
    let data: unknown[] = [];
    if (query.operation !== 'update' && query.operation !== 'delete') {
      const ids = (rows as Record<string,unknown>[]).map(row => row.id).filter(Boolean);
      if (ids.length) { const placeholders = ids.map(()=>'?').join(','); const saved = await env.DB.prepare(`SELECT ${selected.map(s=>`"${s}"`).join(',')} FROM "${table}" WHERE id IN (${placeholders})`).bind(...ids).all<Record<string,unknown>>(); data = (saved.results || []).map(parseRow); }
    } else if (table === 'assets') {
      const targets = await env.DB.prepare(`SELECT ${selected.map(s=>`"${s}"`).join(',')} FROM assets${filters.sql}`).bind(...filters.values).all<Record<string,unknown>>(); data = (targets.results || []).map(parseRow);
    }
    return json({ data });
  } catch (error) { return json({ error: errorMessage(error) }, 400); }
}

async function handle(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('Origin') || '';
  if (request.method === 'OPTIONS') return preflight(request);
  const url = new URL(request.url);
  const path = url.pathname;
  try {
    if (path === '/health') return json({ ok: true, service: 'inventario-api' }, 200, origin);
    if (path === '/api/auth/setup' && request.method === 'POST') {
      if (!env.BOOTSTRAP_TOKEN || request.headers.get('X-Setup-Token') !== env.BOOTSTRAP_TOKEN) return json({ error: 'No autorizado para configurar la cuenta inicial.' }, 401, origin);
      const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM members').first<{n:number}>();
      if (count?.n) return json({ error: 'La cuenta administradora inicial ya fue creada.' }, 409, origin);
      const body = await request.json<{email:string;password:string}>();
      const email = String(body.email || '').trim().toLowerCase(), password = String(body.password || '');
      if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 12) return json({ error: 'Escribe un correo válido y una contraseña de al menos 12 caracteres.' }, 400, origin);
      const userId = id(), salt = encode(crypto.getRandomValues(new Uint8Array(16)).buffer as ArrayBuffer), hash = await passwordHash(password,salt);
      await env.DB.prepare('INSERT INTO members(user_id,email,role,password_salt,password_hash,created_at) VALUES(?,?,?,?,?,?)').bind(userId,email,'admin',salt,hash,now()).run();
      return json({ ok:true }, 201, origin);
    }
    if (path === '/api/auth/login' && request.method === 'POST') {
      const body = await request.json<{email:string;password:string}>();
      const user = await env.DB.prepare('SELECT * FROM members WHERE email=? COLLATE NOCASE').bind(String(body.email || '').trim()).first<Member>();
      if (!user || await passwordHash(String(body.password || ''), user.password_salt) !== user.password_hash) return json({ error: 'Correo o contraseña incorrectos.' }, 401, origin);
      const token = randomToken(), expires = new Date(Date.now()+30*86400000).toISOString();
      await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await digest(token),user.user_id,expires).run();
      const view = memberView(user);
      return json({ token,user:view,session:{user:view,expires_at:expires,token_type:'bearer'} },200,origin);
    }
    if (path === '/api/auth/session' && request.method === 'GET') {
      const user = await currentMember(request,env); if (!user) return json({ error:'La sesión terminó. Ingresa de nuevo.' },401,origin);
      return json({ user:memberView(user),session:{user:memberView(user),token_type:'bearer'} },200,origin);
    }
    if (path === '/api/auth/password' && request.method === 'POST') {
      const member = await currentMember(request,env); if (!member) return json({error:'Inicia sesión para cambiar tu contraseña.'},401,origin);
      const body = await request.json<{currentPassword:string;newPassword:string}>();
      if (await passwordHash(String(body.currentPassword || ''),member.password_salt) !== member.password_hash) return json({error:'La contraseña actual no coincide.'},401,origin);
      const password = String(body.newPassword || '');
      if (password.length < 12) return json({error:'La nueva contraseña debe tener al menos 12 caracteres.'},400,origin);
      const salt = encode(crypto.getRandomValues(new Uint8Array(16)).buffer as ArrayBuffer), hash = await passwordHash(password,salt);
      const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i,'') || '';
      await env.DB.prepare('UPDATE members SET password_salt=?,password_hash=? WHERE user_id=?').bind(salt,hash,member.user_id).run();
      await env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').bind(member.user_id,await digest(token)).run();
      return json({ok:true},200,origin);
    }
    if (path === '/api/auth/logout' && request.method === 'POST') {
      const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i,'');
      if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(token)).run();
      return json({ ok:true },200,origin);
    }
    if (path === '/api/admin/members' && ['GET','POST'].includes(request.method)) {
      const admin = await currentMember(request,env);
      if (admin?.role !== 'admin') return json({error:'Solo un administrador puede gestionar los accesos.'},403,origin);
      if (request.method === 'GET') {
        const members = await env.DB.prepare('SELECT user_id,email,role,created_at FROM members ORDER BY email COLLATE NOCASE').all();
        return json({data:members.results || []},200,origin);
      }
      const body = await request.json<{email:string;password:string;role:Role}>();
      const email = String(body.email || '').trim().toLowerCase(), password = String(body.password || ''), role = body.role;
      if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 12 || !['admin','editor','viewer'].includes(role)) return json({error:'Revisa el correo, el perfil y la contraseña de al menos 12 caracteres.'},400,origin);
      const salt = encode(crypto.getRandomValues(new Uint8Array(16)).buffer as ArrayBuffer), hash = await passwordHash(password,salt);
      const userId = id();
      await env.DB.prepare('INSERT INTO members(user_id,email,role,password_salt,password_hash,created_at) VALUES(?,?,?,?,?,?)').bind(userId,email,role,salt,hash,now()).run();
      return json({data:{user_id:userId,email,role}},201,origin);
    }
    if (path === '/api/query' && request.method === 'POST') {
      const member = await currentMember(request,env); if (!member) return json({ error:'Inicia sesión para continuar.' },401,origin);
      const result = await runQuery(request,env,member); return addOrigin(result,origin);
    }
    if (path === '/api/rpc/import_archive_document' && request.method === 'POST') {
      const member = await currentMember(request,env); if (member?.role !== 'admin') return json({ error:'Solo un administrador puede importar archivos.' },403,origin);
      const body = await request.json<any>(); const doc = body.document; const entries = body.entries;
      if (!doc || !Array.isArray(entries) || entries.length !== doc.entry_count || typeof doc.original_base64 !== 'string') return json({ error:'El archivo o sus registros no están completos.' },400,origin);
      const bytes = decode(doc.original_base64);
      const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
      if (bytes.length !== doc.byte_size || sha !== doc.sha256) return json({ error:'El original no coincide con su verificación.' },400,origin);
      const existing = await env.DB.prepare('SELECT sha256,entry_count FROM archive_documents WHERE id=?').bind(doc.id).first<{sha256:string;entry_count:number}>();
      if (existing && (existing.sha256 !== doc.sha256 || existing.entry_count !== doc.entry_count)) return json({ error:'El archivo ya tiene otra versión guardada.' },409,origin);
      try {
        if (!existing) {
          await env.DB.prepare('INSERT INTO archive_documents(id,path,sha256,byte_size,format,category,entry_count,extraction_status,imported_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(doc.id,doc.path,doc.sha256,doc.byte_size,doc.format,doc.category,doc.entry_count,doc.extraction_status,now()).run();
          for (let i=0;i<entries.length;i+=100) {
            const rows = entries.slice(i,i+100).map((e:any)=>env.DB.prepare('INSERT OR IGNORE INTO archive_entries(id,document_id,ordinal,locator,kind,payload,text) VALUES(?,?,?,?,?,?,?)').bind(e.id,e.document_id,e.ordinal,e.locator,e.kind,JSON.stringify(e.payload),e.text));
            await env.DB.batch(rows);
          }
        }
        const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM archive_entries WHERE document_id=?').bind(doc.id).first<{n:number}>();
        if (count?.n !== doc.entry_count) throw new Error('No se guardaron todas las filas del documento.');
        const fileKey = `archive/${doc.id}`;
        await env.DB.prepare('DELETE FROM file_chunks WHERE file_key=?').bind(fileKey).run();
        const chunks = splitBase64(doc.original_base64).map((chunk,part)=>env.DB.prepare('INSERT INTO file_chunks(file_key,part,content_base64) VALUES(?,?,?)').bind(fileKey,part,chunk));
        for (let i=0;i<chunks.length;i+=100) await env.DB.batch(chunks.slice(i,i+100));
        return json(doc.id,200,origin);
      } catch (error) { if (!existing) { await env.DB.prepare('DELETE FROM file_chunks WHERE file_key=?').bind(`archive/${doc.id}`).run(); await env.DB.prepare('DELETE FROM archive_documents WHERE id=?').bind(doc.id).run(); } return json({error:errorMessage(error)},400,origin); }
    }
    if (path.startsWith('/api/files/') && ['GET','PUT','DELETE'].includes(request.method)) {
      const member = await currentMember(request,env); if (member?.role !== 'admin') return json({error:'Solo los administradores pueden consultar actas.'},403,origin);
      const bits = path.slice('/api/files/'.length).split('/').map(decodeURIComponent); const bucket = bits.shift(); const object = bits.join('/');
      const key = bucket === 'archive-originals' ? `archive/${object}` : bucket === 'asset-actas' ? `actas/${object}` : '';
      if (!key || key.endsWith('/') || key.includes('..')) return json({error:'Ruta de archivo inválida.'},400,origin);
      if (request.method === 'PUT') {
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (bytes.byteLength>20*1024*1024) return json({error:'El archivo supera el límite de 20 MB.'},413,origin);
        await env.DB.prepare('DELETE FROM file_chunks WHERE file_key=?').bind(key).run();
        const base64 = encodeBytes(bytes), chunks = splitBase64(base64).map((chunk,part)=>env.DB.prepare('INSERT INTO file_chunks(file_key,part,content_base64) VALUES(?,?,?)').bind(key,part,chunk));
        for (let i=0;i<chunks.length;i+=100) await env.DB.batch(chunks.slice(i,i+100));
        return json({data:{path:object}},201,origin);
      }
      if (request.method === 'DELETE') { await env.DB.prepare('DELETE FROM file_chunks WHERE file_key=?').bind(key).run(); return json({ok:true},200,origin); }
      const chunks = await env.DB.prepare('SELECT content_base64 FROM file_chunks WHERE file_key=? ORDER BY part').bind(key).all<{content_base64:string}>();
      if (!chunks.results?.length) return json({error:'No se encontró el archivo.'},404,origin);
      const bytes = decode(chunks.results.map(row=>row.content_base64).join(''));
      return new Response(bytes,{headers:{'Content-Type':'application/octet-stream','Cache-Control':'private, no-store',...(origin&&allowedOrigins.has(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, PUT, DELETE, OPTIONS','Vary':'Origin'}:{})}});
    }
    return json({error:'Ruta no encontrada.'},404,origin);
  } catch (error) { return json({error:errorMessage(error)},400,origin); }
}
function addOrigin(response: Response, origin: string) {
  const headers = new Headers(response.headers);
  if (origin && allowedOrigins.has(origin)) { headers.set('Access-Control-Allow-Origin',origin); headers.set('Access-Control-Allow-Headers','Authorization, Content-Type, X-Setup-Token'); headers.set('Access-Control-Allow-Methods','GET, POST, PUT, DELETE, OPTIONS'); headers.set('Vary','Origin'); }
  return new Response(response.body,{status:response.status,headers});
}
export default { fetch: handle } satisfies ExportedHandler<Env>;
