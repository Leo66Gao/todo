// Todo File Opener: lets the Todo web app open a material's file on this Mac.
//
// A web page can't open "/Users/…" itself, so the app hands the path to this
// helper as a link: todo-open://open?path=… (open the file, as double-clicking
// it in Finder would) or todo-open://reveal?path=… (show it in Finder).
//
// Any website could send such a link, so the helper only opens documents
// (PDFs, Office and iWork files, pictures, audio, video, text) and folders in
// your home folder or on an external drive. Anything else, like an app or a
// script, is only shown in Finder, never run.

import AppKit

let documentTypes: Set<String> = [
  "pdf", "epub", "txt", "md", "rtf", "rtfd",
  "doc", "docx", "odt", "pages",
  "ppt", "pptx", "odp", "key",
  "xls", "xlsx", "ods", "csv", "numbers",
  "png", "jpg", "jpeg", "heic", "gif", "webp", "tif", "tiff", "bmp",
  "mp3", "m4a", "wav", "aac", "mp4", "mov", "m4v",
  "ggb", "ipynb",
]

func alert(_ message: String, _ info: String = "") {
  NSApp.activate(ignoringOtherApps: true)
  let a = NSAlert()
  a.messageText = message
  a.informativeText = info
  a.runModal()
}

func handle(_ link: URL) {
  guard link.scheme == "todo-open",
        let raw = URLComponents(url: link, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "path" })?.value,
        raw.hasPrefix("/")
  else { return }
  let file = URL(fileURLWithPath: raw).standardizedFileURL.resolvingSymlinksInPath()
  let path = file.path
  let home = FileManager.default.homeDirectoryForCurrentUser.standardizedFileURL.resolvingSymlinksInPath().path
  guard path.hasPrefix(home + "/") || path.hasPrefix("/Volumes/") else {
    alert("Todo only opens files in your home folder or on an external drive.", path)
    return
  }
  var isFolder: ObjCBool = false
  guard FileManager.default.fileExists(atPath: path, isDirectory: &isFolder) else {
    alert("This file isn’t there any more.", "It may have been moved, renamed or deleted:\n\(path)")
    return
  }
  let values = try? file.resourceValues(forKeys: [.isApplicationKey, .isPackageKey])
  let isApp = values?.isApplication == true
  let ext = file.pathExtension.lowercased()
  if link.host == "open" && !isApp && (documentTypes.contains(ext) || (isFolder.boolValue && values?.isPackage != true)) {
    NSWorkspace.shared.open(file)
  } else {
    NSWorkspace.shared.activateFileViewerSelecting([file])
  }
}

final class Opener: NSObject, NSApplicationDelegate {
  var handled = false
  /** Links being handled (a second one can arrive while a message is showing). */
  var busy = 0

  func application(_ application: NSApplication, open urls: [URL]) {
    handled = true
    busy += 1
    urls.forEach(handle)
    busy -= 1
    // Quit once nothing else is coming or showing.
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
      if self.busy == 0 { NSApp.terminate(nil) }
    }
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    // Opened by itself (not from a link): say what it's for, then quit.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
      if self.handled { return }
      alert("Todo File Opener is installed.", "In Todo, turn on Settings → Files → “Open files on this Mac”. Clicking a material’s file then opens it here.")
      NSApp.terminate(nil)
    }
  }
}

let app = NSApplication.shared
let delegate = Opener()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
