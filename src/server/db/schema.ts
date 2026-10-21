// Drizzle table definitions for typed CRUD. The DDL source of truth is
// ./migrations.ts; keep the two in sync. `chunks.tsv` is a generated column used
// only from raw SQL, so it is not declared here.
import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  vector,
} from "drizzle-orm/pg-core";
import { EMBEDDING_DIMENSIONS } from "./migrations";

export const documents = pgTable("documents", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  fileName: text("file_name").notNull(),
  issuanceType: text("issuance_type"),
  issuanceNo: text("issuance_no"),
  dateIssued: date("date_issued"),
  effectivityDate: date("effectivity_date"),
  issuingOffice: text("issuing_office"),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size").notNull().default(0),
  pageCount: integer("page_count").notNull().default(0),
  lowTextPages: integer("low_text_pages").array().notNull().default([]),
  status: text("status").notNull().default("uploaded"),
  statusDetail: text("status_detail"),
  suggestedMetadata: jsonb("suggested_metadata"),
  uploadedBy: text("uploaded_by"),
  metadataConfirmedBy: text("metadata_confirmed_by"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documentPages = pgTable(
  "document_pages",
  {
    documentId: text("document_id").notNull(),
    pageNo: integer("page_no").notNull(),
    content: text("content").notNull(),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.pageNo] })],
);

export const documentLineage = pgTable("document_lineage", {
  id: text("id").primaryKey(),
  olderDocumentId: text("older_document_id").notNull(),
  newerDocumentId: text("newer_document_id").notNull(),
  relation: text("relation").$type<LineageRelation>().notNull(),
  scopeNote: text("scope_note"),
  confirmedBy: text("confirmed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chunks = pgTable("chunks", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  pageStart: integer("page_start").notNull(),
  pageEnd: integer("page_end").notNull(),
  sectionLabel: text("section_label"),
  content: text("content").notNull(),
  tokenCount: integer("token_count").notNull().default(0),
  embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
});

export const forms = pgTable("forms", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  fileUrl: text("file_url").notNull(),
  fileName: text("file_name").notNull(),
  topics: text("topics").array().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull(),
  title: text("title").notNull(),
  roleAtStart: text("role_at_start").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  sender: text("sender").$type<"user" | "assistant">().notNull(),
  content: text("content").notNull(),
  persona: text("persona").notNull(),
  mode: text("mode").notNull(),
  payload: jsonb("payload"),
  foundInDocuments: boolean("found_in_documents"),
  retrievedChunkIds: text("retrieved_chunk_ids").array().notNull().default([]),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const simplifications = pgTable("simplifications", {
  messageId: text("message_id").primaryKey(),
  plainEnglish: text("plain_english").notNull(),
  filipino: text("filipino").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: text("id").primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  detail: jsonb("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LineageRelation = "amends" | "supersedes" | "repeals";
export type DocumentRow = typeof documents.$inferSelect;
export type ChunkRow = typeof chunks.$inferSelect;
export type FormRow = typeof forms.$inferSelect;
export type LineageRow = typeof documentLineage.$inferSelect;
