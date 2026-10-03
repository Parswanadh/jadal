/**
 * Contact queries.
 *
 * `ContactRecord` adds the escalation-ladder flag beside the contract `Contact`.
 */

import { Contact } from "@jadal/contracts/entities";
import { resultRows, type DbEnv } from "../store";
import { emptyWhere, eq, limitClause, toBool, withOptional } from "./shared";

export interface ContactFilter {
  readonly farmerId?: string;
  readonly status?: Contact["status"];
  readonly purpose?: Contact["purpose"];
  readonly channel?: Contact["channel"];
  readonly limit?: number;
}

/**
 * `Contact` with its escalation-ladder flag.
 *
 * `contact.status` already says whether the *attempt* escalated; the separate `escalated` column says
 * whether the farmer had been contacted before this attempt, which is what the ladder branches on.
 */
export interface ContactRecord extends Contact {
  readonly escalated: boolean;
}

interface ContactRow {
  id: string;
  farmer_id: string;
  channel: string;
  purpose: string;
  status: string;
  attempt: number;
  message_te: string;
  message_en: string;
  at: string;
  transcript: string | null;
  escalated: number;
}

function toContact(row: ContactRow): ContactRecord {
  const parsed = Contact.parse(
    withOptional(
      {
        id: row.id,
        farmer_id: row.farmer_id,
        channel: row.channel,
        purpose: row.purpose,
        status: row.status,
        attempt: row.attempt,
        message_te: row.message_te,
        message_en: row.message_en,
        at: row.at,
      },
      "transcript",
      row.transcript,
    ),
  );
  return { ...parsed, escalated: toBool(row.escalated) };
}

/**
 * Contacts in `at` order, oldest first — the conversation, forwards.
 *
 * `id` breaks ties so two attempts logged in one batch still order totally.
 */
export async function listContacts(env: DbEnv, filter: ContactFilter = {}): Promise<ContactRecord[]> {
  let where = eq(emptyWhere(), "farmer_id", filter.farmerId);
  where = eq(where, "status", filter.status);
  where = eq(where, "purpose", filter.purpose);
  where = eq(where, "channel", filter.channel);

  const limit = limitClause(filter.limit);
  const rows = resultRows(
    await env.DB.prepare(`SELECT * FROM contact${where.sql} ORDER BY at ASC, id ASC${limit.sql}`)
      .bind(...where.bindings, ...limit.bindings)
      .all<ContactRow>(),
  );
  return rows.map(toContact);
}

/** One contact, or `null` when the id is unknown. */
export async function getContact(env: DbEnv, contactId: string): Promise<ContactRecord | null> {
  const row = await env.DB.prepare("SELECT * FROM contact WHERE id = ?").bind(contactId).first<ContactRow>();
  return row === null ? null : toContact(row);
}
