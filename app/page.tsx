import Playground from "./playground";
export default function Home() {
  return (
    <main style={{ "--accent": "#21547c" } as React.CSSProperties}>
      <header>
        <a className="brand" href="/">
          Índice API<span>GRAPHQL + SQLITE</span>
        </a>
        <nav aria-label="Recursos">
          <a href="/docs.html">Documentação ↗</a>
          <a href="/api/schema.graphql">Schema SDL ↗</a>
          <a href="https://github.com/gustapaz/indice-api">GitHub ↗</a>
        </nav>
      </header>
      <section className="intro">
        <p className="eyebrow">GRAPHQL YOGA / D1 / FTS5</p>
        <h1>
          O documento muda.
          <br />O índice acompanha.
        </h1>
        <p>
          Documentos persistidos, busca textual e atualizações que não
          sobrescrevem uma revisão mais nova. Uma API GraphQL real com
          isolamento por workspace e índice sincronizado por triggers.
        </p>
        <div className="tags">
          <span>PERSISTÊNCIA REAL</span>
          <span>BUSCA FTS</span>
          <span>REVISÃO OTIMISTA</span>
        </div>
      </section>
      <Playground />
      <section className="notes">
        <div>
          <h2>Busca e documento, juntos.</h2>
          <p>
            Inserções, atualizações e exclusões atualizam o índice FTS na mesma
            transação. Se uma gravação falha, documento e índice são revertidos.
            A paginação usa cursor por ID; as buscas aceitam prefixos de 1 a 4
            termos.
          </p>
        </div>
        <div>
          <h2>Uma demo com escopo definido.</h2>
          <p>
            Até 20 documentos por workspace, token de 24 horas, 60 escritas por
            hora e 10 workspaces por hora UTC globalmente. Queries e corpos têm
            limites próprios. Nenhum cartão ou faturamento foi ativado.
          </p>
          <a href="/api/health">Consultar health e banco →</a>
        </div>
      </section>
      <footer>
        <span>Índice API · Gustavo Paz</span>
        <span>Dados sintéticos. Persistência no servidor.</span>
      </footer>
    </main>
  );
}
