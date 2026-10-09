"use client";

import { useEffect, useState } from "react";
import type { LiveMessage, LiveState } from "@/lib/core/live";
import type { PublicSite } from "@/lib/core/site";

function apply(state: LiveState, msg: LiveMessage): LiveState {
  switch (msg.type) {
    case "event":
      return { ...state, events: [...state.events.slice(-199), msg.event] };
    case "door":
      return { ...state, doors: { ...state.doors, [msg.doorId]: msg.status } };
    case "track": {
      const others = state.tracks.filter((t) => t.id !== msg.track.id);
      return { ...state, tracks: [...others, msg.track].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) };
    }
    case "integration":
      return { ...state, integrations: state.integrations.map((i) => (i.id === msg.integration.id ? msg.integration : i)) };
    case "audit":
      return { ...state, audit: [...state.audit.slice(-49), msg.entry] };
    case "lockdown":
      return { ...state, lockdown: msg.active };
    case "sim":
      return { ...state, sim: msg.actors };
    case "site":
      return state;
  }
}

/** Loads the site + current state, then keeps it live over server-sent events. */
export function useLive() {
  const [site, setSite] = useState<PublicSite | null>(null);
  const [state, setState] = useState<LiveState | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let source: EventSource | null = null;
    let cancelled = false;
    async function connect() {
      const [s, st] = await Promise.all([fetch("/api/site").then((r) => r.json()), fetch("/api/state").then((r) => r.json())]);
      if (cancelled) return;
      setSite(s);
      setState(st);
      source = new EventSource("/api/events");
      source.onopen = () => setConnected(true);
      source.onerror = () => setConnected(false);
      source.onmessage = (e) => {
        const msg = JSON.parse(e.data) as LiveMessage;
        if (msg.type === "site") {
          fetch("/api/site").then((r) => r.json()).then(setSite).catch(() => {});
          return;
        }
        setState((prev) => (prev ? apply(prev, msg) : prev));
      };
    }
    connect().catch(() => setConnected(false));
    return () => {
      cancelled = true;
      source?.close();
    };
  }, []);

  return { site, state, connected };
}

export async function send(url: string, body: unknown, method: "POST" | "PATCH" = "POST") {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}
