import Foundation
import AppKit
import CoreGraphics

// These documents are deliberately synthetic. No real worker, bank, or employer data is used.
let directory = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "fixtures/material-demo", isDirectory: true)
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

let materials: [(String, [String])] = [
    ("contract", ["合成测试材料 · 劳动合同", "用人单位：合成星海科技有限公司", "劳动者：张小合", "工作岗位：设备维护员", "入职日期：2026年01月05日", "月工资：8000元", "声明：本材料仅用于软件识别测试，不具有法律效力。"]),
    ("wage-statement", ["合成测试材料 · 工资到账记录", "用人单位：合成星海科技有限公司", "员工姓名：张小合", "付款日期：2026年02月10日", "到账金额：6500元", "摘要：2026年01月工资", "声明：本材料仅用于软件识别测试，不是银行流水。"]),
    ("chat", ["合成测试材料 · 工作聊天截图", "主管（合成）：2026年03月02日 09:00", "安排你明天上午到工厂上班，请按时打卡。", "张小合（合成）：2026年03月02日 09:05", "2月份工资还没发，请问什么时候支付？", "主管（合成）：2026年03月02日 09:10", "公司拖欠2月份工资，会尽快支付。", "声明：这不是实际聊天记录，仅用于软件测试。"]),
]

func image(lines: [String]) -> CGImage {
    let width = 1000, height = 700
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: width * 4, bitsPerPixel: 32)!
    let context = NSGraphicsContext(bitmapImageRep: bitmap)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    NSColor.white.setFill()
    NSRect(x: 0, y: 0, width: width, height: height).fill()
    for (index, text) in lines.enumerated() {
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: index == 0 ? 32 : 27, weight: index == 0 ? .semibold : .regular),
            .foregroundColor: NSColor.black,
        ]
        (text as NSString).draw(at: NSPoint(x: 35, y: height - 85 - index * 67), withAttributes: attributes)
    }
    NSGraphicsContext.restoreGraphicsState()
    return bitmap.cgImage!
}

var contractImage: CGImage!
for (name, lines) in materials {
    let picture = image(lines: lines)
    let bitmap = NSBitmapImageRep(cgImage: picture)
    try bitmap.representation(using: .png, properties: [:])!.write(to: directory.appendingPathComponent("\(name).png"))
    if name == "contract" { contractImage = picture }
}

for (name, count) in [("contract.pdf", 1), ("over-limit.pdf", 6)] {
    var box = CGRect(x: 0, y: 0, width: 1000, height: 700)
    let context = CGContext(directory.appendingPathComponent(name) as CFURL, mediaBox: &box, nil)!
    for _ in 0..<count {
        context.beginPDFPage(nil)
        context.draw(contractImage, in: box)
        context.endPDFPage()
    }
    context.closePDF()
}
try (materials[0].1.joined(separator: "\n") + "\n").write(to: directory.appendingPathComponent("facts.txt"), atomically: true, encoding: .utf8)
print("Synthetic fixtures written to \(directory.path)")
