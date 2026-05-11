'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const ALL_TOOLS = [
  { id: 'accountingiq', label: 'AccountingIQ', tagline: 'Tally XML Analyser', tagColor: 'var(--teal)' },
  { id: 'practiceiq',   label: 'PracticeIQ',   tagline: 'CA Practice Management', tagColor: 'var(--purple)' },
  { id: 'researchiq',   label: 'ResearchIQ',   tagline: 'AI-Powered Legal Research', tagColor: 'var(--blue)' },
];

interface ProfilePanelProps {
  user: { name: string | null; email: string; mobile?: string | null };
  onClose: () => void;
}

export default function ProfilePanel({ user, onClose }: ProfilePanelProps) {
  const [editName,   setEditName]   = useState(user.name ?? '');
  const [editMobile, setEditMobile] = useState(user.mobile ?? '');
  const [saving,     setSaving]     = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);

  // Fetch selected_tools + hydrate name/mobile from settings API
  useEffect(() => {
    fetch('/api/profile/settings')
      .then(r => r.json())
      .then(data => {
        if (data.selected_tools) setSelectedTools(data.selected_tools);
        if (data.full_name != null)  setEditName(data.full_name);
        if (data.mobile    != null)  setEditMobile(data.mobile);
      })
      .catch(() => {});
  }, []);

  async function handleSaveProfile() {
    setSaving(true);
    const supabase = createClient();
    await supabase.auth.updateUser({ data: { full_name: editName, mobile: editMobile } });
    await fetch('/api/profile/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: editName, mobile: editMobile }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const inputStyle = {
    background: 'var(--bg4)',
    border: '1px solid var(--border)',
    color: 'var(--text1)',
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        style={{ background: 'rgba(0,0,0,0.45)' }}
      />

      {/* Panel */}
      <div
        className="fixed right-0 top-0 h-full w-80 z-50 flex flex-col"
        style={{ background: 'var(--bg2)', borderLeft: '1px solid var(--border)' }}
      >
        {/* Panel header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b shrink-0"
          style={{ borderColor: 'var(--border)' }}
        >
          <span
            className="text-base"
            style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
          >
            My Profile
          </span>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded text-sm transition-colors"
            style={{ color: 'var(--text3)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text1)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text3)')}
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-6">

          {/* Plan */}
          <div>
            <div
              className="text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: 'var(--text3)' }}
            >
              Plan
            </div>
            <span
              className="text-xs px-2.5 py-1 rounded-full font-semibold"
              style={{ background: 'rgba(82,196,169,0.12)', color: 'var(--teal)' }}
            >
              Free
            </span>
          </div>

          {/* Account Details */}
          <div>
            <div
              className="text-xs font-semibold uppercase tracking-wider mb-3"
              style={{ color: 'var(--text3)' }}
            >
              Account Details
            </div>
            <div className="flex flex-col gap-2.5">
              <input
                type="text"
                placeholder="Full name"
                value={editName}
                onChange={e => { setEditName(e.target.value); setSaved(false); }}
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                style={inputStyle}
              />
              <input
                type="email"
                placeholder="Email"
                value={user.email}
                disabled
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                style={{ ...inputStyle, opacity: 0.5, cursor: 'not-allowed' }}
              />
              <input
                type="tel"
                placeholder="Mobile"
                value={editMobile}
                onChange={e => { setEditMobile(e.target.value); setSaved(false); }}
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                style={inputStyle}
              />
            </div>
          </div>

          {/* Tools Access */}
          <div>
            <div
              className="text-xs font-semibold uppercase tracking-wider mb-3"
              style={{ color: 'var(--text3)' }}
            >
              Tools Access
            </div>
            <div className="flex flex-col gap-2">
              {ALL_TOOLS.map(tool => {
                const enabled = selectedTools.includes(tool.id);
                return (
                  <div
                    key={tool.id}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg"
                    style={{ background: 'var(--bg3)', border: '1px solid var(--border)' }}
                  >
                    <div className="min-w-0 mr-3">
                      <div className="text-sm font-medium" style={{ color: 'var(--text1)' }}>
                        {tool.label}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>
                        {tool.tagline}
                      </div>
                    </div>
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0"
                      style={{
                        background: enabled ? 'rgba(82,196,169,0.12)' : 'var(--bg4)',
                        color: enabled ? 'var(--teal)' : 'var(--text3)',
                      }}
                    >
                      {enabled ? 'Active' : 'No access'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Save button */}
        <div
          className="px-5 py-4 border-t shrink-0"
          style={{ borderColor: 'var(--border)' }}
        >
          <button
            onClick={handleSaveProfile}
            disabled={saving}
            className="w-full py-2.5 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-40"
            style={{ background: 'var(--teal)', color: '#000' }}
          >
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Changes'}
          </button>
        </div>
      </div>
    </>
  );
}
