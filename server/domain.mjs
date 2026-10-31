import { GraphQLError, parse, Kind } from "graphql";
export const now = () => Math.floor(Date.now() / 1000);
export const fail = (code, message) => {
  throw new GraphQLError(message, { extensions: { code } });
};
export async function digest(value) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return (
    "idx_" +
    btoa(String.fromCharCode(...bytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "")
  );
}
export async function quota(db, key, limit, until) {
  return !!(await db
    .prepare(
      "INSERT INTO quotas (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<? RETURNING count",
    )
    .bind(key, until, limit)
    .first());
}
export async function workspace(context) {
  if (!context.auth) {
    context.auth = (async () => {
      const match = /^Bearer (idx_[A-Za-z0-9_-]{43})$/.exec(
        context.request.headers.get("authorization") ?? "",
      );
      if (!match) fail("UNAUTHENTICATED", "Token de workspace necessário.");
      const row = await context.db
        .prepare(
          "SELECT id,expires_at FROM workspaces WHERE token_hash=? AND expires_at>?",
        )
        .bind(await digest(match[1]), now())
        .first();
      if (!row)
        fail("UNAUTHENTICATED", "Token inválido, expirado ou revogado.");
      return row;
    })();
  }
  return context.auth;
}
export async function writable(context) {
  const w = await workspace(context),
    hour = Math.floor(now() / 3600);
  if (
    !(await quota(
      context.db,
      "write:" + w.id + ":" + hour,
      60,
      (hour + 1) * 3600,
    ))
  )
    fail("RATE_LIMITED", "Limite de 60 escritas por workspace por hora UTC.");
  return w;
}
export function textInput(title, body) {
  if (
    typeof title !== "string" ||
    !title.trim() ||
    title.length > 100 ||
    typeof body !== "string" ||
    body.length > 2000
  )
    fail(
      "BAD_USER_INPUT",
      "Título de 1 a 100 caracteres e corpo de até 2000 caracteres.",
    );
  return { title: title.trim(), body };
}
export function uuid(id) {
  if (
    typeof id !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)
  )
    fail("BAD_USER_INPUT", "ID inválido.");
  return id;
}
export function revision(value) {
  if (!Number.isInteger(value) || value < 1)
    fail("BAD_USER_INPUT", "expectedRevision deve ser positivo.");
  return value;
}
export function page(first = 5, after) {
  if (!Number.isInteger(first) || first < 1 || first > 10)
    fail("BAD_USER_INPUT", "first deve estar entre 1 e 10.");
  let cursor = "";
  if (after !== undefined && after !== null) {
    try {
      cursor = atob(after);
    } catch {
      fail("BAD_USER_INPUT", "Cursor inválido.");
    }
    uuid(cursor);
  }
  return { first, cursor };
}
export function queryTerm(term) {
  if (typeof term !== "string" || term.length > 100)
    fail("BAD_USER_INPUT", "Busca deve ter até 100 caracteres.");
  const tokens = term.normalize("NFC").match(/[\p{L}\p{N}]+/gu) ?? [];
  if (
    tokens.length < 1 ||
    tokens.length > 4 ||
    tokens.some((t) => Array.from(t).length < 2 || Array.from(t).length > 24)
  )
    fail("BAD_USER_INPUT", "Use 1 a 4 termos de 2 a 24 letras/números.");
  return tokens.map((t) => '"' + t + '"*').join(" AND ");
}
export function present(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    revision: row.revision,
    updatedAt: new Date(row.updated_at * 1000).toISOString(),
    excerpt: row.excerpt ?? null,
  };
}
export function guardQuery(query) {
  if (typeof query !== "string" || query.length > 12000)
    fail("QUERY_LIMIT", "Query deve ter até 12000 caracteres.");
  const ast = parse(query),
    operations = ast.definitions.filter(
      (d) => d.kind === Kind.OPERATION_DEFINITION,
    );
  if (operations.length !== 1)
    fail("QUERY_LIMIT", "Envie uma operação por requisição.");
  const op = operations[0],
    fragments = new Map(
      ast.definitions
        .filter((d) => d.kind === Kind.FRAGMENT_DEFINITION)
        .map((d) => [d.name.value, d]),
    );
  const introspection =
    op.operation === "query" &&
    op.selectionSet.selections.every(
      (s) =>
        s.kind === Kind.FIELD &&
        ["__schema", "__type", "__typename"].includes(s.name.value),
    );
  let fields = 0,
    aliases = 0,
    roots = 0;
  function walk(set, depth, stack = new Set()) {
    if (depth > (introspection ? 20 : 8))
      fail("QUERY_LIMIT", "Profundidade excedida.");
    for (const s of set.selections) {
      if (s.kind === Kind.FIELD) {
        fields++;
        if (s.alias) aliases++;
        if (depth === 1) roots++;
        if (fields > (introspection ? 3000 : 100) || aliases > 10 || roots > 10)
          fail("QUERY_LIMIT", "Quantidade de campos/aliases excedida.");
        if (s.selectionSet) walk(s.selectionSet, depth + 1, stack);
      } else if (s.kind === Kind.INLINE_FRAGMENT)
        walk(s.selectionSet, depth, stack);
      else {
        const name = s.name.value;
        if (stack.has(name)) fail("QUERY_LIMIT", "Fragmento recursivo.");
        const fragment = fragments.get(name);
        if (fragment)
          walk(fragment.selectionSet, depth, new Set([...stack, name]));
      }
    }
  }
  walk(op.selectionSet, 1);
  if (op.operation === "mutation" && roots !== 1)
    fail("QUERY_LIMIT", "Mutações exigem um campo raiz por operação.");
  return ast;
}
