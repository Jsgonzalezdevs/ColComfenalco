type Result<T = any> = { data: T; error: Error | null; count?: number };
type Filter = { column: string; op: 'eq' | 'in' | 'ilike'; value: unknown };
type QuerySpec = { table: string; operation: string; columns: string; filters: Filter[]; order: Array<{ column: string; ascending: boolean }>; offset?: number; limit?: number; count?: string; head?: boolean; payload?: unknown; onConflict?: string; ignoreDuplicates?: boolean };
const tokenKey = 'comfenalco-cloudflare-session';
const endpoint = String(import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const errors = (body: any) => ({ data: body?.data ?? null, error: body?.error ? new Error(body.error) : null, ...(body?.count === undefined ? {} : { count: body.count }) });

class Query<T = any> implements PromiseLike<Result<T>> {
  private spec: QuerySpec;
  private singleMode: 'single' | 'maybe' | '' = '';
  constructor(table: string) { this.spec = { table, operation: 'select', columns: '*', filters: [], order: [] }; }
  select(columns = '*', options: { count?: string; head?: boolean } = {}) { this.spec.columns = columns; this.spec.count = options.count; this.spec.head = options.head; return this; }
  insert(payload: unknown) { this.spec.operation = 'insert'; this.spec.payload = payload; return this; }
  update(payload: unknown) { this.spec.operation = 'update'; this.spec.payload = payload; return this; }
  delete() { this.spec.operation = 'delete'; return this; }
  upsert(payload: unknown, options: { onConflict?: string; ignoreDuplicates?: boolean } = {}) { this.spec.operation = 'upsert'; this.spec.payload = payload; this.spec.onConflict = options.onConflict; this.spec.ignoreDuplicates = options.ignoreDuplicates; return this; }
  eq(column: string, value: unknown) { this.spec.filters.push({ column, op: 'eq', value }); return this; }
  in(column: string, value: unknown[]) { this.spec.filters.push({ column, op: 'in', value }); return this; }
  ilike(column: string, value: string) { this.spec.filters.push({ column, op: 'ilike', value }); return this; }
  order(column: string, options: { ascending?: boolean } = {}) { this.spec.order.push({ column, ascending: options.ascending ?? true }); return this; }
  range(from: number, to: number) { this.spec.offset = from; this.spec.limit = Math.max(0, to - from + 1); return this; }
  limit(value: number) { this.spec.limit = value; return this; }
  single() { this.singleMode = 'single'; return this; }
  maybeSingle() { this.singleMode = 'maybe'; return this; }
  private async execute(): Promise<Result<T>> {
    if (!endpoint) return { data: null as T, error: new Error('No se configuró la API de Cloudflare.') };
    try {
      const response = await fetch(`${endpoint}/api/query`, { method: 'POST', headers: headers(true), body: JSON.stringify(this.spec) });
      const parsed = errors(await response.json());
      if (!response.ok) return parsed;
      if (this.singleMode) {
        const rows = Array.isArray(parsed.data) ? parsed.data : parsed.data ? [parsed.data] : [];
        if (rows.length > 1 || (!rows.length && this.singleMode === 'single')) return { data: null as T, error: new Error(rows.length ? 'Se esperaba un solo registro.' : 'No se encontró el registro.'), count: parsed.count };
        return { data: (rows[0] ?? null) as T, error: null, count: parsed.count };
      }
      return parsed;
    } catch (error) { return { data: null as T, error: error instanceof Error ? error : new Error('No fue posible conectar con la base de datos.') }; }
  }
  then<TResult1 = Result<T>, TResult2 = never>(onfulfilled?: ((value: Result<T>) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> { return this.execute().then(onfulfilled, onrejected); }
}

function headers(json = false) {
  return { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(localStorage.getItem(tokenKey) ? { Authorization: `Bearer ${localStorage.getItem(tokenKey)}` } : {}) };
}
async function call(path: string, init: RequestInit = {}) {
  if (!endpoint) throw new Error('No se configuró la API de Cloudflare.');
  const response = await fetch(`${endpoint}${path}`, { ...init, headers: { ...headers(init.body instanceof Blob || init.body instanceof ArrayBuffer), ...init.headers } });
  const type = response.headers.get('content-type') || '';
  if (!response.ok) { const body = type.includes('json') ? await response.json() : null; throw new Error(body?.error || 'No fue posible completar la operación.'); }
  return type.includes('json') ? response.json() : response;
}
const subscribers = new Set<(event: string, session: Session | null) => void>();
const auth = {
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    try { const result = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }); localStorage.setItem(tokenKey, result.token); const session = result.session as Session; subscribers.forEach(fn => fn('SIGNED_IN', session)); return { data: { user: result.user, session }, error: null }; }
    catch (error) { return { data: { user: null, session: null }, error: error instanceof Error ? error : new Error('No fue posible iniciar sesión.') }; }
  },
  async getSession() {
    try { const token = localStorage.getItem(tokenKey); if (!token) return { data: { session: null }, error: null }; const result = await call('/api/auth/session'); return { data: { session: { ...result.session, access_token: token } as Session }, error: null }; }
    catch (error) { localStorage.removeItem(tokenKey); return { data: { session: null }, error: error instanceof Error ? error : null }; }
  },
  async getUser() { try { const result = await call('/api/auth/session'); return { data: { user: result.user as User }, error: null }; } catch (error) { return { data: { user: null }, error: error instanceof Error ? error : null }; } },
  async updatePassword({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) { try { await call('/api/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }); return { error: null as Error | null }; } catch (error) { return { error: error instanceof Error ? error : new Error('No se pudo cambiar la contraseña.') }; } },
  async signOut() { try { await call('/api/auth/logout', { method: 'POST' }); localStorage.removeItem(tokenKey); subscribers.forEach(fn => fn('SIGNED_OUT', null)); return { error: null as Error | null }; } catch (error) { localStorage.removeItem(tokenKey); subscribers.forEach(fn => fn('SIGNED_OUT', null)); return { error: error instanceof Error ? error : new Error('No fue posible cerrar sesión.') }; } },
  onAuthStateChange(callback: (event: string, session: Session | null) => void) { subscribers.add(callback); return { data: { subscription: { unsubscribe: () => { subscribers.delete(callback); } } } }; },
};

const storage = { from: (bucket: string) => ({
  async upload(path: string, file: File, options: { contentType?: string; upsert?: boolean } = {}) {
    try { await call(`/api/files/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'PUT', headers: { 'Content-Type': options.contentType || file.type || 'application/octet-stream' }, body: file }); return { data: { path }, error: null }; }
    catch (error) { return { data: null, error: error instanceof Error ? error : new Error('No se pudo subir el archivo.') }; }
  },
  async download(path: string) { try { const response = await call(`/api/files/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`); return { data: await response.blob(), error: null }; } catch (error) { return { data: null, error: error instanceof Error ? error : new Error('No se pudo descargar el archivo.') }; } },
  async remove(paths: string[]) { try { await Promise.all(paths.map(path => call(`/api/files/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' }))); return { data: paths, error: null }; } catch (error) { return { data: null, error: error instanceof Error ? error : new Error('No se pudo borrar el archivo.') }; } },
}) };

const client = {
  from: (table: string) => new Query<any>(table),
  rpc: async (name: string, args: unknown) => { try { const data = await call(`/api/rpc/${encodeURIComponent(name)}`, { method: 'POST', body: JSON.stringify(args) }); return { data, error: null }; } catch (error) { return { data: null, error: error instanceof Error ? error : new Error('No se pudo ejecutar la operación.') }; } },
  admin: {
    async createMember(input: { email: string; password: string; role: string }) {
      try { const result = await call('/api/admin/members', { method: 'POST', body: JSON.stringify(input) }); return { data: result.data, error: null as Error | null }; }
      catch (error) { return { data: null, error: error instanceof Error ? error : new Error('No se pudo crear el acceso.') }; }
    },
  },
  auth,
  storage,
};
export const cloudflare = client;

export type User = { id: string; email: string; role: string };
export type Session = { access_token: string; token_type: string; user: User };
