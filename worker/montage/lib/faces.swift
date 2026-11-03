// Détection du visage principal (Vision, macOS) sur des images extraites des rushes.
// Usage : swift faces.swift img1.jpg img2.jpg …
// Sortie : une ligne JSON par image : {"file":…, "cx":0..1, "cy":0..1, "h":0..1} (origine en haut à gauche), ou {"file":…} sans visage.
import Vision
import AppKit

for path in CommandLine.arguments.dropFirst() {
  guard let img = NSImage(contentsOfFile: path) else { print("{\"file\":\"\(path)\"}"); continue }
  var r = NSRect(origin: .zero, size: img.size)
  guard let cg = img.cgImage(forProposedRect: &r, context: nil, hints: nil) else { print("{\"file\":\"\(path)\"}"); continue }
  let req = VNDetectFaceRectanglesRequest()
  try? VNImageRequestHandler(cgImage: cg).perform([req])
  let faces = (req.results ?? []).sorted { $0.boundingBox.height > $1.boundingBox.height }
  if let b = faces.first?.boundingBox {
    print(String(format: "{\"file\":\"%@\",\"cx\":%.4f,\"cy\":%.4f,\"h\":%.4f}", path, b.midX, 1 - b.midY, b.height))
  } else {
    print("{\"file\":\"\(path)\"}")
  }
}
