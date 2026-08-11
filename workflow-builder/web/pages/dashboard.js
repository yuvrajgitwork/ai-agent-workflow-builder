import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@apollo/client';
import { useAuth } from '../lib/auth';
import { MY_ORG_MEMBERSHIPS, ORG_WORKFLOWS, ORG_STATS } from '../lib/graphql';

const STATUS_COLORS = {
  pending: '#94a3b8',
  running: '#2563eb',
  paused: '#d97706',
  completed: '#16a34a',
  failed: '#dc2626',
};

function StatusBadge({ status }) {
  if (!status) return <span className="badge badge-muted">no runs yet</span>;
  return (
    <span className="badge" style={{ background: STATUS_COLORS[status] || '#64748b' }}>
      {status}
    </span>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [orgId, setOrgId] = useState(null);

  const { data: membershipsData, loading: loadingMemberships } = useQuery(MY_ORG_MEMBERSHIPS, {
    variables: { userId: user?.id },
    skip: !user,
  });

  const memberships = membershipsData?.org_members ?? [];

  useEffect(() => {
    if (!orgId && memberships.length > 0) {
      const stored = typeof window !== 'undefined' ? window.localStorage.getItem('wf_org_id') : null;
      const match = memberships.find((m) => m.organization.id === stored);
      setOrgId(match ? match.organization.id : memberships[0].organization.id);
    }
  }, [memberships, orgId]);

  const current = memberships.find((m) => m.organization.id === orgId);

  const { data: statsData } = useQuery(ORG_STATS, {
    variables: { orgId },
    skip: !orgId,
    pollInterval: 15000,
  });
  const stats = statsData?.org_stats?.[0];

  const { data: workflowsData, loading: loadingWorkflows } = useQuery(ORG_WORKFLOWS, {
    variables: { orgId },
    skip: !orgId,
    pollInterval: 5000,
  });

  function selectOrg(id) {
    setOrgId(id);
    if (typeof window !== 'undefined') window.localStorage.setItem('wf_org_id', id);
  }

  if (loadingMemberships) return <div className="page-center">Loading your organizations…</div>;

  if (memberships.length === 0) {
    return (
      <div className="card">
        <h1>No organizations yet</h1>
        <p>
          Your account ({user?.email}) isn&apos;t a member of any organization. An owner needs to add
          you via <code>org_members</code> — see the seed script in <code>scripts/seed.mjs</code> or
          CHECKLIST.md.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="row-between">
        <div className="org-switcher">
          {memberships.map((m) => (
            <button
              key={m.organization.id}
              className={`chip ${m.organization.id === orgId ? 'chip-active' : ''}`}
              onClick={() => selectOrg(m.organization.id)}
            >
              {m.organization.name} <span className="chip-role">{m.role}</span>
            </button>
          ))}
        </div>
        {current && current.role !== 'viewer' && (
          <Link href={`/workflows/new?org=${orgId}`} className="btn btn-primary">
            + New workflow
          </Link>
        )}
      </div>

      {stats && (
        <div className="card quota-card">
          <div>
            <strong>Quota:</strong> {stats.quota_used} / {stats.quota_limit} used this period
            <div className="quota-bar">
              <div
                className="quota-bar-fill"
                style={{
                  width: `${Math.min(100, (stats.quota_used / Math.max(stats.quota_limit, 1)) * 100)}%`,
                  background: stats.quota_used >= stats.quota_limit ? '#dc2626' : '#2563eb',
                }}
              />
            </div>
          </div>
          <div className="quota-meta">
            <span>{stats.runs_this_month} runs this month</span>
            <span>{Math.round(stats.avg_run_duration_seconds)}s avg run duration</span>
          </div>
        </div>
      )}

      <h2>Workflows</h2>
      {loadingWorkflows && <p>Loading workflows…</p>}
      {workflowsData?.workflows?.length === 0 && <p>No workflows yet in this organization.</p>}
      <div className="wf-list">
        {workflowsData?.workflows?.map((wf) => (
          <Link key={wf.id} href={`/workflows/${wf.id}`} className="wf-item">
            <div>
              <strong>{wf.name}</strong>
              <p className="muted">{wf.description}</p>
              <p className="muted small">
                {wf.workflow_steps.length} steps · {wf.workflow_triggers.map((t) => t.type).join(', ') || 'no triggers'}
              </p>
            </div>
            <StatusBadge status={wf.workflow_runs[0]?.status} />
          </Link>
        ))}
      </div>
    </div>
  );
}
