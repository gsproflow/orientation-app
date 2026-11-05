-- =====================================================================
--  Alumni GSJC Rabat : base de données (Supabase / PostgreSQL)
--  Étape 1 : inscription, profil + photo, validation par le CPE.
--
--  À COLLER EN ENTIER dans Supabase > SQL Editor > New query > Run.
--  Le script peut être relancé sans danger (il ne supprime aucune donnée).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Table des profils
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  email            text not null,
  role             text not null default 'member' check (role in ('member','admin')),
  status           text not null default 'draft'  check (status in ('draft','pending','approved','rejected')),
  member_type      text not null default 'alumni' check (member_type in ('alumni','student','staff')),

  first_name       text check (char_length(first_name) between 1 and 80),
  last_name        text check (char_length(last_name)  between 1 and 80),

  -- Anciens élèves
  graduation_year  int  check (graduation_year between 1990 and 2100),
  country          text check (char_length(country) <= 80),
  city             text check (char_length(city) <= 80),
  school           text check (char_length(school) <= 150),
  program          text check (char_length(program) <= 150),

  -- Lycéens
  class_level      text check (class_level in ('Seconde','Première','Terminale')),
  target_program   text check (char_length(target_program) <= 150),

  -- Personnel
  job_title        text check (char_length(job_title) <= 120),

  -- Réseaux sociaux (Instagram : identifiant seul ; LinkedIn : lien https)
  instagram        text check (instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  linkedin         text check (char_length(linkedin) <= 200
                               and linkedin ~* '^https://([a-z0-9-]+\.)?linkedin\.com/[^[:space:]]+$'),

  photo_path       text check (char_length(photo_path) <= 200),

  -- Modes de contact acceptés
  contact_email    boolean not null default false,
  contact_message  boolean not null default false,
  contact_chat     boolean not null default false,

  -- Ce que les autres membres peuvent voir
  show_photo       boolean not null default true,
  show_email       boolean not null default false,
  show_social      boolean not null default true,
  show_location    boolean not null default true,
  show_study       boolean not null default true,

  consent_at       timestamptz,          -- date du consentement RGPD
  review_note      text check (char_length(review_note) <= 1000),
  reviewed_by      uuid references auth.users(id) on delete set null,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists profiles_status_idx on public.profiles (status, updated_at desc);

-- Une photo doit toujours se trouver dans le dossier de son propriétaire.
do $$
begin
  alter table public.profiles
    add constraint profiles_photo_owner
    check (photo_path is null or photo_path like id::text || '/%');
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------
-- 2. Messages entre l'administration et un candidat
-- ---------------------------------------------------------------------
create table if not exists public.admin_messages (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  from_admin  boolean not null default false,
  sender_id   uuid default auth.uid() references auth.users(id) on delete set null,
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);

create index if not exists admin_messages_user_idx on public.admin_messages (user_id, created_at);

-- ---------------------------------------------------------------------
-- 3. Fonctions utilitaires
-- ---------------------------------------------------------------------
-- Vrai si la personne connectée est un administrateur validé.
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and status = 'approved'
  );
$$;

-- Vérifie qu'un profil est complet (champs + photo + consentement obligatoires).
create or replace function public.assert_profile_complete(p public.profiles)
returns void
language plpgsql
as $$
begin
  if coalesce(p.first_name,'') = '' or coalesce(p.last_name,'') = ''
     or p.photo_path is null or p.photo_path not like p.id::text || '/%'
     or p.consent_at is null then
    raise exception 'Profil incomplet : nom, prénom, photo et consentement sont obligatoires';
  end if;

  if p.member_type = 'alumni' and (
       p.graduation_year is null
       or coalesce(p.country,'') = '' or coalesce(p.city,'') = ''
       or coalesce(p.school,'')  = '' or coalesce(p.program,'') = ''
       or (p.linkedin is null and p.instagram is null)) then
    raise exception 'Profil incomplet : renseignez toutes les informations d''études et un réseau social';
  end if;

  if p.member_type = 'student' and (
       p.class_level is null or coalesce(p.target_program,'') = '') then
    raise exception 'Profil incomplet : renseignez votre classe et votre projet d''orientation';
  end if;

  if p.member_type = 'staff' and coalesce(p.job_title,'') = '' then
    raise exception 'Profil incomplet : renseignez votre fonction';
  end if;
end;
$$;

-- Crée automatiquement un profil vide à chaque nouveau compte.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  mt text := coalesce(new.raw_user_meta_data->>'member_type', 'alumni');
begin
  if mt not in ('alumni','student','staff') then mt := 'alumni'; end if;
  insert into public.profiles (id, email, member_type) values (new.id, new.email, mt);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Empêche un membre de se valider lui-même ou de modifier ses droits.
create or replace function public.guard_profile()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  new.updated_at := now();

  -- Éditeur SQL / service interne : aucune restriction.
  if auth.uid() is null then
    return new;
  end if;

  -- Administrateur : peut tout modifier ; la décision est horodatée.
  if public.is_admin() then
    if new.status is distinct from old.status and new.status in ('approved','rejected') then
      new.reviewed_by := auth.uid();
      new.reviewed_at := now();
    end if;
    return new;
  end if;

  -- Membre ordinaire.
  if new.id <> old.id or new.email <> old.email or new.role <> old.role
     or new.review_note is distinct from old.review_note
     or new.reviewed_by is distinct from old.reviewed_by
     or new.reviewed_at is distinct from old.reviewed_at then
    raise exception 'Modification non autorisée';
  end if;

  if new.status is distinct from old.status then
    if not (old.status in ('draft','rejected') and new.status = 'pending') then
      raise exception 'Changement de statut non autorisé';
    end if;
  end if;

  if old.status = 'approved' and new.member_type <> old.member_type then
    raise exception 'Le type de compte ne peut plus être modifié';
  end if;

  if new.status in ('pending','approved') then
    perform public.assert_profile_complete(new);
  end if;

  return new;
end;
$$;

drop trigger if exists guard_profile on public.profiles;
create trigger guard_profile
  before update on public.profiles
  for each row execute function public.guard_profile();

-- Droit à l'effacement : la personne supprime elle-même son compte.
-- (La photo est supprimée par l'application avant cet appel.)
create or replace function public.delete_my_account()
returns void
language plpgsql security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'Non connecté';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------
-- 4. Règles de sécurité (Row Level Security)
-- ---------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.admin_messages enable row level security;

-- Profils : chacun voit et modifie le sien ; l'administration voit tout.
-- (L'annuaire entre membres viendra à l'étape suivante, via une vue
--  qui respecte les choix de visibilité de chacun.)
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using      (id = (select auth.uid()) or public.is_admin())
  with check (id = (select auth.uid()) or public.is_admin());

-- Messages : visibles par le candidat concerné et par l'administration.
drop policy if exists messages_select on public.admin_messages;
create policy messages_select on public.admin_messages
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

drop policy if exists messages_insert on public.admin_messages;
create policy messages_insert on public.admin_messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and (
      (from_admin = true  and public.is_admin())
      or (from_admin = false and user_id = (select auth.uid()))
    )
  );

-- ---------------------------------------------------------------------
-- 5. Stockage des photos (privé : visibles seulement via lien temporaire)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists avatars_select on storage.objects;
create policy avatars_select on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars'
         and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_admin()));

drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars'
              and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects
  for update to authenticated
  using      (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------
-- 6. Annuaire des alumni (étape 2)
--    Le serveur applique les choix de visibilité de chacun : un champ
--    masqué n'est JAMAIS envoyé aux autres membres.
--    Seuls les alumni validés sont listés (les lycéens mineurs ne le sont pas).
-- ---------------------------------------------------------------------
-- Vrai si la personne connectée est un membre validé.
create or replace function public.is_member()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'approved'
  );
$$;

create or replace function public.directory_list()
returns table (
  id uuid, first_name text, last_name text, graduation_year int,
  country text, city text, school text, program text,
  linkedin text, instagram text, photo_path text,
  contact_email boolean, contact_message boolean, contact_chat boolean,
  email text
)
language sql stable security definer
set search_path = public
as $$
  select
    p.id, p.first_name, p.last_name, p.graduation_year,
    case when p.show_location then p.country end,
    case when p.show_location then p.city end,
    case when p.show_study    then p.school end,
    case when p.show_study    then p.program end,
    case when p.show_social   then p.linkedin end,
    case when p.show_social   then p.instagram end,
    case when p.show_photo    then p.photo_path end,
    p.contact_email, p.contact_message, p.contact_chat,
    case when p.contact_email then p.email end   -- e-mail partagé seulement si la personne accepte ce contact
  from public.profiles p
  where public.is_member()
    and p.status = 'approved'
    and p.member_type = 'alumni'
  order by lower(p.last_name), lower(p.first_name)
  limit 5000;
$$;

revoke all on function public.directory_list() from public, anon;
grant execute on function public.directory_list() to authenticated;

-- Une photo n'est lisible par les autres membres que si son propriétaire
-- est un alumni validé qui a choisi de l'afficher.
create or replace function public.can_view_photo(path text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_member() and exists (
    select 1 from public.profiles p
    where p.photo_path = path
      and p.status = 'approved'
      and p.member_type = 'alumni'
      and p.show_photo
  );
$$;

drop policy if exists avatars_select_members on storage.objects;
create policy avatars_select_members on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and public.can_view_photo(name));

-- =====================================================================
--  FIN. Pour vous nommer administrateur (APRÈS vous être inscrit sur
--  l'application), exécutez cette requête en remplaçant l'adresse :
--
--    update public.profiles
--    set role = 'admin', status = 'approved'
--    where email = 'votre.adresse@exemple.com';
-- =====================================================================
