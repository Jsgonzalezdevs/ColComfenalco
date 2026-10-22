import { useEffect, useState } from 'react';
import { ArrowUpRight, ClipboardCheck } from 'lucide-react';
import { supabase } from './repository';

export default function ImportSummary({ open }: { open: () => void }) {
  const [summary, setSummary] = useState<{ available: number; pending: number } | null>(null);
  useEffect(() => {
    let active = true;
    if (!supabase) return;
    Promise.all([
      supabase.from('archive_entries').select('id', { count: 'exact', head: true }).eq('kind', 'asset_candidate'),
      supabase.from('assets').select('id', { count: 'exact', head: true }).eq('status', 'Por validar'),
    ]).then(([source, pending]) => {
      if (active && !source.error && !pending.error) setSummary({ available: source.count || 0, pending: pending.count || 0 });
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  if (!summary?.available) return null;
  return <section className="panel import-summary">
    <span className="import-summary-icon"><ClipboardCheck size={22}/></span>
    <div><h2>Información de los archivos del colegio</h2>
      <p>{summary.available.toLocaleString('es-CO')} registros encontrados · {summary.pending.toLocaleString('es-CO')} por validar</p>
      <small>Al importar, aparecerán en el inventario para que el equipo confirme sus datos, ubicación y estado. Las repeticiones y los traslados quedarán señalados.</small>
    </div>
    <button className="primary" onClick={open}>{summary.pending ? 'Continuar revisión' : 'Preparar importación'}<ArrowUpRight size={16}/></button>
  </section>;
}
