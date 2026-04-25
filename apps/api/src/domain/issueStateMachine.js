const ALLOWED_TRANSITIONS = {
  todo: ["in_progress"],
  in_progress: ["in_review"],
  in_review: ["done"],
  done: []
};

function transitionIssueStatus(currentStatus, nextStatus) {
  const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(nextStatus)) {
    throw new Error(`Invalid transition: ${currentStatus} -> ${nextStatus}`);
  }

  return nextStatus;
}

module.exports = { transitionIssueStatus };
