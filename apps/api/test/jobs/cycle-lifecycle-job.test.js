const test = require("node:test");
const assert = require("node:assert/strict");
const { store } = require("../../src/repositories/memoryStore");
const { closeExpiredCycles } = require("../../src/jobs/cycleLifecycleJob");

test("cycle lifecycle job should close expired active cycles", () => {
  store.cycles.push({
    id: "cycle-expired",
    organizationId: "org-job",
    projectId: "proj-job",
    name: "Expired Cycle",
    startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: "2026-01-05T00:00:00.000Z",
    status: "active"
  });

  closeExpiredCycles(new Date("2026-02-01T00:00:00.000Z"));
  const cycle = store.cycles.find((item) => item.id === "cycle-expired");

  assert.equal(cycle.status, "closed");
});
