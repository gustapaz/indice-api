# Índice API

Documentos persistidos, busca textual e controle de revisões com **GraphQL Yoga + SQLite/D1 + FTS5**. A API, autorização, SQL e índice são reais; apenas os documentos de demonstração são sintéticos.

[Demo](https://indice-api-gustapaz.starrylinen.chatgpt.site) · [Documentação](https://indice-api-gustapaz.starrylinen.chatgpt.site/docs.html) · [Schema SDL](https://indice-api-gustapaz.starrylinen.chatgpt.site/api/schema.graphql)

## Recursos

- Workspaces isolados com token aleatório temporário, mostrado uma vez.
- Criar, ler, atualizar e excluir documentos com autorização por recurso.
- Busca FTS5 por prefixos, insensível a acentos, com excerpts em texto.
- Índice mantido por triggers na mesma transação do documento.
- Revisão otimista: duas atualizações com a mesma revisão não se sobrescrevem.
- Paginação por cursor, limites de operação GraphQL e revogação do workspace.
- Persistência real entre requisições e reinícios, dentro da retenção da demo.

## Executar localmente

Node.js 24 e npm. Sem conta de cloud, Docker, cartão ou segredo.

```sh
npm ci
npm run build
npm run db:migrate
npm start -- --port 5223
```

Abra http://127.0.0.1:5223 e /docs.html. A migração atua explicitamente no banco local, em .wrangler/state, sem apagar dados existentes. O seed da demonstração é criado pelo roteiro da interface em um workspace novo; não há seed global ou reset destrutivo.

```sh
npm run check
npm run typecheck
npm test
npm run smoke -- http://127.0.0.1:5223
```

16 testes de integração com GraphQL e SQLite/D1 reais no Miniflare, sem mocks do banco. Cobrem hash/expiração de tokens, isolamento, FTS, revisão concorrente, paginação, limites atômicos, rollback e reabertura do banco. A CI instala do lockfile, verifica schema/build, formatação e tipos e executa a suíte. O smoke usa HTTP real e revoga somente o workspace que criou.

## Usar GraphQL

POST /api/graphql, Content-Type: application/json. Comece sem token:

```json
{"query":"mutation { createWorkspace { id token expiresAt } }"}
```

O token aparece uma vez. Envie Authorization: Bearer <token> nas operações privadas. Não coloque tokens em URLs, logs públicos ou Git.

```graphql
mutation {
  createDocument(title: "Guia", body: "Métricas e observabilidade") {
    id
    revision
  }
}

query {
  search(term: "metri", first: 5) {
    edges { cursor node { id title excerpt revision } }
    pageInfo { endCursor hasNextPage }
  }
}
```

Envie cada operação separadamente. updateDocument e deleteDocument exigem expectedRevision. Uma revisão antiga retorna errors com code CONFLICT; ler novamente permite decidir a próxima alteração. revokeWorkspace invalida o token e remove documentos e índice daquele workspace.

GraphQL pode responder HTTP 200 com errors. Verifique extensions.code: UNAUTHENTICATED, BAD_USER_INPUT, NOT_FOUND, CONFLICT, WORKSPACE_FULL ou RATE_LIMITED. Erros de transporte/limites usam 400, 403, 404, 413 ou 415. X-Request-Id identifica a requisição, sem expor detalhes SQL.

## Semântica

Busca aceita de 1 a 4 termos de 2 a 24 letras/números. Termos são literais, unidos por AND, com prefixo; não aceita sintaxe FTS arbitrária. Excerpts usam colchetes, nunca HTML. Ordenação e cursor são por UUID; não há promessa de snapshot entre páginas. first fica entre 1 e 10. Leituras fora do workspace retornam null; mutações retornam NOT_FOUND.

20 documentos/workspace, título até 100 caracteres e corpo até 2000. Token de 24 horas; acesso expira nesse prazo e exclusão física é oportunística ao criar novos workspaces. Revogação própria é imediata. Cotas: 10 workspaces/hora UTC globalmente e 60 escritas/workspace/hora. A revogação continua disponível após esgotar a cota de escrita.

Corpo JSON até 32 KiB, query até 12000 caracteres, uma operação, profundidade 8, até 100 campos expandidos e 10 aliases/raízes. Mutações exigem um campo raiz. Introspecção exclusiva de schema tem limites maiores e não acessa documentos. Sem batching, upload, WebSocket ou query por GET.

## Arquitetura e hospedagem

[Arquitetura](docs/architecture.md) · [Segurança](docs/security.md)

O adaptador Vinext/React serve o Worker e a página técnica. GraphQL Yoga resolve as operações; SQL parametrizado e triggers preservam o índice. Migrações e metadados Drizzle estão versionados. FTS/triggers são customizações da migração inicial: não edite migrações aplicadas, gere novas.

Demo em Sites com binding D1 DB. Nenhum cartão, faturamento, trial ou plano pago foi ativado. GitHub hospeda código/CI; Pages não executa banco ou API. Cotas de leitura e disponibilidade dependem da hospedagem, sem SLA ou promessa de gratuidade permanente. Use somente dados sintéticos, nunca documentos sensíveis.

Não há conta pessoal, senha, e-mail ou efeitos externos. Quem possui o token controla apenas aquele workspace até sua expiração. A interface mantém o token na memória da aba e o oculta nos logs; recarregar perde o acesso. Credenciais de publicação ficam fora do Git.

## Licença

Código do projeto sob MIT. Dependências conservam suas licenças. Tooling Sites/Vinext preserva avisos em vendor e scripts/vite/sites-vite-plugin.LICENSE.
