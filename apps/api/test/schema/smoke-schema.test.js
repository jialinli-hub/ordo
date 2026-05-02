const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

test("schema should define relational models for workspaces and issues", async () => {
  const schemaPath = path.join(__dirname, "../../prisma/schema.prisma");
  const schema = await fs.readFile(schemaPath, "utf8");

  assert.match(schema, /model Workspace\b/);
  assert.match(schema, /model WorkspaceMember\b/);
  assert.match(schema, /model Team\b/);
  assert.match(schema, /model Issue\b/);
  assert.match(schema, /model UserPreference\b/);
});
