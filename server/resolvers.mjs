import {
  workspace,
  writable,
  now,
  quota,
  token,
  digest,
  fail,
  textInput,
  uuid,
  revision,
  page,
  queryTerm,
  present,
} from "./domain.mjs";
async function existing(c, id, w) {
  return c.db
    .prepare("SELECT * FROM documents WHERE id=? AND workspace_id=?")
    .bind(id, w.id)
    .first();
}
async function conflict(c, id, w) {
  if (await existing(c, id, w))
    fail("CONFLICT", "Revisão desatualizada. Leia o documento novamente.");
  fail("NOT_FOUND", "Documento não encontrado neste workspace.");
}
async function connection(c, args, term) {
  const w = await workspace(c),
    { first, cursor } = page(args.first, args.after);
  let rows;
  if (term !== undefined) {
    rows = await c.db
      .prepare(
        "SELECT d.*,snippet(documents_fts,1,'[',']',' … ',12) AS excerpt FROM documents_fts JOIN documents d ON d.rowid=documents_fts.rowid WHERE documents_fts MATCH ? AND d.workspace_id=? AND d.id>? ORDER BY d.id LIMIT ?",
      )
      .bind(queryTerm(term), w.id, cursor, first + 1)
      .all();
  } else
    rows = await c.db
      .prepare(
        "SELECT * FROM documents WHERE workspace_id=? AND id>? ORDER BY id LIMIT ?",
      )
      .bind(w.id, cursor, first + 1)
      .all();
  const values = rows.results.slice(0, first),
    edges = values.map((row) => ({ cursor: btoa(row.id), node: present(row) }));
  return {
    edges,
    pageInfo: {
      hasNextPage: rows.results.length > first,
      endCursor: edges.at(-1)?.cursor ?? null,
    },
  };
}
export const resolvers = {
  Query: {
    document: async (_, args, c) => {
      const w = await workspace(c),
        row = await existing(c, uuid(args.id), w);
      return row ? present(row) : null;
    },
    documents: (_, args, c) => connection(c, args),
    search: (_, args, c) => connection(c, args, args.term),
  },
  Mutation: {
    createWorkspace: async (_, __, c) => {
      const t = now(),
        hour = Math.floor(t / 3600);
      if (!(await quota(c.db, "create:" + hour, 10, (hour + 1) * 3600)))
        fail("RATE_LIMITED", "Limite global de 10 workspaces por hora UTC.");
      await c.db.batch([
        c.db
          .prepare(
            "DELETE FROM workspaces WHERE id IN (SELECT id FROM workspaces WHERE expires_at<=? LIMIT 100)",
          )
          .bind(t),
        c.db
          .prepare(
            "DELETE FROM quotas WHERE key IN (SELECT key FROM quotas WHERE expires_at<=? LIMIT 100)",
          )
          .bind(t),
      ]);
      const raw = token(),
        id = crypto.randomUUID(),
        expires = t + 86400;
      await c.db
        .prepare(
          "INSERT INTO workspaces (id,token_hash,expires_at) VALUES (?,?,?)",
        )
        .bind(id, await digest(raw), expires)
        .run();
      return {
        id,
        token: raw,
        expiresAt: new Date(expires * 1000).toISOString(),
      };
    },
    revokeWorkspace: async (_, __, c) => {
      const w = await workspace(c);
      await c.db.prepare("DELETE FROM workspaces WHERE id=?").bind(w.id).run();
      return true;
    },
    createDocument: async (_, args, c) => {
      const input = textInput(args.title, args.body),
        w = await writable(c),
        id = crypto.randomUUID();
      const row = await c.db
        .prepare(
          "INSERT INTO documents (id,workspace_id,title,body,revision,updated_at) SELECT ?,?,?,?,1,unixepoch() WHERE (SELECT count(*) FROM documents WHERE workspace_id=?)<20 RETURNING *",
        )
        .bind(id, w.id, input.title, input.body, w.id)
        .first();
      if (!row)
        fail("WORKSPACE_FULL", "Limite de 20 documentos por workspace.");
      return present(row);
    },
    updateDocument: async (_, args, c) => {
      const id = uuid(args.id),
        expected = revision(args.expectedRevision),
        input = textInput(args.title, args.body),
        w = await writable(c);
      const row = await c.db
        .prepare(
          "UPDATE documents SET title=?,body=?,revision=revision+1,updated_at=unixepoch() WHERE id=? AND workspace_id=? AND revision=? RETURNING *",
        )
        .bind(input.title, input.body, id, w.id, expected)
        .first();
      if (!row) await conflict(c, id, w);
      return present(row);
    },
    deleteDocument: async (_, args, c) => {
      const id = uuid(args.id),
        expected = revision(args.expectedRevision),
        w = await writable(c);
      const row = await c.db
        .prepare(
          "DELETE FROM documents WHERE id=? AND workspace_id=? AND revision=? RETURNING id",
        )
        .bind(id, w.id, expected)
        .first();
      if (!row) await conflict(c, id, w);
      return true;
    },
  },
};
