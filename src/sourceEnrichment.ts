import { normalize } from './domain';

export type SourceDocument = { id: string; path: string; category: string; format?: string; byte_size?: number };
export type SourceEntry = { id: string; document_id: string; ordinal: number; locator: string; kind: string; payload: Record<string, unknown>; text: string };
export type PersonProposal = { name: string; position: string };
export type LocationProposal = { name: string; block: string };
export type SourceAssignment = { person?: PersonProposal; location?: LocationProposal; actaDocumentId?: string };
export type EnrichmentPlan = {
  assignments: Map<string, SourceAssignment>;
  people: Map<string, PersonProposal>;
  locations: Map<string, LocationProposal>;
};

const clean = (value: unknown) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
const cellsOf = (entry: SourceEntry): Map<string, string> => {
  const cells = entry.payload.cells;
  if (Array.isArray(cells)) return new Map(cells.map((value, index) => [String(index), clean(value)]));
  if (!cells || typeof cells !== 'object') return new Map();
  return new Map(Object.entries(cells as Record<string, unknown>).map(([key, cell]) => {
    const value = cell && typeof cell === 'object' && 'value' in cell ? (cell as { value: unknown }).value : cell;
    return [key, clean(value)];
  }));
};
const groupOf = (entry: SourceEntry) => {
  const unit = clean(entry.payload.sheet) ? `sheet:${clean(entry.payload.sheet)}` : clean(entry.payload.table) ? `table:${clean(entry.payload.table)}` : '';
  return unit ? `${entry.document_id}:${unit}` : '';
};
const parentLocation = (value: string) => /^(m[oó]dulo|bloque|ciclo|sede|unidad infantil|secci[oó]n educativa)\b/i.test(value);
const locationHeader = (header: string) => /ubicaci[oó]n|localizaci[oó]n|sal[oó]n|aula|espacio|dependencia|(?:^|\s)area(?:\s|$)|bloque|m[oó]dulo|sede/i.test(header);
const responsibleHeader = (header: string) => /responsable|encargado|custodio|asignado a/i.test(header) && !/tercero responsable/i.test(header);
const isPlateHeader = (value: string) => ['placa', 'placa inventario', 'placa / activo', 'placa/activo', 'n° placa', 'no. placa', 'no placa'].includes(value);
const isDescriptionHeader = (value: string) => ['descripcion', 'descripcion placa / activo', 'detalle del activo', 'activos', 'activo', 'activoactivos'].includes(value);
const addPerson = (map: Map<string, PersonProposal>, person: PersonProposal) => {
  const name = clean(person.name).slice(0, 180);
  if (!name) return;
  const key = normalize(name);
  const previous = map.get(key);
  const position = clean(person.position).slice(0, 120) || 'Responsable según archivo';
  if (!previous || (previous.position === 'Responsable según archivo' && position !== previous.position)) map.set(key, { name: previous?.name || name, position });
};
const addLocation = (map: Map<string, LocationProposal>, location: LocationProposal) => {
  const name = clean(location.name).slice(0, 180);
  if (!name) return;
  const key = normalize(name);
  if (!map.has(key)) map.set(key, { name, block: clean(location.block).slice(0, 120) || 'Colegio' });
};
const canonicalLocation = (values: string[]): LocationProposal | undefined => {
  const unique = [...new Map(values.map(value => [normalize(value), clean(value)])).values()].filter(Boolean);
  if (!unique.length) return undefined;
  const parent = unique.find(parentLocation);
  const specific = unique.filter(value => normalize(value) !== normalize(parent || ''));
  const name = [...specific, ...(parent ? [parent] : [])].join(' · ').slice(0, 180);
  return { name, block: parent || 'Colegio' };
};

function actaCustodians(entries: SourceEntry[], documents: Map<string, SourceDocument>) {
  const grouped = new Map<string, SourceEntry[]>();
  for (const entry of entries) {
    const key = groupOf(entry);
    if (key) grouped.set(key, [...(grouped.get(key) || []), entry]);
  }
  const byDocument = new Map<string, Map<string, PersonProposal>>();
  for (const [group, rows] of grouped) {
    const documentId = rows[0].document_id;
    if (!documents.get(documentId)?.category.toLocaleLowerCase('es-CO').includes('acta')) continue;
    const ordered = rows.slice().sort((a, b) => a.ordinal - b.ordinal);
    for (const headerRow of ordered) {
      const header = cellsOf(headerRow);
      const indexes = new Map([...header].map(([key, value]) => [key, normalize(value)]));
      const nameKey = [...indexes].find(([, value]) => ['nombre y apellido', 'nombre completo', 'responsable'].includes(value))?.[0];
      const positionKey = [...indexes].find(([, value]) => ['cargo', 'dependencia', 'area o cargo'].includes(value))?.[0];
      if (!nameKey || !positionKey) continue;
      const signerMap = new Map<string, PersonProposal>();
      for (const row of ordered.filter(candidate => candidate.ordinal > headerRow.ordinal)) {
        const cells = cellsOf(row);
        const name = clean(cells.get(nameKey));
        const position = clean(cells.get(positionKey));
        if (name && position && normalize(name) !== normalize('NOMBRE Y APELLIDO')) signerMap.set(normalize(name), { name, position });
      }
      const doc = documents.get(documentId)!;
      const base = doc.path.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
      const titleTokens = normalize(base).split(/[^a-z0-9]+/).filter(token => token && !['acta', 'de', 'entrega', 'activos', 'activo', 'copia', 'final'].includes(token));
      if (!titleTokens.length) continue;
      let matches = [...signerMap.values()].filter(person => titleTokens.every(token => normalize(person.name).split(/[^a-z0-9]+/).includes(token)));
      // Some actas are named by a role or department rather than by the receiver's name.
      if (!matches.length && titleTokens.length === 1) matches = [...signerMap.values()].filter(person => normalize(person.position).split(/[^a-z0-9]+/).includes(titleTokens[0]));
      if (matches.length === 1) {
        const all = byDocument.get(documentId) || new Map<string, PersonProposal>();
        all.set(normalize(matches[0].name), matches[0]);
        byDocument.set(documentId, all);
      }
    }
  }
  return byDocument;
}

function fileLocation(document: SourceDocument, person?: PersonProposal): LocationProposal | undefined {
  const parts = document.path.split('/');
  const name = parts.at(-1)?.replace(/\.[^.]+$/, '') || '';
  if (/^activos por bloques y salones$/i.test(parts.at(-2) || '') && /^bloque\s/i.test(name)) return { name, block: 'Colegio' };
  if (!/^activos por bloques y salones$/i.test(parts.at(-2) || '') || !/^activos\s+/i.test(name)) return undefined;
  let area = name.replace(/^activos\s+/i, '');
  if (person) {
    const tokens = normalize(person.name).split(/[^a-z0-9]+/).filter(Boolean);
    for (const token of tokens) area = area.replace(new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`, 'ig'), ' ');
    area = area.replace(/\s+/g, ' ').trim();
  }
  // Only turn filenames into locations when the remaining words clearly name
  // a school space. This avoids mistaking an unrecognized person's name for a room.
  if (!area || normalize(area) === normalize(name) || !/\b(banda marcial|coliseo|enfermer[ií]a|orquesta|rector[ií]a|sala|secretar[ií]a|bodega|bloque|sal[oó]n|aula)\b/i.test(area)) return undefined;
  return { name: area, block: 'Áreas y salones' };
}

export function buildEnrichmentPlan(entries: SourceEntry[], sourceDocuments: SourceDocument[]): EnrichmentPlan {
  const documents = new Map(sourceDocuments.map(document => [document.id, document]));
  const groups = new Map<string, SourceEntry[]>();
  for (const entry of entries) {
    const key = groupOf(entry);
    if (key) groups.set(key, [...(groups.get(key) || []), entry]);
  }
  const headers = new Map<string, { people: string[]; locations: string[] }>();
  for (const [group, rows] of groups) {
    const ordered = rows.slice().sort((a, b) => a.ordinal - b.ordinal);
    for (const row of ordered) {
      const values = cellsOf(row);
      const normalized = [...values].map(([key, value]) => [key, normalize(value)] as const);
      const hasPlate = normalized.some(([, value]) => isPlateHeader(value));
      const hasDescription = normalized.some(([, value]) => isDescriptionHeader(value));
      if (!hasPlate || !hasDescription) continue;
      headers.set(group, {
        people: normalized.filter(([, value]) => responsibleHeader(value)).map(([key]) => key),
        locations: normalized.filter(([, value]) => locationHeader(value)).map(([key]) => key),
      });
      break;
    }
  }

  const custodianByActa = actaCustodians(entries, documents);
  const people = new Map<string, PersonProposal>();
  const locations = new Map<string, LocationProposal>();
  const assignments = new Map<string, SourceAssignment>();
  const byPlate = new Map<string, SourceAssignment[]>();
  const candidates = entries.filter(entry => entry.kind === 'asset_candidate');

  for (const entry of candidates) {
    const doc = documents.get(entry.document_id);
    if (!doc) continue;
    const cells = cellsOf(entry);
    const header = headers.get(groupOf(entry));
    const directPerson = header?.people.map(key => clean(cells.get(key))).find(Boolean);
    const assignedByActa = custodianByActa.get(entry.document_id);
    const actaPerson = assignedByActa?.size === 1 ? [...assignedByActa.values()][0] : undefined;
    const person = directPerson ? { name: directPerson, position: actaPerson && normalize(actaPerson.name) === normalize(directPerson) ? actaPerson.position : 'Responsable según archivo' } : actaPerson;
    const locationValues = header?.locations.map(key => clean(cells.get(key))).filter(Boolean) || [];
    const location = canonicalLocation(locationValues) || fileLocation(doc, person);
    const assignment: SourceAssignment = { ...(person ? { person } : {}), ...(location ? { location } : {}), ...(actaPerson ? { actaDocumentId: doc.id } : {}) };
    if (person) addPerson(people, person);
    if (location) addLocation(locations, location);
    assignments.set(entry.id, assignment);
    const proposal = entry.payload.asset_proposal as { plate_as_written?: unknown } | undefined;
    const plate = clean(proposal?.plate_as_written);
    if (plate && /^\d+(?:\.0)?$/.test(plate)) {
      const key = normalize(plate.replace(/\.0$/, ''));
      byPlate.set(key, [...(byPlate.get(key) || []), assignment]);
    }
  }

  for (const entry of candidates) {
    const assignment = assignments.get(entry.id) || {};
    const proposal = entry.payload.asset_proposal as { plate_as_written?: unknown } | undefined;
    const plate = clean(proposal?.plate_as_written).replace(/\.0$/, '');
    const matches = plate && /^\d+$/.test(plate) ? byPlate.get(normalize(plate)) || [] : [];
    const uniquePeople = new Map<string, PersonProposal>();
    const uniqueLocations = new Map<string, LocationProposal>();
    for (const candidate of matches) {
      if (candidate.person) uniquePeople.set(normalize(candidate.person.name), candidate.person);
      if (candidate.location) uniqueLocations.set(normalize(candidate.location.name), candidate.location);
    }
    const propagatedPerson = !assignment.person && uniquePeople.size === 1 ? [...uniquePeople.values()][0] : undefined;
    const propagatedLocation = !assignment.location && uniqueLocations.size === 1 ? [...uniqueLocations.values()][0] : undefined;
    const uniqueActas = new Set(matches.map(candidate => candidate.actaDocumentId).filter((id): id is string => !!id));
    const actaDocumentId = assignment.actaDocumentId || (uniqueActas.size === 1 ? [...uniqueActas][0] : undefined);
    const next = { ...assignment, ...(propagatedPerson ? { person: propagatedPerson } : {}), ...(propagatedLocation ? { location: propagatedLocation } : {}), ...(actaDocumentId ? { actaDocumentId } : {}) };
    if (propagatedPerson) addPerson(people, propagatedPerson);
    if (propagatedLocation) addLocation(locations, propagatedLocation);
    assignments.set(entry.id, next);
  }

  return { assignments, people, locations };
}
