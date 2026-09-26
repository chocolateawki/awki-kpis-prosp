-- =========================================================
-- Funnel de prospección · DANO Miami
-- Ejecutar completo en Supabase > SQL Editor
-- =========================================================

-- 1) Usuarios autorizados (solo estos emails pueden leer/escribir)
create table if not exists public.usuarios_permitidos (
  email text primary key,
  created_at timestamptz not null default now()
);

create or replace function public.es_usuario_permitido()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.usuarios_permitidos
    where lower(email) = lower(auth.jwt() ->> 'email')
  );
$$;

-- 2) Clientes (marca del cliente, solo texto)
create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique check (char_length(trim(nombre)) between 1 and 80),
  created_at timestamptz not null default now()
);

-- 3) Métricas mensuales por cliente
create table if not exists public.metricas_mensuales (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  mes date not null check (extract(day from mes) = 1),   -- primer día del mes

  -- Prospección
  p_base            integer check (p_base >= 0),
  p_descalificados  integer check (p_descalificados >= 0),
  p_contactados     integer check (p_contactados >= 0),
  p_emails          integer check (p_emails >= 0),
  p_llamadas        integer check (p_llamadas >= 0),
  p_conectadas      integer check (p_conectadas >= 0),
  p_abiertos        integer check (p_abiertos >= 0),
  p_respondieron    integer check (p_respondieron >= 0),
  p_agendadas       integer check (p_agendadas >= 0),
  p_realizadas      integer check (p_realizadas >= 0),
  p_meta            integer check (p_meta >= 0),

  -- Nutrición
  n_enviados    integer check (n_enviados >= 0),
  n_abiertos    integer check (n_abiertos >= 0),
  n_clics       integer check (n_clics >= 0),
  n_respuestas  integer check (n_respuestas >= 0),
  n_reuniones   integer check (n_reuniones >= 0),
  n_bajas       integer check (n_bajas >= 0),

  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  unique (cliente_id, mes)
);

create index if not exists metricas_cliente_mes_idx
  on public.metricas_mensuales (cliente_id, mes);

-- Mantener updated_at / updated_by al editar
create or replace function public.tocar_metricas()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists trg_tocar_metricas on public.metricas_mensuales;
create trigger trg_tocar_metricas
  before update on public.metricas_mensuales
  for each row execute function public.tocar_metricas();

-- 4) Seguridad a nivel de fila (RLS)
alter table public.usuarios_permitidos enable row level security;
alter table public.clientes            enable row level security;
alter table public.metricas_mensuales  enable row level security;

-- usuarios_permitidos: sin políticas = nadie la lee desde el navegador
-- (se administra solo desde el panel de Supabase)

drop policy if exists "clientes_lectura"   on public.clientes;
drop policy if exists "clientes_alta"      on public.clientes;
drop policy if exists "clientes_edicion"   on public.clientes;
create policy "clientes_lectura" on public.clientes
  for select to authenticated using (public.es_usuario_permitido());
create policy "clientes_alta" on public.clientes
  for insert to authenticated with check (public.es_usuario_permitido());
create policy "clientes_edicion" on public.clientes
  for update to authenticated using (public.es_usuario_permitido())
  with check (public.es_usuario_permitido());

drop policy if exists "metricas_lectura" on public.metricas_mensuales;
drop policy if exists "metricas_alta"    on public.metricas_mensuales;
drop policy if exists "metricas_edicion" on public.metricas_mensuales;
create policy "metricas_lectura" on public.metricas_mensuales
  for select to authenticated using (public.es_usuario_permitido());
create policy "metricas_alta" on public.metricas_mensuales
  for insert to authenticated with check (public.es_usuario_permitido());
create policy "metricas_edicion" on public.metricas_mensuales
  for update to authenticated using (public.es_usuario_permitido())
  with check (public.es_usuario_permitido());
-- Sin política de DELETE: los borrados solo desde el panel de Supabase.

-- 5) Autoriza a tu equipo (reemplaza por los emails reales)
-- insert into public.usuarios_permitidos (email) values
--   ('tu.email@empresa.com'),
--   ('otra.persona@empresa.com');
