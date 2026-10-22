import type { Asset } from './domain';
import { supabase } from './repository';

type SourceDocument = { id: string; path: string; category: string };
type SourceEntry = { id: string; document_id: string; ordinal: number; locator: string; payload: Record<string, unknown>; text: string };
type Proposal = { descriptions?: unknown; plate_as_written?: unknown; quantity_as_written?: unknown; status_as_written?: unknown; review_flags?: unknown };

const batchSize = 100;
const pageSize = 500;

export function sourceAssetDraft(entry: SourceEntry, document: SourceDocument, reviewDueDate: string): Omit<Asset, 'created_at' | 'updated_at'> {
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
    location_id: null,
    person_id: null,
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
      },
      source_document: document.path,
      source_category: document.category,
      source_locator: entry.locator,
      source_text: entry.text,
      source_payload: entry.payload,
    },
  };
}

export async function importSourceAssets(reviewDueDate: string, onProgress: (done: number, total: number) => void) {
  if (!supabase) throw new Error('La importación requiere conexión con la base de datos del colegio.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewDueDate)) throw new Error('Selecciona la fecha de próxima revisión.');

  const docsResult = await supabase.from('archive_documents').select('id,path,category').order('path');
  if (docsResult.error) throw docsResult.error;
  const documentById = new Map((docsResult.data as SourceDocument[]).map(document => [document.id, document]));

  const countResult = await supabase.from('archive_entries').select('id', { count: 'exact', head: true }).eq('kind', 'asset_candidate');
  if (countResult.error) throw countResult.error;
  const total = countResult.count || 0;
  if (!total) return { total: 0, inserted: 0 };

  let inserted = 0;
  for (let offset = 0; offset < total; offset += pageSize) {
    const pageResult = await supabase.from('archive_entries').select('id,document_id,ordinal,locator,payload,text').eq('kind', 'asset_candidate').order('document_id').order('ordinal').range(offset, offset + pageSize - 1);
    if (pageResult.error) throw pageResult.error;
    const rows = pageResult.data as SourceEntry[];
    for (let start = 0; start < rows.length; start += batchSize) {
      const batch = rows.slice(start, start + batchSize).map(entry => {
        const document = documentById.get(entry.document_id);
        if (!document) throw new Error('Uno de los registros no tiene archivo de origen. No se importó ese lote.');
        return sourceAssetDraft(entry, document, reviewDueDate);
      });
      const result = await supabase.from('assets').upsert(batch, { onConflict: 'source_entry_id', ignoreDuplicates: true }).select('id');
      if (result.error) throw new Error(`Se importaron ${inserted} registros antes del error: ${result.error.message}. Puedes volver a intentarlo; no se duplicarán.`);
      inserted += result.data?.length || 0;
      onProgress(Math.min(offset + start + batch.length, total), total);
    }
  }
  return { total, inserted };
}
