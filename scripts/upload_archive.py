"""Upload and verify through the authenticated admin API; never needs service_role.
Usage: python upload_archive.py SESSION_JSON PACKAGE_JSON REPORT_JSON
SESSION_JSON is a temporary, mode-600 file outside the repository.
"""
import base64
import hashlib
import json
import sys
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path


def upload(session_path, package_path, report_path):
    session = json.loads(session_path.read_text())
    package = json.loads(package_path.read_text())
    headers = {'apikey': session['key'], 'Authorization': 'Bearer ' + session['session']['access_token'], 'Content-Type': 'application/json'}

    def request(path, data=None):
        payload = None if data is None else json.dumps(data, ensure_ascii=False, allow_nan=False).encode()
        try:
            with urllib.request.urlopen(urllib.request.Request(session['base'] + '/rest/v1/' + path, data=payload, headers=headers), timeout=60) as result:
                body = result.read()
                return json.loads(body) if body else None
        except urllib.error.HTTPError as error:
            detail = json.loads(error.read())
            raise RuntimeError(f'API {error.code}: {detail.get("message", "Error de acceso")}') from None

    uid = session['session']['user']['id']
    member = request('members?select=role&user_id=eq.' + uid)
    if member != [{'role': 'admin'}]:
        raise RuntimeError('La cuenta temporal aún no tiene rol admin.')
    existing = request('archive_documents?select=id,sha256,entry_count&limit=1000')
    print(f'Administrador verificado. Documentos archivados antes de iniciar: {len(existing)}', flush=True)
    grouped = defaultdict(list)
    for entry in package['entries']:
        grouped[entry['document_id']].append(entry)
    for index, doc in enumerate(package['documents'], 1):
        raw = base64.b64decode(doc['original_base64'])
        assert len(raw) == doc['byte_size'] and hashlib.sha256(raw).hexdigest() == doc['sha256']
        response = request('rpc/import_archive_document', {'document': doc, 'entries': grouped[doc['id']]})
        assert response == doc['id'], 'La función devolvió otro documento.'
        if index % 5 == 0 or index == len(package['documents']):
            print(f'Cargados {index}/{len(package["documents"])} archivos', flush=True)
    stored = request('archive_documents?select=id,path,sha256,byte_size,format,category,entry_count,extraction_status&limit=1000')
    by_id = {doc['id']: doc for doc in stored}
    for doc in package['documents']:
        expected = {key: value for key, value in doc.items() if key != 'original_base64'}
        assert by_id.get(doc['id']) == expected, 'Los metadatos no coinciden.'
        original = request('archive_originals?select=original_base64&document_id=eq.' + doc['id'])
        assert len(original) == 1 and base64.b64decode(original[0]['original_base64']) == base64.b64decode(doc['original_base64']), 'El original descargado no coincide.'
    print('Verificados los 55 originales y sus huellas SHA-256 en la base remota.', flush=True)
    remote = {}
    offset = 0
    while True:
        batch = request(f'archive_entries?select=id,document_id,ordinal,locator,kind,payload,text&order=id&offset={offset}&limit=1000')
        if not batch:
            break
        remote.update({entry['id']: entry for entry in batch})
        offset += len(batch)
    for entry in package['entries']:
        assert remote.get(entry['id']) == entry, 'Una fila remota no coincide con la extracción.'
    result = {'project_ref': session['base'].split('//')[1].split('.')[0], 'documents_verified': len(package['documents']), 'originals_verified_byte_for_byte': len(package['documents']), 'entries_verified': len(package['entries']), 'asset_candidate_rows': sum(e['kind']=='asset_candidate' for e in package['entries']), 'remote_total_entries': len(remote), 'admin_role_verified': True, 'status': 'verified'}
    report_path.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    upload(*[Path(arg) for arg in sys.argv[1:4]])
