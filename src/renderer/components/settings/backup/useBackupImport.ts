import useAppApi from 'renderer/hooks/useAppApi';

/** Pick a backup file and restore it. Resolves true once the import succeeded. */
export default function useBackupImport() {
  const { message } = useAppApi();

  return async () => {
    try {
      const res = await window.ipcRenderer.get<
        { success: boolean; error?: string } | boolean
      >('IMPORT_SETTINGS');
      const success =
        typeof res === 'object' && res !== null ? res.success : Boolean(res);
      if (success) message.success('Settings imported successfully');
      else if (typeof res === 'object' && res?.error) message.error(res.error);
      return success;
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : 'Error importing settings',
      );
      return false;
    }
  };
}

/** Restore an encrypted JNbot Cloud snapshot. Resolves an error message, or null on success. */
export async function restoreCloudBackup(userId: string, shareKey: string) {
  try {
    const result = await window.ipcRenderer.get<{
      success: boolean;
      error?: string;
    }>('CLOUD_STORAGE_IMPORT', {
      userId: userId.trim(),
      password: shareKey.trim(),
    });
    return result.success
      ? null
      : result.error || 'Failed to restore cloud backup.';
  } catch (err) {
    return err instanceof Error ? err.message : 'Error restoring backup.';
  }
}
