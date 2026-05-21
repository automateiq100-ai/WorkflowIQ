'use client';

import { useState } from 'react';
import { useApp } from '@/lib/state';
import { persistAIConsent } from '@/lib/session';

export default function ConsentModal() {
  const { dispatch } = useApp();
  const [dpdpa, setDpdpa] = useState(false);
  const [professional, setProfessional] = useState(false);
  const [aiConsent, setAiConsent] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  const canProceed = dpdpa && professional;

  function handleProceed() {
    dispatch({ type: 'CONSENT_GIVEN' });
    if (aiConsent) {
      dispatch({ type: 'AI_CONSENT_GIVEN' });
      persistAIConsent(true);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.85)' }}
    >
      <div
        className="max-w-lg w-full rounded-2xl border p-8"
        style={{ background: 'var(--bg2)', borderColor: 'var(--border)' }}
      >
        <div
          className="text-2xl mb-1"
          style={{ fontFamily: 'var(--font-dm-serif)', color: 'var(--text1)' }}
        >
          Before you begin
        </div>
        <p className="text-sm mt-3 leading-relaxed" style={{ color: 'var(--text2)' }}>
          AccountingIQ processes your Tally XML files{' '}
          <strong style={{ color: 'var(--text1)' }}>entirely in your browser</strong>. No data is
          uploaded to any server or stored externally.
        </p>

        {/* Two required checkboxes */}
        <div className="mt-6 space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={dpdpa}
              onChange={e => setDpdpa(e.target.checked)}
              className="mt-0.5 shrink-0 w-4 h-4"
              style={{ accentColor: 'var(--teal)' }}
            />
            <span className="text-sm leading-relaxed" style={{ color: 'var(--text2)' }}>
              I understand this tool processes my Tally XML data locally on this device under{' '}
              <strong style={{ color: 'var(--text1)' }}>DPDPA 2023</strong>. No data is transmitted
              to any server.
            </span>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={professional}
              onChange={e => setProfessional(e.target.checked)}
              className="mt-0.5 shrink-0 w-4 h-4"
              style={{ accentColor: 'var(--teal)' }}
            />
            <span className="text-sm leading-relaxed" style={{ color: 'var(--text2)' }}>
              I confirm I am a qualified CA or authorised professional and take{' '}
              <strong style={{ color: 'var(--text1)' }}>professional responsibility</strong> for the
              data uploaded.
            </span>
          </label>

          {/* Third checkbox: AI Analysis consent (optional) */}
          <div className="border-t pt-4" style={{ borderColor: 'var(--border)' }}>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={aiConsent}
                onChange={e => setAiConsent(e.target.checked)}
                className="mt-0.5 shrink-0 w-4 h-4"
                style={{ accentColor: 'var(--purple)' }}
              />
              <span className="text-sm leading-relaxed" style={{ color: 'var(--text2)' }}>
                <strong style={{ color: 'var(--purple)' }}>Optional:</strong>{' '}
                I understand the Insights Report sends aggregated scoring results (no raw XML, no voucher
                details, no party names) to an India-resident server for narrative generation. No data leaves India.
              </span>
            </label>
            <p className="text-xs mt-1 ml-7" style={{ color: 'var(--text3)' }}>
              You can enable this later from Settings. The Insights Report tab will be locked until consent is given.
            </p>
          </div>
        </div>

        {/* Privacy rights accordion */}
        <div className="mt-5">
          <button
            onClick={() => setPrivacyOpen(p => !p)}
            className="flex items-center gap-1.5 text-xs"
            style={{ color: 'var(--text3)' }}
          >
            <span>{privacyOpen ? '▼' : '▶'}</span>
            Privacy Rights under DPDPA Sections 12–14
          </button>
          {privacyOpen && (
            <div
              className="mt-3 rounded-lg p-4 text-xs space-y-2.5"
              style={{ background: 'var(--bg3)', color: 'var(--text2)' }}
            >
              <p>
                <strong style={{ color: 'var(--text1)' }}>Section 12 — Right to Access:</strong>{' '}
                You may request a summary of personal data processed and the entities it has been
                shared with.
              </p>
              <p>
                <strong style={{ color: 'var(--text1)' }}>
                  Section 13 — Right to Correction &amp; Erasure:
                </strong>{' '}
                You may request correction of inaccurate data, completion of incomplete data, or
                erasure of data no longer needed.
              </p>
              <p>
                <strong style={{ color: 'var(--text1)' }}>
                  Section 14 — Right to Grievance Redress:
                </strong>{' '}
                You have the right to a readily available grievance redressal mechanism.
              </p>
              <p className="pt-1" style={{ color: 'var(--text3)' }}>
                Note: AccountingIQ processes data exclusively client-side. No personal data is
                stored or transmitted. These rights are referenced for transparency.
              </p>
            </div>
          )}
        </div>

        {/* Proceed button — disabled until both required boxes checked */}
        <button
          onClick={handleProceed}
          disabled={!canProceed}
          className="mt-6 w-full py-2.5 rounded-lg text-sm font-semibold"
          style={{
            background: 'var(--teal)',
            color: '#000',
            opacity: canProceed ? 1 : 0.5,
            cursor: canProceed ? 'pointer' : 'not-allowed',
          }}
        >
          Proceed
        </button>
      </div>
    </div>
  );
}
