import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { UnfinishedSession } from '@shared/types';
import { call } from '../lib/api';
import { formatDateLong, formatDuration, formatTime } from '../lib/format';
import { ErrorText, Modal } from './ui';

/** Shown at startup when a session was left running (crash, power loss, forced quit). */
export function RecoveryDialog() {
  const [items, setItems] = useState<UnfinishedSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    void call('sessions:unfinished', {}).then(setItems).catch(() => setItems([]));
  }, []);

  const current = items[0];
  if (!current) return null;
  const { session } = current;

  const act = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setItems((list) => list.slice(1));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal label="Unfinished session" onClose={() => setItems((l) => l.slice(1))}>
      <h2>Unfinished session found</h2>
      <p className="secondary">
        {session.assignmentName ?? 'Session'} · {formatDateLong(session.startedAt)} {formatTime(session.startedAt)}–
        {formatTime(session.lastHeartbeatAt)} · {formatDuration(current.trackedMs)} saved
      </p>
      <ErrorText error={error} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn danger" disabled={busy} onClick={() => void act(() => call('sessions:discard', { id: session.id }))}>
          Discard
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              await call('sessions:recover', { id: session.id });
              navigate(`/report/${session.id}`);
            })
          }
        >
          End &amp; recover
        </button>
        <button
          className="btn primary"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              await call('sessions:resume', { id: session.id });
              navigate('/session');
            })
          }
        >
          Resume
        </button>
      </div>
    </Modal>
  );
}
