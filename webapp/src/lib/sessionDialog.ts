import { captureWorkspaceSession, useWorkspace } from "@/store/workspace";

/** A dialog belongs to the account that opened it, including after sign-out/in. */
export function sessionDialog<T>(cancelled: T, show: (finish: (value: T) => void) => () => void): Promise<T> {
  const current = captureWorkspaceSession();
  return new Promise<T>((resolve) => {
    let settled = false;
    let close = () => {};
    let unsubscribe = () => {};
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      close();
      resolve(current() ? value : cancelled);
    };
    unsubscribe = useWorkspace.subscribe(() => { if (!current()) finish(cancelled); });
    try {
      close = show(finish);
      if (settled) close();
    } catch (error) {
      unsubscribe();
      settled = true;
      throw error;
    }
  });
}
