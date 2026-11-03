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
- El formulario de activos no obliga a completar campos; lo que falte queda pendiente de validar.
- Buscar por descripción, placa, categoría o responsable y filtrar por estado/ubicación.
- Crear responsables y ubicaciones; consultar sus activos.
- Trasladar un registro completo y conservar antes/después.
- Historial automático al registrar o editar, control de versiones para evitar sobreescrituras.
- CSV compatible con Excel (separador punto y coma), reporte de novedades e impresión / PDF desde el navegador.
- Acceso por correo/contraseña con la API de Cloudflare; roles de consulta, edición y administración.

**Archivos del colegio:** sección exclusiva para administradores. Muestra los 55 documentos originales de forma legible; permite abrir PDF y Word en el navegador y conservar la descarga del original. Las hojas de cálculo se consultan mediante el texto extraído. Ya no muestra coordenadas internas ni bloques JSON en la pantalla.

**Importación guiada:** los 4.642 registros detectados se pueden agregar al inventario con una fecha de próxima revisión elegida por el administrador. Cada registro queda como «Por validar»; no se inventan placas, estados, ubicaciones ni responsables. Se conservan todos los campos de origen, las repeticiones y los datos que requieren conciliación. La importación se puede reintentar sin duplicar filas.

**Actas:** cada ficha permite vincular un acta del archivo original o adjuntar un PDF, Word o imagen de hasta 20 MB. Administradores pueden consultar el contenido dentro del sistema y descargar el archivo original. Los archivos se guardan en D1 como fragmentos de texto.

**Generación de actas:** la sección Actas parte de la plantilla individual compartida y conserva su encabezado institucional, memorando, compromisos, próxima reunión y cuadro de firmas. Carga los activos vinculados a la persona para que se elijan los bienes que se entregan; el sistema añade la relación seleccionada como anexo editable en el mismo Word. Los registros «Por validar», «No encontrado» y «Pendiente de baja» se excluyen inicialmente y se pueden incluir de forma manual después de confirmarlos. El tratamiento «Señor/Señora», la cédula, la fecha y, opcionalmente, el número de acta se completan antes de generar. La vista previa aparece dentro de la aplicación y el DOCX se descarga con espacios para firmar a mano. Para PDF, abre el DOCX en Word y usa Guardar como PDF. La firma digital y el almacenamiento de actas nuevas en el archivo institucional no están implementados.

**Pendiente:** conciliación institucional de las propuestas, aprobación formal de bajas, firma digital, almacenamiento de las actas recién generadas en el archivo institucional, fotos, edición de catálogos, paginación del inventario confirmado y recuperación de contraseña desde la aplicación. Documentos sí tiene paginación desde la base de datos. Pendiente de baja es un estado de seguimiento, no una aprobación. La impresión de reportes es un listado de inventario, independiente del acta de entrega.

## Datos y documentos en Cloudflare

La arquitectura activa usa **D1 para todo**: activos, responsables, ubicaciones, movimientos, texto extraído y originales de los documentos. Los originales se codifican en fragmentos pequeños dentro de D1; la API los reconstruye solo después de autenticar a un administrador. Esto conserva la vista previa de Word/PDF sin agregar un servicio de almacenamiento con suscripción propia. La API está en Cloudflare Workers y exige inicio de sesión y rol antes de leer o cambiar información. Las variables públicas del frontend solo contienen la URL de la API. Los SQL de `supabase/` son archivos heredados de una arquitectura anterior; no se ejecutan para desplegar ni operar la versión actual.

El paquete de importación que se preparó para el colegio está fuera del repositorio, en `../preparacion-importacion/importacion-colegio.json`: 55 originales, 7.484 fragmentos y 4.642 filas candidatas a activo. No es un conteo de bienes únicos. El paquete ocupa aproximadamente 13,5 MB y sus originales 5,7 MB. Las filas candidatas entran como **Por validar**, con responsables, ubicaciones y actas asociadas cuando la fuente permite resolverlos. El administrador elige la fecha de revisión al importar. No se debe copiar el paquete ni los documentos a `public/`, `dist/` o Git.

### Aprovisionar el servicio

Conectar la cuenta Cloudflare en esta máquina y ejecutar desde esta carpeta:

```sh
pnpm install --frozen-lockfile
pnpm exec wrangler login
pnpm exec wrangler d1 create comfenalco-activos
```

El `database_id` devuelto debe quedar en `wrangler.jsonc`. Después ejecutar:

```sh
pnpm exec wrangler d1 migrations apply comfenalco-activos --remote
pnpm exec wrangler secret put BOOTSTRAP_TOKEN
pnpm exec wrangler deploy
```

Luego configurar la URL `https://comfenalco-activos-api.<cuenta>.workers.dev` como `VITE_API_URL` en el proyecto Vercel y volver a desplegar el frontend. La primera cuenta se crea una sola vez llamando `POST /api/auth/setup` con el secreto temporal `X-Setup-Token`, correo y contraseña segura; después se elimina el secreto con `pnpm exec wrangler secret delete BOOTSTRAP_TOKEN`. No hay registro público.

La base D1 queda guardada al terminar las consultas; no depende de mantener un servidor encendido. El plan gratuito publicado actualmente incluye hasta 500 MB por base de datos y 5 GB totales, con límites diarios de lectura/escritura; Workers limita además las solicitudes gratuitas. Cada fragmento de archivo queda por debajo del máximo de 2 MB por fila de D1. Si se exceden los límites diarios, las consultas pueden fallar hasta que se restablezcan; los datos guardados no se borran.

### Importar el archivo del colegio

Una vez que exista la cuenta administradora, entrar a **Documentos**, seleccionar el paquete privado `importacion-colegio.json` y escoger la fecha de próxima revisión. La importación es reintentable; al terminar debe mostrar 55 documentos originales y 7.484 fragmentos, y dejar los registros candidatos pendientes de validar. El archivo original se verifica con SHA-256 antes de guardarlo en D1.

La demo local permanece disponible cuando `VITE_API_URL` no está definida; usa información ficticia en el navegador. Para apuntar el desarrollo local al Worker, ejecutar `pnpm dev:api` y configurar `VITE_API_URL=http://127.0.0.1:8787` en `.env.local`.

## Publicación

El frontend sigue en Vercel; Render solo se conserva como configuración alternativa de sitio estático. La API y la base viven en Cloudflare. No publicar un frontend con `VITE_API_URL` apuntando a una base nueva vacía antes de completar el aprovisionamiento y la importación.

## Verificar

```sh
pnpm test
pnpm build
```

Las pruebas cubren duplicidad de placas, unidades/lotes, conflictos de edición, referencias inválidas, historial de traslado y neutralización de fórmulas en CSV. Las reglas de acceso se aplican en el Worker de Cloudflare y en la base D1.

## Identidad visual

Verde principal `#006830`, acento `#95BF0C`, verde lima `#BFD730`, tomados del CSS público del colegio. Escudo obtenido de la web institucional, sin redibujarlo. Fuentes DM Sans y Manrope con alternativas del sistema.

- Sitio: https://colegiocomfenalcoibague.edu.co/
- Paleta: https://colegiocomfenalcoibague.edu.co/wp-content/uploads/elementor/css/post-5.css
- Escudo: https://colegiocomfenalcoibague.edu.co/wp-content/uploads/2023/10/LOGO_COLEGIO_IBAGU-300x267-1.png
- Cloudflare Workers: https://developers.cloudflare.com/workers/
- Cloudflare D1: https://developers.cloudflare.com/d1/

Los archivos fuente del inventario no se modificaron. Sus copias están en las tablas protegidas de D1 y no se incluyen en el código estático de la aplicación.
