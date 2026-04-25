import { useEffect, useState } from "react";
import { apiGet } from "../../api/client";

export function IssueList() {
  const [issues, setIssues] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiGet("/api/issues")
      .then((data) => {
        if (active) {
          setIssues(data.items ?? []);
        }
      })
      .catch(() => {
        if (active) {
          setError("Issue 加载失败");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <section>
      <h2>Issue 列表</h2>
      {error ? <p>{error}</p> : null}
      <ul>
        {issues.map((issue) => (
          <li key={issue.id}>{issue.title}</li>
        ))}
      </ul>
    </section>
  );
}
