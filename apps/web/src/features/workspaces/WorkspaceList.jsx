import { useEffect, useState } from "react";
import { apiGet } from "../../api/client";

export function WorkspaceList() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiGet("/api/workspaces")
      .then((data) => {
        if (active) {
          setItems(data.items ?? []);
        }
      })
      .catch(() => {
        if (active) {
          setError("Workspace 加载失败");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section>
      <h2>Workspace</h2>
      {error ? <p>{error}</p> : null}
      <ul>
        {items.map((item) => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
    </section>
  );
}
