"use client";
import { useRef, useState } from "react";
type Session = { id: string; token: string; expiresAt: string };
type Doc = { id: string; revision: number };
type Payload = {
  data?: {
    createWorkspace?: Session;
    createDocument?: Doc;
    updateDocument?: Doc;
    revokeWorkspace?: boolean;
    [key: string]: unknown;
  };
  errors?: { message: string; extensions?: { code?: string } }[];
};
type Entry = { operation: string; status: number; payload: unknown };
export default function Playground() {
  const token = useRef(""),
    [session, setSession] = useState<Session | null>(null),
    [busy, setBusy] = useState(false),
    [term, setTerm] = useState("observabilidade"),
    [entries, setEntries] = useState<Entry[]>([]),
    [message, setMessage] = useState(
      "Pronto para criar um workspace sintético.",
    );
  async function send(
    operation: string,
    query: string,
    variables: Record<string, unknown> = {},
  ) {
    const response = await fetch("/api/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token.current ? { Authorization: "Bearer " + token.current } : {}),
      },
      body: JSON.stringify({ query, variables }),
    });
    const payload = (await response.json()) as Payload;
    const safe = payload.data?.createWorkspace
      ? {
          ...payload,
          data: {
            ...payload.data,
            createWorkspace: {
              ...payload.data.createWorkspace,
              token: "[omitido: apenas na memória da página]",
            },
          },
        }
      : payload;
    setEntries((old) => [
      ...old,
      { operation, status: response.status, payload: safe },
    ]);
    return payload;
  }
  function check(value: Payload) {
    if (value.errors?.length)
      throw new Error(
        value.errors[0].extensions?.code + ": " + value.errors[0].message,
      );
  }
  async function run() {
    setBusy(true);
    setEntries([]);
    try {
      const start = await send(
        "Criar workspace",
        "mutation{createWorkspace{id token expiresAt}}",
      );
      check(start);
      const s = start.data?.createWorkspace;
      if (!s) throw new Error("Resposta de sessão inválida.");
      token.current = s.token;
      setSession({ ...s, token: "[omitido]" });
      const created = await send(
        "Persistir documento",
        "mutation($t:String!,$b:String!){createDocument(title:$t,body:$b){id title revision}}",
        {
          t: "Guia de observabilidade",
          b: "Métricas, logs e rastreamento distribuído.",
        },
      );
      check(created);
      const d = created.data?.createDocument;
      if (!d) throw new Error("Documento não criado.");
      check(
        await send(
          "Buscar no índice FTS",
          'query{search(term:"metri"){edges{node{id title excerpt revision}}}}',
        ),
      );
      check(
        await send(
          "Atualizar com revisão atual",
          'mutation($id:ID!){updateDocument(id:$id,expectedRevision:1,title:"Guia de observabilidade",body:"Observabilidade revisada: métricas e logs."){id revision}}',
          { id: d.id },
        ),
      );
      const stale = await send(
        "Recusar revisão antiga",
        'mutation($id:ID!){updateDocument(id:$id,expectedRevision:1,title:"Revisão perdida",body:""){id revision}}',
        { id: d.id },
      );
      if (stale.errors?.[0]?.extensions?.code !== "CONFLICT")
        throw new Error("Conflito esperado não foi detectado.");
      setMessage(
        "Roteiro concluído: documento persistido, busca FTS funcionando e revisão antiga recusada.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Falha ao consultar API.");
    } finally {
      setBusy(false);
    }
  }
  async function search(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      check(
        await send(
          "Busca personalizada",
          "query($term:String!){search(term:$term,first:5){edges{node{id title excerpt revision}}pageInfo{endCursor hasNextPage}}}",
          { term },
        ),
      );
      setMessage("Busca concluída no banco do seu workspace.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Falha na busca.");
    } finally {
      setBusy(false);
    }
  }
  async function revoke() {
    setBusy(true);
    try {
      const r = await send("Revogar workspace", "mutation{revokeWorkspace}");
      check(r);
      if (!r.data?.revokeWorkspace)
        throw new Error("Revogação não confirmada.");
      token.current = "";
      setSession(null);
      setMessage(
        "Token revogado e documentos/índice deste workspace removidos.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Falha na revogação.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="lab" aria-labelledby="lab-title">
      <div className="entry">
        <h2 id="lab-title">Um roteiro sobre um banco real.</h2>
        <ol className="steps">
          <li>Criar workspace isolado</li>
          <li>Gravar um documento sintético</li>
          <li>Buscar usando SQLite FTS5</li>
          <li>Atualizar com revisão esperada</li>
          <li>Recusar atualização desatualizada</li>
        </ol>
        <div className="actions">
          <button
            className="primary"
            disabled={busy || !!session}
            onClick={run}
          >
            {busy ? "Processando…" : "Executar roteiro →"}
          </button>
          <button disabled={busy || !session} onClick={revoke}>
            Revogar e apagar workspace
          </button>
        </div>
        <form onSubmit={search}>
          <label htmlFor="term">Busca no seu workspace</label>
          <input
            id="term"
            value={term}
            disabled={busy || !session}
            onChange={(e) => setTerm(e.target.value)}
            maxLength={100}
          />
          <button disabled={busy || !session} type="submit">
            Buscar documentos
          </button>
        </form>
        <p className="small">
          Token apenas na memória desta aba, oculto nas respostas abaixo.
          Recarregar perde o acesso. O workspace expira em 24 horas; remoção
          física é oportunística. Use somente dados sintéticos.
        </p>
        {session && (
          <p className="small">
            Workspace: {session.id}
            <br />
            Expiração UTC: {session.expiresAt}
          </p>
        )}
      </div>
      <div className="response">
        <span className="eyebrow">GRAPHQL / RESPOSTAS REAIS</span>
        <p role="status" aria-live="polite">
          {message}
        </p>
        {entries.length ? (
          <pre aria-label="Respostas GraphQL">
            {entries
              .map(
                (e) =>
                  e.operation +
                  " · HTTP " +
                  e.status +
                  "\n" +
                  JSON.stringify(e.payload, null, 2),
              )
              .join("\n\n")}
          </pre>
        ) : (
          <div className="empty">
            As respostas aparecem aqui, incluindo o conflito esperado de
            revisão. GraphQL pode retornar HTTP 200 com errors: confira o código
            de domínio.
          </div>
        )}
      </div>
    </section>
  );
}
