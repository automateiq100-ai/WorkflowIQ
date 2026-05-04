'use client';

import { useEffect, useRef, useState } from 'react';
import type { Client } from '@/lib/practiceiq/types';
import { api } from '@/lib/api';

type ChatRole = 'user' | 'assistant';
type ChatMsg = { role: ChatRole; content: string };

export default function AskShaliniPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [scopedClient, setScopedClient] = useState<string>('');
  const [history, setHistory] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(api('/api/practiceiq/clients'))
      .then(r => r.json())
      .then(j => setClients(j.data ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [history, busy]);

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    const next = [...history, { role: 'user' as ChatRole, content: text }];
    setHistory(next);
    setDraft('');
    setBusy(true);
    try {
      const r = await fetch(api('/api/practiceiq/documents/ask'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: scopedClient || null,
          messages: next.map(m => ({ role: m.role, content: m.content })),
        }),
      });
      if (!r.ok) {
        const errText = r.status === 404
          ? 'Ask Shalini endpoint will be wired in the next step.'
          : `Request failed: ${r.status}`;
        setHistory(h => [...h, { role: 'assistant', content: `⚠ ${errText}` }]);
        return;
      }
      const j = await r.json();
      const reply = j.reply ?? j.content ?? '(empty reply)';
      setHistory(h => [...h, { role: 'assistant', content: reply }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'send failed';
      setHistory(h => [...h, { role: 'assistant', content: `⚠ ${msg}` }]);
    } finally {
      setBusy(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const examplePrompts = [
    "What's pending for Rajesh Kumar Traders?",
    'Show me all overdue clients',
    "Did Anjali send the bank statement for April?",
    'Draft a reminder for Patel about the TDS challan',
  ];

  return (
    <div className="p-8 max-w-4xl mx-auto h-[calc(100vh-2rem)] flex flex-col">
      <div className="mb-4">
        <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
          Ask Shalini
        </h1>
        <p className="text-sm" style={{ color: 'var(--text2)' }}>
          Ask about client status, search past chats, or draft a reminder. Shalini never sends — she returns drafts for your approval.
        </p>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <label className="text-xs" style={{ color: 'var(--text3)' }}>Scope:</label>
        <select
          value={scopedClient}
          onChange={e => setScopedClient(e.target.value)}
          className="text-sm"
          style={{ ...input, maxWidth: 280 }}
        >
          <option value="">All clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 rounded-xl border p-4 mb-3 overflow-y-auto"
        style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
      >
        {history.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="text-3xl mb-3">🤖</div>
            <div className="text-sm mb-4" style={{ color: 'var(--text2)' }}>
              Try asking:
            </div>
            <div className="space-y-2">
              {examplePrompts.map(p => (
                <button
                  key={p}
                  onClick={() => setDraft(p)}
                  className="block text-xs px-3 py-2 rounded-lg"
                  style={{ background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border)' }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {history.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className="max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap"
                  style={{
                    background: m.role === 'user' ? 'var(--purple)' : 'var(--bg3)',
                    color: m.role === 'user' ? 'white' : 'var(--text1)',
                  }}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div
                  className="rounded-lg px-3 py-2 text-sm"
                  style={{ background: 'var(--bg3)', color: 'var(--text3)' }}
                >
                  Shalini is thinking…
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-2 items-end">
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask Shalini anything about your clients' documents…"
          rows={2}
          className="flex-1"
          style={{ ...input, resize: 'none', padding: '10px 12px' }}
        />
        <button
          onClick={send}
          disabled={busy || !draft.trim()}
          className="text-sm px-4 py-2 rounded-lg"
          style={{
            background: 'var(--purple)',
            color: 'white',
            opacity: (busy || !draft.trim()) ? 0.5 : 1,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

const input: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 8,
  background: 'var(--bg3)', border: '1px solid var(--border)',
  color: 'var(--text1)', fontSize: 13,
};
