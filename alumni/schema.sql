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

-- Position sur la carte (ville d'études) : calculée par l'application à partir
-- d'une liste de villes, jamais envoyée à un service extérieur.
alter table public.profiles add column if not exists country_code text
  check (country_code ~ '^[A-Z]{2}$');
alter table public.profiles add column if not exists lat double precision
  check (lat between -90 and 90);
alter table public.profiles add column if not exists lng double precision
  check (lng between -180 and 180);

-- Domaine d'études (liste fixe) : indispensable pour des statistiques par filière fiables.
alter table public.profiles add column if not exists study_field text
  check (study_field in ('law','health','engineering','it','business','humanities','arts','comms','education','other'));

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

-- Règle des adresses e-mail, appliquée par la base (impossible à contourner depuis l'écran) :
--   lycéens            : prenom.nom@gsjc.ma (le prénom peut se réduire à une ou deux lettres,
--                        ex. a.boulami@gsjc.ma ; tirets autorisés ; jusqu'à 3 chiffres en fin de nom)
--   personnel          : une adresse @gsjc.ma
--   anciens élèves     : une adresse personnelle (les adresses @gsjc.ma leur sont fermées)
-- Pour changer de domaine, remplacer « gsjc\.ma » ci-dessous (et SCHOOL_EMAIL_DOMAIN dans config.js).
create or replace function public.email_ok_for_type(em text, mt text)
returns boolean
language sql immutable
as $$
  select case
    when mt = 'student' then lower(trim(coalesce(em, ''))) ~ '^[a-z]+(-[a-z]+)*\.[a-z]+(-[a-z]+)*[0-9]{0,3}@gsjc\.ma$'
    when mt = 'staff'   then lower(trim(coalesce(em, ''))) ~ '^[^@[:space:]]+@gsjc\.ma$'
    else                     lower(trim(coalesce(em, ''))) !~ '@gsjc\.ma$'
  end;
$$;

-- Refuse la création d'un compte dont l'adresse ne respecte pas la règle de son type.
create or replace function public.enforce_signup_rules()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  mt text := coalesce(new.raw_user_meta_data->>'member_type', 'alumni');
begin
  if mt not in ('alumni','student','staff') then mt := 'alumni'; end if;
  if not public.email_ok_for_type(new.email, mt) then
    raise exception 'Adresse e-mail non conforme pour ce type de compte';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_signup_rules on auth.users;
create trigger enforce_signup_rules
  before insert on auth.users
  for each row execute function public.enforce_signup_rules();

-- Même règle si l'adresse est modifiée plus tard ; le profil reste synchronisé.
create or replace function public.enforce_email_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  mt text;
begin
  if new.email is not distinct from old.email then
    return new;
  end if;
  select member_type into mt from public.profiles where id = new.id;
  if mt is not null and not public.email_ok_for_type(new.email, mt) then
    raise exception 'Adresse e-mail non conforme pour ce type de compte';
  end if;
  update public.profiles set email = lower(trim(new.email)) where id = new.id;
  return new;
end;
$$;

drop trigger if exists enforce_email_change on auth.users;
create trigger enforce_email_change
  before update of email on auth.users
  for each row execute function public.enforce_email_change();

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

  if new.member_type <> old.member_type and not public.email_ok_for_type(new.email, new.member_type) then
    raise exception 'Ce type de compte n''est pas compatible avec votre adresse e-mail';
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

-- (le format de réponse change : on supprime l'ancienne version avant de recréer)
drop function if exists public.directory_list();

create or replace function public.directory_list()
returns table (
  id uuid, first_name text, last_name text, graduation_year int,
  country text, city text, school text, program text,
  linkedin text, instagram text, photo_path text,
  contact_email boolean, contact_message boolean, contact_chat boolean,
  email text, country_code text, lat double precision, lng double precision, study_field text
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
    case when p.contact_email then p.email end,  -- e-mail partagé seulement si la personne accepte ce contact
    case when p.show_location then p.country_code end,
    case when p.show_location then p.lat end,
    case when p.show_location then p.lng end,
    case when p.show_study then p.study_field end
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

-- ---------------------------------------------------------------------
-- 8. Actualités et agenda des événements (étape 5)
--    Publiés par l'administration ; visibles selon le public visé.
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists content_seen_at timestamptz;

create table if not exists public.news (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 3 and 140),
  body        text not null check (char_length(body) between 1 and 5000),
  image_path  text check (char_length(image_path) <= 200),
  audience    text not null default 'all' check (audience in ('all','alumni','student')),
  pinned      boolean not null default false,
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists news_created_idx on public.news (created_at desc);

create table if not exists public.events (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(title) between 3 and 140),
  description  text check (char_length(description) <= 5000),
  location     text check (char_length(location) <= 200),
  starts_at    timestamptz not null,
  ends_at      timestamptz,
  capacity     int check (capacity between 1 and 10000),
  registration boolean not null default true,
  audience     text not null default 'all' check (audience in ('all','alumni','student')),
  image_path   text check (char_length(image_path) <= 200),
  created_by   uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);
create index if not exists events_start_idx on public.events (starts_at);

create table if not exists public.event_registrations (
  event_id    uuid not null references public.events(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (event_id, user_id)
);

-- Le membre connecté fait-il partie du public visé ? (le personnel voit tout)
create or replace function public.audience_ok(a text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_member() and (
    a = 'all'
    or public.is_admin()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.member_type = 'staff'
             or (a = 'alumni'  and p.member_type = 'alumni')
             or (a = 'student' and p.member_type = 'student'))
    )
  );
$$;

-- Événements visibles, avec le nombre d'inscrits et mon inscription.
create or replace function public.events_list()
returns table (
  id uuid, title text, description text, location text,
  starts_at timestamptz, ends_at timestamptz, capacity int, registration boolean,
  audience text, image_path text, created_at timestamptz,
  registered bigint, mine boolean
)
language sql stable security definer
set search_path = public
as $$
  select
    e.id, e.title, e.description, e.location, e.starts_at, e.ends_at, e.capacity,
    e.registration, e.audience, e.image_path, e.created_at,
    (select count(*) from public.event_registrations r where r.event_id = e.id),
    exists (select 1 from public.event_registrations r
            where r.event_id = e.id and r.user_id = auth.uid())
  from public.events e
  where public.audience_ok(e.audience)
  order by e.starts_at;
$$;

-- S'inscrire (verrouille l'événement pour ne jamais dépasser le nombre de places).
create or replace function public.register_event(eid uuid)
returns bigint
language plpgsql security definer
set search_path = public
as $$
declare
  e public.events;
  n bigint;
begin
  if not public.is_member() then
    raise exception 'Accès réservé aux membres validés';
  end if;
  select * into e from public.events where id = eid for update;
  if not found or not public.audience_ok(e.audience) then
    raise exception 'Événement introuvable';
  end if;
  if not e.registration then
    raise exception 'Cet événement ne nécessite pas d''inscription';
  end if;
  if coalesce(e.ends_at, e.starts_at + interval '3 hours') < now() then
    raise exception 'Cet événement est terminé';
  end if;
  select count(*) into n from public.event_registrations where event_id = eid;
  if exists (select 1 from public.event_registrations where event_id = eid and user_id = auth.uid()) then
    return n;
  end if;
  if e.capacity is not null and n >= e.capacity then
    raise exception 'Cet événement est complet';
  end if;
  insert into public.event_registrations (event_id, user_id) values (eid, auth.uid());
  return n + 1;
end;
$$;

create or replace function public.unregister_event(eid uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  delete from public.event_registrations where event_id = eid and user_id = auth.uid();
end;
$$;

-- Nouveautés non vues (publiées depuis la dernière visite, ou depuis la validation du compte).
create or replace function public.content_unseen()
returns bigint
language sql stable security definer
set search_path = public
as $$
  with me as (
    select coalesce(content_seen_at, reviewed_at, created_at) as since
    from public.profiles where id = auth.uid()
  )
  select
    (select count(*) from public.news n, me
      where public.audience_ok(n.audience) and n.created_at > me.since
        and n.created_by is distinct from auth.uid())
    + (select count(*) from public.events e, me
      where public.audience_ok(e.audience) and e.created_at > me.since
        and e.created_by is distinct from auth.uid());
$$;

create or replace function public.mark_content_seen()
returns void
language sql security definer
set search_path = public
as $$
  update public.profiles set content_seen_at = now() where id = auth.uid();
$$;

revoke all on function public.events_list(), public.register_event(uuid),
  public.unregister_event(uuid), public.content_unseen(), public.mark_content_seen()
  from public, anon;
grant execute on function public.events_list(), public.register_event(uuid),
  public.unregister_event(uuid), public.content_unseen(), public.mark_content_seen()
  to authenticated;

-- Règles de sécurité
alter table public.news                enable row level security;
alter table public.events              enable row level security;
alter table public.event_registrations enable row level security;

drop policy if exists news_select on public.news;
create policy news_select on public.news
  for select to authenticated using (public.audience_ok(audience));
drop policy if exists news_insert on public.news;
create policy news_insert on public.news
  for insert to authenticated with check (public.is_admin());
drop policy if exists news_update on public.news;
create policy news_update on public.news
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists news_delete on public.news;
create policy news_delete on public.news
  for delete to authenticated using (public.is_admin());

drop policy if exists events_select on public.events;
create policy events_select on public.events
  for select to authenticated using (public.audience_ok(audience));
drop policy if exists events_insert on public.events;
create policy events_insert on public.events
  for insert to authenticated with check (public.is_admin());
drop policy if exists events_update on public.events;
create policy events_update on public.events
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists events_delete on public.events;
create policy events_delete on public.events
  for delete to authenticated using (public.is_admin());

-- Inscriptions : chacun voit les siennes, l'administration voit tout.
-- (S'inscrire et se désinscrire passe par les fonctions ci-dessus.)
drop policy if exists registrations_select on public.event_registrations;
create policy registrations_select on public.event_registrations
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());

-- Images de couverture : visibles par les membres, ajoutées par l'administration.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('content', 'content', false, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists content_select on storage.objects;
create policy content_select on storage.objects
  for select to authenticated using (bucket_id = 'content' and public.is_member());
drop policy if exists content_insert on storage.objects;
create policy content_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'content' and public.is_admin());
drop policy if exists content_update on storage.objects;
create policy content_update on storage.objects
  for update to authenticated
  using (bucket_id = 'content' and public.is_admin())
  with check (bucket_id = 'content' and public.is_admin());
drop policy if exists content_delete on storage.objects;
create policy content_delete on storage.objects
  for delete to authenticated using (bucket_id = 'content' and public.is_admin());

-- Mises à jour en direct des nouvelles publications.
do $$
declare t text;
begin
  foreach t in array array['news', 'events'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_object then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 9. Offres de stage, d'alternance et d'emploi (étape 6)
--    Proposées par les alumni et le personnel, validées par l'administration.
-- ---------------------------------------------------------------------
create table if not exists public.offers (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  organization  text not null check (char_length(organization) between 2 and 120),
  title         text not null check (char_length(title) between 3 and 140),
  type          text not null check (type in ('internship','apprenticeship','job','other')),
  location      text check (char_length(location) <= 120),
  remote        boolean not null default false,
  description   text not null check (char_length(description) between 10 and 5000),
  apply_url     text check (char_length(apply_url) <= 300 and apply_url ~* '^https://[^[:space:]]+$'),
  apply_email   text check (char_length(apply_email) <= 150 and apply_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  deadline      date,
  duration      text check (char_length(duration) <= 80),
  audience      text not null default 'all' check (audience in ('all','alumni','student')),
  status        text not null default 'pending' check (status in ('pending','published','rejected','closed')),
  review_note   text check (char_length(review_note) <= 1000),
  reviewed_by   uuid references public.profiles(id) on delete set null,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (apply_url is not null or apply_email is not null)
);
create index if not exists offers_status_idx on public.offers (status, created_at desc);

create or replace function public.can_post_offer()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'approved'
      and (p.role = 'admin' or p.member_type in ('alumni', 'staff'))
  );
$$;

-- Garde-fous : un auteur ne peut ni se valider lui-même, ni modifier une offre
-- validée sans qu'elle repasse en validation.
create or replace function public.guard_offer()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  changed boolean;
begin
  new.updated_at := now();
  if auth.uid() is null then
    return new;
  end if;

  if public.is_admin() then
    if tg_op = 'INSERT' and new.status = 'pending' then
      new.status := 'published';                    -- les offres de l'administration sont publiées directement
    end if;
    if (tg_op = 'INSERT' or new.status is distinct from old.status) and new.status in ('published','rejected') then
      new.reviewed_by := auth.uid();
      new.reviewed_at := now();
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.review_note := null; new.reviewed_by := null; new.reviewed_at := null;
    return new;
  end if;

  if new.author_id <> old.author_id or new.created_at <> old.created_at
     or new.review_note is distinct from old.review_note
     or new.reviewed_by is distinct from old.reviewed_by
     or new.reviewed_at is distinct from old.reviewed_at then
    raise exception 'Modification non autorisée';
  end if;

  changed := (new.title, new.organization, new.type, new.location, new.remote, new.description,
              new.apply_url, new.apply_email, new.deadline, new.duration, new.audience)
             is distinct from
             (old.title, old.organization, old.type, old.location, old.remote, old.description,
              old.apply_url, old.apply_email, old.deadline, old.duration, old.audience);

  if new.status is distinct from old.status then
    if new.status = 'closed' and not changed then
      null;                                         -- « offre pourvue »
    elsif new.status = 'pending' and old.status = 'rejected' then
      null;                                         -- renvoi après correction
    else
      raise exception 'Changement de statut non autorisé';
    end if;
  elsif changed then
    new.status := 'pending';                        -- toute modification repasse en validation
  end if;
  return new;
end;
$$;

drop trigger if exists guard_offer on public.offers;
create trigger guard_offer
  before insert or update on public.offers
  for each row execute function public.guard_offer();

-- Offres visibles, avec le nom de l'auteur (le profil de l'auteur n'est pas lisible directement).
create or replace function public.offers_list()
returns table (
  id uuid, organization text, title text, type text, location text, remote boolean,
  description text, apply_url text, apply_email text, deadline date, duration text,
  audience text, status text, review_note text, created_at timestamptz, reviewed_at timestamptz,
  author_name text, author_year int, author_admin boolean, mine boolean
)
language sql stable security definer
set search_path = public
as $$
  select
    o.id, o.organization, o.title, o.type, o.location, o.remote, o.description,
    o.apply_url, o.apply_email, o.deadline, o.duration, o.audience, o.status,
    case when o.author_id = auth.uid() or public.is_admin() then o.review_note end,
    o.created_at, o.reviewed_at,
    case when a.role = 'admin' then 'Administration GSJC'
         else trim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')) end,
    a.graduation_year,
    (a.role = 'admin'),
    (o.author_id = auth.uid())
  from public.offers o
  left join public.profiles a on a.id = o.author_id
  where public.is_member()
    and (o.author_id = auth.uid() or public.is_admin()
         or (o.status = 'published' and public.audience_ok(o.audience)))
  order by o.created_at desc;
$$;

revoke all on function public.offers_list() from public, anon;
grant execute on function public.offers_list() to authenticated;

alter table public.offers enable row level security;

drop policy if exists offers_select on public.offers;
create policy offers_select on public.offers
  for select to authenticated
  using (author_id = (select auth.uid()) or public.is_admin()
         or (status = 'published' and public.audience_ok(audience)));

drop policy if exists offers_insert on public.offers;
create policy offers_insert on public.offers
  for insert to authenticated
  with check (author_id = (select auth.uid()) and public.can_post_offer());

drop policy if exists offers_update on public.offers;
create policy offers_update on public.offers
  for update to authenticated
  using (author_id = (select auth.uid()) or public.is_admin())
  with check (author_id = (select auth.uid()) or public.is_admin());

drop policy if exists offers_delete on public.offers;
create policy offers_delete on public.offers
  for delete to authenticated
  using (author_id = (select auth.uid()) or public.is_admin());

-- Les nouvelles offres comptent dans les « nouveautés » (même pastille que les actualités).
create or replace function public.content_unseen()
returns bigint
language sql stable security definer
set search_path = public
as $$
  with me as (
    select coalesce(content_seen_at, reviewed_at, created_at) as since
    from public.profiles where id = auth.uid()
  )
  select
    (select count(*) from public.news n, me
      where public.audience_ok(n.audience) and n.created_at > me.since
        and n.created_by is distinct from auth.uid())
    + (select count(*) from public.events e, me
      where public.audience_ok(e.audience) and e.created_at > me.since
        and e.created_by is distinct from auth.uid())
    + (select count(*) from public.offers o, me
      where o.status = 'published' and public.audience_ok(o.audience)
        and coalesce(o.reviewed_at, o.created_at) > me.since
        and o.author_id is distinct from auth.uid());
$$;

do $$
begin
  begin
    alter publication supabase_realtime add table public.offers;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;

-- ---------------------------------------------------------------------
-- 10. Statistiques pour l'administration (étape 7)
--     Calculées par la base, réservées à l'administration.
-- ---------------------------------------------------------------------
-- Clé de regroupement : sans accents, sans majuscules, sans ponctuation.
create or replace function public.norm_key(t text)
returns text
language sql immutable
as $$
  select regexp_replace(
    translate(lower(trim(coalesce(t, ''))),
              'àâäáãåéèêëíìîïóòôöõúùûüýÿçñœ', 'aaaaaaeeeeiiiiooooouuuuyycno'),
    '[^a-z0-9]+', ' ', 'g');
$$;

create or replace function public.admin_stats(year_from int default null, year_to int default null)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  res jsonb;
begin
  if not public.is_admin() then
    raise exception 'Accès réservé à l''administration';
  end if;

  with al as (
    select * from public.profiles
    where status = 'approved' and member_type = 'alumni'
      and (year_from is null or graduation_year >= year_from)
      and (year_to   is null or graduation_year <= year_to)
  )
  select jsonb_build_object(
    'members', (
      select jsonb_build_object(
        'alumni',   count(*) filter (where status = 'approved' and member_type = 'alumni'),
        'students', count(*) filter (where status = 'approved' and member_type = 'student'),
        'staff',    count(*) filter (where status = 'approved' and member_type = 'staff'),
        'pending',  count(*) filter (where status = 'pending'),
        'rejected', count(*) filter (where status = 'rejected'),
        'draft',    count(*) filter (where status = 'draft'))
      from public.profiles),
    'alumni_total', (select count(*) from al),
    'signups', (
      select coalesce(jsonb_agg(jsonb_build_object('k', to_char(m, 'YYYY-MM'), 'n', coalesce(c, 0)) order by m), '[]'::jsonb)
      from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m
      left join (
        select date_trunc('month', created_at) as mm, count(*) as c
        from public.profiles where status <> 'draft' group by 1) s on s.mm = m),
    'by_country', (
      select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc, k), '[]'::jsonb)
      from (select country as k, count(*) as n from al where country is not null group by country order by count(*) desc, country limit 15) t),
    'by_city', (
      select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc, k), '[]'::jsonb)
      from (select city || ', ' || country as k, count(*) as n from al where city is not null and country is not null
            group by city, country order by count(*) desc, city limit 15) t),
    'by_school', (
      select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc, k), '[]'::jsonb)
      from (select mode() within group (order by school) as k, count(*) as n from al where school is not null
            group by public.norm_key(school) order by count(*) desc, 1 limit 15) t),
    'by_program', (
      select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc, k), '[]'::jsonb)
      from (select mode() within group (order by program) as k, count(*) as n from al where program is not null
            group by public.norm_key(program) order by count(*) desc, 1 limit 15) t),
    'by_field', (
      select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc, k), '[]'::jsonb)
      from (select coalesce(study_field, 'unknown') as k, count(*) as n from al group by 1) t),
    'by_year', (
      select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by k), '[]'::jsonb)
      from (select graduation_year as k, count(*) as n from al where graduation_year is not null group by 1) t),
    'contact', (
      select jsonb_build_object(
        'email',   count(*) filter (where contact_email),
        'message', count(*) filter (where contact_message or contact_chat),
        'located', count(*) filter (where lat is not null),
        'total',   count(*)) from al),
    'activity', jsonb_build_object(
      'conversations',   (select count(*) from public.conversations),
      'messages_30d',    (select count(*) from public.messages where created_at > now() - interval '30 days'),
      'news',            (select count(*) from public.news),
      'events_upcoming', (select count(*) from public.events where coalesce(ends_at, starts_at + interval '3 hours') >= now()),
      'registrations',   (select count(*) from public.event_registrations),
      'offers_published',(select count(*) from public.offers where status = 'published'),
      'offers_pending',  (select count(*) from public.offers where status = 'pending'),
      'reports_open',    (select count(*) from public.reports where status = 'open'))
  ) into res;

  return res;
end;
$$;

revoke all on function public.admin_stats(int, int) from public, anon;
grant execute on function public.admin_stats(int, int) to authenticated;

-- =====================================================================
--  FIN. Pour vous nommer administrateur (APRÈS vous être inscrit sur
--  l'application), exécutez cette requête en remplaçant l'adresse :
--
--    update public.profiles
--    set role = 'admin', status = 'approved'
--    where email = 'votre.adresse@exemple.com';
-- =====================================================================
