# Activos · Colegio Comfenalco Ibagué

Aplicación web en React, TypeScript y Vite. Versión inicial 0.2.0. Compatible con navegadores modernos en Windows y macOS; diseño adaptable a pantallas pequeñas.

## Ejecutar

Instalar Node.js 22.12 o superior y pnpm 11.25.0. Desde esta carpeta:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

También puede instalarse con `npm install` y ejecutarse con `npm run dev`. El lockfile de referencia es `pnpm-lock.yaml`.

Sin variables de entorno abre una **demostración con información ficticia** y persistencia en localStorage. No usar esta modalidad como registro oficial: depende del navegador y puede perderse al borrar sus datos. La exportación JSON permite conservar una copia de lo visible, pero todavía no hay restauración desde la interfaz.

## Funciones implementadas

- Panel con unidades, registros, estados y distribución por área.
- Crear y editar activos con placa individual o lotes sin placa.
- Buscar por descripción, placa, categoría o responsable y filtrar por estado/ubicación.
- Crear responsables y ubicaciones; consultar sus activos.
- Trasladar un registro completo y conservar antes/después.
- Historial automático al registrar o editar, control de versiones para evitar sobreescrituras.
- CSV compatible con Excel (separador punto y coma), reporte de novedades e impresión / PDF desde el navegador.
- Acceso por correo/contraseña cuando se configura Supabase; roles viewer, editor y admin.

**Archivos del colegio:** sección exclusiva para administradores. Muestra los 55 documentos originales de forma legible; permite abrir PDF y Word en el navegador y conservar la descarga del original. Las hojas de cálculo se consultan mediante el texto extraído. Ya no muestra coordenadas internas ni bloques JSON en la pantalla.

**Importación guiada:** los 4.642 registros detectados se pueden agregar al inventario con una fecha de próxima revisión elegida por el administrador. Cada registro queda como «Por validar»; no se inventan placas, estados, ubicaciones ni responsables. Se conservan todos los campos de origen, las repeticiones y los datos que requieren conciliación. La importación se puede reintentar sin duplicar filas.

**Actas:** cada ficha permite vincular un acta del archivo original o adjuntar un PDF, Word o imagen de hasta 20 MB. Administradores pueden consultar el contenido dentro del sistema y descargar el archivo original. Los documentos nuevos se guardan en un bucket privado.

**Pendiente:** conciliación institucional de las propuestas, aprobación formal de bajas, actas institucionales nuevas, firmas, fotos, edición de catálogos, paginación del inventario confirmado y recuperación de contraseña desde la aplicación. Documentos sí tiene paginación desde la base de datos. Pendiente de baja es un estado de seguimiento, no una aprobación. La impresión es un listado de inventario, no un acta de entrega.

## Archivo completo de las fuentes

El 22 de octubre de 2026 se cargaron y verificaron en el proyecto de la aplicación **55 originales y 7.484 fragmentos**, incluidos los dos Excel antiguos `.xls` y las imágenes con texto de los Word. Se identificaron 4.642 filas que podrían describir activos; esta cifra no es un total de bienes únicos. Las copias temporales `~$` de Office no son documentos fuente y se excluyeron (3 archivos). Los originales locales no se modificaron.

Las tablas `archive_documents`, `archive_originals` y `archive_entries` tienen RLS y acceso exclusivo para `members.role = 'admin'`. No se conceden permisos de modificación o eliminación de documentos ya archivados. El RPC `import_archive_document` es SECURITY INVOKER, valida el original y sus filas en una sola transacción por documento y permite reintentar el mismo paquete sin duplicarlo. Un paquete interrumpido puede reanudarse. El archivo original completo se guarda codificado en base64, incluso si tiene elementos que el extractor no interpreta.

Para un proyecto nuevo, ejecutar primero `supabase/setup.sql` y luego `supabase/archive.sql`, una sola vez. La actualización aditiva `supabase/review_and_documents.sql` habilita los registros pendientes, las fechas de revisión y los documentos privados por activo; ya fue aplicada en el proyecto actual. Los archivos originales y paquetes de importación contienen información interna: **no copiarlos a `public/`, `dist/` ni al repositorio**. La interfaz recibe los datos después de autenticar y autorizar al administrador.

Herramientas de preparación: `scripts/prepare_import.py` usa Python con openpyxl, xlrd 2.0.2, python-docx y pypdf. Acepta carpeta fuente, carpeta de salida privada y, opcionalmente, el JSONL de OCR generado con `scripts/ocr_images.swift` (macOS Vision; requiere un SDK compatible con el compilador). La extracción conserva los valores, las fórmulas Excel y las coordenadas de origen; el OCR se marca siempre para revisión. Las propuestas no eligen entre descripciones contradictorias ni resuelven responsables o traslados por su cuenta.

`scripts/upload_archive.py` carga el paquete con una sesión temporal de administrador desde fuera del repositorio y después compara todos los originales y filas descargados contra el paquete local. No necesita una clave service_role. `scripts/check_archive_sql.mjs` verifica con PostgreSQL local/PGlite la carga íntegra, reintentos, rechazo de alteraciones y acceso denegado a viewer, no miembro y anon. También se verificó en la API real que los visitantes sin sesión no pueden consultar las tres tablas.

## Conectar Supabase

1. Crear un proyecto nuevo. Ejecutar `supabase/setup.sql` en SQL Editor, una sola vez. El script es de instalación, no una migración incremental; no ejecutarlo sobre un proyecto con tablas del mismo nombre.
2. En Authentication, deshabilitar el registro público y los inicios anónimos. Crear/invitar los usuarios autorizados desde el panel de Supabase. Si se usa invitación, completar el flujo de contraseña en un cliente que lo soporte; esta versión solo implementa ingreso con contraseña ya establecida.
3. Copiar el UUID del usuario y autorizarlo desde SQL Editor:

```sql
insert into public.members (user_id, role)
values ('UUID-DEL-USUARIO', 'admin');
```

Roles: `viewer` consulta y exporta; `editor` y `admin` registran y actualizan. La gestión de miembros queda exclusivamente en el panel/SQL; no hay interfaz administrativa de roles todavía.

4. Copiar `.env.example` a `.env.local` y completar:

```env
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=TU-CLAVE-PUBLICABLE
```

Usar la clave **publishable**. Nunca poner `service_role`, claves secretas o contraseña de la base de datos en el frontend. Reiniciar el servidor después de cambiar las variables.
5. Ingresar, crear una ubicación y un responsable, registrar un activo, trasladarlo y comprobar el historial. La base compartida inicia vacía y nunca recibe automáticamente los datos de demostración.

### Seguridad y verificación pendiente

Todas las tablas tienen RLS. Los usuarios solo acceden si están en `members`; nadie puede autoasignarse un rol desde la API. No hay permisos de borrado de activos ni escritura directa del historial. El disparador privado escribe la bitácora en la misma transacción, fija usuario/fecha y exige una versión consecutiva. El cliente actualiza con el filtro `id + version` para detectar conflictos.

Antes de uso institucional del inventario consolidado, completar las pruebas de editor con escritura, bitácora inmutable, traslado y conflicto entre dos sesiones contra la instancia real. El archivo documental ya fue cargado y verificado con acceso admin y bloqueo anónimo. Las políticas de viewer/no miembro y la integridad del RPC de archivo también se probaron en PostgreSQL local. Quedan pendientes los asesores de Supabase: la conexión MCP disponible no tiene acceso a este proyecto. No se requiere un servidor Render adicional para esta arquitectura.

## Publicar en Vercel

- Subir solamente esta carpeta como repositorio, sin `.env.local` ni documentos originales.
- Si se sube la carpeta padre, elegir `inventario-comfenalco` como Root Directory.
- Framework: Vite; build `pnpm build`; salida `dist`; Node 22.12+ (preferiblemente 24 LTS compatible con el alojamiento).
- Definir las dos variables VITE anteriores antes de compilar. `vercel.json` contiene la configuración base.
- En Supabase Auth, configurar Site URL con la URL publicada. No configurar variables secretas en el navegador.
- Volver a desplegar si cambian las variables: Vite las incorpora durante la compilación.

## Alternativa Render

`render.yaml` describe un Static Site. Seleccionar esta carpeta como raíz si el repositorio contiene más carpetas. Configurar las mismas variables. **Elegir Vercel o Render para la web**; Supabase proporciona base de datos y autenticación. Mantener ambos alojamientos no aporta funcionalidad a esta primera versión.

## Verificar

```sh
pnpm test
pnpm build
```

Las pruebas cubren duplicidad de placas, unidades/lotes, conflictos de edición, referencias inválidas, historial de traslado y neutralización de fórmulas en CSV. No sustituyen las pruebas de políticas en Supabase.

## Identidad visual

Verde principal `#006830`, acento `#95BF0C`, verde lima `#BFD730`, tomados del CSS público del colegio. Escudo obtenido de la web institucional, sin redibujarlo. Fuentes DM Sans y Manrope con alternativas del sistema.

- Sitio: https://colegiocomfenalcoibague.edu.co/
- Paleta: https://colegiocomfenalcoibague.edu.co/wp-content/uploads/elementor/css/post-5.css
- Escudo: https://colegiocomfenalcoibague.edu.co/wp-content/uploads/2023/10/LOGO_COLEGIO_IBAGU-300x267-1.png
- Auth: https://supabase.com/docs/guides/auth/quickstarts/react
- RLS: https://supabase.com/docs/guides/database/postgres/row-level-security

Los archivos fuente del inventario no se modificaron. Sus copias están en las tablas protegidas de Supabase y no se incluyen en el código estático de la aplicación.
