export interface YaosExtensionSettings {
  showCursorNames: boolean;
  showStatusBar: boolean;
  showPeerDotsInStatusBar: boolean;
  showComments: boolean;
  showNotifications: boolean;
  showEditHistory: boolean;
  editHistoryRetentionDays: number;
  editHistoryMaxPerFilePerDay: number;
  editHistoryDebounceMs: number;
  editHistoryRebaseInterval: number;
}

export const DEFAULT_SETTINGS: YaosExtensionSettings = {
  showCursorNames: true,
  showStatusBar: true,
  showPeerDotsInStatusBar: true,
  showComments: true,
  showNotifications: true,
  showEditHistory: true,
  editHistoryRetentionDays: 30,
  editHistoryMaxPerFilePerDay: 50,
  editHistoryDebounceMs: 5000,
  editHistoryRebaseInterval: 10,
};
