import Foundation
import Vision
import PDFKit
import ImageIO
import CoreGraphics

struct OCRFailure: Error {
    let code: String
    let message: String
}

struct Block: Codable {
    let id: String
    let page: Int
    let text: String
    let bbox: [Double]
    let confidence: Float
}

func fail(_ code: String, _ message: String) throws -> Never {
    throw OCRFailure(code: code, message: message)
}

func recognise(_ image: CGImage, page: Int, orientation: CGImagePropertyOrientation = .up) throws -> [Block] {
    guard image.width <= 8192, image.height <= 8192,
          image.width * image.height <= 40_000_000 else {
        try fail("IMAGE_TOO_LARGE", "图片像素过大，请缩小后重新识别。")
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = true
    try VNImageRequestHandler(cgImage: image, orientation: orientation).perform([request])
    let observations = (request.results ?? []).sorted { left, right in
        if abs(left.boundingBox.midY - right.boundingBox.midY) > 0.01 {
            return left.boundingBox.midY > right.boundingBox.midY
        }
        return left.boundingBox.minX < right.boundingBox.minX
    }
    return observations.enumerated().compactMap { index, observation in
        guard let candidate = observation.topCandidates(1).first,
              !candidate.string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        let rect = observation.boundingBox
        return Block(id: "p\(page)-b\(index + 1)", page: page, text: candidate.string,
                     bbox: [Double(rect.minX), Double(1 - rect.maxY), Double(rect.width), Double(rect.height)],
                     confidence: candidate.confidence)
    }
}

func writePNG(_ image: CGImage, to url: URL) throws {
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil) else {
        try fail("PDF_RENDER_FAILED", "无法建立 PDF 页面图像。")
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else {
        try fail("PDF_RENDER_FAILED", "无法保存 PDF 页面图像。")
    }
}

do {
    guard CommandLine.arguments.count == 4 else { try fail("OCR_ARGUMENTS", "OCR 参数不正确。") }
    let input = URL(fileURLWithPath: CommandLine.arguments[1])
    let mime = CommandLine.arguments[2]
    let output = URL(fileURLWithPath: CommandLine.arguments[3], isDirectory: true)
    var blocks: [Block] = []
    var imagePaths: [String] = []
    var pageCount = 1
    if mime == "application/pdf" {
        guard let document = PDFDocument(url: input) else { try fail("INVALID_PDF", "PDF 无法读取。") }
        guard !document.isLocked else { try fail("PDF_LOCKED", "PDF 已加密，请解锁后重新上传。") }
        pageCount = document.pageCount
        guard pageCount > 0 else { try fail("EMPTY_PDF", "PDF 没有页面。") }
        guard pageCount <= 5 else { try fail("PDF_PAGE_LIMIT", "最多识别 5 页 PDF，请拆分后上传。") }
        for index in 0..<pageCount {
            guard let page = document.page(at: index) else { try fail("PDF_RENDER_FAILED", "PDF 页面无法读取。") }
            let bounds = page.bounds(for: .mediaBox)
            let width = Int(ceil(bounds.width * 2))
            let height = Int(ceil(bounds.height * 2))
            guard width > 0, height > 0, width <= 8192, height <= 8192,
                  width * height <= 40_000_000 else { try fail("IMAGE_TOO_LARGE", "PDF 页面尺寸过大。") }
            guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                                          bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
                try fail("PDF_RENDER_FAILED", "无法渲染 PDF 页面。")
            }
            context.setFillColor(CGColor(gray: 1, alpha: 1))
            context.fill(CGRect(x: 0, y: 0, width: width, height: height))
            context.scaleBy(x: 2, y: 2)
            context.translateBy(x: -bounds.minX, y: -bounds.minY)
            page.draw(with: .mediaBox, to: context)
            guard let image = context.makeImage() else { try fail("PDF_RENDER_FAILED", "PDF 页面没有图像。") }
            let url = output.appendingPathComponent("page-\(index + 1).png")
            try writePNG(image, to: url)
            imagePaths.append(url.path)
            blocks += try recognise(image, page: index + 1)
        }
    } else {
        guard let source = CGImageSourceCreateWithURL(input as CFURL, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0, width <= 8192, height <= 8192,
              width * height <= 40_000_000 else { try fail("INVALID_IMAGE", "图片无法读取或像素过大。") }
        guard let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            try fail("INVALID_IMAGE", "图片无法解码。")
        }
        let orientation = CGImagePropertyOrientation(rawValue: (properties[kCGImagePropertyOrientation] as? UInt32) ?? 1) ?? .up
        blocks = try recognise(image, page: 1, orientation: orientation)
        imagePaths = [input.path]
    }
    guard !blocks.isEmpty else { try fail("OCR_EMPTY", "未识别到文字，请上传清晰且包含文字的材料。") }
    let encoded = try JSONEncoder().encode(blocks)
    let blockJSON = try JSONSerialization.jsonObject(with: encoded)
    let data = try JSONSerialization.data(withJSONObject: ["pageCount": pageCount, "blocks": blockJSON, "imagePaths": imagePaths])
    FileHandle.standardOutput.write(data)
} catch {
    let failure = error as? OCRFailure
    let data = try! JSONSerialization.data(withJSONObject: ["error": [
        "code": failure?.code ?? "OCR_FAILED",
        "message": failure?.message ?? "文字识别暂时失败，请重试。",
    ]])
    FileHandle.standardOutput.write(data)
    exit(1)
}
