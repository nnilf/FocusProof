import { useCallback, useEffect, useRef, useState } from 'react';
import { onEvent } from '../lib/api';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Loads data from the main process and reloads it whenever main reports a data change
 * (or when `deps` change).
 */
export function useApi<T>(loader: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const seq = useRef(0);

  const reload = useCallback(() => {
    const id = ++seq.current;
    setLoading(true);
    loaderRef
      .current()
      .then((d) => {
        if (id !== seq.current) return;
        setData(d);
        setError(null);
      })
      .catch((err: unknown) => {
        if (id !== seq.current) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (id === seq.current) setLoading(false);
      });
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, deps);
  useEffect(() => onEvent('data:changed', () => reload()), [reload]);

  return { data, error, loading, reload };
}
