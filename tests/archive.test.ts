import { describe,it,expect,vi } from 'vitest';
vi.mock('../src/repository',()=>({supabase:null}));
import { validateArchive,verifyOriginal,importPackage } from '../src/archive';
import type { ArchivePackage } from '../src/archive';
const documentId='c412d446-a0a9-45ed-a98e-46d7406f218b';
const rowId='dd679ab7-de74-4e9e-a63b-c9ad8f91d007';
function sample():ArchivePackage{return {format:'colegio-source-archive',version:1,documents:[{id:documentId,path:'Prueba.docx',sha256:'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',byte_size:3,format:'docx',category:'Acta',entry_count:1,extraction_status:'complete',original_base64:'YWJj'}],entries:[{id:rowId,document_id:documentId,ordinal:0,locator:'Párrafo 1',kind:'paragraph',payload:{paragraph:1},text:'abc'}]};}
describe('Integridad de la importación institucional',()=>{
 it('acepta un paquete completo',()=>expect(()=>validateArchive(sample())).not.toThrow());
 it('rechaza un original modificado antes de cargarlo',async()=>{const p=sample();await expect(verifyOriginal(p.documents[0],'YWJk')).rejects.toThrow('no coincide');await expect(verifyOriginal(p.documents[0],'YWJj')).resolves.toEqual(new Uint8Array([97,98,99]));});
 it('detecta filas faltantes',()=>{const p=sample();p.entries=[];expect(()=>validateArchive(p)).toThrow('Faltan filas');});
 it('detecta filas atribuidas a otro documento',()=>{const p=sample();p.entries[0].document_id='f782b93b-d571-4853-bb39-266ab7918829';expect(()=>validateArchive(p)).toThrow('filas inválidas');});
 it('no acepta filas ni posiciones duplicadas',()=>{const p=sample();p.entries.push({...p.entries[0],id:'f782b93b-d571-4853-bb39-266ab7918829'});p.documents[0].entry_count=2;expect(()=>validateArchive(p)).toThrow('filas inválidas');});
 it('no permite cargar documentos institucionales en modo demostración',async()=>{await expect(importPackage(sample(),()=>{})).rejects.toThrow('requiere Supabase');});
});
