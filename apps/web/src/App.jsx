import "./App.css";
import { ProjectList } from "./features/projects/ProjectList";
import { IssueList } from "./features/issues/IssueList";
import { DingTalkLogin } from "./features/auth/DingTalkLogin";
import { ProfileCard } from "./features/profile/ProfileCard";
import { WorkspaceList } from "./features/workspaces/WorkspaceList";
import { TeamList } from "./features/teams/TeamList";
import { CycleList } from "./features/cycles/CycleList";
import { apiPost } from "./api/client";
import { useEffect, useMemo, useState } from "react";

function App() {
  const [loggedIn, setLoggedIn] = useState(() => {
    const url = new URL(window.location.href);
    const accessToken = url.searchParams.get("accessToken");
    if (accessToken) {
      localStorage.setItem("ordo_access_token", accessToken);
      url.searchParams.delete("accessToken");
      window.history.replaceState({}, "", url.toString());
      return true;
    }
    return Boolean(localStorage.getItem("ordo_access_token"));
  });
  const [exchangeError, setExchangeError] = useState("");

  useEffect(() => {
    const url = new URL(window.location.href);
    const isCallbackPath = url.pathname === "/dingtalk/callback";
    const authCode = url.searchParams.get("authCode") || url.searchParams.get("code");
    if (!isCallbackPath || !authCode) {
      return;
    }

    const redirectUri = `${window.location.origin}/dingtalk/callback`;
    apiPost("/api/auth/dingtalk/exchange-code", {
      authCode,
      redirectUri
    })
      .then((data) => {
        localStorage.setItem("ordo_access_token", data.accessToken);
        window.history.replaceState({}, "", window.location.origin);
        setLoggedIn(true);
      })
      .catch(() => {
        setExchangeError("Failed to exchange DingTalk auth code");
      });
  }, []);

  const sections = useMemo(
    () => [
      <ProfileCard key="profile" />,
      <WorkspaceList key="workspace" />,
      <TeamList key="team" />,
      <CycleList key="cycle" />,
      <ProjectList key="project" />,
      <IssueList key="issue" />
    ],
    []
  );

  return (
    <main className="layout">
      <h1>Ordo Web</h1>
      {loggedIn ? (
        <div className="grid">{sections}</div>
      ) : (
        <>
          <DingTalkLogin />
          {exchangeError ? <p>{exchangeError}</p> : null}
        </>
      )}
    </main>
  );
}

export default App;
