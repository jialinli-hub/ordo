const { store } = require("../repositories/memoryStore");

function closeExpiredCycles(now = new Date()) {
  for (const cycle of store.cycles) {
    if (cycle.status === "active" && new Date(cycle.endsAt) < now) {
      cycle.status = "closed";
    }
  }
}

module.exports = { closeExpiredCycles };
