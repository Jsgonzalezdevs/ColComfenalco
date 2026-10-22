import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Eye, FileText, Link2, Paperclip } from 'lucide-react';
import { downloadOriginal, getOriginalBlob, listDocuments } from './archive';
import type { ArchiveDocument } from './archive';
import { supabase } from './repository';

type AssetDocument = { id: string; asset_id: string; archive_document_id: string | null; storage_path: string | null; filename: string; mime_type: string; byte_size: number; preview_text: string | null; created_at: string };
const accepted = new Set(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png']);
const byId = (items: ArchiveDocument[], id: string | null) => items.find(item => item.id === id);
const message = (error: unknown) => error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : 'No se pudo abrir el documento.';

export default function AssetDocuments({ assetId, sourceDocumentId = null, isAdmin }: { assetId: string; sourceDocumentId?: string | null; isAdmin: boolean }) {
  const [items, setItems] = useState<AssetDocument[]>([]);
  const [archive, setArchive] = useState<ArchiveDocument[]>([]);
  const [linkId, setLinkId] = useState('');
  const [preview, setPreview] = useState<{ title: string; mime: string; url?: string; text?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  async function refresh() {
    if (!supabase || !isAdmin) return;
    const [attached, originals] = await Promise.all([
      supabase.from('asset_documents').select('*').eq('asset_id', assetId).order('created_at'),
      listDocuments(),
    ]);
    if (attached.error) throw attached.error;
    setItems(attached.data as AssetDocument[]);
    setArchive(originals);
  }

  useEffect(() => { let active = true; setError(''); if (isAdmin) void refresh().catch(e => { if (active) setError(message(e)); }); return () => { active = false; }; }, [assetId, isAdmin]);
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);

  const alreadyLinked = new Set(items.map(item => item.archive_document_id).filter((id): id is string => !!id));
  const sourceDocument = byId(archive, sourceDocumentId);
  const availableActs = useMemo(() => archive.filter(document => {
    const path = document.path.toLocaleLowerCase('es-CO');
    return (path.includes('/actas/') || document.category.toLocaleLowerCase('es-CO').includes('acta')) && !alreadyLinked.has(document.id);
  }), [archive, items]);

  async function open(item: AssetDocument | ArchiveDocument, mime = '') {
    setBusy(true); setError('');
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
    try {
      const isArchive = 'path' in item;
      const type = isArchive ? (item.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') : (item.mime_type || mime);
      let blob: Blob | null;
      if (isArchive) blob = await getOriginalBlob(item);
      else {
        const result = await supabase!.storage.from('asset-actas').download(item.storage_path!);
        if (result.error) throw result.error;
        blob = result.data;
      }
      if (!blob) throw new Error('No se pudo leer el archivo guardado.');
      if (type === 'application/pdf' || type.startsWith('image/')) {
        setPreview({ title: isArchive ? item.path.split('/').pop()! : item.filename, mime: type, url: URL.createObjectURL(blob) });
      } else if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const { extractRawText } = await import('mammoth');
        const text = isArchive ? (await extractRawText({ arrayBuffer: await blob.arrayBuffer() })).value : ('preview_text' in item ? item.preview_text || '' : '');
        setPreview({ title: isArchive ? item.path.split('/').pop()! : item.filename, mime: type, text: text.trim() || 'Este documento no contiene texto para mostrar.' });
      } else {
        throw new Error('Esta versión se puede descargar, pero no tiene vista de lectura en el navegador.');
      }
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }

  async function download(item: AssetDocument) {
    setError('');
    try {
      const original = byId(archive, item.archive_document_id);
      if (original) { await downloadOriginal(original); return; }
      const result = await supabase!.storage.from('asset-actas').download(item.storage_path!);
      if (result.error) throw result.error;
      const url = URL.createObjectURL(result.data);
      const a = window.document.createElement('a'); a.href = url; a.download = item.filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(message(e)); }
  }

  async function downloadArchived(item: ArchiveDocument) {
    setError('');
    try { await downloadOriginal(item); }
    catch (e) { setError(message(e)); }
  }

  async function upload(file: File) {
    if (!accepted.has(file.type) && !/\.(pdf|docx|jpe?g|png)$/i.test(file.name)) { setError('Adjunta un PDF, Word (.docx) o una imagen JPG/PNG.'); return; }
    if (file.size > 20 * 1024 * 1024) { setError('El archivo debe pesar 20 MB o menos.'); return; }
    setBusy(true); setError('');
    const extension = file.name.split('.').pop()?.toLowerCase() || 'file';
    const path = `${assetId}/${crypto.randomUUID()}.${extension}`;
    try {
      let previewText: string | null = null;
      if (/\.docx$/i.test(file.name)) {
        const { extractRawText } = await import('mammoth');
        previewText = (await extractRawText({ arrayBuffer: await file.arrayBuffer() })).value.slice(0, 200000);
      }
      const uploadResult = await supabase!.storage.from('asset-actas').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
      if (uploadResult.error) throw uploadResult.error;
      const insert = await supabase!.from('asset_documents').insert({ asset_id: assetId, storage_path: path, filename: file.name, mime_type: file.type || 'application/octet-stream', byte_size: file.size, preview_text: previewText });
      if (insert.error) { await supabase!.storage.from('asset-actas').remove([path]); throw insert.error; }
      await refresh();
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }

  async function linkExisting() {
    if (!linkId || !supabase) return;
    const document = byId(archive, linkId);
    if (!document) return;
    setBusy(true); setError('');
    const result = await supabase.from('asset_documents').insert({ asset_id: assetId, archive_document_id: document.id, filename: document.path.split('/').pop(), mime_type: document.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', byte_size: document.byte_size });
    if (result.error) setError(message(result.error));
    else { setLinkId(''); await refresh(); }
    setBusy(false);
  }

  if (!isAdmin) return <section className="asset-documents"><div className="asset-documents-heading"><div><h3>Actas y documentos de soporte</h3><p>Los documentos institucionales están disponibles para administradores.</p></div></div></section>;

  return <section className="asset-documents">
    <div className="asset-documents-heading"><div><h3>Actas y documentos de soporte</h3><p>Consulta los documentos aquí o descarga el archivo original.</p></div>{isAdmin && <button className="secondary" disabled={busy} onClick={() => fileInput.current?.click()}><Paperclip size={16}/>Adjuntar acta</button>}</div>
    {isAdmin && <input ref={fileInput} hidden type="file" accept=".pdf,.docx,.jpg,.jpeg,.png" onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file); }} />}
    {sourceDocument && !items.some(item => item.archive_document_id === sourceDocument.id) && <article className="asset-document-row"><span className="archive-file-icon"><FileText size={18}/></span><div><strong>{sourceDocument.path.split('/').pop()}</strong><small>Archivo original del que se obtuvo este registro</small></div><button className="text-button" disabled={busy} onClick={() => void open(sourceDocument)}><Eye size={15}/>Ver</button><button className="icon-button" aria-label="Descargar archivo de origen" onClick={() => void downloadArchived(sourceDocument)}><Download size={16}/></button></article>}
    {items.map(item => {
      const original = byId(archive, item.archive_document_id);
      return <article className="asset-document-row" key={item.id}><span className="archive-file-icon"><FileText size={18}/></span><div><strong>{item.filename}</strong><small>{original ? 'Documento original del colegio' : 'Adjuntado a esta ficha'} · {new Date(item.created_at).toLocaleDateString('es-CO')}</small></div><button className="text-button" disabled={busy} onClick={() => void open(original || item, item.mime_type)}><Eye size={15}/>Ver</button><button className="icon-button" aria-label={`Descargar ${item.filename}`} onClick={() => void download(item)}><Download size={16}/></button></article>;
    })}
    {isAdmin && availableActs.length > 0 && <div className="link-acta-row"><label>Vincular un acta que ya está en los archivos<select value={linkId} onChange={e => setLinkId(e.target.value)}><option value="">Selecciona un acta…</option>{availableActs.map(document => <option key={document.id} value={document.id}>{document.path.split('/').pop()}</option>)}</select></label><button className="secondary" disabled={!linkId || busy} onClick={() => void linkExisting()}><Link2 size={16}/>Vincular</button></div>}
    {!sourceDocument && !items.length && <p className="empty-documents">Aún no hay documentos vinculados.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {preview && <div className="document-reader"><div className="document-reader-heading"><strong>{preview.title}</strong><button className="text-button" onClick={() => setPreview(null)}>Cerrar vista</button></div>{preview.url ? preview.mime.startsWith('image/') ? <img src={preview.url} alt={`Vista de ${preview.title}`}/> : <iframe title={`Vista de ${preview.title}`} src={preview.url}/> : <pre>{preview.text}</pre>}</div>}
    {busy && <small className="field-help">Procesando documento…</small>}
  </section>;
}
