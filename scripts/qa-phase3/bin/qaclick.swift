// Phase 3 QA 工具：macOS 坐标点击（CGEvent）。用法: qaclick <x> <y>
import CoreGraphics
import Foundation

let args = CommandLine.arguments
guard args.count == 3, let x = Double(args[1]), let y = Double(args[2]) else {
    FileHandle.standardError.write("usage: qaclick <x> <y>\n".data(using: .utf8)!)
    exit(2)
}
let p = CGPoint(x: x, y: y)
let src = CGEventSource(stateID: .hidSystemState)
let down = CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left)
let up = CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left)
down?.post(tap: .cghidEventTap)
usleep(60000)
up?.post(tap: .cghidEventTap)
print("clicked (\(x), \(y))")
