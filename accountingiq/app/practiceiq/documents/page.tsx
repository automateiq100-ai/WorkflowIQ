'use client';

import { useEffect, useRef, useState } from 'react';
import type { DocumentMeta, Client } from '@/lib/practiceiq/types';

type Doc = DocumentMeta & { signed_url: string | null };

const CATEGORIES = ['tax', 'audit', 'roc', 'misc'];

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [filterClient, setFilterClient] = useState('');
  const [clientId, setClientId] = useState('');
  const [category, setCategory] = useState('misc');
  const [fy, setFy] = useState('FY2025-26');
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    const [d, c] = await Promise.all([
      fetch('/api/practiceiq/documents').then(r => r.json()),
      fetch('/api/practiceiq/clients').then(r => r.json()),
    ]);
    setDocs(d.data ?? []);
    setClients(c.data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', f);
    if (clientId) fd.append('client_id', clientId);
    fd.append('category', category);
    fd.append('fy', fy);
    const res = await fetch('/api/practiceiq/documents', { method: 'POST', body: fd }).then(r => r.json());
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
    if (res.error) alert(res.error);
    load();
  }

  async function del(d: Doc) {
    if (!confirm(`Delete ${d.filename}?`)) return;
    await fetch(`/api/practiceiq/documents/${d.id}`, { method: 'DELETE' });
    load();
  }

  const filtered = docs.filter(d => !filterClient || d.client_id === filterClient);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl mb-1" style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}>
          Documents
        </h1>
        <p className="text-sm" style={{ color: 'var(--text2)' }}>
          Securely store client files in your private vault
        </p>
      </div>

      {/* Upload */}
      <div className="rounded-xl border p-5 mb-6" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
        <div className="text-xs uppercase mb-3" style={{ color: 'var(--text3)' }}>Upload a document</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <select value={clientId} onChange={e => setClientId(e.target.value)} style={input}>
            <option value="">— No client —</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={category} onChange={e => setCategory(e.target.value)} style={input}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input value={fy} onChange={e => setFy(e.target.value)} placeholder="FY2025-26" style={input} />
          <input ref={fileRef} type="file" onChange={upload} disabled={uploading} style={{ ...input, padding: '6px' }} />
        </div>
        {uploading && <div className="mt-3 text-xs" style={{ color: 'var(--teal)' }}>Uploading...</div>}
      </div>

      <div className="mb-3 flex justify-between items-center">
        <select value={filterClient} onChange={e => setFilterClient(e.target.value)} className="text-sm" style={{ ...input, maxWidth: 240 }}>
          <option value="">All clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="text-xs" style={{ color: 'var(--text3)' }}>{filtered.length} files</div>
      </div>

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--text2)' }}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border p-12 text-center" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
          <div className="text-4xl mb-3">📁</div>
          <div className="text-sm" style={{ color: 'var(--text3)' }}>No documents yet.</div>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--bg3)' }}>
                <Th>Filename</Th><Th>Client</Th><Th>Category</Th><Th>FY</Th><Th>Size</Th><Th>Uploaded</Th><Th></Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => {
                const client = clients.find(c => c.id === d.client_id);
                return (
                  <tr key={d.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-4 py-3" style={{ color: 'var(--text1)' }}>{d.filename}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{client?.name ?? '—'}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text2)' }}>{d.category ?? '—'}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text3)' }}>{d.fy ?? '—'}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text3)' }}>{formatSize(d.size_bytes)}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--text3)' }}>{new Date(d.uploaded_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right">
                      {d.signed_url && (
                        <a href={d.signed_url} target="_blank" rel="noopener noreferrer" className="text-xs mr-3" style={{ color: 'var(--purple)' }}>
                          Download
                        </a>
                      )}
                      <button onClick={() => del(d)} className="text-xs" style={{ color: 'var(--red)' }}>Delete</button>
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
  width: '100%',
  padding: '8px 12px',
  borderRadius: 8,
  background: 'var(--bg3)',
  border: '1px solid var(--border)',
  color: 'var(--text1)',
  fontSize: 13,
};
