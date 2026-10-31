export const typeDefs = `
 "A synthetic document isolated by workspace token."
 type Document { id: ID!, title: String!, body: String!, revision: Int!, updatedAt: String!, excerpt: String }
 type WorkspaceSession { id: ID!, token: String!, expiresAt: String! }
 type PageInfo { endCursor: String, hasNextPage: Boolean! }
 type DocumentEdge { cursor: String!, node: Document! }
 type DocumentConnection { edges: [DocumentEdge!]!, pageInfo: PageInfo! }
 type Query {
   document(id: ID!): Document
   documents(first: Int = 5, after: String): DocumentConnection!
   search(term: String!, first: Int = 5, after: String): DocumentConnection!
 }
 type Mutation {
   createWorkspace: WorkspaceSession!
   revokeWorkspace: Boolean!
   createDocument(title: String!, body: String!): Document!
   updateDocument(id: ID!, expectedRevision: Int!, title: String!, body: String!): Document!
   deleteDocument(id: ID!, expectedRevision: Int!): Boolean!
 }
`;
