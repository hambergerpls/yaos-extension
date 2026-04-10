export interface YaosExtensionSettings {
  showCursorNames: boolean;
  showStatusBar: boolean;
  showPeerDotsInStatusBar: boolean;
  showComments: boolean;
  showNotifications: boolean;
}

export const DEFAULT_SETTINGS: YaosExtensionSettings = {
  showCursorNames: true,
  showStatusBar: true,
  showPeerDotsInStatusBar: true,
  showComments: true,
  showNotifications: true,
};
