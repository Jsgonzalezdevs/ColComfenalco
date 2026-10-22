import { describe, expect, it } from 'vitest';
import { buildEnrichmentPlan } from '../src/sourceEnrichment';
import type { SourceDocument, SourceEntry } from '../src/sourceEnrichment';

const actaId = 'acta-1';
const inventoryId = 'inventory-1';
const row = (id: string, document_id: string, ordinal: number, kind: string, payload: Record<string, unknown>, text = ''): SourceEntry => ({ id, document_id, ordinal, kind, payload, text, locator: `fila ${ordinal}` });

describe('asociaciones de datos de origen', () => {
  it('lee responsables y ubicaciones desde los encabezados y celdas del archivo', () => {
    const docs: SourceDocument[] = [{ id: inventoryId, path: 'Ciclo 1.xlsx', category: 'Inventario / soporte' }];
    const entries = [
      row('header', inventoryId, 0, 'sheet_row', { sheet: 'Sala', cells: { A: { value: 'PLACA' }, B: { value: 'DESCRIPCION' }, C: { value: 'RESPONSABLE' }, D: { value: 'UBICACIÓN ACTIVO' }, E: { value: 'UBICACIÓN' } } }),
      row('asset', inventoryId, 1, 'asset_candidate', { sheet: 'Sala', cells: { A: { value: '12345' }, B: { value: 'Computador' }, C: { value: 'Ana Pérez' }, D: { value: 'MÓDULO CUATRO' }, E: { value: 'PRIMER PISO SALA DE SISTEMAS' } }, asset_proposal: { plate_as_written: '12345' } }),
    ];
    const plan = buildEnrichmentPlan(entries, docs);
    expect(plan.assignments.get('asset')?.person?.name).toBe('Ana Pérez');
    expect(plan.assignments.get('asset')?.location).toEqual({ name: 'PRIMER PISO SALA DE SISTEMAS · MÓDULO CUATRO', block: 'MÓDULO CUATRO' });
    expect(plan.people.has('ana perez')).toBe(true);
    expect(plan.locations.size).toBe(1);
  });

  it('usa el acta cuando su nombre coincide con la persona firmante y la placa coincide', () => {
    const docs: SourceDocument[] = [
      { id: actaId, path: 'ACTAS/ACTA DE ENTREGA DE ACTIVOS ANA PEREZ.docx', category: 'Acta', format: 'docx', byte_size: 100 },
      { id: inventoryId, path: 'Inventario.xlsx', category: 'Inventario / soporte' },
    ];
    const entries = [
      row('asset-header', actaId, 0, 'table_row', { table: 2, row: 1, cells: ['PLACA', 'ACTIVO'] }),
      row('acta-asset', actaId, 1, 'asset_candidate', { table: 2, row: 2, cells: ['12345', 'COMPUTADOR'], asset_proposal: { plate_as_written: '12345' } }),
      row('signer-header', actaId, 2, 'table_row', { table: 3, row: 1, cells: ['NOMBRE Y APELLIDO', 'CARGO', 'FIRMA'] }),
      row('signer', actaId, 3, 'table_row', { table: 3, row: 2, cells: ['Ana Perez', 'DOCENTE', ''] }),
      row('inventory-header', inventoryId, 0, 'sheet_row', { sheet: 'Activos', cells: { A: { value: 'PLACA' }, B: { value: 'DESCRIPCION' } } }),
      row('inventory-asset', inventoryId, 1, 'asset_candidate', { sheet: 'Activos', cells: { A: { value: '12345' }, B: { value: 'COMPUTADOR' } }, asset_proposal: { plate_as_written: '12345' } }),
    ];
    const plan = buildEnrichmentPlan(entries, docs);
    expect(plan.assignments.get('acta-asset')?.person).toEqual({ name: 'Ana Perez', position: 'DOCENTE' });
    expect(plan.assignments.get('inventory-asset')?.person).toEqual({ name: 'Ana Perez', position: 'DOCENTE' });
    expect(plan.assignments.get('inventory-asset')?.actaDocumentId).toBe(actaId);
  });

  it('no asigna un acta cuando su nombre no identifica de forma única a una persona firmante', () => {
    const docs: SourceDocument[] = [{ id: actaId, path: 'ACTAS/ACTA DE ENTREGA DE ACTIVOS AUDIOVISUALES.docx', category: 'Acta' }];
    const entries = [
      row('header', actaId, 0, 'table_row', { table: 1, row: 1, cells: ['PLACA', 'ACTIVO'] }),
      row('asset', actaId, 1, 'asset_candidate', { table: 1, row: 2, cells: ['12345', 'VIDEO BEAM'], asset_proposal: { plate_as_written: '12345' } }),
      row('signer-header', actaId, 2, 'table_row', { table: 3, row: 1, cells: ['NOMBRE Y APELLIDO', 'CARGO', 'FIRMA'] }),
      row('signer-a', actaId, 3, 'table_row', { table: 3, row: 2, cells: ['Ana Perez', 'COORDINADORA', ''] }),
      row('signer-b', actaId, 4, 'table_row', { table: 3, row: 3, cells: ['Luis Lopez', 'COORDINADOR', ''] }),
    ];
    expect(buildEnrichmentPlan(entries, docs).assignments.get('asset')?.person).toBeUndefined();
  });
});
