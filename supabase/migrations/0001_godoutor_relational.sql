-- ═══════════════════════════════════════════════════════════════════════
-- GoDoutor · Migração 0001 — persistência RELACIONAL (fim do documento único)
-- Projeto-alvo: Supabase ref sefwhobqafkretljjlqx (org CRM Growth, sa-east-1)
-- ═══════════════════════════════════════════════════════════════════════
-- Princípios (docs/GODOUTOR-SUPABASE-HANDOFF.md):
--   • TODAS as coleções do documento viram tabela. Nenhum módulo legado é
--     descartado; IDs originais são preservados (PKs text = IDs do produto).
--   • Consultas específicas por clínica (business_id), unidade e PERÍODO:
--     índices compostos (business_id, data) e paginação SQL — nada de
--     recarregar "o documento inteiro".
--   • Tabelas vivem no schema `app`, FORA do que a Data API (PostgREST)
--     expõe. `public` fica vazio. Grants mínimos: só a role `godoutor_app`
--     (senha definida pela operação, nunca neste arquivo).
--   • RLS habilitada em tudo: `anon`/`authenticated` NÃO têm política alguma
--     (negação total). A autorização real continua na aplicação (cookies de
--     sessão atuais); NÃO presumimos auth.uid() do Supabase Auth.
--   • Conflito de horário é recusado PELO BANCO (constraint de exclusão) e
--     pela revalidação transacional da aplicação — duas camadas.
-- Convenções:
--   • timestamps ISO do domínio ↔ timestamptz; datas YYYY-MM-DD ↔ date;
--     horários HH:MM ↔ time.
--   • referências OPCIONAIS do domínio ('') viram NULL com FK; vínculos que o
--     produto permite "moles" (dono apagado, histórico) ficam text + índice.
--   • estruturas compostas que SEMPRE são lidas com a linha-pai (config,
--     histórico, blocos) ficam em jsonb — as entidades consultadas por
--     período/tenant têm colunas e índices próprios.
-- ═══════════════════════════════════════════════════════════════════════

create extension if not exists btree_gist; -- constraint de exclusão da agenda

create schema if not exists app;

-- Controle de versão de migração (o importador confere antes de gravar).
create table if not exists app.schema_migrations (
  version    text primary key,
  applied_at timestamptz not null default now()
);

-- ── Identidade e acesso (autenticação PRESERVADA — sem Supabase Auth) ─────
create table app.users (
  id            text primary key,
  name          text not null default '',
  email         text not null,
  password_hash text not null default '',
  role          text not null default 'owner' check (role in ('owner','admin','master')),
  active        boolean not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now()
);
create unique index users_email_uniq on app.users (lower(email));

create table app.sessions (
  id         text primary key,
  user_id    text not null references app.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_expires_idx on app.sessions (expires_at);
create index sessions_user_idx on app.sessions (user_id);

-- Consumidor (conta global de quem agenda/compra).
create table app.customers (
  id                  text primary key,
  name                text not null default '',
  phone               text not null default '',
  email               text not null default '',
  password_hash       text not null default '',
  google_id           text not null default '',
  avatar              text not null default '',
  must_change_password boolean not null default false,
  access_created_at   timestamptz,
  created_at          timestamptz not null default now()
);
create unique index customers_google_uniq on app.customers (google_id) where google_id <> '';
create unique index customers_email_uniq on app.customers (lower(email)) where email <> '';

create table app.customer_sessions (
  id          text primary key,
  customer_id text not null references app.customers(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index customer_sessions_expires_idx on app.customer_sessions (expires_at);

create table app.password_resets (
  id          text primary key,
  kind        text not null check (kind in ('user','customer')),
  account_id  text not null,
  token_hash  text not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index password_resets_token_idx on app.password_resets (token_hash);

-- Reautenticação curta de exclusão (nunca contém senha). expiresAt/usedAt do
-- domínio são ÉPOCA em milissegundos — mantidos como bigint.
create table app.deletion_authorizations (
  token_hash      text primary key,
  user_id         text not null,
  session_hash    text not null default '',
  kind            text not null check (kind in ('business','organization')),
  target_id       text not null,
  organization_id text not null default '',
  target_name     text not null default '',
  expires_at      bigint not null,
  used_at         bigint not null default 0
);

-- ── Organização (clínica) e Unidades ──────────────────────────────────────
create table app.organizations (
  id                 text primary key,
  name               text not null,
  owner_id           text not null references app.users(id),
  metadata           jsonb not null default '{}'::jsonb,
  public_business_id text, -- FK adicionada ao fim (depende de businesses)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Unidade operacional (a "clínica" das consultas — business_id em tudo).
create table app.businesses (
  id                   text primary key,
  organization_id      text not null references app.organizations(id),
  owner_id             text not null references app.users(id),
  name                 text not null,
  slug                 text not null,
  description          text not null default '',
  logo                 text not null default '',
  cover                text not null default '',
  niche                text not null default 'outro',
  modes                jsonb not null default '[]'::jsonb,
  features             jsonb,
  products_off         boolean,
  whatsapp_integration jsonb,
  instagram_integration jsonb,
  phone                text not null default '',
  whatsapp             text not null default '',
  email                text not null default '',
  instagram            text not null default '',
  tiktok               text not null default '',
  socials              jsonb not null default '{}'::jsonb,
  address              text not null default '',
  maps_url             text not null default '',
  hours                jsonb not null default '{}'::jsonb,
  business_timezone    text,
  payment_methods      jsonb not null default '[]'::jsonb,
  pix_key              text not null default '',
  delivery_fee         integer not null default 0,
  min_order            integer not null default 0,
  google_url           text not null default '',
  google_place_id      text not null default '',
  google_api_key       text not null default '',
  booking              jsonb not null default '{"teamMode":"solo","leadMin":30,"cancelUntilMin":120,"horizonDays":60,"bufferMin":0}'::jsonb,
  nav                  jsonb not null default '[]'::jsonb,
  nav_custom           boolean not null default false,
  nav_items            jsonb,
  automations          jsonb,
  capability_flags     jsonb,
  about                jsonb not null default '{"title":"","text":"","image":"","enabled":false}'::jsonb,
  appearance           jsonb,
  published            boolean not null default false,
  subscription         jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index businesses_slug_uniq on app.businesses (slug);
create index businesses_org_idx on app.businesses (organization_id);

create table app.organization_members (
  id              text primary key,
  organization_id text not null references app.organizations(id) on delete cascade,
  user_id         text not null references app.users(id) on delete cascade,
  role            text not null check (role in ('OWNER','ADMIN')),
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);

-- Equipe da unidade (logins internos, papéis e permissões).
create table app.members (
  id          text primary key,
  business_id text not null references app.businesses(id) on delete cascade,
  user_id     text not null references app.users(id) on delete cascade,
  role        text not null,
  permissions jsonb not null default '{}'::jsonb,
  active      boolean not null default true,
  note        text not null default '',
  invited_by  text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (business_id, user_id)
);
create index members_user_idx on app.members (user_id);

-- ── Página pública e catálogo ─────────────────────────────────────────────
create table app.pages (
  id          text primary key,
  business_id text not null references app.businesses(id) on delete cascade,
  preset_id   text not null default '',
  theme       jsonb not null default '{}'::jsonb,
  blocks      jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);
create unique index pages_business_uniq on app.pages (business_id);

create table app.categories (
  id          text primary key,
  business_id text not null references app.businesses(id) on delete cascade,
  kind        text not null check (kind in ('product','service')),
  name        text not null,
  "order"     integer not null default 0,
  active      boolean not null default true
);
create index categories_business_idx on app.categories (business_id, kind, "order");

create table app.products (
  id          text primary key,
  business_id text not null references app.businesses(id) on delete cascade,
  category_id text references app.categories(id) on delete set null, -- '' do domínio vira NULL
  name        text not null,
  description text not null default '',
  image       text not null default '',
  price       integer not null default 0,
  promo_price integer not null default 0,
  active      boolean not null default true,
  featured    boolean not null default false,
  "order"     integer not null default 0
);
create index products_business_idx on app.products (business_id, active);

create table app.product_options (
  id          text primary key,
  business_id text not null references app.businesses(id) on delete cascade,
  product_id  text not null references app.products(id) on delete cascade,
  name        text not null,
  required    boolean not null default false,
  multiple    boolean not null default false,
  min         integer not null default 0,
  max         integer not null default 0,
  "order"     integer not null default 0
);
create index product_options_product_idx on app.product_options (product_id);

create table app.product_option_values (
  id          text primary key,
  business_id text not null references app.businesses(id) on delete cascade,
  option_id   text not null references app.product_options(id) on delete cascade,
  name        text not null,
  price_delta integer not null default 0,
  active      boolean not null default true
);
create index product_option_values_option_idx on app.product_option_values (option_id);

-- ── Serviços, profissionais e disponibilidade (motor da agenda) ───────────
create table app.services (
  id               text primary key,
  business_id      text not null references app.businesses(id) on delete cascade,
  category_id      text references app.categories(id) on delete set null, -- '' do domínio vira NULL
  name             text not null,
  description      text not null default '',
  image            text not null default '',
  price            integer not null default 0,
  show_price       boolean not null default true,
  duration_min     integer not null default 30,
  professional_ids jsonb not null default '[]'::jsonb,
  active           boolean not null default true,
  featured         boolean not null default false,
  bookable         boolean not null default true,
  questions        jsonb not null default '[]'::jsonb
);
create index services_business_idx on app.services (business_id, active);

create table app.professionals (
  id                   text primary key,
  business_id          text not null references app.businesses(id) on delete cascade,
  name                 text not null,
  role                 text not null default '',
  photo                text not null default '',
  active               boolean not null default true,
  user_id              text references app.users(id),
  follow_business_hours boolean not null default true
);
create index professionals_business_idx on app.professionals (business_id, active);
create index professionals_user_idx on app.professionals (user_id);

-- Regra de disponibilidade ('' no profissional = horário geral da clínica).
create table app.availability (
  id              text primary key,
  business_id     text not null references app.businesses(id) on delete cascade,
  professional_id text references app.professionals(id) on delete cascade, -- NULL/'' = horário geral da clínica
  service_id      text references app.services(id) on delete cascade,      -- NULL/'' = todos os serviços
  weekday         smallint not null check (weekday between 0 and 6),
  start           time not null,
  "end"           time not null,
  slot_min        integer not null default 30
);
-- Consulta por unidade + dia da semana (grade do dia).
create index availability_business_weekday_idx on app.availability (business_id, weekday);
create index availability_business_pro_idx on app.availability (business_id, professional_id);

create table app.availability_exceptions (
  id          text primary key,
  business_id text not null references app.businesses(id) on delete cascade,
  date        date not null,
  closed      boolean not null default false,
  start       text not null default '',
  "end"       text not null default '',
  note        text not null default ''
);
-- Exceções por unidade e período (janela da agenda).
create index availability_exceptions_business_date_idx on app.availability_exceptions (business_id, date);

-- ── Leads (esteira) ───────────────────────────────────────────────────────
create table app.leads (
  id               text primary key,
  business_id      text not null references app.businesses(id) on delete cascade,
  customer_id      text references app.customers(id),
  name             text not null default '',
  phone            text not null default '',
  email            text not null default '',
  instagram        text not null default '',
  origin           text not null default '',
  channel          text not null default '',
  interest         text not null default '',
  action           text not null default '',
  status           text not null default 'new' check (status in ('new','contacted','qualified','converted','lost')),
  created_at       timestamptz not null default now(),
  last_interaction timestamptz,
  stage_id         text not null default 'new',
  assigned_user_id text references app.users(id),
  priority         text,
  next_action      text not null default '',
  service_id       text not null default '',
  professional_id  text not null default '',
  source_url       text not null default '',
  metadata         jsonb,
  booking_id       text, -- vínculo com agendamento (FK adiada p/ fim: dependência mútua)
  notes            jsonb,
  stage_history    jsonb
);
create index leads_business_status_idx on app.leads (business_id, status);
create index leads_business_created_idx on app.leads (business_id, created_at desc);
create index leads_business_phone_idx on app.leads (business_id, phone);

-- ── Agendamentos (o centro: consultas por unidade e período) ──────────────
create table app.bookings (
  id                 text primary key,
  business_id        text not null references app.businesses(id) on delete cascade,
  customer_id        text references app.customers(id),
  service_id         text not null references app.services(id),
  professional_id    text references app.professionals(id), -- NULL/'' = sem profissional (solo)
  date               date not null,
  time               time not null,
  -- Minutos desde 00:00 (grade real do dia). Calculados na escrita a partir
  -- de time + duração do serviço — é o que a constraint de exclusão usa.
  start_min          integer not null,
  end_min            integer not null,
  customer_name      text not null default '',
  customer_phone     text not null default '',
  status             text not null default 'pending' check (status in ('pending','confirmed','cancelled','completed','no_show')),
  note               text not null default '',
  answers            jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  history            jsonb not null default '[]'::jsonb,
  previous_id        text references app.bookings(id),
  reschedule_count   integer not null default 0,
  lead_id            text references app.leads(id),
  series_id          text,
  series_index       integer,
  series_count       integer,
  series_request_id  text,
  series_fingerprint text,
  booking_kind       text not null default 'standard' check (booking_kind in ('standard','fit_in')),
  checked_in_at      timestamptz,
  checked_in_by      text,
  checked_in_by_name text,
  check (end_min > start_min),
  check (start_min >= 0 and end_min <= 24 * 60)
);
-- Consulta da agenda por unidade + período (o índice mais quente do produto).
create index bookings_business_date_idx on app.bookings (business_id, date);
create index bookings_business_status_date_idx on app.bookings (business_id, status, date);
create index bookings_business_phone_idx on app.bookings (business_id, customer_phone);
create index bookings_business_created_idx on app.bookings (business_id, created_at desc);
create index bookings_customer_idx on app.bookings (customer_id) where customer_id is not null;
-- Idempotência de série recorrente (chave tenant-scoped).
create unique index bookings_series_uniq on app.bookings (business_id, series_request_id, series_index)
  where series_request_id is not null;

-- ⛔ DUPLA RESERVA RECUSADA PELO BANCO: dois atendimentos ATIVOS do mesmo
-- profissional (ou do "qualquer um" quando professional_id = '') no MESMO dia
-- não podem se sobrepor no tempo. O encaixe (fit_in — conflito reconhecido
-- pela equipe) e os estados terminais ficam de fora por definição. Mesmo sob
-- duas transações simultâneas em instâncias diferentes, a segunda falha aqui.
alter table app.bookings add constraint bookings_no_overlap
  exclude using gist (
    business_id with =,
    date with =,
    (coalesce(professional_id, '')) with =, -- solo/'' = um único recurso da unidade
    int4range(start_min, end_min) with &&
  ) where (status in ('pending','confirmed') and booking_kind <> 'fit_in');

-- ── CRM (contato = relação conta × unidade) ───────────────────────────────
create table app.contacts (
  id                text primary key,
  business_id       text not null references app.businesses(id) on delete cascade,
  customer_id       text references app.customers(id),
  name              text not null default '',
  phone             text not null default '',
  email             text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  source            text not null default 'interaction',
  last_interaction  timestamptz,
  marketing_opt_in  boolean not null default false,
  note              text not null default '',
  notes             jsonb,
  profile           jsonb,
  channel_identities jsonb
);
create index contacts_business_phone_idx on app.contacts (business_id, phone);
create index contacts_business_customer_idx on app.contacts (business_id, customer_id);
create index contacts_business_updated_idx on app.contacts (business_id, updated_at desc);

create table app.reviews (
  id            text primary key,
  business_id   text not null references app.businesses(id) on delete cascade,
  customer_id   text references app.customers(id),
  customer_name text not null default '',
  rating        smallint not null check (rating between 1 and 5),
  text          text not null default '',
  source        text not null check (source in ('site','google')),
  status        text not null default 'pending' check (status in ('pending','published','hidden')),
  order_id      text not null default '',
  booking_id    text not null default '',
  external_id   text not null default '',
  created_at    timestamptz not null default now()
);
create index reviews_business_status_idx on app.reviews (business_id, status, created_at desc);
create unique index reviews_external_uniq on app.reviews (business_id, external_id) where external_id <> '';

-- ── Eventos analíticos (append-only, consulta por unidade e período) ──────
create table app.events (
  id          text primary key,
  business_id text not null references app.businesses(id) on delete cascade,
  type        text not null,
  path        text not null default '',
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index events_business_created_idx on app.events (business_id, created_at desc);
create index events_business_type_created_idx on app.events (business_id, type, created_at desc);

-- ── Pedidos ───────────────────────────────────────────────────────────────
create table app.orders (
  id               text primary key,
  business_id      text not null references app.businesses(id) on delete cascade,
  customer_id      text references app.customers(id),
  code             text not null default '',
  customer_name    text not null default '',
  customer_phone   text not null default '',
  customer_address text not null default '',
  type             text not null check (type in ('delivery','pickup')),
  payment          text not null default '',
  items            jsonb not null default '[]'::jsonb,
  subtotal         integer not null default 0,
  total            integer not null default 0,
  status           text not null default 'new',
  note             text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  history          jsonb not null default '[]'::jsonb
);
create index orders_business_created_idx on app.orders (business_id, created_at desc);
create index orders_business_status_idx on app.orders (business_id, status);

-- ── Agente e conversas ────────────────────────────────────────────────────
create table app.agents (
  id                 text primary key,
  business_id        text not null unique references app.businesses(id) on delete cascade,
  name               text not null default '',
  enabled            boolean not null default true,
  greeting           text not null default '',
  tone               text not null default 'profissional',
  objectives         jsonb not null default '[]'::jsonb,
  instructions       text not null default '',
  restrictions       text not null default '',
  handoff_message    text not null default '',
  knowledge_override text not null default '',
  channels           jsonb not null default '{"site":true,"whatsapp":false}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table app.conversations (
  id                  text primary key,
  business_id         text not null references app.businesses(id) on delete cascade,
  channel             text not null check (channel in ('whatsapp','instagram','agent')),
  channel_user_id     text not null default '',
  channel_account_id  text not null default '',
  last_inbound_at     timestamptz,
  channel_username    text not null default '',
  contact_id          text not null default '',
  customer_id         text references app.customers(id),
  name                text not null default '',
  phone               text not null default '',
  status              text not null default 'open' check (status in ('open','closed')),
  mode                text not null default 'automation',
  unread              integer not null default 0,
  last_message_at     timestamptz,
  last_message_preview text not null default '',
  created_at          timestamptz not null default now(),
  context             jsonb
);
create index conversations_business_recent_idx on app.conversations (business_id, last_message_at desc);
create index conversations_business_open_idx on app.conversations (business_id, status);
create index conversations_business_phone_idx on app.conversations (business_id, channel, phone);
-- Chave estável por unidade: business + canal + conta + participante.
-- Parcial de propósito: só vale quando existe identidade REAL de canal
-- (IGSID/wa_id). Conversas legadas sem participant (chave por telefone na
-- aplicação) não são forçadas a colidir entre clientes diferentes.
create unique index conversations_channel_uniq on app.conversations
  (business_id, channel, channel_account_id, channel_user_id)
  where channel_user_id <> '';

create table app.messages (
  id               text primary key,
  business_id      text not null references app.businesses(id) on delete cascade,
  conversation_id  text not null references app.conversations(id) on delete cascade,
  direction        text not null check (direction in ('in','out')),
  body             text not null default '',
  status           text not null default 'pending' check (status in ('pending','sent','delivered','read','failed')),
  external_id      text not null default '',
  by               text not null default '',
  by_name          text not null default '',
  channel          text not null default '',
  channel_user_id  text not null default '',
  at               timestamptz not null default now(),
  error            text not null default '',
  claim_token      text,
  claim_expires_at timestamptz,
  attempts         integer not null default 0,
  next_retry_at    timestamptz,
  meta             jsonb
);
-- Histórico da conversa por período (paginação SQL, sem recarregar tudo).
create index messages_conversation_at_idx on app.messages (conversation_id, at desc);
create index messages_business_at_idx on app.messages (business_id, at desc);
-- Fila de saída (retry do WhatsApp/Instagram).
create index messages_outbox_idx on app.messages (business_id, status, next_retry_at)
  where status = 'pending' and direction = 'out';
-- Dedupe de webhook: mesma mensagem nunca entra duas vezes.
create unique index messages_external_uniq on app.messages (business_id, external_id) where external_id <> '';

-- ── Campanhas ─────────────────────────────────────────────────────────────
create table app.campaigns (
  id               text primary key,
  business_id      text not null references app.businesses(id) on delete cascade,
  name             text not null,
  message          text not null default '',
  template_name    text not null default '',
  template_language text not null default '',
  template_params  jsonb,
  segment          text not null default 'all_optin',
  segment_ref      text not null default '',
  status           text not null default 'draft',
  counts           jsonb not null default '{"eligible":0,"sent":0,"delivered":0,"failed":0}'::jsonb,
  channel          text not null default 'whatsapp',
  created_by       text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  sent_at          timestamptz
);
create index campaigns_business_idx on app.campaigns (business_id, created_at desc);

create table app.campaign_recipients (
  id               text primary key,
  business_id      text not null references app.businesses(id) on delete cascade,
  campaign_id      text not null references app.campaigns(id) on delete cascade,
  contact_id       text not null default '',
  name             text not null default '',
  phone            text not null default '',
  status           text not null default 'pending' check (status in ('pending','sent','delivered','failed')),
  external_id      text not null default '',
  error            text not null default '',
  at               timestamptz,
  next_retry_at    timestamptz,
  attempts         integer not null default 0,
  claim_token      text,
  claim_expires_at timestamptz
);
create index campaign_recipients_campaign_idx on app.campaign_recipients (campaign_id, status);
create index campaign_recipients_outbox_idx on app.campaign_recipients (business_id, status, next_retry_at)
  where status = 'pending';

-- ── Auditoria, suporte e esteira ──────────────────────────────────────────
create table app.audit (
  id                 text primary key,
  at                 timestamptz not null default now(),
  action             text not null,
  actor_user_id      text not null default '',
  actor_email        text not null default '',
  actor_role         text not null default '',
  business_id        text not null default '',
  support_session_id text not null default '',
  meta               jsonb not null default '{}'::jsonb
);
create index audit_business_at_idx on app.audit (business_id, at desc);
create index audit_at_idx on app.audit (at desc);

create table app.support_sessions (
  id              text primary key,
  master_user_id  text not null references app.users(id),
  master_email    text not null default '',
  business_id     text not null default '',
  mode            text not null check (mode in ('view','admin')),
  reason          text not null default '',
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  ended_at        timestamptz
);

create table app.pipelines (
  id          text primary key,
  business_id text not null unique references app.businesses(id) on delete cascade,
  stages      jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

create table app.api_keys (
  id                text primary key,
  business_id       text not null references app.businesses(id) on delete cascade,
  name              text not null default '',
  key_prefix        text not null default '',
  key_hash          text not null,
  created_at        timestamptz not null default now(),
  last_used_at      timestamptz,
  revoked_at        timestamptz,
  created_by_user_id text not null default ''
);
create unique index api_keys_hash_uniq on app.api_keys (key_hash);
create index api_keys_business_idx on app.api_keys (business_id);

create table app.webhooks (
  id          text primary key,
  business_id text not null references app.businesses(id) on delete cascade,
  url         text not null,
  secret      text not null default '',
  events      jsonb not null default '[]'::jsonb,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index webhooks_business_idx on app.webhooks (business_id);

create table app.webhook_deliveries (
  id               text primary key,
  webhook_id       text not null default '',
  business_id      text not null references app.businesses(id) on delete cascade,
  event            text not null,
  event_id         text not null default '',
  url              text not null default '',
  payload_summary  jsonb not null default '{}'::jsonb,
  status           text not null default 'pending' check (status in ('pending','success','failed')),
  status_code      integer,
  error            text not null default '',
  attempts         integer not null default 0,
  max_attempts     integer not null default 3,
  next_retry_at    timestamptz,
  delivered_at     timestamptz,
  attempts_history jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  claim_token      text,
  claim_expires_at timestamptz
);
-- Fila de retry com posse (lease) — o consumidor CAS disputa por aqui.
create index webhook_deliveries_outbox_idx on app.webhook_deliveries (business_id, status, next_retry_at)
  where status = 'pending';
create index webhook_deliveries_business_idx on app.webhook_deliveries (business_id, created_at desc);

create table app.idempotency_keys (
  id            text primary key,
  business_id   text not null references app.businesses(id) on delete cascade,
  key           text not null,
  endpoint      text not null default '',
  status_code   integer not null default 0,
  response_body jsonb,
  created_at    timestamptz not null default now(),
  unique (business_id, key)
);

create table app.integration_logs (
  id            text primary key,
  business_id   text not null references app.businesses(id) on delete cascade,
  endpoint      text not null default '',
  method        text not null default '',
  source        text not null default '',
  status        integer not null default 0,
  operation_id  text not null default '',
  error_message text not null default '',
  at            timestamptz not null default now()
);
create index integration_logs_business_idx on app.integration_logs (business_id, at desc);

-- ── Automações (P4), propostas (P5), tarefas ──────────────────────────────
create table app.automations (
  id                text primary key,
  business_id       text not null references app.businesses(id) on delete cascade,
  name              text not null default '',
  description       text not null default '',
  active            boolean not null default true,
  trigger           jsonb not null,
  nodes             jsonb not null default '[]'::jsonb,
  edges             jsonb not null default '[]'::jsonb,
  settings          jsonb not null default '{}'::jsonb,
  template_id       text not null default '',
  version           integer not null default 1,
  created_by_user_id text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index automations_business_active_idx on app.automations (business_id, active);

create table app.automation_runs (
  id               text primary key,
  business_id      text not null references app.businesses(id) on delete cascade,
  automation_id    text not null default '',
  automation_name  text not null default '',
  status           text not null default 'queued' check (status in ('queued','running','waiting','completed','failed','cancelled')),
  trigger_event    text not null default '',
  current_node_id  text not null default '',
  context          jsonb not null default '{}'::jsonb,
  waiting_until    timestamptz,
  started_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  finished_at      timestamptz,
  error            text not null default '',
  history          jsonb not null default '[]'::jsonb,
  event_key        text not null default '',
  emitted_by_run_id text not null default '',
  steps            integer not null default 0,
  resumes          integer not null default 0,
  last_action_type text not null default '',
  last_error       text not null default '',
  claim_token      text,
  claim_expires_at timestamptz
);
-- Idempotência do gatilho: mesma chave ⇒ no máximo uma execução.
-- Escopo do dedupe: (unidade, AUTOMAÇÃO, chave) — igual ao motor do documento.
create unique index automation_runs_event_uniq on app.automation_runs (business_id, automation_id, event_key)
  where event_key <> '';
create index automation_runs_due_idx on app.automation_runs (status, waiting_until)
  where status in ('queued','running','waiting');
create index automation_runs_business_idx on app.automation_runs (business_id, status, started_at desc);

create table app.tasks (
  id                text primary key,
  business_id       text not null references app.businesses(id) on delete cascade,
  title             text not null default '',
  note              text not null default '',
  status            text not null default 'open' check (status in ('open','done','cancelled')),
  due_at            timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  done_at           timestamptz,
  assigned_user_id  text not null default '',
  created_by        text not null default '',
  automation_id     text not null default '',
  automation_run_id text not null default '',
  automation_node_id text not null default '',
  lead_id           text not null default '',
  booking_id        text not null default '',
  customer_id       text not null default '',
  encounter_id      text not null default '',
  source            text not null default 'automation' check (source in ('automation','manual'))
);
create index tasks_business_status_idx on app.tasks (business_id, status);
create index tasks_business_due_idx on app.tasks (business_id, due_at);

create table app.ai_proposals (
  id                text primary key,
  business_id       text not null references app.businesses(id) on delete cascade,
  status            text not null default 'draft' check (status in ('draft','approved','published','cancelled')),
  prompt            text not null default '',
  plan              jsonb not null default '{}'::jsonb,
  nodes             jsonb not null default '[]'::jsonb,
  edges             jsonb not null default '[]'::jsonb,
  validation        jsonb not null default '{"ok":false,"errors":[],"warnings":[]}'::jsonb,
  automation_id     text not null default '',
  created_by_user_id text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  published_at      timestamptz
);
create index ai_proposals_business_idx on app.ai_proposals (business_id, status);

-- ── Integrações externas (P6) ─────────────────────────────────────────────
create table app.integrations (
  id                    text primary key,
  business_id           text not null references app.businesses(id) on delete cascade,
  kind                  text not null check (kind in ('channel','source','technical')),
  provider              text not null default '',
  name                  text not null default 'Integração',
  direction             text not null default 'in' check (direction in ('in','out','both')),
  status                text not null default 'active' check (status in ('active','paused')),
  token_hash            text not null default '',
  token_prefix          text not null default '',
  signing_secret        text not null default '',
  signing_secret_prefix text not null default '',
  require_signature     boolean not null default false,
  default_event         text not null default '',
  config                jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by_user_id    text not null default '',
  rotated_at            timestamptz,
  last_event_at         timestamptz,
  event_count           integer not null default 0
);
create unique index integrations_token_uniq on app.integrations (token_hash) where token_hash <> '';
create index integrations_business_idx on app.integrations (business_id, status);

create table app.integration_events (
  id                text primary key,
  business_id       text not null references app.businesses(id) on delete cascade,
  integration_id    text not null references app.integrations(id) on delete cascade,
  provider          text not null default '',
  direction         text not null default 'in' check (direction in ('in','out')),
  event             text not null default '',
  status            text not null default 'failed' check (status in ('processed','duplicate','rejected','failed')),
  external_event_id text not null default '',
  idempotency_key   text not null default '',
  http_status       integer not null default 0,
  reason            text not null default '',
  lead_id           text not null default '',
  contact_id        text not null default '',
  automation_run_ids jsonb not null default '[]'::jsonb,
  payload_summary   jsonb not null default '{}'::jsonb,
  at                timestamptz not null default now()
);
-- Idempotência por integração + identificador externo.
create unique index integration_events_idem_uniq on app.integration_events (business_id, idempotency_key)
  where idempotency_key <> '';
create index integration_events_business_idx on app.integration_events (business_id, at desc);
create index integration_events_integration_idx on app.integration_events (integration_id, at desc);

-- ── Fila de espera (A3.4) e registros de atendimento ──────────────────────
create table app.queue_entries (
  id              text primary key,
  business_id     text not null references app.businesses(id) on delete cascade,
  customer_name   text not null default '',
  customer_phone  text not null default '',
  contact_id      text not null default '',
  service_id      text not null default '',
  professional_id text not null default '',
  booking_id      text not null default '',
  note            text not null default '',
  status          text not null default 'waiting' check (status in ('waiting','called','in_service','done','left')),
  date            date not null,
  created_at      timestamptz not null default now(),
  called_at       timestamptz,
  started_at      timestamptz,
  ended_at        timestamptz,
  updated_by      text not null default '',
  updated_at      timestamptz not null default now()
);
-- Operação do dia por unidade: fila atual + histórico do período.
create index queue_entries_business_date_idx on app.queue_entries (business_id, date, status);
create index queue_entries_business_phone_idx on app.queue_entries (business_id, customer_phone);

create table app.encounters (
  id              text primary key,
  business_id     text not null references app.businesses(id) on delete cascade,
  booking_id      text not null default '',
  queue_id        text not null default '',
  service_id      text not null default '',
  professional_id text not null default '',
  customer_id     text references app.customers(id),
  contact_id      text not null default '',
  customer_name   text not null default '',
  date            date not null,
  time            text not null default '',
  complaint       text not null default '',
  evolution       text not null default '',
  guidance        text not null default '',
  follow_up       text not null default '',
  internal_note   text not null default '',
  tags            jsonb not null default '[]'::jsonb,
  status          text not null default 'draft' check (status in ('draft','finalized')),
  version         integer not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      text not null default '',
  updated_by      text not null default '',
  finalized_at    timestamptz,
  finalized_by    text not null default '',
  signed_by       text not null default ''
);
-- 1:1 opcionais garantidos no banco: um agendamento/entrada de fila tem NO
-- MÁXIMO um registro de atendimento.
create unique index encounters_booking_uniq on app.encounters (business_id, booking_id) where booking_id <> '';
create unique index encounters_queue_uniq on app.encounters (business_id, queue_id) where queue_id <> '';
create index encounters_business_date_idx on app.encounters (business_id, date);
create index encounters_business_contact_idx on app.encounters (business_id, contact_id, created_at desc);

-- ── Dependências circulares resolvidas ao fim ─────────────────────────────
alter table app.organizations
  add constraint organizations_public_business_fk
  foreign key (public_business_id) references app.businesses(id);
alter table app.leads
  add constraint leads_booking_fk foreign key (booking_id) references app.bookings(id);

-- ═══════════════════════════════════════════════════════════════════════
-- ISOLAMENTO: schema `app` FORA da Data API, grants mínimos, RLS negada
-- ═══════════════════════════════════════════════════════════════════════
-- A aplicação conecta como `godoutor_app` (senha definida pela OPERAÇÃO —
-- nunca versionada). `anon`/`authenticated` não recebem USAGE no schema nem
-- grant em tabela alguma: PostgREST não expõe nada daqui.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'godoutor_app') then
    create role godoutor_app login; -- senha: ALTER ROLE godoutor_app PASSWORD ... (operação)
  end if;
end $$;

revoke all on schema app from public;
revoke all on all tables in schema app from public;
revoke all on all sequences in schema app from public;
-- Papéis da Data API do Supabase (existem lá; fora do Supabase, são pulados).
do $$
declare r record;
begin
  for r in select rolname from pg_roles where rolname in ('anon', 'authenticated')
  loop
    execute format('revoke all on schema app from %I', r.rolname);
    execute format('revoke all on all tables in schema app from %I', r.rolname);
    execute format('revoke all on all sequences in schema app from %I', r.rolname);
  end loop;
end $$;
revoke all on schema public from godoutor_app; -- a app role não precisa do public

grant usage on schema app to godoutor_app;
grant select, insert, update, delete on all tables in schema app to godoutor_app;

-- RLS: mesmo para a app role a regra é explícita; para os papéis expostos
-- (Data API) vale a negação total (nenhuma política).
alter table app.schema_migrations enable row level security;
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'app' and tablename <> 'schema_migrations'
  loop
    execute format('alter table app.%I enable row level security', t.tablename);
    execute format('drop policy if exists godoutor_app_all on app.%I', t.tablename);
    execute format($f$create policy godoutor_app_all on app.%I
                     to godoutor_app using (true) with check (true)$f$, t.tablename);
  end loop;
end $$;

-- (nada em `public`: a Data API continua servindo somente o que existir lá —
-- hoje nada — e estas tabelas NÃO devem ser movidas para lá.)

insert into app.schema_migrations (version) values ('0001_godoutor_relational')
on conflict (version) do nothing;
