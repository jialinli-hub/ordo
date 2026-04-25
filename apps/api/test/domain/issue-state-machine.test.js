const test = require("node:test");
const assert = require("node:assert/strict");
const { transitionIssueStatus } = require("../../src/domain/issueStateMachine");

test("state machine should reject invalid transition todo -> done directly", () => {
  assert.throws(() => transitionIssueStatus("todo", "done"));
});
