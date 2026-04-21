'use client';

import { useState, useMemo } from 'react';
import { useApp } from '@/lib/state';
import { getGrade } from '@/lib/constants';
import type { FixTask } from '@/lib/types';

// ── Helpers ────────────────────────────────────────────────────────────────

const EFFORT_LABELS: Record<string, string> = { S: '~15 min', M: '~1 hr', L: '~half day' };
const EFFORT_COLORS: Record<string, string> = { S: 'var(--green)', M: 'var(--amber)', L: 'var(--coral)' };
const STATUS_LABELS: Record<FixTask['status'], string> = { 'todo': 'To Do', 'in-progress': 'In Progress', 'done': 'Done' };
const STATUS_COLORS: Record<FixTask['status'], string> = { 'todo': 'var(--text3)', 'in-progress': 'var(--amber)', 'done': 'var(--green)' };

const CATEGORY_COLORS: Record<string, string> = {
  'Chart of Accounts': 'var(--purple)',
  'Statutory': 'var(--red)',
  'Data Integrity': 'var(--blue)',
  'Reconciliation': 'var(--teal)',
  'Reporting': 'var(--text2)',
};

function buildAIPayload(state: ReturnType<typeof useApp>['state']) {
  const { results, parsedData, files, filters } = state;
  if (!results) return null;

  const pd = parsedData as Record<string, number | null | undefined>;
  const dbStats = files.daybook.chunkedStats;

  return {
    score: results.overall,
    grade: getGrade(results.overall).label,
    dimScores: results.dimScores,
    findings: results.checks.map(c => ({
      id: c.id,
      dim: c.dim,
      name: c.name,
      status: c.status,
      note: c.failLabel ?? c.note,
      max: c.max,
    })),
    financials: {
      revenue:            pd.revenue ?? 0,
      netProfit:          pd.bsNetProfit ?? pd.netProfit ?? 0,
      currentAssets:      pd.ca ?? 0,
      currentLiabilities: pd.cl ?? 0,
      bankBalance:        pd.bankBal ?? 0,
      debtorBalance:      pd.debtorBal ?? 0,
      creditorBalance:    pd.creditorBal ?? 0,
      suspenseBalance:    (pd.suspenseLedgers as unknown as Array<{amount:number}> | null)
        ?.reduce((s, l) => s + Math.abs(l.amount), 0) ?? 0,
      fixedAssets:        pd.fixedAssets ?? 0,
      closingStock:       pd.closingStock ?? 0,
    },
    profile: {
      gstApplicable:  filters.gstApplicable,
      gstRegular:     filters.gstRegular,
      tdsApplicable:  filters.tdsApplicable,
      hasEmployees:   filters.hasEmployees,
      hasFAfilter:    filters.hasFAfilter,
      isGoods:        filters.isGoods,
      fullFY:         filters.fullFY,
    },
    dataNotes: {
      filesUploaded:         Object.values(state.files).filter(f => f.hasContent).length,
      dayBookVoucherCount:   dbStats?.totalVouchers ?? 0,
      distinctMonthsInData:  Object.keys(dbStats?.monthCounts ?? {}).length,
      scoreCapped:           results.scoreCapped,
    },
  };
}

// ── Score simulation bar ───────────────────────────────────────────────────

function SimulatedScoreBar({ currentScore, tasks }: { currentScore: number; tasks: FixTask[] }) {
  const easyGain = tasks
    .filter(t => t.effort === 'S' && t.status !== 'done')
    .reduce((s, t) => s + t.estimatedScoreGain, 0);

  const allGain = tasks
    .filter(t => t.status !== 'done')
    .reduce((s, t) => s + t.estimatedScoreGain, 0);

  const doneGain = tasks
    .filter(t => t.status === 'done')
    .reduce((s, t) => s + t.estimatedScoreGain, 0);

  const withEasy = Math.min(100, currentScore + easyGain);
  const withAll = Math.min(100, currentScore + allGain);
  const withDone = Math.min(100, currentScore + doneGain);

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg3)', border: '1px solid var(--border)' }}>
      <div className="text-xs font-semibold mb-3" style={{ color: 'var(--text3)' }}>SCORE SIMULATION</div>
      <div className="relative h-8 rounded-full overflow-hidden" style={{ background: 'var(--bg4)' }}>
        {/* Done gain */}
        {doneGain > 0 && (
          <div className="absolute top-0 left-0 h-full rounded-full transition-all"
            style={{ width: `${withDone}%`, background: 'var(--green)', opacity: 0.5 }} />
        )}
        {/* Easy gain */}
        <div className="absolute top-0 left-0 h-full rounded-full transition-all"
          style={{ width: `${withEasy}%`, background: 'var(--teal)', opacity: 0.5 }} />
        {/* All gain */}
        <div className="absolute top-0 left-0 h-full rounded-full transition-all"
          style={{ width: `${withAll}%`, background: 'var(--blue)', opacity: 0.3 }} />
        {/* Current */}
        <div className="absolute top-0 left-0 h-full rounded-full transition-all"
          style={{ width: `${currentScore}%`, background: getGrade(currentScore).color }} />
        {/* Label */}
        <div className="absolute inset-0 flex items-center justify-center text-xs font-bold" style={{ color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
          {currentScore} → {withAll}
        </div>
      </div>
      <div className="flex gap-4 mt-2 flex-wrap">
        {[
          { label: 'Current', score: currentScore, color: getGrade(currentScore).color },
          { label: 'After easy fixes (S)', score: withEasy, color: 'var(--teal)' },
          { label: 'All fixes done', score: withAll, color: 'var(--blue)' },
        ].map(s => (
          <div key={s.label} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ background: s.color }} />
            <span className="text-xs" style={{ color: 'var(--text3)' }}>{s.label}:</span>
            <span className="text-xs font-semibold" style={{ color: s.color }}>{s.score}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Task card ──────────────────────────────────────────────────────────────

function TaskCard({ task }: { task: FixTask }) {
  const { dispatch } = useApp();
  const [expanded, setExpanded] = useState(false);

  function cycleStatus() {
    const next: Record<FixTask['status'], FixTask['status']> = {
      'todo': 'in-progress',
      'in-progress': 'done',
      'done': 'todo',
    };
    dispatch({ type: 'FIX_TASK_STATUS', id: task.id, status: next[task.status] });
  }

  return (
    <div
      className="rounded-xl transition-all"
      style={{
        background: task.status === 'done' ? 'rgba(20,184,166,0.05)' : 'var(--bg2)',
        border: `1px solid ${task.status === 'done' ? 'var(--teal)' : 'var(--border)'}`,
        opacity: task.status === 'done' ? 0.7 : 1,
      }}
    >
      {/* Card header */}
      <div className="flex items-start gap-3 p-4">
        {/* Status toggle */}
        <button
          onClick={cycleStatus}
          className="shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs transition-all mt-0.5"
          style={{
            borderColor: STATUS_COLORS[task.status],
            background: task.status === 'done' ? 'var(--teal)' : 'transparent',
            color: task.status === 'done' ? '#000' : STATUS_COLORS[task.status],
          }}
          title={`Status: ${STATUS_LABELS[task.status]} — click to advance`}
        >
          {task.status === 'done' ? '✓' : task.status === 'in-progress' ? '◐' : ''}
        </button>

        <div className="flex-1 min-w-0">
          {/* Title row */}
          <div className="flex items-start gap-2 flex-wrap">
            <span className="text-sm font-semibold" style={{ color: task.status === 'done' ? 'var(--text3)' : 'var(--text1)', textDecoration: task.status === 'done' ? 'line-through' : 'none' }}>
              {task.title}
            </span>
            <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: 'rgba(0,0,0,0.2)', color: CATEGORY_COLORS[task.category] ?? 'var(--text2)' }}>
              {task.category}
            </span>
          </div>

          {/* Chips */}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="px-2 py-0.5 rounded text-xs" style={{ background: 'var(--bg3)', color: STATUS_COLORS[task.status] }}>
              {STATUS_LABELS[task.status]}
            </span>
            <span className="px-2 py-0.5 rounded text-xs" style={{ background: 'var(--bg3)', color: EFFORT_COLORS[task.effort] }}>
              {task.effort} — {EFFORT_LABELS[task.effort]}
            </span>
            {task.estimatedScoreGain > 0 && (
              <span className="px-2 py-0.5 rounded text-xs font-semibold" style={{ background: 'rgba(20,184,166,0.12)', color: 'var(--teal)' }}>
                +{task.estimatedScoreGain} pts
              </span>
            )}
            {task.checkIds.map(id => (
              <span key={id} className="px-1.5 py-0.5 rounded text-xs font-mono" style={{ background: 'var(--bg4)', color: 'var(--text3)', fontSize: 10 }}>
                {id}
              </span>
            ))}
          </div>
        </div>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(e => !e)}
          className="shrink-0 text-xs px-2 py-1 rounded"
          style={{ color: 'var(--text3)', background: 'var(--bg3)' }}
        >
          {expanded ? '▲ Less' : '▼ Steps'}
        </button>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="px-4 pb-4 border-t" style={{ borderColor: 'var(--border)' }}>
          <p className="text-xs mt-3 mb-3 leading-relaxed" style={{ color: 'var(--text2)' }}>{task.detail}</p>
          <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text3)' }}>TALLY PRIME STEPS</div>
          <ol className="flex flex-col gap-1.5">
            {task.tallySteps.map((step, i) => (
              <li key={i} className="flex gap-2 text-xs" style={{ color: 'var(--text2)' }}>
                <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: 'var(--bg4)', color: 'var(--teal)' }}>
                  {i + 1}
                </span>
                <span className="leading-relaxed">{step.replace(/^\d+\.\s*/, '')}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// ── Main view ──────────────────────────────────────────────────────────────

export default function AgentFixView({ embedded }: { embedded?: boolean }) {
  const { state, dispatch } = useApp();
  const { results, analysed, aiConsentGiven, fixTasks, fixTasksLoading } = state;
  const [error, setError] = useState<string | null>(null);

  const doneTasks = useMemo(() => fixTasks?.filter(t => t.status === 'done').length ?? 0, [fixTasks]);
  const totalTasks = fixTasks?.length ?? 0;
  const totalGain = useMemo(() =>
    fixTasks?.reduce((s, t) => s + t.estimatedScoreGain, 0) ?? 0,
  [fixTasks]);

  async function handleGetFixPlan() {
    setError(null);
    const payload = buildAIPayload(state);
    if (!payload) return;

    dispatch({ type: 'FIX_TASKS_LOADING' });
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 180_000); // 3 min for local models
      const res = await fetch('/api/ai/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      dispatch({ type: 'FIX_TASKS_LOADED', tasks: data.tasks });
    } catch (e) {
      dispatch({ type: 'FIX_TASKS_CLEAR' });
      setError(e instanceof Error ? e.message : 'Unknown error');
    }
  }

  // Not analysed yet
  if (!analysed || !results) {
    return (
      <div className={embedded ? 'py-8 text-center' : 'flex flex-col items-center justify-center h-full gap-4 py-24'}>
        <div style={{ fontSize: 40, opacity: 0.3 }}>⚑</div>
        <div className="text-sm" style={{ color: 'var(--text3)' }}>Run analysis first to generate a fix plan.</div>
        <button
          onClick={() => dispatch({ type: 'SET_VIEW', view: 'upload' })}
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: 'var(--teal)', color: '#000' }}
        >
          Go to Upload
        </button>
      </div>
    );
  }

  // AI consent gate
  if (!aiConsentGiven) {
    return (
      <div className={embedded ? 'py-8 text-center' : 'flex flex-col items-center justify-center h-full gap-4 py-24'}>
        <div style={{ fontSize: 40, opacity: 0.3 }}>🔒</div>
        <div className="text-sm font-medium" style={{ color: 'var(--text1)' }}>AI consent required</div>
        <div className="text-xs text-center max-w-sm" style={{ color: 'var(--text3)' }}>
          Fix Planner sends anonymised check findings (no party names, no amounts) to OpenAI GPT-4o.
          Enable AI Analysis consent in the consent modal to continue.
        </div>
      </div>
    );
  }

  const currentScore = results.overall;
  const grade = getGrade(currentScore);

  return (
    <div className={embedded ? '' : 'flex flex-col h-full'}>
      {/* Header */}
      <div className={embedded ? 'px-4 py-3 shrink-0' : 'px-6 py-4 shrink-0'} style={{ borderBottom: embedded ? 'none' : '1px solid var(--border)' }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold" style={{ color: 'var(--text1)' }}>Fix Planner</h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text3)' }}>
              AI-generated step-by-step Tally fixes ordered by score impact
            </p>
          </div>
          {/* Score + progress */}
          <div className="flex items-center gap-4 shrink-0">
            {fixTasks && fixTasks.length > 0 && (
              <div className="text-right">
                <div className="text-xs" style={{ color: 'var(--text3)' }}>Progress</div>
                <div className="text-sm font-semibold" style={{ color: doneTasks === totalTasks ? 'var(--green)' : 'var(--text1)' }}>
                  {doneTasks}/{totalTasks} done
                </div>
              </div>
            )}
            <div className="text-right">
              <div className="text-2xl font-bold" style={{ color: grade.color }}>{currentScore}</div>
              <div className="text-xs" style={{ color: 'var(--text3)' }}>Current score</div>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        {fixTasks && fixTasks.length > 0 && (
          <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg4)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${(doneTasks / totalTasks) * 100}%`, background: 'var(--teal)' }}
            />
          </div>
        )}
      </div>

      {/* Content */}
      <div className={embedded ? 'px-4 py-3' : 'flex-1 overflow-y-auto px-6 py-4'}>

        {/* Get Fix Plan button */}
        {!fixTasks && !fixTasksLoading && (
          <div className="flex flex-col items-center gap-4 py-12">
            <div style={{ fontSize: 48, opacity: 0.2 }}>⚑</div>
            <div className="text-sm" style={{ color: 'var(--text2)' }}>
              Generate a prioritised list of Tally fixes based on your analysis results.
            </div>
            <div className="text-xs text-center max-w-md" style={{ color: 'var(--text3)' }}>
              The AI will analyse {results.checks.filter(c => c.status === 'fail' || c.status === 'partial').length} failing checks
              and produce concrete Tally Prime steps to fix each issue, ordered by score impact.
            </div>
            <button
              onClick={handleGetFixPlan}
              className="px-6 py-2.5 rounded-xl text-sm font-semibold transition-all"
              style={{ background: 'var(--teal)', color: '#000' }}
            >
              ⚡ Get Fix Plan
            </button>
            {error && (
              <div className="text-xs px-4 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)' }}>
                {error}
              </div>
            )}
          </div>
        )}

        {/* Loading */}
        {fixTasksLoading && (
          <div className="flex flex-col items-center gap-4 py-16">
            <div className="text-2xl animate-spin">⟳</div>
            <div className="text-sm" style={{ color: 'var(--text3)' }}>Generating fix plan…</div>
            <div className="text-xs" style={{ color: 'var(--text3)' }}>GPT-4o is analysing your check failures and writing Tally steps</div>
          </div>
        )}

        {/* Tasks */}
        {fixTasks && fixTasks.length > 0 && (
          <div className="flex flex-col gap-4">
            {/* Simulated score */}
            <SimulatedScoreBar currentScore={currentScore} tasks={fixTasks} />

            {/* Summary stats */}
            <div className="flex gap-3 flex-wrap">
              {[
                { label: 'Fix tasks', value: totalTasks, color: 'var(--text1)' },
                { label: 'Potential gain', value: `+${totalGain} pts`, color: 'var(--teal)' },
                { label: 'Easy fixes (S)', value: fixTasks.filter(t => t.effort === 'S').length, color: 'var(--green)' },
                { label: 'Done', value: doneTasks, color: doneTasks > 0 ? 'var(--green)' : 'var(--text3)' },
              ].map(s => (
                <div key={s.label} className="px-3 py-2 rounded-lg" style={{ background: 'var(--bg3)', border: '1px solid var(--border)' }}>
                  <div className="text-xs" style={{ color: 'var(--text3)' }}>{s.label}</div>
                  <div className="text-sm font-semibold" style={{ color: s.color }}>{s.value}</div>
                </div>
              ))}
              <button
                onClick={() => dispatch({ type: 'FIX_TASKS_CLEAR' })}
                className="px-3 py-2 rounded-lg text-xs self-end"
                style={{ background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text3)' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text3)')}
              >
                ↺ Regenerate
              </button>
            </div>

            {/* Task list */}
            <div className="flex flex-col gap-3">
              {fixTasks.map(task => (
                <TaskCard key={task.id} task={task} />
              ))}
            </div>
          </div>
        )}

        {/* Empty tasks */}
        {fixTasks && fixTasks.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16">
            <div style={{ fontSize: 36, opacity: 0.3 }}>✓</div>
            <div className="text-sm font-medium" style={{ color: 'var(--text1)' }}>No critical fixes identified</div>
            <div className="text-xs" style={{ color: 'var(--text3)' }}>All checks passed or only minor issues found.</div>
          </div>
        )}
      </div>
    </div>
  );
}
