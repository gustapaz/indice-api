import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep, basename } from "node:path";
import { createApi } from "../server/api.mjs";
import { digest, now, queryTerm } from "../server/domain.mjs";
let mf, db, api, directory;
const migration = new URL(
  "../drizzle/0000_careful_nightshade.sql",
  import.meta.url,
);
function runtime() {
  return new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("test")}}',
    compatibilityDate: "2026-05-15",
    d1Databases: { DB: "indice-test" },
    d1Persist: directory,
  });
}
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "indice-tests-"));
  mf = runtime();
  db = await mf.getD1Database("DB");
  for (const sql of (await readFile(migration, "utf8"))
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean))
    await db.prepare(sql).run();
  api = createApi(db);
});
beforeEach(async () => {
  await db.batch([
    db.prepare("DELETE FROM workspaces"),
    db.prepare("DELETE FROM quotas"),
  ]);
});
after(async () => {
  await mf.dispose();
  const actual = resolve(directory),
    base = resolve(tmpdir()) + sep;
  if (!actual.startsWith(base) || !basename(actual).startsWith("indice-tests-"))
    throw new Error("Unsafe test cleanup path");
  await rm(actual, { recursive: true, force: true });
});
async function gql(query, variables = {}, token) {
  const response = await api(
    new Request("https://indice.test/api/graphql", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify({ query, variables }),
    }),
  );
  return {
    status: response.status,
    body: await response.json(),
    headers: response.headers,
  };
}
async function session() {
  const r = await gql("mutation { createWorkspace { id token expiresAt } }");
  assert.equal(r.status, 200);
  assert.ok(!r.body.errors);
  return r.body.data.createWorkspace;
}
async function create(
  token,
  title = "Métricas",
  body = "Observabilidade com métricas e logs",
) {
  return gql(
    "mutation($t:String!,$b:String!){createDocument(title:$t,body:$b){id title body revision updatedAt}}",
    { t: title, b: body },
    token,
  );
}
const code = (r) => r.body.errors?.[0]?.extensions?.code;
test("health and public schema", async () => {
  const r = await api(new Request("https://indice.test/api/health"));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).database, "ok");
  assert.match(
    await (
      await api(new Request("https://indice.test/api/schema.graphql"))
    ).text(),
    /type Mutation/,
  );
});
test("tokens stored only as hashes; expiry and invalid auth denied", async () => {
  const s = await session(),
    row = await db
      .prepare("SELECT token_hash FROM workspaces WHERE id=?")
      .bind(s.id)
      .first();
  assert.equal(row.token_hash, await digest(s.token));
  assert.notEqual(row.token_hash, s.token);
  assert.equal(
    code(await gql("{ documents { edges { node { id } } } }")),
    "UNAUTHENTICATED",
  );
  assert.equal(
    code(
      await gql(
        "{ documents { edges { node { id } } } }",
        {},
        "idx_" + "x".repeat(43),
      ),
    ),
    "UNAUTHENTICATED",
  );
  await db
    .prepare("UPDATE workspaces SET expires_at=? WHERE id=?")
    .bind(now() - 1, s.id)
    .run();
  assert.equal(
    code(await gql("{documents{edges{node{id}}}}", {}, s.token)),
    "UNAUTHENTICATED",
  );
});
test("create, read and search use real SQLite FTS with accents/prefix", async () => {
  const s = await session(),
    r = await create(s.token),
    d = r.body.data.createDocument;
  assert.equal(d.revision, 1);
  const read = await gql(
    "query($id:ID!){document(id:$id){id body revision}}",
    { id: d.id },
    s.token,
  );
  assert.equal(read.body.data.document.id, d.id);
  const search = await gql(
    "query($term:String!){search(term:$term){edges{node{id excerpt}}}}",
    { term: "metri" },
    s.token,
  );
  assert.equal(search.body.data.search.edges[0].node.id, d.id);
  assert.match(search.body.data.search.edges[0].node.excerpt, /\[/);
});
test("workspace isolation for reads, search, updates and deletion", async () => {
  const a = await session(),
    b = await session(),
    created = await create(a.token),
    id = created.body.data.createDocument.id;
  assert.equal(
    (await gql("query($id:ID!){document(id:$id){id}}", { id }, b.token)).body
      .data.document,
    null,
  );
  assert.equal(
    (await gql('{search(term:"metri"){edges{node{id}}}}', {}, b.token)).body
      .data.search.edges.length,
    0,
  );
  const update = await gql(
    'mutation($id:ID!){updateDocument(id:$id,expectedRevision:1,title:"Outro",body:""){id}}',
    { id },
    b.token,
  );
  assert.equal(code(update), "NOT_FOUND");
  const del = await gql(
    "mutation($id:ID!){deleteDocument(id:$id,expectedRevision:1)}",
    { id },
    b.token,
  );
  assert.equal(code(del), "NOT_FOUND");
});
test("optimistic concurrency permits exactly one simultaneous revision", async () => {
  const s = await session(),
    d = (await create(s.token)).body.data.createDocument;
  const query =
    'mutation($id:ID!,$t:String!){updateDocument(id:$id,expectedRevision:1,title:$t,body:"novo"){id title revision}}';
  const results = await Promise.all([
    gql(query, { id: d.id, t: "alpha" }, s.token),
    gql(query, { id: d.id, t: "beta" }, s.token),
  ]);
  assert.equal(results.filter((r) => !r.body.errors).length, 1);
  assert.equal(results.filter((r) => code(r) === "CONFLICT").length, 1);
  assert.equal(
    results.find((r) => !r.body.errors).body.data.updateDocument.revision,
    2,
  );
  assert.equal(
    (
      await gql(
        '{search(term:"observabilidade"){edges{node{id}}}}',
        {},
        s.token,
      )
    ).body.data.search.edges.length,
    0,
  );
  assert.equal(
    (await gql('{search(term:"novo"){edges{node{id}}}}', {}, s.token)).body.data
      .search.edges.length,
    1,
  );
});
test("delete updates FTS; stale delete is rejected", async () => {
  const s = await session(),
    d = (await create(s.token)).body.data.createDocument;
  const q =
    "mutation($id:ID!,$r:Int!){deleteDocument(id:$id,expectedRevision:$r)}";
  assert.equal(code(await gql(q, { id: d.id, r: 2 }, s.token)), "CONFLICT");
  assert.equal(
    (await gql(q, { id: d.id, r: 1 }, s.token)).body.data.deleteDocument,
    true,
  );
  assert.equal(
    (await db.prepare("SELECT count(*) AS n FROM documents_fts").first()).n,
    0,
  );
});
test("revocation cascades documents and FTS and invalidates token", async () => {
  const s = await session();
  await create(s.token);
  assert.equal(
    (await gql("mutation{revokeWorkspace}", {}, s.token)).body.data
      .revokeWorkspace,
    true,
  );
  assert.equal(
    (await db.prepare("SELECT count(*) AS n FROM documents").first()).n,
    0,
  );
  assert.equal(
    (await db.prepare("SELECT count(*) AS n FROM documents_fts").first()).n,
    0,
  );
  assert.equal(
    code(await gql("{documents{edges{node{id}}}}", {}, s.token)),
    "UNAUTHENTICATED",
  );
});
test("keyset pagination has no duplicate edges and validates cursor", async () => {
  const s = await session();
  for (let i = 0; i < 5; i++) await create(s.token, "Doc " + i, "body");
  const ids = [];
  let after = null;
  do {
    const r = await gql(
      "query($a:String){documents(first:2,after:$a){edges{cursor node{id}}pageInfo{endCursor hasNextPage}}}",
      { a: after },
      s.token,
    );
    const c = r.body.data.documents;
    ids.push(...c.edges.map((e) => e.node.id));
    after = c.pageInfo.hasNextPage ? c.pageInfo.endCursor : null;
  } while (after);
  assert.equal(ids.length, 5);
  assert.equal(new Set(ids).size, 5);
  assert.equal(
    code(await gql("{documents(first:11){edges{node{id}}}}", {}, s.token)),
    "BAD_USER_INPUT",
  );
  assert.equal(
    code(await gql('{documents(after:"wrong"){edges{node{id}}}}', {}, s.token)),
    "BAD_USER_INPUT",
  );
});
test("atomic document cap under concurrency", async () => {
  const s = await session();
  for (let i = 0; i < 19; i++) await create(s.token, "Doc " + i, "body");
  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) => create(s.token, "Last " + i, "body")),
  );
  assert.equal(results.filter((r) => !r.body.errors).length, 1);
  assert.equal(results.filter((r) => code(r) === "WORKSPACE_FULL").length, 4);
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) AS n FROM documents WHERE workspace_id=?")
        .bind(s.id)
        .first()
    ).n,
    20,
  );
});
test("global creation quota and write quota are enforced", async () => {
  let s;
  for (let i = 0; i < 10; i++) s = await session();
  assert.equal(
    code(await gql("mutation{createWorkspace{id}}")),
    "RATE_LIMITED",
  );
  const hour = Math.floor(now() / 3600);
  await db
    .prepare("INSERT INTO quotas(key,count,expires_at) VALUES(?,60,?)")
    .bind("write:" + s.id + ":" + hour, (hour + 1) * 3600)
    .run();
  assert.equal(code(await create(s.token)), "RATE_LIMITED");
  assert.equal(
    (await gql("mutation{revokeWorkspace}", {}, s.token)).body.data
      .revokeWorkspace,
    true,
  );
});
test("query limits, fragments, aliases, batching and mutation roots", async () => {
  assert.equal(
    code(await gql("mutation{a:createWorkspace{id} b:createWorkspace{id}}")),
    "QUERY_LIMIT",
  );
  assert.equal(
    code(
      await gql(
        "{" +
          Array.from({ length: 11 }, (_, i) => "a" + i + ":__typename").join(
            " ",
          ) +
          "}",
      ),
    ),
    "QUERY_LIMIT",
  );
  assert.equal(
    code(await gql("query{...A} fragment A on Query{...A}")),
    "QUERY_LIMIT",
  );
  assert.equal(
    code(await gql("query A{__typename} query B{__typename}")),
    "QUERY_LIMIT",
  );
  const batch = await api(
    new Request("https://indice.test/api/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "[]",
    }),
  );
  assert.equal(batch.status, 400);
});
test("search syntax is restricted and SQL/FTS metacharacters are data", async () => {
  assert.equal(queryTerm("café logs"), '"café"* AND "logs"*');
  const s = await session();
  assert.equal(
    code(await gql('{search(term:"*"){edges{node{id}}}}', {}, s.token)),
    "BAD_USER_INPUT",
  );
  const r = await gql(
    "query($t:String!){search(term:$t){edges{node{id}}}}",
    { t: '" OR foo' },
    s.token,
  );
  assert.equal(r.body.errors, undefined);
  assert.equal(r.body.data.search.edges.length, 0);
});
test("field validation and standard GraphQL type validation", async () => {
  const s = await session();
  assert.equal(code(await create(s.token, "", "body")), "BAD_USER_INPUT");
  assert.equal(
    code(await create(s.token, "title", "x".repeat(2001))),
    "BAD_USER_INPUT",
  );
  const r = await gql(
    'mutation{createDocument(title:123,body:"body"){id}}',
    {},
    s.token,
  );
  assert.ok(r.body.errors);
});
test("index and document changes rollback together on database fault", async () => {
  const s = await session();
  await db
    .prepare(
      "CREATE TRIGGER fail_test_insert AFTER INSERT ON documents BEGIN SELECT RAISE(ABORT,'test-internal-sql'); END",
    )
    .run();
  try {
    const r = await create(s.token);
    assert.ok(r.body.errors);
    assert.ok(!JSON.stringify(r.body).includes("test-internal-sql"));
    assert.equal(
      (await db.prepare("SELECT count(*) AS n FROM documents").first()).n,
      0,
    );
    assert.equal(
      (await db.prepare("SELECT count(*) AS n FROM documents_fts").first()).n,
      0,
    );
  } finally {
    await db.prepare("DROP TRIGGER fail_test_insert").run();
  }
});
test("transport limits, invalid JSON, Origin and security headers", async () => {
  const call = (body, headers = {}) =>
    api(
      new Request("https://indice.test/api/graphql", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body,
      }),
    );
  assert.equal((await call("x")).status, 400);
  assert.equal((await call(" ".repeat(32769))).status, 413);
  assert.equal(
    (await call("{}", { "content-type": "text/plain" })).status,
    415,
  );
  assert.equal(
    (await call("{}", { origin: "https://other.example" })).status,
    403,
  );
  const r = await gql("{__typename}");
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("access-control-allow-origin"), null);
});
test("persistence survives runtime recreation", async () => {
  const s = await session(),
    d = (await create(s.token)).body.data.createDocument;
  await mf.dispose();
  mf = runtime();
  db = await mf.getD1Database("DB");
  api = createApi(db);
  const r = await gql(
    "query($id:ID!){document(id:$id){id revision}}",
    { id: d.id },
    s.token,
  );
  assert.equal(r.body.data.document.id, d.id);
  assert.equal(r.body.data.document.revision, 1);
});
