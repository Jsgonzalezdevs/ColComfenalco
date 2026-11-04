import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import type { Asset, Data, Person } from './domain';
import { formatLocation } from './domain';

export type ActaDetails = {
  recipient: Person;
  recipientId: string;
  treatment: 'Señor' | 'Señora';
  actNumber: string;
  date: string;
  assets: Asset[];
};

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function dateParts(value: string) {
  const [year, month, day] = value.split('-');
  const monthNumber = Number(month);
  if (!year || !day || !MONTHS[monthNumber - 1]) throw new Error('Selecciona una fecha válida.');
  return {
    day,
    month,
    year,
    dateText: `${Number(day)} de ${MONTHS[monthNumber - 1]} de ${year}`,
  };
}

function positionWithArticle(details: ActaDetails) {
  const position = details.recipient.position.trim();
  const article = details.treatment === 'Señora' ? 'La' : 'El';
  return `${article} ${position || 'responsable de los activos'}`;
}

export function actaFilename(details: ActaDetails) {
  const slug = details.recipient.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-CO').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `acta-entrega-activos-${slug || 'responsable'}.docx`;
}

export async function createActaDocx(details: ActaDetails, data: Data): Promise<Blob> {
  const response = await fetch('/acta-entrega-template.docx');
  if (!response.ok) throw new Error('No fue posible cargar el formato institucional del acta.');
  const zip = new PizZip(await response.arrayBuffer());
  const doc = new Docxtemplater(zip, {
    delimiters: { start: '{{', end: '}}' },
    paragraphLoop: true,
    linebreaks: true,
  });
  const date = dateParts(details.date);
  const recipientName = details.recipient.name.trim().toLocaleUpperCase('es-CO');
  const recipientRoleUpper = details.recipient.position.trim().toLocaleUpperCase('es-CO');
  const recipientRolePhrase = positionWithArticle(details);
  const locations = new Map(data.locations.map(location => [location.id, formatLocation(location)]));

  doc.render({
    recipientName,
    recipientId: details.recipientId.trim(),
    treatmentPhrase: details.treatment === 'Señora' ? 'a la señora' : 'al señor',
    identityWord: details.treatment === 'Señora' ? 'Identificada' : 'Identificado',
    recipientRolePhrase,
    recipientRoleUpper,
    recipientPosition: details.recipient.position.trim(),
    actNumber: details.actNumber.trim(),
    ...date,
    assets: details.assets.map(asset => ({
      plate: asset.plate?.trim() || (asset.source_data?.plate_enabled === true ? '' : 'SIN PLACA'),
      description: asset.name.trim(),
      category: asset.category?.trim() || 'Sin clasificar',
      location: asset.location_id ? locations.get(asset.location_id) || 'Sin ubicación registrada' : 'Sin ubicación registrada',
      status: asset.status,
      quantity: String(asset.quantity),
    })),
  });

  return doc.getZip().generate({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
