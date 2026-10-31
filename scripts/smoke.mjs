import assert from "node:assert/strict";
const base = process.argv[2];
if (!base) throw new Error("Use npm run smoke -- URL");
let token = "";
async function gql(query, variables = {}) {
  const r = await fetch(new URL("/api/graphql", base), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  assert.equal(r.status, 200);
  return r.json();
}
assert.equal(
  (await (await fetch(new URL("/api/health", base))).json()).database,
  "ok",
);
const s = await gql("mutation{createWorkspace{id token expiresAt}}");
assert.ok(!s.errors);
token = s.data.createWorkspace.token;
try {
  const created = await gql(
    'mutation{createDocument(title:"Métricas de exemplo",body:"Observabilidade com logs e rastreamento"){id revision}}',
  );
  assert.ok(!created.errors);
  const id = created.data.createDocument.id;
  const search = await gql('{search(term:"metri"){edges{node{id revision}}}}');
  assert.equal(search.data.search.edges[0].node.id, id);
  const update = await gql(
    'mutation($id:ID!){updateDocument(id:$id,expectedRevision:1,title:"Revisado",body:"Novo conteúdo"){id revision}}',
    { id },
  );
  assert.equal(update.data.updateDocument.revision, 2);
  const stale = await gql(
    "mutation($id:ID!){deleteDocument(id:$id,expectedRevision:1)}",
    { id },
  );
  assert.equal(stale.errors[0].extensions.code, "CONFLICT");
  const read = await gql("query($id:ID!){document(id:$id){id revision}}", {
    id,
  });
  assert.equal(read.data.document.revision, 2);
  console.log(
    JSON.stringify(
      {
        ok: true,
        base: new URL(base).origin,
        checks: [
          "health+database",
          "workspace",
          "persist document",
          "FTS prefix search",
          "optimistic update",
          "stale conflict",
          "read persisted",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  const revoked = await gql("mutation{revokeWorkspace}");
  assert.equal(revoked.data.revokeWorkspace, true);
  const denied = await gql("{documents{edges{node{id}}}}");
  assert.equal(denied.errors[0].extensions.code, "UNAUTHENTICATED");
  console.log("Synthetic smoke workspace revoked.");
}
