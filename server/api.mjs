import { createYoga, createSchema } from "graphql-yoga";
import { GraphQLError } from "graphql";
import { typeDefs } from "./schema.mjs";
import { resolvers } from "./resolvers.mjs";
import { guardQuery } from "./domain.mjs";
export function createApi(db) {
  const yoga = createYoga({
    schema: createSchema({ typeDefs, resolvers }),
    graphqlEndpoint: "/api/graphql",
    graphiql: false,
    cors: false,
    logging: false,
    context: ({ request }) => ({ db, request }),
    maskedErrors: true,
  });
  return async (request) => {
    const id = crypto.randomUUID();
    let response;
    const error = (status, code, message) =>
      new Response(
        JSON.stringify({
          errors: [{ message, extensions: { code, requestId: id } }],
        }),
        { status, headers: { "Content-Type": "application/json" } },
      );
    try {
      const origin = request.headers.get("origin");
      if (origin && origin !== new URL(request.url).origin)
        response = error(403, "ORIGIN_DENIED", "Origem não autorizada.");
      else {
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path === "/api/health") {
          await db.prepare("SELECT 1").first();
          response = Response.json({
            status: "ok",
            database: "ok",
            engine: "graphql-yoga-d1",
            version: "1.0.0",
          });
        } else if (request.method === "GET" && path === "/api/schema.graphql")
          response = new Response(typeDefs, {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        else if (request.method !== "POST" || path !== "/api/graphql")
          response = error(
            404,
            "NOT_FOUND",
            "Use POST /api/graphql ou GET /api/schema.graphql.",
          );
        else if (
          request.headers
            .get("content-type")
            ?.split(";")[0]
            .trim()
            .toLowerCase() !== "application/json" ||
          (request.headers.has("content-encoding") &&
            request.headers.get("content-encoding") !== "identity")
        )
          response = error(
            415,
            "UNSUPPORTED_MEDIA_TYPE",
            "Use JSON sem compressão.",
          );
        else {
          const reader = request.body?.getReader();
          if (!reader)
            throw Object.assign(new Error("Envie JSON."), {
              http: 400,
              code: "BAD_REQUEST",
            });
          const chunks = [];
          let size = 0;
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > 32768) {
                await reader.cancel();
                throw Object.assign(new Error("Corpo excede 32 KiB."), {
                  http: 413,
                  code: "BODY_LIMIT",
                });
              }
              chunks.push(value);
            }
          } finally {
            reader.releaseLock();
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          let body;
          try {
            body = JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            );
          } catch {
            throw Object.assign(new Error("JSON/UTF-8 inválido."), {
              http: 400,
              code: "BAD_REQUEST",
            });
          }
          if (
            !body ||
            Array.isArray(body) ||
            typeof body !== "object" ||
            Object.keys(body).some(
              (k) => !["query", "variables", "operationName"].includes(k),
            )
          )
            throw Object.assign(new Error("Envie um único objeto GraphQL."), {
              http: 400,
              code: "BAD_REQUEST",
            });
          guardQuery(body.query);
          const headers = new Headers(request.headers);
          headers.delete("content-length");
          response = await yoga.fetch(
            new Request(request.url, {
              method: "POST",
              headers,
              body: JSON.stringify(body),
            }),
          );
        }
      }
    } catch (e) {
      response =
        e instanceof GraphQLError
          ? error(400, e.extensions.code ?? "GRAPHQL_PARSE_FAILED", e.message)
          : e.http
            ? error(e.http, e.code, e.message)
            : error(503, "SERVICE_UNAVAILABLE", "Serviço indisponível.");
    }
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Request-Id", id);
    return new Response(response.body, { status: response.status, headers });
  };
}
