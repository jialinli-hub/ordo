import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../../api/client";

export function TeamList() {
  const [items, setItems] = useState([]);
  const [name, setName] = useState("Platform Team");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadTeams() {
      try {
        const data = await apiGet("/api/teams");
        if (active) {
          setItems(data.items ?? []);
        }
      } catch {
        if (active) {
          setError("Team 加载失败");
        }
      }
    }
    void loadTeams();
    return () => {
      active = false;
    };
  }, []);

  async function createTeam() {
    try {
      await apiPost("/api/teams", { name });
      const data = await apiGet("/api/teams");
      setItems(data.items ?? []);
    } catch {
      setError("Team 创建失败");
    }
  }

  return (
    <section>
      <h2>Team</h2>
      {error ? <p>{error}</p> : null}
      <input value={name} onChange={(event) => setName(event.target.value)} />
      <button onClick={createTeam}>创建 Team</button>
      <ul>
        {items.map((item) => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
    </section>
  );
}
