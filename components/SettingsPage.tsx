"use client";

import { useEffect, useState } from "react";
import { TOPIC_LABELS, type Contact, type NotifyTopic } from "@/lib/core/contacts";
import { send } from "./useLive";

interface Field {
  key: string;
  label: string;
  type?: "text" | "password" | "boolean";
  placeholder?: string;
  help?: string;
  source: "settings page" | ".env.local" | "default" | "not set";
  isSet: boolean;
  value?: string;
}

interface IntegrationSettings {
  id: string;
  name: string;
  driverLabel: string;
  health?: { state: string; detail?: string };
  simulated: boolean;
  optional: boolean;
  required: string[];
  fields: Field[];
}

/** Connection settings for every system, editable here instead of in .env.local. */
export function SettingsPage() {
  const [items, setItems] = useState<IntegrationSettings[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setItems(d)))
      .catch((e) => setError(String(e)));
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="settings-page">
      <header className="topbar">
        <div className="brand"><span className="logo">◆</span> Settings</div>
        <span className="spacer" />
        <a className="button-link" href="/">← Back to console</a>
      </header>
      <main className="settings-main">
        <h2>Connections</h2>
        <p className="muted">
          Addresses, usernames and passwords for each system. Saving reconnects that system right away. Values saved here take priority over
          <code>.env.local</code>. Passwords are stored on this server and are never shown again after saving.
        </p>
        {error && <p className="error">{error}</p>}
        {!items && !error && <p className="muted">Loading…</p>}
        <div className="settings-grid">
          {items?.map((it) => <IntegrationCard key={it.id} item={it} onSaved={() => setTimeout(load, 1500)} />)}
        </div>

        <h2>Text-message contacts</h2>
        <p className="muted">Who gets texts, and for what. Texts go out through the Text messages (Twilio) connection above.</p>
        <ContactsEditor />

        <h2>Logins &amp; access</h2>
        <p className="muted">
          Everyone on the network can use the console for now. Coming later: individual logins and roles (for example, view-only vs. door control vs.
          alerts vs. admin), with this Settings page limited to admins.
        </p>
      </main>
    </div>
  );
}

function IntegrationCard({ item, onSaved }: { item: IntegrationSettings; onSaved: () => void }) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [test, setTest] = useState<Record<string, unknown> | null>(null);
  const dirty = Object.keys(edits).length > 0;
  const state = item.health?.state ?? "unknown";
  const status = item.simulated ? "simulated" : state;

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await send(`/api/settings/${item.id}`, { values: edits }, "PUT");
      setEdits({});
      setMessage({ ok: true, text: "Saved. Reconnecting…" });
      onSaved();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setBusy(true);
    setTest(null);
    try {
      const res = await fetch(`/api/integrations/${item.id}/check`);
      setTest(await res.json());
    } catch (err) {
      setTest({ error: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-card">
      <div className="sc-head">
        <div>
          <h3>{item.name}</h3>
          <div className="muted small">{item.driverLabel}{item.optional ? " · optional" : ""}</div>
        </div>
        <span className={`health health-${status}`}>{status}</span>
      </div>
      {item.health?.detail && <p className="muted small">{item.health.detail}</p>}

      {item.fields.map((f) => {
        const edited = f.key in edits;
        const value = edited ? edits[f.key] : f.type === "password" ? "" : f.value ?? "";
        const set = (v: string) => setEdits((e) => ({ ...e, [f.key]: v }));
        return (
          <div key={f.key} className="sc-field">
            {f.type === "boolean" ? (
              <label className="toggle">
                <input type="checkbox" checked={value === "true"} onChange={(e) => set(e.target.checked ? "true" : "false")} />
                {f.label}
                {item.required.includes(f.key) && <span className="req">required</span>}
              </label>
            ) : (
              <label>
                <span>
                  {f.label}
                  {item.required.includes(f.key) && <span className="req">required</span>}
                </span>
                <input
                  type={f.type === "password" ? "password" : "text"}
                  value={value}
                  autoComplete="off"
                  placeholder={f.type === "password" ? (f.isSet ? "•••••••• saved — type to replace" : "not set") : f.placeholder ?? ""}
                  onChange={(e) => set(e.target.value)}
                />
              </label>
            )}
            <div className="sc-meta">
              {f.help && <span>{f.help}</span>}
              <span className={`src src-${f.source.replace(/[^a-z]/g, "")}`}>{edited ? "unsaved" : f.source === "not set" ? "not set" : `from ${f.source}`}</span>
              {f.source === "settings page" && !edited && (
                <button className="btn-ghost small-btn" onClick={() => set("")} title="Remove the value saved here and use .env.local / the default">use default</button>
              )}
            </div>
          </div>
        );
      })}

      {message && <p className={message.ok ? "ok-text" : "error"}>{message.text}</p>}
      <div className="btn-row end">
        <button disabled={busy} onClick={runTest}>Test connection</button>
        {dirty && <button disabled={busy} onClick={() => setEdits({})}>Discard</button>}
        <button className="btn-primary" disabled={busy || !dirty} onClick={save}>Save &amp; reconnect</button>
      </div>
      {test && <TestResult result={test} />}
    </section>
  );
}

function TestResult({ result }: { result: Record<string, unknown> }) {
  const detail = (result.test ?? result) as Record<string, unknown> | string;
  return (
    <div className="test-result">
      {typeof detail === "string" ? (
        <p className="muted small">Test {detail} — {String((result.health as { detail?: string } | undefined)?.detail ?? "this system isn't connected to a real device yet")}</p>
      ) : (
        <table className="table">
          <tbody>
            {Object.entries(detail).map(([k, v]) => (
              <tr key={k}>
                <td className="muted">{k}</td>
                <td className={typeof v === "string" && /^(ok|HTTP 2)/.test(v) ? "ok-text" : typeof v === "string" && /(HTTP [45]|error|fail|reject|refused|timed out)/i.test(v) ? "error" : ""}>{typeof v === "object" ? JSON.stringify(v) : String(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ContactsEditor() {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    fetch("/api/contacts").then((r) => r.json()).then(setContacts).catch(() => setContacts([]));
  }, []);
  if (!contacts) return <p className="muted">Loading…</p>;
  const topics = Object.keys(TOPIC_LABELS) as NotifyTopic[];
  const update = (i: number, patch: Partial<Contact>) => {
    setContacts(contacts.map((c, j) => (j === i ? { ...c, ...patch } : c)));
    setDirty(true);
  };
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      setContacts(await send("/api/contacts", { contacts }, "PUT"));
      setDirty(false);
      setMsg({ ok: true, text: "Contacts saved." });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const test = async (c: Contact) => {
    setMsg(null);
    try {
      const out = await send("/api/contacts/test", { id: c.id });
      setMsg({ ok: true, text: out.simulated ? `Simulated text to ${c.name} (Twilio isn't set up yet).` : `Test text sent to ${c.name}.` });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  };
  return (
    <div className="contacts">
      <table className="table">
        <thead>
          <tr>
            <th>On</th>
            <th>Name</th>
            <th>Mobile number</th>
            {topics.map((t) => <th key={t} title={TOPIC_LABELS[t]} className="topic-h">{t}</th>)}
            <th />
          </tr>
        </thead>
        <tbody>
          {contacts.map((c, i) => (
            <tr key={c.id || i}>
              <td><input type="checkbox" checked={c.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} /></td>
              <td><input value={c.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="Name" /></td>
              <td><input value={c.phone} onChange={(e) => update(i, { phone: e.target.value })} placeholder="(555) 123-4567" /></td>
              {topics.map((t) => (
                <td key={t} className="topic-c">
                  <input
                    type="checkbox"
                    checked={c.topics.includes(t)}
                    onChange={(e) => update(i, { topics: e.target.checked ? [...c.topics, t] : c.topics.filter((x) => x !== t) })}
                  />
                </td>
              ))}
              <td className="nowrap">
                {c.id && !dirty && <button className="small-btn" onClick={() => test(c)}>Test</button>}
                <button className="btn-ghost small-btn" title="Remove" onClick={() => (setContacts(contacts.filter((_, j) => j !== i)), setDirty(true))}>✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="topic-legend muted small">
        {topics.map((t) => <li key={t}><strong>{t}</strong> — {TOPIC_LABELS[t]}</li>)}
      </ul>
      {msg && <p className={msg.ok ? "ok-text" : "error"}>{msg.text}</p>}
      <div className="btn-row end">
        <button onClick={() => (setContacts([...contacts, { id: "", name: "", phone: "", topics: ["alerts", "critical"], enabled: true }]), setDirty(true))}>+ Add contact</button>
        <button className="btn-primary" disabled={busy || !dirty} onClick={save}>Save contacts</button>
      </div>
    </div>
  );
}
