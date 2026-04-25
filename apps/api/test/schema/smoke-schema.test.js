const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

test("schema should contain organization_members and project_members", async () => {
  const schemaPath = path.join(__dirname, "../../prisma/schema.prisma");
  const schema = await fs.readFile(schemaPath, "utf8");

  assert.match(schema, /model OrganizationMember/);
  assert.match(schema, /model ProjectMember/);
});
