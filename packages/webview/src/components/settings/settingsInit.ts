/**
 * 设置页的 __DIONYSUS_INIT__ 读取（与 App.tsx 的 DionysusInit 解耦：
 * 本目录为 role='settings' 独立入口，只消费自己需要的字段）。
 *
 * builtinAssetsUri / userLibraryUri 由 extension 的 webview-provider 经
 * asWebviewUri 注入；persona 摘要里的 avatarPath 是相对这两个根的
 * POSIX 路径，设置页在此拼成可加载 URL。
 */
export interface SettingsInit {
  /** 出厂 assets/ 的 asWebviewUri（avatarSource='builtin' 的头像根） */
  builtinAssetsUri?: string
  /** 用户素材库 character-library/ 的 asWebviewUri（avatarSource='user' 的头像根） */
  userLibraryUri?: string
}

/** 读取宿主注入的设置页初始化数据；缺失（纯浏览器/vitest）时回退空对象。 */
export function readSettingsInit(): SettingsInit {
  const raw: unknown = window.__DIONYSUS_INIT__
  if (!raw || typeof raw !== 'object') return {}
  const init = raw as Record<string, unknown>
  return {
    ...(typeof init.builtinAssetsUri === 'string' ? { builtinAssetsUri: init.builtinAssetsUri } : {}),
    ...(typeof init.userLibraryUri === 'string' ? { userLibraryUri: init.userLibraryUri } : {}),
  }
}
