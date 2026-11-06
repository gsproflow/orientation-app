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
      and p.member_type in ('alumni', 'staff')
      and p.show_photo
  );
$$;

drop policy if exists avatars_select_members on storage.objects;
create policy avatars_select_members on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and public.can_view_photo(name));

-- ---------------------------------------------------------------------
-- 7. Messagerie entre membres (étape 3)
--    Conversations privées à deux. L'administration ne peut lire une
--    conversation que si l'un des participants la signale.
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists admin_thread_read_at timestamptz;

create table if not exists public.conversations (
  id               uuid primary key default gen_random_uuid(),
  user_a           uuid not null references public.profiles(id) on delete cascade,
  user_b           uuid not null references public.profiles(id) on delete cascade,
  started_by       uuid not null references public.profiles(id) on delete cascade,
  created_at       timestamptz not null default now(),
  check (user_a < user_b),
  unique (user_a, user_b)
);

create table if not exists public.messages (
  id               bigint generated always as identity primary key,
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  sender_id        uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body             text not null check (char_length(body) between 1 and 2000),
  created_at       timestamptz not null default now()
);
create index if not exists messages_conv_idx on public.messages (conversation_id, created_at);

create table if not exists public.conversation_reads (
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  last_read_at     timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.reports (
  id               bigint generated always as identity primary key,
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  reporter_id      uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  reason           text not null check (char_length(reason) between 3 and 1000),
  status           text not null default 'open' check (status in ('open','closed')),
  created_at       timestamptz not null default now(),
  handled_by       uuid references public.profiles(id) on delete set null,
  handled_at       timestamptz
);
create index if not exists reports_status_idx on public.reports (status, created_at);

-- Fonctions d'appui (évitent les boucles entre règles de sécurité)
create or replace function public.is_participant(cid uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = cid and auth.uid() in (c.user_a, c.user_b)
  );
$$;

create or replace function public.is_reported(cid uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.reports r where r.conversation_id = cid);
$$;

-- Démarrer (ou retrouver) une conversation avec un membre.
create or replace function public.start_conversation(target uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  me  uuid := auth.uid();
  a   uuid;
  b   uuid;
  cid uuid;
  t   public.profiles;
begin
  if me is null or not public.is_member() then
    raise exception 'Accès réservé aux membres validés';
  end if;
  if target = me then
    raise exception 'Vous ne pouvez pas vous écrire à vous-même';
  end if;

  select * into t from public.profiles where id = target and status = 'approved';
  if not found then
    raise exception 'Destinataire introuvable';
  end if;

  a := least(me, target);
  b := greatest(me, target);

  -- Une conversation existante reste utilisable, même si les préférences ont changé.
  select id into cid from public.conversations where user_a = a and user_b = b;
  if found then
    return cid;
  end if;

  if not (public.is_admin()
          or (t.member_type = 'alumni' and (t.contact_message or t.contact_chat))) then
    raise exception 'Cette personne n''accepte pas les messages dans l''application';
  end if;

  if (select count(*) from public.conversations
      where started_by = me and created_at > now() - interval '1 day') >= 20 then
    raise exception 'Limite atteinte : 20 nouvelles conversations par jour';
  end if;

  insert into public.conversations (user_a, user_b, started_by)
  values (a, b, me) returning id into cid;
  return cid;
end;
$$;

-- Liste de mes conversations avec le dernier message et le nombre de non lus.
create or replace function public.my_conversations()
returns table (
  id uuid, other_id uuid, other_first text, other_last text, other_type text,
  other_photo text, last_body text, last_at timestamptz, last_sender uuid, unread bigint
)
language sql stable security definer
set search_path = public
as $$
  select
    c.id, o.id, o.first_name, o.last_name, o.member_type,
    case when o.show_photo then o.photo_path end,
    lm.body, coalesce(lm.created_at, c.created_at), lm.sender_id,
    (select count(*) from public.messages m
      where m.conversation_id = c.id
        and m.sender_id <> auth.uid()
        and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz))
  from public.conversations c
  join public.profiles o
    on o.id = case when c.user_a = auth.uid() then c.user_b else c.user_a end
  left join public.conversation_reads r
    on r.conversation_id = c.id and r.user_id = auth.uid()
  left join lateral (
    select m.body, m.created_at, m.sender_id from public.messages m
    where m.conversation_id = c.id order by m.created_at desc limit 1
  ) lm on true
  where public.is_member() and auth.uid() in (c.user_a, c.user_b)
  order by coalesce(lm.created_at, c.created_at) desc;
$$;

-- Nombre total de messages non lus (conversations + messages de l'administration).
create or replace function public.my_unread()
returns bigint
language sql stable security definer
set search_path = public
as $$
  select
    (select coalesce(sum(unread), 0) from public.my_conversations())::bigint
    + (select count(*) from public.admin_messages am
        where am.user_id = auth.uid() and am.from_admin
          and am.created_at > coalesce(
                (select p.admin_thread_read_at from public.profiles p where p.id = auth.uid()),
                '-infinity'::timestamptz));
$$;

-- Marquer une conversation comme lue.
create or replace function public.mark_conversation_read(cid uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_participant(cid) then
    raise exception 'Conversation introuvable';
  end if;
  insert into public.conversation_reads (conversation_id, user_id, last_read_at)
  values (cid, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
end;
$$;

-- Anti-spam : 60 messages par heure et par personne.
create or replace function public.limit_message_rate()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if (select count(*) from public.messages
      where sender_id = new.sender_id and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Trop de messages envoyés. Réessayez dans quelques minutes.';
  end if;
  return new;
end;
$$;

drop trigger if exists limit_message_rate on public.messages;
create trigger limit_message_rate
  before insert on public.messages
  for each row execute function public.limit_message_rate();

revoke all on function public.start_conversation(uuid), public.my_conversations(),
  public.my_unread(), public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.start_conversation(uuid), public.my_conversations(),
  public.my_unread(), public.mark_conversation_read(uuid) to authenticated;

-- Règles de sécurité
alter table public.conversations      enable row level security;
alter table public.messages           enable row level security;
alter table public.conversation_reads enable row level security;
alter table public.reports            enable row level security;

drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations
  for select to authenticated
  using (auth.uid() in (user_a, user_b) or (public.is_admin() and public.is_reported(id)));

drop policy if exists chat_messages_select on public.messages;
create policy chat_messages_select on public.messages
  for select to authenticated
  using (public.is_participant(conversation_id)
         or (public.is_admin() and public.is_reported(conversation_id)));

drop policy if exists chat_messages_insert on public.messages;
create policy chat_messages_insert on public.messages
  for insert to authenticated
  with check (sender_id = (select auth.uid())
              and public.is_member()
              and public.is_participant(conversation_id));

drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports
  for select to authenticated
  using (reporter_id = (select auth.uid()) or public.is_admin());

drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports
  for insert to authenticated
  with check (reporter_id = (select auth.uid())
              and public.is_member()
              and public.is_participant(conversation_id));

drop policy if exists reports_update on public.reports;
create policy reports_update on public.reports
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Mises à jour en direct (messages, demandes d'inscription, messages de l'administration, signalements).
-- Les règles de sécurité ci-dessus s'appliquent aussi aux mises à jour en direct.
do $$
declare t text;
begin
  foreach t in array array['messages', 'admin_messages', 'profiles', 'reports'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;   -- déjà ajoutée
      when undefined_object then null;   -- publication absente (hors Supabase)
    end;
  end loop;
end $$;

-- =====================================================================
--  FIN. Pour vous nommer administrateur (APRÈS vous être inscrit sur
--  l'application), exécutez cette requête en remplaçant l'adresse :
--
--    update public.profiles
--    set role = 'admin', status = 'approved'
--    where email = 'votre.adresse@exemple.com';
-- =====================================================================
