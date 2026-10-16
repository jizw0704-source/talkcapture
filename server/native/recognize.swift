import Foundation
import Vision
import ImageIO
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["zh-Hans", "en-US"]
request.usesLanguageCorrection = true
do {
  try VNImageRequestHandler(url: url).perform([request])
  let lines = (request.results ?? []).compactMap { observation -> [String: Any]? in
    guard let text = observation.topCandidates(1).first else { return nil }
    return ["text": text.string, "confidence": text.confidence, "y": Double(1-observation.boundingBox.midY), "x": Double(observation.boundingBox.minX), "width": Double(observation.boundingBox.width), "height": Double(observation.boundingBox.height)]
  }.sorted { ($0["y"] as! Double) < ($1["y"] as! Double) }
  let data = try JSONSerialization.data(withJSONObject: lines)
  FileHandle.standardOutput.write(data)
} catch {
  FileHandle.standardError.write(Data("本地文字识别失败：\(error.localizedDescription)".utf8))
  exit(1)
}
