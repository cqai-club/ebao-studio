/** Localized copy for Desktop-owned native dialogs and notifications. */

import type { DesktopLocale } from './runtime.ts'

export interface DesktopNativeCopy {
  readonly ok: string
  readonly pluginRecoveryTitle: string
  readonly pluginRecoveryMessage: string
  readonly unknownPlugin: string
  readonly missingPluginError: string
  readonly failedPlugins: string
  readonly pluginRecoveryInstructions: string
  readonly openTerminal: string
  readonly restart: string
  readonly dismiss: string
  readonly updateAvailableTitle: string
  readonly updateAvailableMessage: (version: string) => string
  readonly downloadUpdate: string
  readonly installStableAlongsideBeta: string
  readonly download: string
  readonly later: string
  readonly updateCheckFailedTitle: string
  readonly updateCheckFailedMessage: string
  readonly tryAgainLater: string
  readonly upToDateTitle: string
  readonly upToDateMessage: string
  readonly installedVersion: (version: string) => string
  readonly installerUnavailable: string
  readonly updateDownloadedTitle: string
  readonly updateReady: (version: string) => string
  readonly restartToUpdateQuestion: string
  readonly restartAndUpdate: string
  readonly terminalErrorTitle: string
  readonly terminalErrorMessage: string
  readonly diagnosticsErrorTitle: string
  readonly diagnosticsErrorMessage: string
  readonly skippedPluginTitle: string
  readonly skippedPluginBody: (name: string, additionalCount: number) => string
  readonly unsupportedStorageTitle: string
  readonly unsupportedStorageBody: (label: string) => string
  readonly profileCompatibilityTitle: string
  readonly profileCompatibilityMessage: (profileName: string, previousProductName?: string) => string
  readonly profileCompatibilityDetail: (
    previousDesktopVersion: string,
    previousDshVersion: string,
    currentProductName: string,
    currentDesktopVersion: string,
    currentDshVersion: string,
  ) => string
  readonly profileCompatibilityUnknownDetail: (
    currentProductName: string,
    currentDesktopVersion: string,
    currentDshVersion: string,
  ) => string
  readonly profileCompatibilityWarning: string
  readonly switchProfile: string
  readonly useProfileAnyway: string
  readonly quit: string
  readonly unknownVersion: string
}

const COPY: Record<DesktopLocale, DesktopNativeCopy> = {
  en: {
    ok: 'OK',
    pluginRecoveryTitle: 'Plugin Load Failed',
    pluginRecoveryMessage: 'Some plugins could not be loaded.',
    unknownPlugin: 'Unknown client plugin',
    missingPluginError: 'The plugin loader did not provide an error message.',
    failedPlugins: 'Plugins that failed to load:',
    pluginRecoveryInstructions: 'Update or uninstall the failed third-party plugins in DSH Terminal, then restart the app.',
    openTerminal: 'Open DSH Terminal',
    restart: 'Restart 易宝工坊',
    dismiss: 'Dismiss',
    updateAvailableTitle: '易宝工坊 Update Available',
    updateAvailableMessage: version => `易宝工坊 ${version} is available.`,
    downloadUpdate: 'Download this update now?',
    installStableAlongsideBeta: 'Install the stable edition alongside 易宝工坊 Beta? The Beta app will remain installed.',
    download: 'Download',
    later: 'Later',
    updateCheckFailedTitle: 'Unable to Check for Updates',
    updateCheckFailedMessage: 'Could not retrieve update information.',
    tryAgainLater: 'Please try again later.',
    upToDateTitle: '易宝工坊 Is Up to Date',
    upToDateMessage: 'You are using the latest version.',
    installedVersion: version => `Installed version: ${version}`,
    installerUnavailable: 'This version cannot download installers from within the app.',
    updateDownloadedTitle: '易宝工坊 Update Downloaded',
    updateReady: version => `易宝工坊 ${version} is ready to install.`,
    restartToUpdateQuestion: 'Restart 易宝工坊 now to install the verified update automatically.',
    restartAndUpdate: 'Restart and Update',
    terminalErrorTitle: 'Unable to Open DSH Terminal',
    terminalErrorMessage: 'Could not start the terminal. Please try again.',
    diagnosticsErrorTitle: 'Unable to Export Diagnostics',
    diagnosticsErrorMessage: 'Could not create the diagnostic archive. Please try again.',
    skippedPluginTitle: 'UI Plugin Not Loaded',
    skippedPluginBody: (name, additionalCount) => additionalCount > 0
      ? `${name} and ${additionalCount} other UI ${additionalCount === 1 ? 'plugin are' : 'plugins are'} not installed in this Profile.`
      : `${name} is not installed in this Profile.`,
    unsupportedStorageTitle: 'Storage May Be Unsupported',
    unsupportedStorageBody: label => `${label} is on a volume that may prevent sandboxed commands or plugin installation from working.`,
    profileCompatibilityTitle: 'Profile Compatibility Warning',
    profileCompatibilityMessage: profileName =>
      `The Desktop version last used by the current Profile “${profileName}” differs from the current version:`,
    profileCompatibilityDetail: (previousDesktopVersion, previousDshVersion, _currentProductName, currentDesktopVersion, currentDshVersion) =>
      `Last Desktop/DSH version: ${previousDesktopVersion}/${previousDshVersion}\nCurrent Desktop/DSH version: ${currentDesktopVersion}/${currentDshVersion}`,
    profileCompatibilityUnknownDetail: (_currentProductName, currentDesktopVersion, currentDshVersion) =>
      `Last Desktop/DSH version: Unknown/Unknown\nCurrent Desktop/DSH version: ${currentDesktopVersion}/${currentDshVersion}`,
    profileCompatibilityWarning: 'DSH version differences may cause:\n1. Historical session information to fail to load;\n2. Some plugins in the current Profile to be incompatible and possibly cause errors or crashes.\nWe recommend switching to a compatible Profile or creating a new Profile.',
    switchProfile: 'Switch Profile',
    useProfileAnyway: 'Use Anyway',
    quit: 'Quit',
    unknownVersion: 'Unknown',
  },
  zh: {
    ok: '确定',
    pluginRecoveryTitle: '插件加载失败',
    pluginRecoveryMessage: '部分插件未能加载。',
    unknownPlugin: '未知客户端插件',
    missingPluginError: '插件加载器没有提供错误信息。',
    failedPlugins: '加载失败的插件：',
    pluginRecoveryInstructions: '请在 DSH 终端中更新或卸载加载失败的第三方插件，然后重启应用。',
    openTerminal: '打开 DSH 终端',
    restart: '重启 易宝工坊',
    dismiss: '关闭',
    updateAvailableTitle: '易宝工坊 有可用更新',
    updateAvailableMessage: version => `易宝工坊 ${version} 已可用。`,
    downloadUpdate: '现在下载此更新？',
    installStableAlongsideBeta: '是否同时安装稳定版？易宝工坊 Beta 将继续保留。',
    download: '下载',
    later: '稍后',
    updateCheckFailedTitle: '无法检查更新',
    updateCheckFailedMessage: '未能获取更新信息。',
    tryAgainLater: '请稍后重试。',
    upToDateTitle: '易宝工坊 已是最新版本',
    upToDateMessage: '当前已是最新版本。',
    installedVersion: version => `当前版本：${version}`,
    installerUnavailable: '当前版本不支持在应用内下载安装包。',
    updateDownloadedTitle: '易宝工坊 更新已下载',
    updateReady: version => `易宝工坊 ${version} 已可安装。`,
    restartToUpdateQuestion: '现在重启 易宝工坊，自动安装已校验的更新。',
    restartAndUpdate: '重启并更新',
    terminalErrorTitle: '无法打开 DSH 终端',
    terminalErrorMessage: '未能启动终端。请重试。',
    diagnosticsErrorTitle: '无法导出诊断信息',
    diagnosticsErrorMessage: '未能生成诊断包。请重试。',
    skippedPluginTitle: '界面插件未加载',
    skippedPluginBody: (name, additionalCount) => additionalCount > 0
      ? `${name} 及另外 ${additionalCount} 个界面插件未安装在当前 Profile 中。`
      : `${name} 未安装在当前 Profile 中。`,
    unsupportedStorageTitle: '存储位置可能不受支持',
    unsupportedStorageBody: label => `${label} 所在的磁盘可能导致沙盒命令或插件安装无法正常工作。`,
    profileCompatibilityTitle: 'Profile 兼容性警告',
    profileCompatibilityMessage: profileName =>
      `当前 Profile“${profileName}”最后一次使用的桌面版本与当前版本不同：`,
    profileCompatibilityDetail: (previousDesktopVersion, previousDshVersion, _currentProductName, currentDesktopVersion, currentDshVersion) =>
      `最后一次的桌面版/DSH 版本：${previousDesktopVersion}/${previousDshVersion}\n当前的桌面版/DSH 版本：${currentDesktopVersion}/${currentDshVersion}`,
    profileCompatibilityUnknownDetail: (_currentProductName, currentDesktopVersion, currentDshVersion) =>
      `最后一次的桌面版/DSH 版本：未知/未知\n当前的桌面版/DSH 版本：${currentDesktopVersion}/${currentDshVersion}`,
    profileCompatibilityWarning: 'DSH 版本差异可能会导致：\n1. 历史会话信息加载出错；\n2. 当前 Profile 下的部分插件不兼容，甚至引发报错或崩溃。\n建议您切换到兼容的 Profile，或创建新的 Profile。',
    switchProfile: '切换 Profile',
    useProfileAnyway: '仍然使用',
    quit: '退出',
    unknownVersion: '未知',
  },
}

export function desktopNativeCopy(locale: DesktopLocale): DesktopNativeCopy {
  return COPY[locale]
}
