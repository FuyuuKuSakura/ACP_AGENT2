// Phase 3/4 QA 工具：滚轮事件。用法: qascroll <x> <y> <deltaY>（正=向下滚，负=向上滚）
import CoreGraphics
import Foundation

let a = CommandLine.arguments
guard a.count == 4, let x = Double(a[1]), let y = Double(a[2]), let dy = Int32(a[3]) else {
    FileHandle.standardError.write("usage: qascroll <x> <y> <deltaY>\n".data(using: .utf8)!)
    exit(2)
}
// 先把光标移过去（hover 目标区域），再发滚轮
let p = CGPoint(x: x, y: y)
let src = CGEventSource(stateID: .hidSystemState)
if let move = CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left) {
    move.post(tap: .cghidEventTap)
}
usleep(120000)
if let ev = CGEvent(scrollWheelEvent2Source: src, units: .pixel, wheelCount: 1, wheel1: dy, wheel2: 0, wheel3: 0) {
    ev.post(tap: .cghidEventTap)
}
print("scrolled \(dy) @ (\(x), \(y))")
