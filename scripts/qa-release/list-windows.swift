#!/usr/bin/env swift
// 列出屏幕上所有窗口的 CGWindowID / owner / title（供 screencapture -l 免聚焦截窗）
import CoreGraphics

let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as! [[String: Any]]
for w in list {
  let id = w[kCGWindowNumber as String] as? Int ?? 0
  let owner = w[kCGWindowOwnerName as String] as? String ?? ""
  let title = w[kCGWindowName as String] as? String ?? ""
  let layer = w[kCGWindowLayer as String] as? Int ?? -1
  guard layer == 0 else { continue }
  print("\(id)\t\(owner)\t\(title)")
}
