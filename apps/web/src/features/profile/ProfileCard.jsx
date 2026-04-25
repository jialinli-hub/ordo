import { useEffect, useState } from "react";
import { apiGet } from "../../api/client";

export function ProfileCard() {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiGet("/api/profile")
      .then((data) => {
        if (active) {
          setProfile(data);
        }
      })
      .catch(() => {
        if (active) {
          setError("Profile 加载失败");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section>
      <h2>个人 Profile</h2>
      {error ? <p>{error}</p> : null}
      {profile ? (
        <ul>
          <li>{profile.name}</li>
          <li>{profile.email}</li>
        </ul>
      ) : null}
    </section>
  );
}
