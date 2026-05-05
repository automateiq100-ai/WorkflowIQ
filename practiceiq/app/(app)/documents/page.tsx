'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Client } from '@/lib/practiceiq/types';
import { api } from '@/lib/api';

type InboxDoc = {
  id: string;
  client_id: string | null;
  filename: string;
  size_bytes: number | null;
  uploaded_at: string;
  signed_url: string | null;
  source?: 'manual' | 'telegram' | 'email' | 'tally_import' | null;
  doc_type?: string | null;
  filing_period?: string | null;
  status?: 'received' | 'verified' | 'rejected' | 'archived' | null;
  mime_type?: string | null;
  uploaded_by?: string | null;
  category?: string | null;
  fy?: string | null;
  source_telegram_account_id?: string | null;
  source_telegram_account?: {
    label: string | null;
    telegram_first_name: string | null;
    telegram_username: string | null;
  } | null;
};

const DOC_TYPES = [
  { value: '', label: 'All types' },
  { value: 'gstr1_invoices', label: 'GSTR-1 Invoices' },
  { value: 'tds_challan', label: 'TDS Challan' },
  { value: 'sales_register', label: 'Sales Register' },
  { value: 'purchase_register', label: 'Purchase Register' },
  { value: 'bank_statement', label: 'Bank Statement' },
];

const STATUS_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  received: { bg: 'rgba(99, 102, 241, 0.15)', fg: 'var(--purple)', label: 'Received' },
  verified: { bg: 'rgba(34, 197, 94, 0.15)', fg: 'var(--teal)', label: 'Verified' },
  rejected: { bg: 'rgba(239, 68, 68, 0.15)', fg: 'var(--red)', label: 'Rejected' },
  archived: { bg: 'var(--bg3)', fg: 'var(--text3)', label: 'Archived' },
};

const SOURCE_BADGE: Record<string, string> = {
  manual: '👤 Manual',
  telegram: '📲 Telegram',
  email: '✉️ Email',
  tally_import: '📊 Tally',
};

export default function DocumentsInboxPage() {
  const [docs, setDocs] = useState<InboxDoc[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  const [openClient, setOpenClient] = useState<string | null>(null);
  const [filterDocType, setFilterDocType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const [uploadDocType, setUploadDocType] = useState('');
  const [uploadPeriod, setUploadPeriod] = useState('2025-04');
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    const [d, c] = await Promise.all([
      fetch(api('/api/practiceiq/documents')).then(r => r.json()),
      fetch(api('/api/practiceiq/clients')).then(r => r.json()),
    ]);
    setDocs(d.data ?? []);
    setClients(c.data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f || !openClient) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', f);
    fd.append('client_id', openClient);
    if (uploadDocType) fd.append('doc_type', uploadDocType);
    if (uploadPeriod) fd.append('filing_period', uploadPeriod);
    const res = await fetch(api('/api/practiceiq/documents'), { method: 'POST', body: fd }).then(r => r.json());
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
    if (res.error) alert(res.error);
    load();
  }

  async function patchStatus(d: InboxDoc, status: 'verified' | 'rejected') {
    const res = await fetch(api(`/api/practiceiq/documents/${d.id}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      alert('Status update endpoint will be wired in the next step.');
      return;
    }
    load();
  }

  async function softDelete(d: InboxDoc) {
    if (!confirm(`Delete ${d.filename}? (soft-delete; can be restored from DB)`)) return;
    await fetch(api(`/api/practiceiq/documents/${d.id}`), { method: 'DELETE' });
    load();
  }

  // Group docs by client_id
  const docsByClient = useMemo(() => {
    const map = new Map<string, InboxDoc[]>();
    for (const d of docs) {
      const key = d.client_id ?? '__unfiled__';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return map;
  }, [docs]);

  const openClientObj = openClient ? clients.find(c => c.id === openClient) : null;
  const clientDocs = openClient ? (docsByClient.get(openClient) ?? []) : [];
  const filteredClientDocs = clientDocs.filter(d =>
    (!filterDocType || d.doc_type === filterDocType) &&
    (!filterStatus || d.status === filterStatus)
  );

  // Folder grid view
  if (!openClient) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
            Documents — Inbox
          </h1>
          <p className="text-sm" style={{ color: 'var(--text2)' }}>
            One folder per client. Click a folder to see what's inside.
          </p>
        </div>

        {loading ? (
          <div className="text-sm" style={{ color: 'var(--text2)' }}>Loading...</div>
        ) : clients.length === 0 ? (
          <div className="rounded-xl border p-12 text-center" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
            <div className="text-4xl mb-3">👥</div>
            <div className="text-sm" style={{ color: 'var(--text3)' }}>
              No clients yet. Add a client first from the Clients tab.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {clients.map(c => {
              const cdocs = docsByClient.get(c.id) ?? [];
              const received = cdocs.filter(d => (d.status ?? 'received') === 'received').length;
              const verified = cdocs.filter(d => d.status === 'verified').length;
              const total = cdocs.length;
              return (
                <button
                  key={c.id}
                  onClick={() => setOpenClient(c.id)}
                  className="text-left rounded-xl border p-4 transition-colors hover:shadow"
                  style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="text-3xl">📁</div>
                    {total > 0 && (
                      <div
                        className="text-xs px-2 py-1 rounded-full"
                        style={{ background: 'var(--bg3)', color: 'var(--text2)' }}
                      >
                        {total}
                      </div>
                    )}
                  </div>
                  <div className="text-sm mb-1 truncate" style={{ color: 'var(--text1)' }}>{c.name}</div>
                  <div className="text-xs" style={{ color: 'var(--text3)' }}>
                    {total === 0 ? 'Empty' : `${received} new · ${verified} verified`}
                  </div>
                </button>
              );
            })}
            {/* Unfiled bucket — only if there are unfiled docs */}
            {(docsByClient.get('__unfiled__')?.length ?? 0) > 0 && (
              <button
                onClick={() => setOpenClient('__unfiled__')}
                className="text-left rounded-xl border p-4 transition-colors hover:shadow border-dashed"
                style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="text-3xl">❓</div>
                  <div
                    className="text-xs px-2 py-1 rounded-full"
                    style={{ background: 'var(--bg3)', color: 'var(--text2)' }}
                  >
                    {docsByClient.get('__unfiled__')?.length}
                  </div>
                </div>
                <div className="text-sm mb-1" style={{ color: 'var(--text1)' }}>Unfiled</div>
                <div className="text-xs" style={{ color: 'var(--text3)' }}>Documents not linked to a client</div>
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // Drill-down: docs for one client
  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-3 text-xs" style={{ color: 'var(--text3)' }}>
        <button
          onClick={() => { setOpenClient(null); setFilterDocType(''); setFilterStatus(''); }}
          className="hover:underline"
          style={{ color: 'var(--text2)' }}
        >
          ← All clients
        </button>
        <span className="mx-2">›</span>
        <span>{openClientObj?.name ?? 'Unfiled'}</span>
      </div>

      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
            📁 {openClientObj?.name ?? 'Unfiled'}
          </h1>
          <p className="text-sm" style={{ color: 'var(--text2)' }}>
            {clientDocs.length} document{clientDocs.length === 1 ? '' : 's'}
          </p>
        </div>
        {openClient !== '__unfiled__' && (
          <button
            onClick={() => setShowUpload(v => !v)}
            className="text-xs px-3 py-2 rounded-lg"
            style={{ background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border)' }}
          >
            {showUpload ? 'Hide upload' : '＋ Upload manually'}
          </button>
        )}
      </div>

      {showUpload && openClient !== '__unfiled__' && (
        <div className="rounded-xl border p-5 mb-6" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
          <div className="text-xs uppercase mb-3" style={{ color: 'var(--text3)' }}>
            Upload to {openClientObj?.name}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <select value={uploadDocType} onChange={e => setUploadDocType(e.target.value)} style={input}>
              <option value="">— Doc type —</option>
              {DOC_TYPES.filter(t => t.value).map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <input value={uploadPeriod} onChange={e => setUploadPeriod(e.target.value)} placeholder="2025-04" style={input} />
            <input ref={fileRef} type="file" onChange={upload} disabled={uploading} style={{ ...input, padding: '6px' }} />
          </div>
          {uploading && <div className="mt-3 text-xs" style={{ color: 'var(--teal)' }}>Uploading...</div>}
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-2 items-center">
        <select value={filterDocType} onChange={e => setFilterDocType(e.target.value)} className="text-sm" style={{ ...input, maxWidth: 200 }}>
          {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="text-sm" style={{ ...input, maxWidth: 160 }}>
          <option value="">All status</option>
          <option value="received">Received</option>
          <option value="verified">Verified</option>
          <option value="rejected">Rejected</option>
          <option value="archived">Archived</option>
        </select>
        <div className="ml-auto text-xs" style={{ color: 'var(--text3)' }}>{filteredClientDocs.length} files</div>
      </div>

      {filteredClientDocs.length === 0 ? (
        <div className="rounded-xl border p-12 text-center" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
          <div className="text-4xl mb-3">📭</div>
          <div className="text-sm" style={{ color: 'var(--text3)' }}>
            {clientDocs.length === 0
              ? 'This folder is empty. Upload manually or wait for Shalini to collect via Telegram.'
              : 'No documents match the current filters.'}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--bg3)' }}>
                <Th>Filename</Th><Th>Doc type</Th><Th>Period</Th>
                <Th>Source</Th><Th>Status</Th><Th>Size</Th><Th>Uploaded</Th><Th></Th>
              </tr>
            </thead>
            <tbody>
              {filteredClientDocs.map(d => {
                const status = d.status ?? 'received';
                const badge = STATUS_BADGE[status] ?? STATUS_BADGE.received;
                return (
                  <tr key={d.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-4 py-3" style={{ color: 'var(--text1)' }}>{d.filename}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>
                      {DOC_TYPES.find(t => t.value === d.doc_type)?.label ?? (d.category ?? '—')}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text3)' }}>{d.filing_period ?? d.fy ?? '—'}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text3)' }}>
                      {d.source ? (SOURCE_BADGE[d.source] ?? d.source) : '—'}
                      {d.source === 'telegram' && d.source_telegram_account && (
                        <div className="text-[11px] mt-0.5" style={{ color: 'var(--text2)' }}>
                          via {d.source_telegram_account.label
                            || d.source_telegram_account.telegram_first_name
                            || (d.source_telegram_account.telegram_username && `@${d.source_telegram_account.telegram_username}`)
                            || 'unknown'}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-1 rounded" style={{ background: badge.bg, color: badge.fg }}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--text3)' }}>{formatSize(d.size_bytes)}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text3)' }}>
                      {new Date(d.uploaded_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {d.signed_url && (
                        <a
                          href={d.signed_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs mr-3"
                          style={{ color: 'var(--purple)' }}
                        >
                          View
                        </a>
                      )}
                      {status === 'received' && (
                        <>
                          <button
                            onClick={() => patchStatus(d, 'verified')}
                            className="text-xs mr-2"
                            style={{ color: 'var(--teal)' }}
                          >
                            Verify
                          </button>
                          <button
                            onClick={() => patchStatus(d, 'rejected')}
                            className="text-xs mr-3"
                            style={{ color: 'var(--red)' }}
                          >
                            Reject
                          </button>
                        </>
                      )}
                      <button onClick={() => softDelete(d)} className="text-xs" style={{ color: 'var(--red)' }}>
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="text-left px-4 py-2 text-xs font-medium" style={{ color: 'var(--text3)' }}>{children}</th>;
}
function formatSize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
const input: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 8,
  background: 'var(--bg3)', border: '1px solid var(--border)',
  color: 'var(--text1)', fontSize: 13,
};
