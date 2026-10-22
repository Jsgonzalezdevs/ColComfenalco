import type { Asset } from './domain';
import { normalize } from './domain';
import { supabase } from './repository';
import { buildEnrichmentPlan } from './sourceEnrichment';
import type { LocationProposal, PersonProposal, SourceAssignment, SourceDocument, SourceEntry } from './sourceEnrichment';
type Proposal = { descriptions?: unknown; plate_as_written?: unknown; quantity_as_written?: unknown; status_as_written?: unknown; review_flags?: unknown };

const batchSize = 100;
const pageSize = 500;

export function sourceAssetDraft(entry: SourceEntry, document: SourceDocument, reviewDueDate: string, assignment: SourceAssignment = {}, personId: string | null = null, locationId: string | null = null): Omit<Asset, 'created_at' | 'updated_at'> {
  const proposal = (entry.payload.asset_proposal || {}) as Proposal;
  const descriptions = Array.isArray(proposal.descriptions) ? proposal.descriptions.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
  const originalQuantity = proposal.quantity_as_written;
  const quantity = typeof originalQuantity === 'number' && Number.isSafeInteger(originalQuantity) && originalQuantity > 0 ? originalQuantity : 1;
  const flags = Array.isArray(proposal.review_flags) ? proposal.review_flags.filter((x): x is string => typeof x === 'string') : [];
  const name = (descriptions[0] || entry.text.split('|').map(x => x.trim()).find(Boolean) || 'Activo importado para revisar').slice(0, 180);
  return {
    id: crypto.randomUUID(),
    plate: null,
    name,
    category: 'Por clasificar',
    location_id: locationId,
    person_id: personId,
    quantity,
    status: 'Por validar',
    notes: '',
    version: 1,
    last_action: 'Registro',
    action_note: 'Importado desde los archivos del colegio para validación',
    review_due_date: reviewDueDate,
    last_reviewed_at: null,
    source_entry_id: entry.id,
    source_document_id: document.id,
    source_data: {
      proposal: {
        descriptions,
        plate_as_written: typeof proposal.plate_as_written === 'string' ? proposal.plate_as_written : '',
        quantity_as_written: originalQuantity ?? null,
        status_as_written: typeof proposal.status_as_written === 'string' ? proposal.status_as_written : '',
        review_flags: flags,
        location_as_written: assignment.location?.name || '',
        responsible_as_written: assignment.person?.name || '',
      },
      source_document: document.path,
      source_category: document.category,
      source_locator: entry.locator,
      source_text: entry.text,
      source_payload: entry.payload,
    },
  };
}

async function readAllEntries() {
  if (!supabase) throw new Error('La importación requiere conexión con la base de datos del colegio.');
  const countResult = await supabase.from('archive_entries').select('id', { count: 'exact', head: true });
  if (countResult.error) throw countResult.error;
  const total = countResult.count || 0;
  const entries: SourceEntry[] = [];
  for (let offset = 0; offset < total; offset += pageSize) {
    const pageResult = await supabase.from('archive_entries').select('id,document_id,ordinal,locator,kind,payload,text').order('document_id').order('ordinal').range(offset, offset + pageSize - 1);
    if (pageResult.error) throw pageResult.error;
    entries.push(...pageResult.data as SourceEntry[]);
  }
  return entries;
}

async function ensureCatalog<T extends PersonProposal | LocationProposal>(kind: 'people' | 'locations', proposals: Map<string, T>) {
  if (!supabase) throw new Error('Conecta la base de datos del colegio para crear responsables y ubicaciones.');
  const select = kind === 'people' ? 'id,name,position' : 'id,name,block';
  const result = await supabase.from(kind).select(select);
  if (result.error) throw result.error;
  const ids = new Map((result.data || []).map((item: { id: string; name: string }) => [normalize(item.name), item.id]));
  const missing = [...proposals].filter(([key]) => !ids.has(key)).map(([, item]) => ({ id: crypto.randomUUID(), ...item }));
  let created = 0;
  for (let start = 0; start < missing.length; start += batchSize) {
    const inserted = await supabase.from(kind).insert(missing.slice(start, start + batchSize)).select(select);
    if (inserted.error) throw inserted.error;
    created += inserted.data?.length || 0;
    for (const item of inserted.data || []) ids.set(normalize(item.name), item.id);
  }
  return { ids, created };
}

async function fillMissingAssignments(candidates: SourceEntry[], plan: ReturnType<typeof buildEnrichmentPlan>, peopleIds: Map<string, string>, locationIds: Map<string, string>) {
  if (!supabase) throw new Error('No hay conexión con la base de datos.');
  let updated = 0;
  let conflicts = 0;
  let linkedPeople = 0;
  let linkedLocations = 0;
  for (let start = 0; start < candidates.length; start += batchSize) {
    const rows = candidates.slice(start, start + batchSize);
    const result = await supabase.from('assets').select('*').in('source_entry_id', rows.map(entry => entry.id));
    if (result.error) throw result.error;
    const assetByEntry = new Map((result.data || []).map((asset: Asset) => [asset.source_entry_id, asset]));
    const updates = new Map<string, { version: number; personId: string | null; locationId: string | null; ids: string[] }>();
    for (const entry of rows) {
      const asset = assetByEntry.get(entry.id);
      if (!asset) continue;
      const assignment = plan.assignments.get(entry.id) || {};
      const personId = assignment.person ? peopleIds.get(normalize(assignment.person.name)) || null : null;
      const locationId = assignment.location ? locationIds.get(normalize(assignment.location.name)) || null : null;
      if (asset.person_id && personId && asset.person_id !== personId) conflicts++;
      if (asset.status !== 'Por validar' && asset.location_id && locationId && asset.location_id !== locationId) conflicts++;
      const nextPersonId = asset.person_id || personId;
      // Imported assets remain provisional until their status is validated. Reapply
      // the corrected source location to those rows, including earlier bad matches.
      const nextLocationId = asset.status === 'Por validar' && locationId ? locationId : asset.location_id || locationId;
      if (nextPersonId) linkedPeople++;
      if (nextLocationId) linkedLocations++;
      if (nextPersonId === asset.person_id && nextLocationId === asset.location_id) continue;
      const key = JSON.stringify([asset.version, nextPersonId, nextLocationId]);
      const group = updates.get(key) || { version: asset.version, personId: nextPersonId, locationId: nextLocationId, ids: [] };
      group.ids.push(asset.id);
      updates.set(key, group);
    }
    const groups = [...updates.values()];
    for (let offset = 0; offset < groups.length; offset += 10) {
      const savedGroups = await Promise.all(groups.slice(offset, offset + 10).map(group => supabase!.from('assets')
        .update({ person_id: group.personId, location_id: group.locationId, version: group.version + 1, action_note: 'Asociación inicial completada desde los archivos importados.' })
        .in('id', group.ids)
        .eq('version', group.version)
        .select('id')));
      const failed = savedGroups.find(saved => saved.error);
      if (failed?.error) throw new Error(`Se importaron los catálogos y ${updated} asociaciones antes del error: ${failed.error.message}. Puedes volver a intentarlo.`);
      updated += savedGroups.reduce((total, saved) => total + (saved.data?.length || 0), 0);
      conflicts += savedGroups.reduce((total, saved, index) => total + (groups[offset + index].ids.length - (saved.data?.length || 0)), 0);
    }
  }
  return { updated, conflicts, linkedPeople, linkedLocations };
}

async function removeUnusedLegacyLocations(plan: ReturnType<typeof buildEnrichmentPlan>) {
  if (!supabase) throw new Error('No hay conexión con la base de datos.');
  // Legacy names were intentionally excluded from the new location catalog, so
  // resolve them against the existing rows before checking whether they are safe to remove.
  const existing = await supabase.from('locations').select('id,name');
  if (existing.error) throw existing.error;
  const idsByName = new Map((existing.data || []).map((location: { id: string; name: string }) => [normalize(location.name), location.id]));
  const ids = [...plan.legacyLocations.keys()].map(key => idsByName.get(key)).filter((id): id is string => !!id);
  let removed = 0;
  for (let start = 0; start < ids.length; start += batchSize) {
    const group = ids.slice(start, start + batchSize);
    const usage = await supabase.from('assets').select('location_id').in('location_id', group);
    if (usage.error) throw usage.error;
    const used = new Set((usage.data || []).map((asset: { location_id: string }) => asset.location_id));
    const unused = group.filter(id => !used.has(id));
    if (!unused.length) continue;
    const result = await supabase.from('locations').delete().in('id', unused).select('id');
    if (result.error) throw new Error(`Se corrigieron los vínculos de los activos, pero no se pudieron retirar las ubicaciones mezcladas con descripciones de bienes. Ejecuta supabase/cleanup_imported_locations.sql en Supabase y vuelve a intentar. ${result.error.message}`);
    removed += result.data?.length || 0;
  }
  return removed;
}

export async function importSourceAssets(reviewDueDate: string, onProgress: (done: number, total: number) => void) {
  if (!supabase) throw new Error('La importación requiere conexión con la base de datos del colegio.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewDueDate)) throw new Error('Selecciona la fecha de próxima revisión.');

  const docsResult = await supabase.from('archive_documents').select('id,path,category,format,byte_size').order('path');
  if (docsResult.error) throw docsResult.error;
  const documentById = new Map((docsResult.data as SourceDocument[]).map(document => [document.id, document]));
  const entries = await readAllEntries();
  const candidates = entries.filter(entry => entry.kind === 'asset_candidate');
  const total = candidates.length;
  if (!total) return { total: 0, inserted: 0, peopleFound: 0, locationsFound: 0, peopleCreated: 0, locationsCreated: 0, assignedPeople: 0, assignedLocations: 0, linkedActas: 0, existingAssetsUpdated: 0, sourceConflicts: 0, removedLegacyLocations: 0 };
  const plan = buildEnrichmentPlan(entries, [...documentById.values()]);
  const [people, locations] = await Promise.all([
    ensureCatalog('people', plan.people),
    ensureCatalog('locations', plan.locations),
  ]);

  let inserted = 0;
  const failedLinks: string[] = [];
  for (let start = 0; start < candidates.length; start += batchSize) {
      const rows = candidates.slice(start, start + batchSize);
      const batch = rows.map(entry => {
        const document = documentById.get(entry.document_id);
        if (!document) throw new Error('Uno de los registros no tiene archivo de origen. No se importó ese lote.');
        const assignment = plan.assignments.get(entry.id) || {};
        const personId = assignment.person ? people.ids.get(normalize(assignment.person.name)) || null : null;
        const locationId = assignment.location ? locations.ids.get(normalize(assignment.location.name)) || null : null;
        if (assignment.person && !personId) failedLinks.push(`Responsable: ${assignment.person.name}`);
        if (assignment.location && !locationId) failedLinks.push(`Ubicación: ${assignment.location.name}`);
        return sourceAssetDraft(entry, document, reviewDueDate, assignment, personId, locationId);
      });
      const result = await supabase.from('assets').upsert(batch, { onConflict: 'source_entry_id', ignoreDuplicates: true }).select('id');
      if (result.error) throw new Error(`Se importaron ${inserted} registros antes del error: ${result.error.message}. Puedes volver a intentarlo; no se duplicarán.`);
      inserted += result.data?.length || 0;
      onProgress(Math.min(start + batch.length, total), total);
  }

  const assignments = await fillMissingAssignments(candidates, plan, people.ids, locations.ids);
  const removedLegacyLocations = await removeUnusedLegacyLocations(plan);

  // Attach a source acta to an asset only when the source rows identify a unique acta.
  const actaPairs = candidates.flatMap(entry => {
    const actaDocumentId = plan.assignments.get(entry.id)?.actaDocumentId;
    return actaDocumentId ? [{ entryId: entry.id, actaDocumentId }] : [];
  });
  let linkedActas = 0;
  for (let start = 0; start < actaPairs.length; start += batchSize) {
    const group = actaPairs.slice(start, start + batchSize);
    const ids = group.map(item => item.entryId);
    const assetResult = await supabase.from('assets').select('id,source_entry_id').in('source_entry_id', ids);
    if (assetResult.error) throw assetResult.error;
    const idByEntry = new Map((assetResult.data || []).map((asset: { id: string; source_entry_id: string }) => [asset.source_entry_id, asset.id]));
    const links = group.flatMap(pair => {
      const assetId = idByEntry.get(pair.entryId);
      const document = documentById.get(pair.actaDocumentId);
      if (!assetId || !document) return [];
      return [{ asset_id: assetId, archive_document_id: document.id, filename: document.path.split('/').pop() || document.path, mime_type: document.format?.toLowerCase() === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', byte_size: document.byte_size || 0 }];
    });
    if (links.length) {
      const result = await supabase.from('asset_documents').upsert(links, { onConflict: 'asset_id,archive_document_id', ignoreDuplicates: true }).select('id');
      if (result.error) throw new Error(`Se importaron ${inserted} activos, pero hubo un problema al vincular actas: ${result.error.message}. Puedes reintentar sin crear duplicados.`);
      linkedActas += result.data?.length || 0;
    }
  }
  if (failedLinks.length) throw new Error(`Se importaron ${inserted} activos, pero no se pudieron resolver ${failedLinks.length} asociaciones a personas o ubicaciones. Puedes volver a intentarlo después de revisar los catálogos.`);
  return { total, inserted, peopleFound: plan.people.size, locationsFound: plan.locations.size, peopleCreated: people.created, locationsCreated: locations.created, assignedPeople: assignments.linkedPeople, assignedLocations: assignments.linkedLocations, linkedActas, existingAssetsUpdated: assignments.updated, sourceConflicts: assignments.conflicts, removedLegacyLocations };
}
