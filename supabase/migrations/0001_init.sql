-- RADAR — schema initial
-- Reference : spec §4. Ecarts documentes dans le plan §3.

create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- artisans : le reseau. PREREQUIS n°1 — sans cette table, aucun matching.
-- ---------------------------------------------------------------------------
create table artisans (
  id                   uuid primary key default gen_random_uuid(),
  nom                  text not null,
  societe              text,
  siret                text,
  telephone            text,
  email                text,

  -- Capacites — indispensables au scoring
  metiers              text[] not null default '{}',
  departements         text[] not null default '{}',
  rayon_km             int,
  effectif             int,
  ca_annuel            numeric,
  chantier_max         numeric,
  chantier_min         numeric,

  -- Eligibilite marches publics
  decennale            boolean not null default false,
  decennale_expire_le  date,
  rc_pro               boolean not null default false,
  qualifications       text[] not null default '{}',
  attestations_ok      boolean not null default false,
  deja_repondu_ao      boolean not null default false,
  references_publiques text,

  -- Suivi
  actif                boolean not null default true,
  appetence_public     int check (appetence_public between 0 and 5),
  notes                text,
  created_at           timestamptz not null default now()
);

create index idx_artisans_metiers on artisans using gin (metiers);
create index idx_artisans_depts   on artisans using gin (departements);
create index idx_artisans_actif   on artisans (actif);

-- ---------------------------------------------------------------------------
-- avis : les opportunites
-- ---------------------------------------------------------------------------
create table avis (
  id                    uuid primary key default gen_random_uuid(),

  -- Identification source
  source                text not null default 'BOAMP',
  source_id             text not null,               -- idweb
  hash_dedup            text,                        -- reserve : dedup inter-sources (TED, v2)
  perimetre             text,                        -- dialecte du blob : DIRECTIVE-24 | FNSimple | MAPA ...
  annonce_lie           text,                        -- idweb de l'avis initial (rectificatif/annulation)

  -- Contenu
  objet                 text,
  objet_normalise       text,
  description           text,
  acheteur_nom          text,
  acheteur_siret        text,

  -- Contact acheteur — RGPD : usage interne strict, jamais exporte,
  -- jamais utilise comme destinataire (spec §1.4).
  contact_nom           text,
  contact_email         text,
  contact_telephone     text,

  -- Classification
  cpv_principal         text,
  cpv_tous              text[] not null default '{}',
  metier                text,
  classification_source text,                        -- 'cpv' | 'mots_cles' | null
  famille               text,                        -- 'travaux' | 'services' | 'fournitures'
  procedure             text,
  alloti                boolean not null default false,
  lot_numero            text,
  lot_intitule          text,
  accord_cadre          boolean not null default false,

  -- Localisation
  departement           text,
  code_postal           text,
  commune               text,
  nuts                  text,

  -- Economie
  montant_estime        numeric,
  montant_inconnu       boolean not null default true,

  -- Dates
  date_parution         date,
  date_limite           timestamptz,                 -- nullable assume (plan §1.4)

  -- Statut
  etat                  text not null default 'en_cours',
  nature                text,                        -- APPEL_OFFRE | ATTRIBUTION | RECTIFICATIF | ANNULATION
  type_avis             text,

  -- Liens
  url_avis              text,
  url_dce               text,

  -- Scoring
  score                 int,
  score_detail          jsonb,
  artisan_suggere       uuid references artisans(id) on delete set null,
  match_raison          text,                        -- pourquoi zero candidat (signal de recrutement)
  decision              text,
  decision_note         text,
  decision_at           timestamptz,

  -- Technique
  raw                   jsonb not null,
  raw_historique        jsonb[] not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (source, source_id)
);

create index idx_avis_objet_trgm on avis using gin (objet_normalise gin_trgm_ops);
create index idx_avis_hash       on avis (hash_dedup);
create index idx_avis_score      on avis (score desc);
create index idx_avis_limite     on avis (date_limite);
create index idx_avis_dept       on avis (departement);
create index idx_avis_decision   on avis (decision);
create index idx_avis_nature     on avis (nature);
create index idx_avis_lie        on avis (annonce_lie);

-- jours_restants ne peut PAS etre une colonne generee stockee : PostgreSQL
-- exige une expression immuable et now() ne l'est pas (plan §3).
-- On l'expose via une vue, calculee a la lecture.
create view avis_actifs as
select
  a.*,
  case
    when a.date_limite is null then null
    else extract(day from (a.date_limite - now()))::int
  end as jours_restants
from avis a
where a.etat in ('en_cours', 'rectifie');

-- ---------------------------------------------------------------------------
-- runs : journal d'execution
-- ---------------------------------------------------------------------------
create table runs (
  id            uuid primary key default gen_random_uuid(),
  source        text not null,
  job           text not null default 'ingest',
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  statut        text,                                 -- 'ok' | 'erreur' | 'partiel'
  avis_recus    int not null default 0,
  avis_nouveaux int not null default 0,
  avis_maj      int not null default 0,
  erreur        text
);

create index idx_runs_started on runs (started_at desc);

-- ---------------------------------------------------------------------------
-- config : tout ce qui est parametrable (spec §9.7)
-- ---------------------------------------------------------------------------
create table config (
  cle    text primary key,
  valeur jsonb not null
);

insert into config (cle, valeur) values
  ('last_run_boamp',      'null'::jsonb),
  ('departements_cibles', '["75","77","78","91","92","93","94","95"]'::jsonb),
  ('montant_min',         '20000'::jsonb),
  ('montant_max',         '600000'::jsonb),
  ('score_seuil_notif',   '50'::jsonb),
  ('score_seuil_prio',    '70'::jsonb),
  ('score_seuil_immediat','85'::jsonb),
  ('poids', '{
     "metier": 30,
     "departement_direct": 20,
     "departement_limitrophe": 10,
     "montant_ok": 20,
     "montant_inconnu": 10,
     "delai_sup_21j": 15,
     "delai_14_21j": 12,
     "delai_7_14j": 8,
     "delai_3_7j": 3,
     "procedure_adaptee": 10,
     "procedure_ouverte": 5,
     "procedure_restreinte": 2,
     "accord_cadre": 5
   }'::jsonb);
