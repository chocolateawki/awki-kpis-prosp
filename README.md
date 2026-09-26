# Funnel de prospección · DANO Miami

Reporte de gestión previa a deals (HubSpot) con ingreso manual de métricas mensuales por cliente.
Stack: HTML + JS estático · Supabase (datos y login por email) · GitHub · Vercel.

```
├── index.html              Interfaz
├── app.js                  Lógica, cálculos y conexión a Supabase
├── config.example.js       Plantilla de credenciales (local)
├── scripts/build-config.js Genera config.js en Vercel desde variables de entorno
├── supabase/schema.sql     Tablas, RLS y usuarios autorizados
├── vercel.json             Build y cabeceras de seguridad
└── assets/                 Logo, fondo y tipografías
```

Sin `config.js` la app funciona en **modo local** (datos solo en el navegador), útil para probar.

## 1. Supabase

1. Crea un proyecto en supabase.com.
2. En **SQL Editor**, pega y ejecuta `supabase/schema.sql`.
3. Autoriza a tu equipo (solo estos emails verán y editarán datos):
   ```sql
   insert into public.usuarios_permitidos (email) values ('tu.email@empresa.com');
   ```
4. En **Authentication → URL Configuration**:
   - Site URL: `https://TU-APP.vercel.app`
   - Redirect URLs: `https://TU-APP.vercel.app/**` y `http://localhost:3000/**`
5. En **Project Settings → API** copia la *Project URL* y la *anon / publishable key*.

> Nunca uses la `service_role` / secret key en el frontend.

## 2. GitHub

```bash
git init
git add .
git commit -m "Funnel de prospección DANO Miami"
git branch -M main
git remote add origin https://github.com/TU-ORG/dano-funnel.git
git push -u origin main
```

Usa un **repositorio privado**: incluye tipografías con licencia (Franie, Acumin).

## 3. Vercel

1. **Add New → Project** e importa el repositorio.
2. Framework Preset: **Other** (el build y la carpeta de salida ya están en `vercel.json`).
3. En **Environment Variables** agrega:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
4. Deploy. Cada push a `main` vuelve a desplegar.

## Desarrollo local

```bash
cp config.example.js config.js   # completa URL y key
npx serve -l 3000 .
```

## Datos

- `clientes`: marca del cliente (texto), seleccionable en el encabezado.
- `metricas_mensuales`: una fila por cliente y mes (`mes` = primer día del mes).
- Los borrados solo se hacen desde el panel de Supabase.
- Para reportes en SQL:
  ```sql
  select c.nombre, m.mes, m.p_agendadas, m.n_reuniones,
         round(m.p_descalificados::numeric / nullif(m.p_base,0) * 100, 1) as pct_descalificados
  from metricas_mensuales m join clientes c on c.id = m.cliente_id
  order by c.nombre, m.mes;
  ```
