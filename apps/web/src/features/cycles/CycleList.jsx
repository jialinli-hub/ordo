import { useEffect, useState } from "react";
import { apiGet } from "../../api/client";

export function CycleList() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiGet("/api/cycles")
      .then((data) => {
        if (active) {
          setItems(data.items ?? []);
        }
      })
      .catch(() => {
        if (active) {
          setError("Cycle 加载失败");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section>
      <h2>Cycle</h2>
      {error ? <p>{error}</p> : null}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            {item.name} ({item.status})
          </li>
        ))}
      </ul>
    </section>
  );
}
