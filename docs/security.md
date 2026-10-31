# Segurança e limites

Token aleatório de 256 bits, hash no banco, expiração e revogação própria. Sem recuperação por senha. Quem possui o token controla aquele workspace. Queries/mutações incluem autorização por recurso; testes verificam leitura, busca, atualização e exclusão entre workspaces.

SQL usa bind de parâmetros. Revisões, limites, títulos, corpos e cursores são validados. FTS aceita termos limitados, sem sintaxe arbitrária. O limite de documentos e as quotas são verificados atomicamente no SQL. O índice é mantido por triggers, sem janela de inconsistência.

Corpo até 32 KiB por stream real, mídia JSON sem compressão. Uma operação por requisição, sem batching ou query por GET. Queries têm profundidade/custo limitados e fragmentos recursivos são recusados. Introspecção pública descreve apenas schema; não revela documentos ou tokens existentes.

Origin de navegador deve coincidir com a API; clientes sem Origin são aceitos. Isso não é autenticação. Sem CORS permissivo ou cookies. Respostas incluem no-store, nosniff, Referrer-Policy e request IDs. Yoga mascara falhas internas; a aplicação não registra tokens, documentos ou stacks em respostas.

São permitidos 10 workspaces/hora UTC globalmente, 60 escritas/workspace/hora, 20 documentos/workspace e token de 24h. Revogar continua possível com quota esgotada. Não há rate limit de leitura ou defesa DDoS própria; limites do provedor podem afetar disponibilidade. Exclusão de expirados é oportunística, não um cron com garantia de horário.

Sem cartão, faturamento, trial ou plano pago ativado. A demo não tem SLA. Use somente dados sintéticos: a infraestrutura pode registrar metadados de requisição e este não é um serviço para documentos sensíveis. Os testes comprovam comportamentos específicos, sem certificar ausência universal de vulnerabilidades.
