// Botão Seguir/Seguindo autossuficiente (estado otimista, reverte no erro).
// Usado na busca de pessoas; PostCard tem a própria lógica por causa da lista.
import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { followUser, unfollowUser } from "../api/social";
import { Button } from "./ui";

export function FollowButton({ userId, initialFollowing }: { userId: string; initialFollowing: boolean }) {
  const { token } = useAuth();
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const next = !following;
    setFollowing(next);
    setBusy(true);
    try {
      if (next) await followUser(token!, userId);
      else await unfollowUser(token!, userId);
    } catch {
      setFollowing(!next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      title={following ? "Seguindo" : "Seguir"}
      size="sm"
      variant={following ? "secondary" : "primary"}
      onPress={toggle}
      disabled={busy}
    />
  );
}
