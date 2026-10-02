import { useState } from 'react';
import { call } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { Card, EmptyState, ErrorText, Loading, PageHeader } from '../components/ui';
import { SessionTable } from '../components/SessionTable';

export function HistoryPage() {
  const [assignmentId, setAssignmentId] = useState<number | null>(null);
  const assignments = useApi(() => call('assignments:list', { includeArchived: true }), []);
  const { data, error, loading } = useApi(() => call('sessions:list', { assignmentId, limit: 1000 }), [assignmentId]);

  return (
    <div className="page">
      <PageHeader
        title="History"
        actions={
          <select
            className="select"
            style={{ width: 260 }}
            value={assignmentId ?? ''}
            onChange={(e) => setAssignmentId(e.target.value ? Number(e.target.value) : null)}
            aria-label="Filter by assignment"
          >
            <option value="">All assignments</option>
            {assignments.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        }
      />
      <Card>
        {!data ? (
          loading ? <Loading /> : <ErrorText error={error} />
        ) : data.length ? (
          <SessionTable rows={data} />
        ) : (
          <EmptyState>No sessions yet.</EmptyState>
        )}
      </Card>
    </div>
  );
}
