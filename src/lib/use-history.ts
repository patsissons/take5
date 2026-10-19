import { useCallback, useEffect, useState } from "react";
import * as history from "./history";

/** The run gallery and the storage meter, reloaded on demand. */
export function useHistory() {
  const [runs, setRuns] = useState<history.Run[]>([]);
  const [estimate, setEstimate] = useState<{
    usage: number;
    quota: number;
  } | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const [list, usage] = await Promise.all([
      history.listRuns(),
      history.storageEstimate(),
    ]);
    setRuns(list);
    setEstimate(usage);
    setLoaded(true);
  }, []);

  useEffect(() => {
    // reload only sets state after awaiting IndexedDB, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const remove = useCallback(
    async (id: string) => {
      await history.deleteRun(id);
      await reload();
    },
    [reload],
  );

  const clear = useCallback(async () => {
    await history.clearHistory();
    await reload();
  }, [reload]);

  /** After the database itself was deleted: empty without reopening it. */
  const forget = useCallback(() => {
    setRuns([]);
    setEstimate(null);
  }, []);

  return { runs, estimate, loaded, reload, remove, clear, forget };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} kB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}
