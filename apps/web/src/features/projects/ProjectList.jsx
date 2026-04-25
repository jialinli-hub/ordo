import { useEffect, useState } from "react";
import { apiGet } from "../../api/client";

export function ProjectList() {
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiGet("/api/projects")
      .then((data) => {
        if (active) {
          setProjects(data.items ?? []);
        }
      })
      .catch(() => {
        if (active) {
          setError("项目加载失败");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <section>
      <h2>项目列表</h2>
      {error ? <p>{error}</p> : null}
      <ul>
        {projects.map((project) => (
          <li key={project.id}>{project.name}</li>
        ))}
      </ul>
    </section>
  );
}
