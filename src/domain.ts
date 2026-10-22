export const statuses = ['Bueno', 'Regular', 'Deteriorado', 'No encontrado', 'Pendiente de baja'] as const;
export type Status = typeof statuses[number];
export type Person = { id: string; name: string; position: string };
export type Location = { id: string; name: string; block: string };
export type Asset = { id: string; plate: string | null; name: string; category: string; location_id: string; person_id: string | null; quantity: number; status: Status; notes: string; version: number; last_action: string; action_note: string; created_at: string; updated_at: string };
export type Movement = { id: string; asset_id: string; asset_name: string; action: string; note: string; created_at: string; actor: string; before: Asset | null; after: Asset };
export type Data = { assets: Asset[]; people: Person[]; locations: Location[]; movements: Movement[] };
export const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export function validateAsset(asset: Asset, assets: Asset[]) {
 if (!asset.name.trim()) throw new Error('Escribe la descripción del activo.');
 if (!Number.isSafeInteger(asset.quantity) || asset.quantity < 1) throw new Error('La cantidad debe ser un entero mayor que cero.');
 if (!asset.location_id) throw new Error('Selecciona una ubicación.');
 if (!statuses.includes(asset.status)) throw new Error('Selecciona un estado válido.');
 if (asset.plate && asset.quantity !== 1) throw new Error('Un activo con placa debe tener cantidad 1. Registra los bienes sin placa por cantidades.');
 if (asset.plate && assets.some(a => a.id !== asset.id && normalize(a.plate || '') === normalize(asset.plate!))) throw new Error('Esta placa ya está registrada.');
}
export function saveLocal(data: Data, asset: Asset): Data {
 validateAsset(asset, data.assets);
 const old = data.assets.find(a => a.id === asset.id);
 if (old && old.version !== asset.version) throw new Error('El activo cambió. Actualiza los datos e inténtalo de nuevo.');
 if (!data.locations.some(l => l.id === asset.location_id)) throw new Error('La ubicación no existe.');
 if (asset.person_id && !data.people.some(p => p.id === asset.person_id)) throw new Error('El responsable no existe.');
 const action = !old ? 'Registro' : old.location_id !== asset.location_id || old.person_id !== asset.person_id ? 'Traslado' : 'Edición';
 const saved = { ...asset, last_action: action, created_at: old?.created_at || new Date().toISOString(), version: (old?.version || 0) + 1, updated_at: new Date().toISOString() };
 return { ...data, assets: old ? data.assets.map(a => a.id === saved.id ? saved : a) : [saved, ...data.assets], movements: [{ id: crypto.randomUUID(), asset_id: saved.id, asset_name: saved.name, action: saved.last_action, note: saved.action_note, actor: 'Usuario de demostración', created_at: saved.updated_at, before: old || null, after: saved }, ...data.movements] };
}
export function csvCell(value: unknown) {
 const s = String(value ?? '');
 return '"' + (/^[\s]*[=+@-]/.test(s) ? "'" + s : s).replace(/"/g, '""') + '"';
}
export function inventoryCsv(data: Data, assets = data.assets) {
 const rows = [['Placa','Descripción','Categoría','Ubicación','Responsable','Cantidad','Estado','Observaciones'], ...assets.map(a => [a.plate || 'SIN PLACA', a.name, a.category, data.locations.find(l => l.id === a.location_id)?.name || '', data.people.find(p => p.id === a.person_id)?.name || '', a.quantity, a.status, a.notes])];
 return '\uFEFF' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');
}
