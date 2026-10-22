// macOS Vision OCR. Output is source transcription for review, never a confirmed asset.
import Foundation
import Vision
import ImageIO

for path in CommandLine.arguments.dropFirst() {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["es", "en"]
    request.usesLanguageCorrection = false
    do {
        try VNImageRequestHandler(url: URL(fileURLWithPath: path)).perform([request])
        let lines = (request.results ?? []).compactMap { observation -> [String: Any]? in
            guard let text = observation.topCandidates(1).first else { return nil }
            return ["text": text.string, "confidence": text.confidence,
                    "x": observation.boundingBox.minX, "y": observation.boundingBox.minY,
                    "width": observation.boundingBox.width, "height": observation.boundingBox.height]
        }
        let data = try JSONSerialization.data(withJSONObject: ["image": URL(fileURLWithPath: path).lastPathComponent, "lines": lines], options: [.sortedKeys])
        print(String(data: data, encoding: .utf8)!)
    } catch {
        fputs("OCR failed: \(error)\n", stderr)
        exit(1)
    }
}
