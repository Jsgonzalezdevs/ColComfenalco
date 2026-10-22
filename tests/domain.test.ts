import { describe,it,expect } from 'vitest';
import { createDemo } from '../src/demo';
import { saveLocal,validateAsset,csvCell,inventoryCsv } from '../src/domain';
describe('Reglas del inventario',()=>{
 it('impide placas duplicadas sin importar mayúsculas o espacios',()=>{const d=createDemo();expect(()=>validateAsset({...d.assets[1],plate:' demo-001 '},d.assets)).toThrow('ya está registrada');});
 it('conserva origen y destino y aumenta la versión al trasladar',()=>{const d=createDemo(),original=d.assets[0];const n=saveLocal(d,{...original,location_id:d.locations[4].id,last_action:'Traslado',action_note:'Reubicación'});expect(n.movements[0].before?.location_id).toBe(original.location_id);expect(n.movements[0].after.location_id).toBe(d.locations[4].id);expect(n.assets[0].version).toBe(2);expect(d.assets[0].version).toBe(1);});
 it('rechaza una edición basada en una versión anterior',()=>{const d=createDemo();const n=saveLocal(d,{...d.assets[0],notes:'primera edición'});expect(()=>saveLocal(n,d.assets[0])).toThrow('cambió');});
 it('separa placa individual de cantidades por lote',()=>{const d=createDemo();expect(()=>validateAsset({...d.assets[0],quantity:2},d.assets)).toThrow('cantidad 1');expect(()=>validateAsset({...d.assets[0],quantity:0},d.assets)).toThrow('entero');expect(()=>validateAsset({...d.assets[0],quantity:1.5},d.assets)).toThrow('entero');});
 it('evita ejecutar fórmulas en el CSV exportado',()=>{expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');expect(csvCell('  +1')).toContain("'");expect(inventoryCsv(createDemo())).toContain('SIN PLACA');});
 it('rechaza referencias a responsables inexistentes',()=>{const d=createDemo();expect(()=>saveLocal(d,{...d.assets[0],person_id:'inexistente'})).toThrow('responsable');});
});
