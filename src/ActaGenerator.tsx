import { useMemo, useState } from 'react';
import { Download, FileText, PrinterCheck } from 'lucide-react';
import type { Asset, Data } from './domain';
import { formatLocation } from './domain';
import type { ActaDetails } from './acta';

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function actaFilename(details: ActaDetails) {
  const slug = details.recipient.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-CO').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `acta-entrega-activos-${slug || 'responsable'}.docx`;
}

export default function ActaGenerator({ data, canEdit }: { data: Data; canEdit: boolean }) {
  const [personId, setPersonId] = useState('');
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [recipientId, setRecipientId] = useState('');
  const [treatment, setTreatment] = useState<ActaDetails['treatment'] | ''>('');
  const [actNumber, setActNumber] = useState('');
  const [date, setDate] = useState(today);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [details, setDetails] = useState<ActaDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const recipient = data.people.find(person => person.id === personId);
  const assigned = useMemo(() => data.assets.filter(asset => asset.person_id === personId), [data.assets, personId]);
  const included = assigned.filter(asset => selectedAssets.includes(asset.id));
  const notReady = assigned.filter(asset => ['Por validar', 'No encontrado', 'Pendiente de baja'].includes(asset.status));
  const selectedNotReady = included.filter(asset => ['Por validar', 'No encontrado', 'Pendiente de baja'].includes(asset.status));

  function clearOutput() {
    setBlob(null);
    setDetails(null);
  }

  function selectPerson(id: string) {
    setPersonId(id);
    setSelectedAssets(data.assets.filter(asset => asset.person_id === id && !['Por validar', 'No encontrado', 'Pendiente de baja'].includes(asset.status)).map(asset => asset.id));
    clearOutput();
    setError('');
  }

  function toggleAsset(asset: Asset) {
    setSelectedAssets(current => current.includes(asset.id) ? current.filter(id => id !== asset.id) : [...current, asset.id]);
    clearOutput();
  }

  async function generate() {
    if (!canEdit) return;
    if (!recipient) { setError('Selecciona a la persona responsable.'); return; }
    if (!treatment) { setError('Elige el tratamiento: señor o señora.'); return; }
    if (!recipientId.trim()) { setError('Completa el número de identificación de quien recibe.'); return; }
    if (!date) { setError('Selecciona la fecha del acta.'); return; }
    if (!included.length) { setError('Selecciona al menos un activo para incluir en el acta.'); return; }
    setBusy(true);
    setError('');
    try {
      const next: ActaDetails = {
        recipient,
        recipientId: recipientId.trim(),
        treatment,
        actNumber: actNumber.trim(),
        date,
        assets: included,
      };
      const { createActaDocx } = await import('./acta');
      const output = await createActaDocx(next, data);
      setDetails(next);
      setBlob(output);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo generar el acta.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="acta-page">
    {!canEdit && <div className="demo-banner"><span>Tu acceso permite consultar el inventario, pero no generar actas.</span></div>}
    <section className="panel acta-form">
      <div className="section-title"><div><h2>Datos del acta</h2><p>Elige una persona para cargar los activos que tiene asignados y preparar el anexo de entrega.</p></div><span className="badge good">Formato institucional · Word editable</span></div>
      <div className="acta-fields">
        <label>Responsable que recibe *<select value={personId} disabled={!canEdit} onChange={event => selectPerson(event.target.value)}><option value="">Selecciona una persona…</option>{data.people.map(person => <option key={person.id} value={person.id}>{person.name} · {person.position}</option>)}</select></label>
        <div className="acta-assets">
          <div className="acta-assets-heading"><div><strong>Activos asignados</strong><small>{recipient ? `${assigned.length} registros vinculados · ${included.reduce((sum, asset) => sum + asset.quantity, 0)} unidades incluidas en el anexo` : 'Selecciona un responsable para ver su inventario.'}</small></div>{recipient && assigned.length > 0 && <label className="select-all"><input type="checkbox" checked={selectedAssets.length === assigned.length} onChange={event => { setSelectedAssets(event.target.checked ? assigned.map(asset => asset.id) : []); clearOutput(); }}/>Incluir todos</label>}</div>
          {recipient && <div className="acta-assets-table"><table><thead><tr><th></th><th>PLACA</th><th>ACTIVO</th><th>UBICACIÓN</th><th>ESTADO</th><th>CANT.</th></tr></thead><tbody>{assigned.map(asset => <tr key={asset.id}><td><input type="checkbox" aria-label={`Incluir ${asset.name}`} checked={selectedAssets.includes(asset.id)} onChange={() => toggleAsset(asset)}/></td><td>{asset.plate || (asset.source_data?.plate_enabled === true ? '' : 'Sin placa')}</td><td><strong>{asset.name}</strong><small>{asset.category}</small></td><td>{formatLocation(data.locations.find(item => item.id === asset.location_id))}</td><td><span className={`badge ${asset.status === 'Bueno' ? 'good' : 'review'}`}>{asset.status}</span></td><td>{asset.quantity}</td></tr>)}</tbody></table>{!assigned.length && <div className="acta-empty">Esta persona no tiene activos asignados todavía.</div>}</div>}
          {notReady.length > 0 && <p className="field-help acta-warning">{selectedNotReady.length > 0 ? `${selectedNotReady.length} activo(s) con estado pendiente o sin validar están seleccionados. Confirma que efectivamente se entregan.` : `${notReady.length} activo(s) con estado pendiente o sin validar se excluyen por defecto. Inclúyelos solo si confirmaste su entrega.`} El estado quedará indicado en el anexo.</p>}
        </div>
        <div className="acta-field-grid">
          <label>Tratamiento de quien recibe *<select value={treatment} onChange={event => { setTreatment(event.target.value as ActaDetails['treatment'] | ''); clearOutput(); }} required><option value="">Selecciona…</option><option value="Señor">Señor</option><option value="Señora">Señora</option></select></label>
          <label>Cédula de quien recibe *<input value={recipientId} onChange={event => { setRecipientId(event.target.value); clearOutput(); }} maxLength={32} placeholder="Número de identificación" required/></label>
          <label>Número de acta<input value={actNumber} onChange={event => { setActNumber(event.target.value); clearOutput(); }} maxLength={12} placeholder="Opcional"/></label>
          <label>Fecha del acta *<input type="date" value={date} onChange={event => { setDate(event.target.value); clearOutput(); }} required/></label>
        </div>
        <p className="field-help">Se conserva el contenido, el diseño y los espacios de firma manuscrita del acta individual compartida. La cédula se pide aquí porque no está guardada en el inventario. Los activos seleccionados aparecen en un anexo editable dentro del mismo Word.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={!canEdit || busy || !recipient || !treatment || !recipientId.trim() || !date || !included.length} onClick={() => void generate()}><FileText size={17}/>{busy ? 'Generando documento…' : 'Generar acta editable'}</button>
      </div>
    </section>
    {blob && details && <section className="panel acta-preview" aria-label="Acta generada"><div className="section-title"><div><h2>Acta lista para descargar</h2><p>Se generó el Word editable con {details.assets.length} registros ({details.assets.reduce((sum, asset) => sum + asset.quantity, 0)} unidades) y espacios para firma manuscrita.</p></div><div className="acta-preview-actions"><button className="secondary" onClick={() => save(blob, actaFilename(details))}><Download size={17}/>Descargar Word</button></div></div></section>}
    <p className="acta-footnote"><PrinterCheck size={15}/> Para obtener PDF, abre el Word descargado y usa Archivo → Guardar como PDF o Imprimir → Guardar como PDF.</p>
  </div>;
}
