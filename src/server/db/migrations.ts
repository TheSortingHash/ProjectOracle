// Ordered, append-only SQL migrations. Never edit a shipped entry; add a new one.
// Applied lazily on first database access (see ./index.ts) so neither the build
// nor a fresh deploy needs a separate migrate step.

export const EMBEDDING_DIMENSIONS = 1024;

export const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: "0001_init",
    sql: `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
  id               text PRIMARY KEY,
  title            text NOT NULL,
  file_name        text NOT NULL,
  issuance_type    text,
  issuance_no      text,
  date_issued      date,
  effectivity_date date,
  issuing_office   text,
  file_url         text NOT NULL,
  file_size        integer NOT NULL DEFAULT 0,
  page_count       integer NOT NULL DEFAULT 0,
  low_text_pages   integer[] NOT NULL DEFAULT '{}',
  status           text NOT NULL DEFAULT 'uploaded',
  status_detail    text,
  suggested_metadata jsonb,
  uploaded_by      text,
  metadata_confirmed_by text,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_pages (
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_no     integer NOT NULL,
  content     text NOT NULL,
  PRIMARY KEY (document_id, page_no)
);

CREATE TABLE IF NOT EXISTS document_lineage (
  id                text PRIMARY KEY,
  older_document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  newer_document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  relation          text NOT NULL CHECK (relation IN ('amends','supersedes','repeals')),
  scope_note        text,
  confirmed_by      text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (older_document_id, newer_document_id)
);

CREATE TABLE IF NOT EXISTS chunks (
  id            text PRIMARY KEY,
  document_id   text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal       integer NOT NULL,
  page_start    integer NOT NULL,
  page_end      integer NOT NULL,
  section_label text,
  content       text NOT NULL,
  token_count   integer NOT NULL DEFAULT 0,
  embedding     vector(${EMBEDDING_DIMENSIONS}),
  tsv           tsvector GENERATED ALWAYS AS (
                  to_tsvector('english', coalesce(section_label, '') || ' ' || content)
                ) STORED
);
CREATE INDEX IF NOT EXISTS chunks_document_idx ON chunks (document_id);
CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS forms (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  description text,
  file_url    text NOT NULL,
  file_name   text NOT NULL,
  topics      text[] NOT NULL DEFAULT '{}',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  id            text PRIMARY KEY,
  client_id     text NOT NULL,
  title         text NOT NULL,
  role_at_start text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_client_idx ON conversations (client_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id                  text PRIMARY KEY,
  conversation_id     text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender              text NOT NULL CHECK (sender IN ('user','assistant')),
  content             text NOT NULL,
  persona             text NOT NULL,
  mode                text NOT NULL,
  payload             jsonb,
  found_in_documents  boolean,
  retrieved_chunk_ids text[] NOT NULL DEFAULT '{}',
  input_tokens        integer NOT NULL DEFAULT 0,
  output_tokens       integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS simplifications (
  message_id    text PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  plain_english text NOT NULL,
  filipino      text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          text PRIMARY KEY,
  actor       text NOT NULL,
  action      text NOT NULL,
  target_type text,
  target_id   text,
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
`,
  },
];
