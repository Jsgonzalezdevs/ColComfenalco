import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, CalendarDays, Download, Eye, FileText, Search, Upload, X } from 'lucide-react';
import { archivePageSize, downloadOriginal, findEntries, getOriginalBlob, listDocuments } from './archive';
import type { ArchiveDocument } from './archive';
import { importSourceAssets } from './sourceImport';
import { configured, supabase } from './repository';

const message = (error: unknown) => error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : 'No se pudo completar la operación.';
const fileName = (path: string) => path.split('/').pop() || path;
const sourceFolder = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : 'Archivos del colegio';

export default function Archive({ isAdmin, onImported }: { isAdmin: boolean; onImported: () => void }) {
  const [documents, setDocuments] = useState<ArchiveDocument[]>([]);
  const [candidateCount, setCandidateCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [search, setSearch] = useState('');
  const [reviewDate, setReviewDate] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [schemaReady, setSchemaReady] = useState(false);
  const [schemaMessage, setSchemaMessage] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [selected, setSelected] = useState<ArchiveDocument | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  async function refresh() {
    if (!configured || !supabase) return;
    setLoading(true);
    setError('');
    try {
      const [docs, source, pending, assetSchema, actaSchema] = await Promise.all([
        listDocuments(),
        supabase.from('archive_entries').select('id', { count: 'exact', head: true }).eq('kind', 'asset_candidate'),
        supabase.from('assets').select('id', { count: 'exact', head: true }).eq('status', 'Por validar'),
        supabase.from('assets').select('id,review_due_date,last_reviewed_at,source_entry_id,source_document_id,source_data').limit(1),
        supabase.from('asset_documents').select('id', { count: 'exact', head: true }),
      ]);
      if (source.error) throw source.error;
      if (pending.error) throw pending.error;
      const missingSchema = assetSchema.error || actaSchema.error;
      setSchemaReady(!missingSchema);
      setSchemaMessage(missingSchema ? 'La base de datos todavía no tiene lista la actualización para importar activos y adjuntar actas. Revisa que el SQL terminara correctamente y vuelve a intentar.' : '');
      setDocuments(docs);
      setCandidateCount(source.count || 0);
      setPendingCount(pending.count || 0);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (isAdmin) void refresh(); else setLoading(false); }, [isAdmin]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const visibleDocuments = useMemo(() => documents.filter(document => `${document.path} ${document.category}`.toLocaleLowerCase('es-CO').includes(search.toLocaleLowerCase('es-CO').trim())), [documents, search]);

  async function openDocument(document: ArchiveDocument) {
    setSelected(document);
    setPreviewText('');
    setPreviewError('');
    setPreviewLoading(true);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
    try {
      const blob = await getOriginalBlob(document);
      const format = document.format.toLowerCase();
      if (format === 'pdf') {
        setPreviewUrl(URL.createObjectURL(blob));
      } else if (format === 'docx') {
        const { extractRawText } = await import('mammoth');
        const result = await extractRawText({ arrayBuffer: await blob.arrayBuffer() });
        setPreviewText(result.value.trim() || 'Este archivo no contiene texto para mostrar.');
      } else {
        const pieces: string[] = [];
        const pages = Math.min(10, Math.ceil(document.entry_count / archivePageSize));
        for (let page = 0; page < pages; page++) {
          const result = await findEntries(document.id, '', page);
          pieces.push(...result.entries.map(entry => entry.text));
        }
        setPreviewText(pieces.join('\n\n').trim() || 'Este archivo no tiene una vista de lectura disponible. Puedes descargar el original.');
      }
    } catch (e) {
      setPreviewError(message(e));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function downloadDocument(document: ArchiveDocument) {
    setError('');
    try { await downloadOriginal(document); }
    catch (e) { setError(message(e)); }
  }

  async function importRecords() {
    if (!schemaReady) { setError('Primero debe quedar lista la actualización de la base de datos.'); return; }
    if (!reviewDate) { setError('Selecciona la fecha en que volverán a validar estos registros.'); return; }
    setBusy(true); setError(''); setNotice(''); setProgress({ done: 0, total: candidateCount });
    try {
      const result = await importSourceAssets(reviewDate, (done, total) => setProgress({ done, total }));
      setNotice(result.inserted
        ? `${result.inserted.toLocaleString('es-CO')} registros agregados al inventario para validar. La fecha de revisión quedó guardada.`
        : 'Todos los registros ya estaban en el inventario. No se crearon duplicados.');
      await refresh();
      onImported();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false); setProgress(null);
    }
  }

  if (!configured) return <section className="panel archive-intro"><FileText/><h2>Archivos del colegio</h2><p>Conecta la base de datos institucional para consultar e importar sus registros.</p></section>;
  if (!isAdmin) return <section className="panel archive-intro"><h2>Acceso de administradores</h2><p>La importación y los documentos institucionales están disponibles para administradores.</p></section>;

  return <div className="archive-page">
    <section className="panel import-guide">
      <div className="import-guide-heading"><span className="import-summary-icon"><Upload size={22}/></span><div><span className="eyebrow">IMPORTACIÓN GUIADA</span><h2>Traer los registros al inventario</h2><p>Los datos se guardarán como <strong>Por validar</strong>. No se asignará una ubicación ni se confirmará un estado automáticamente.</p></div></div>
      <div className="import-guide-stats"><div><strong>{candidateCount.toLocaleString('es-CO')}</strong><span>registros encontrados en los archivos</span></div><div><strong>{pendingCount.toLocaleString('es-CO')}</strong><span>pendientes de validar en el inventario</span></div><div><strong>{documents.length}</strong><span>archivos originales conservados</span></div></div>
      {schemaMessage && <div className="error-panel" role="alert">{schemaMessage}<button disabled={busy} onClick={() => void refresh()}>Comprobar de nuevo</button></div>}
      <div className="import-date-row"><label>Fecha para volver a revisar el estado de estos registros<input type="date" value={reviewDate} min={`${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`} onChange={e => setReviewDate(e.target.value)} required/></label><button className="primary" disabled={busy || loading || !candidateCount || !schemaReady} onClick={() => void importRecords()}>{busy ? 'Importando…' : loading ? 'Revisando sistema…' : pendingCount ? 'Continuar importación' : 'Importar registros'}<ArrowUpRight size={17}/></button></div>
      <p className="field-help">Las placas repetidas, los datos incompletos y las filas de traslados o bajas quedarán marcadas para que el equipo las concilie. La importación se puede reintentar sin crear duplicados.</p>
      {progress && <div className="import-progress" role="status"><div><span>Preparando el inventario</span><strong>{progress.done.toLocaleString('es-CO')} de {progress.total.toLocaleString('es-CO')}</strong></div><progress max={progress.total || 1} value={progress.done}/></div>}
      {notice && <div className="success-panel" role="status">{notice}<button className="text-button" onClick={onImported}>Ver inventario<ArrowUpRight size={15}/></button></div>}
    </section>

    {error && <div className="error-panel" role="alert"><span>{error}</span><button disabled={busy} onClick={() => void refresh()}>Reintentar</button></div>}

    {selected && <section className="panel source-preview" aria-live="polite">
      <div className="section-title"><div><span className="eyebrow">VISTA DE LECTURA</span><h2>{fileName(selected.path)}</h2><p>{sourceFolder(selected.path)}</p></div><div className="source-preview-actions"><button className="secondary" onClick={() => void downloadDocument(selected)}><Download size={16}/>Descargar original</button><button className="icon-button" aria-label="Cerrar vista" onClick={() => setSelected(null)}><X size={19}/></button></div></div>
      {previewLoading ? <div className="empty"><p>Abriendo archivo…</p></div> : previewError ? <div className="error-panel" role="alert">{previewError}</div> : previewUrl ? <iframe className="source-pdf" src={previewUrl} title={`Vista previa de ${fileName(selected.path)}`} /> : <pre className="source-text">{previewText}</pre>}
      <p className="field-help">La vista sirve para consultar el contenido en el navegador. El botón conserva la descarga del archivo original.</p>
    </section>}

    <section className="panel archive-library">
      <div className="section-title"><div><span className="eyebrow">ARCHIVOS ORIGINALES</span><h2>Consultar documentos del colegio</h2><p>Abre un archivo para leerlo aquí o descarga su versión original.</p></div></div>
      <label className="search archive-search"><Search size={19}/><input aria-label="Buscar archivos" value={search} placeholder="Buscar por nombre o carpeta…" onChange={e => setSearch(e.target.value)}/></label>
      {loading ? <div className="empty"><p>Cargando archivos…</p></div> : visibleDocuments.length ? <div className="archive-list">{visibleDocuments.map(document => <article className="archive-card" key={document.id}>
        <span className="archive-file-icon"><FileText size={19}/></span><div className="archive-file-info"><small>{sourceFolder(document.path)}</small><strong>{fileName(document.path)}</strong><span>{document.format.toUpperCase()} · {document.category}</span></div>
        <div className="archive-card-actions"><button className="secondary" onClick={() => void openDocument(document)}><Eye size={16}/>Ver en navegador</button><button className="icon-button" aria-label={`Descargar original ${fileName(document.path)}`} onClick={() => void downloadDocument(document)}><Download size={17}/></button></div>
      </article>)}</div> : <div className="empty"><FileText/><h3>No encontramos archivos</h3><p>Prueba con otra palabra.</p></div>}
    </section>
  </div>;
}
