# Arquitetura

O objetivo é estudar GraphQL com persistência, busca FTS e controle otimista de concorrência. Yoga recebe operações tipadas; resolvers executam SQL parametrizado no D1. Não há biblioteca de busca externa, IA ou dados no armazenamento do navegador.

- `server/schema.mjs`: schema SDL público.
- `server/api.mjs`: transporte, limites e contexto por requisição.
- `server/domain.mjs`: tokens, autorização, cursores, quotas e custo GraphQL.
- `server/resolvers.mjs`: consultas e mutações reais.
- `db/schema.ts` e `drizzle/`: schema, índices, FTS5 e triggers.
- `tests/api.test.mjs`: integração SQLite/D1 real, incluindo concorrência e reinício.

Cada documento pertence a um workspace. Todas as consultas de documento e FTS incluem esse ID autenticado. Tokens de 256 bits são retornados uma vez e armazenados como SHA-256. Autorizações são resolvidas e compartilhadas apenas dentro daquela requisição.

Inserções usam verificação do limite de 20 documentos dentro do mesmo INSERT SELECT. Atualizações e exclusões incluem revision=expectedRevision no WHERE. Somente uma atualização concorrente vence; a outra recebe CONFLICT. Não se faz leitura seguida de escrita sem condição.

Triggers mantêm a tabela virtual FTS na mesma transação. Uma falha de gravação reverte documento e índice. A revogação exclui em cascata documentos, disparando a limpeza do FTS. Workspaces expirados perdem acesso imediatamente; exclusão física é oportunística e limitada.

Paginação usa UUID e cursor base64, com busca first+1 para hasNextPage. Não existe snapshot entre requisições. Termos FTS são extraídos como letras/números, citados e enviados por bind; operadores FTS não são aceitos. Não é um ranking semântico.

O banco local persiste em .wrangler/state. A hospedagem recebe o binding D1 e aplica migrações antes do Worker. Tests usam banco temporário separado, verificam rollback e reabertura. Não existem resets globais ou credenciais administrativas públicas.
