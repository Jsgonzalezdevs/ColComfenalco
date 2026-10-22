import type { Data, Asset } from './domain';
const locations = [ ['Secretaría', 'Administrativo'], ['Sala de sistemas', 'Bloque 1'], ['Salón 101', 'Bloque 2'], ['Biblioteca', 'Bloque 3'], ['Bodega', 'Servicios generales'], ['Banda marcial', 'Cultural'] ].map(([name,block]) => ({ id: crypto.randomUUID(), name, block }));
const people = [['Responsable de secretaría','Secretaría'],['Responsable de tecnología','Docente'],['Responsable de biblioteca','Biblioteca'],['Responsable de mantenimiento','Servicios generales']].map(([name,position]) => ({id:crypto.randomUUID(),name,position}));
const entries = [
 ['DEMO-001','Computador de escritorio','Tecnología',1,1,1,'Bueno'],
 ['DEMO-002','Televisor de 42 pulgadas','Audiovisuales',2,1,1,'Regular'],
 [null,'Silla plástica azul','Mobiliario',2,0,32,'Bueno'],
 ['DEMO-003','Video proyector','Audiovisuales',1,1,1,'No encontrado'],
 ['DEMO-004','Escritorio de madera','Mobiliario',0,0,1,'Bueno'],
 ['DEMO-005','Ventilador de pared','Equipos',2,3,1,'Deteriorado'],
 [null,'Tambor de marcha','Instrumentos',5,3,6,'Bueno'],
 ['DEMO-006','Archivador metálico','Mobiliario',4,3,1,'Pendiente de baja'],
 ['DEMO-007','Computador portátil','Tecnología',3,2,1,'Bueno'],
 [null,'Mesa de trabajo','Mobiliario',4,3,4,'Regular'],
] as const;
export function createDemo(): Data {
 const now = new Date().toISOString();
 const assets: Asset[] = entries.map(([plate,name,category,l,p,quantity,status])=>({id:crypto.randomUUID(),plate,name,category,location_id:locations[l].id,person_id:people[p].id,quantity,status,notes:'Registro ficticio para explorar el sistema.',version:1,last_action:'Registro',action_note:'Carga de demostración',created_at:now,updated_at:now}));
 return {assets,people,locations,movements:[]};
}
