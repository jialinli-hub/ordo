const { createHandler } = require("graphql-http/lib/use/express");
const { schema } = require("./schema");

/**
 * GraphQL over HTTP（graphql-http），挂载在已通过 auth + tenant 的链路上。
 * context 注入 Express 的 req.context（userId / workspaceId / organizationId）。
 */
const graphqlHandler = createHandler({
  schema,
  context: (req) => {
    const expressReq = req.raw;
    return { ...expressReq.context, req: expressReq };
  }
});

module.exports = { graphqlHandler };
