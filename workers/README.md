# API de inventario en Cloudflare

La API protege los registros y los fragmentos de archivo en D1 detrás de autenticación propia. El navegador nunca recibe credenciales de base de datos ni puede conectarse directamente a D1. Los originales se parten en fragmentos de texto menores al límite por fila y se reconstruyen al abrirlos o descargarlos.

## Primer despliegue

1. Instala Wrangler con `pnpm install` y autentica la cuenta con `pnpm exec wrangler login`.
2. Crea la base con `pnpm exec wrangler d1 create comfenalco-activos` y guarda el `database_id` devuelto en `wrangler.jsonc`.
3. Aplica el esquema con `pnpm exec wrangler d1 migrations apply comfenalco-activos --remote`.
4. Define un secreto aleatorio `BOOTSTRAP_TOKEN` con `pnpm exec wrangler secret put BOOTSTRAP_TOKEN`.
5. Despliega con `pnpm exec wrangler deploy`, configura esa URL en Vercel como `VITE_API_URL` y vuelve a desplegar el frontend.
6. Crea la primera cuenta administradora llamando una vez a `POST /api/auth/setup` con el encabezado `X-Setup-Token`, el correo del administrador y una contraseña de al menos 12 caracteres. Luego elimina `BOOTSTRAP_TOKEN` con `pnpm exec wrangler secret delete BOOTSTRAP_TOKEN`.

En Cloudflare, D1 almacena los campos de texto/JSON y los originales codificados por fragmentos. La autenticación es independiente de Supabase.

## Pruebas locales

`pnpm exec wrangler d1 migrations apply comfenalco-activos --local`

`pnpm exec wrangler dev`
