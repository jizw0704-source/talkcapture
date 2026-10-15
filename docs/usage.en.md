# Product scope and user guide

[中文](usage.md) · [English](usage.en.md) · [Project overview](../README.en.md)

The desktop workflow has three steps: import photos, review images, and export the report. The interface is currently in Chinese. This guide gives the labels used in the application; English documentation does not imply an English interface.

## Manual review

1. Select or drag in JPEG, PNG, HEIC / HEIF photos. Limits are 100 photos per project, 30 MB per file, and 1 GB total. Damaged or unsupported files are reported separately.
2. By default, the tool attempts to find the complete projected slide and creates a correction preview. The result is a suggestion requiring review. Adjust the four corners by dragging, coordinate input, or arrow keys. If detection fails or multiple candidates are found, select corners in this order: top left, top right, bottom right, bottom left.
3. Choose “校正并确认” (Correct and confirm). The application normally advances to the next photo. Automatic suggestions are kept separately for each page. With import detection disabled, some untouched pages with the same rotation may inherit normalized corners from the preceding page; each still needs review and confirmation.
4. Drag pages to change their order, or expand “页序与批量操作” (Page order and batch actions) to move, exclude, or restore pages. Excluding a page removes it from output without deleting the original.
5. Choose “去导出” (Go to export), select PPTX or PDF, choose 16:9 or 4:3, then generate and download. Unconfirmed pages normally block manual export unless you explicitly choose to include them as original images.

Switching steps does not discard original images, replace corners, or rerun detection. Advanced settings are collapsed until needed. If an original is missing, select its page to supply the source again while keeping its edits.

“自动找出 PPT” (Automatically find PPT) retries the current page. Successful detection replaces its corners and requires confirmation again; “撤销四角操作” (Undo corner operation) restores the preceding selection. Failed or canceled detection preserves existing corners and confirmation status. Reimporting matching originals does not rerun detection or overwrite saved manual parameters.

## Batch organization and PPT generation

Wait for the entire photo batch to be imported, then choose “自动整理并生成 PPT” (Automatically organize and generate PPT).

The batch uses the current page order, confirmed results, existing corners, rotation, brightness, and contrast. Only pages without a selection are detected again. Explicit batch processing attempts detection even if automatic detection during import is disabled. It does not reorder pages by content, deduplicate photos, or uniformly shrink all selections.

Pages with geometrically valid corners are corrected and labeled “自动校正 · 建议检查” (Automatically corrected · Review recommended). This differs from human confirmation. Once every included page is ready, the tool generates a PPTX and provides a download link. It keeps the selected report name, aspect ratio, and quality; initial settings are 16:9 with quality priority. It does not automatically save the file to disk.

Multiple candidates, missing boundaries, invalid or incomplete manual corners, missing originals, and processing failures appear under “需要检查” (Needs review). Successful pages remain available, but complete document generation pauses. The batch does not silently omit failed pages or substitute their original images. Inspect each issue, manually confirm or exclude the page, then choose “继续整理并生成 PPT” (Continue organizing and generate PPT).

Cancellation is available during detection, correction, and file generation. Completed pages and existing edits are retained. The third-party packaging library may finish its current operation before cancellation takes effect, but the canceled result is discarded and the operation can be retried.

Ordinary import does not trigger automatic confirmation or export. Batch processing starts only when you explicitly choose it. Inspect the final document for complete content even when automatic generation succeeds.

## Phone transfer

1. Connect the phone and computer to the same trusted Wi-Fi. On the computer choose “手机传图” (Phone transfer), select its Wi-Fi address, then “生成二维码” (Generate QR code).
2. Scan the code on the phone and choose “申请连接” (Request connection). On the computer, verify that it is your phone and choose “允许这台手机” (Allow this phone).
3. Select photos on the phone and choose “传到电脑” (Send to computer). Progress reflects bytes transferred. “等待导入” (Waiting for import) means delivery is complete but desktop import is still pending. “电脑已导入” (Imported on computer) means the application has finished reading the file. Failed files can be retried.
4. Photos join the current desktop project. When finished, choose “停止传图” (Stop transfer) or “关闭入口” (Close entry point).

A session allows one approved phone for up to 10 minutes, with a maximum of 100 photos / 1 GB and 30 MB per file. Existing project photos count toward the project limit. If the desktop is busy or its pending queue is full, wait and retry. Do not share the QR code or pairing URL with other people.

The current transfer uses **unencrypted HTTP**. Use it only for non-sensitive material on trusted Wi-Fi, never on public networks or the public internet. The tool does not change firewall settings, open public tunnels, upload to cloud storage, or delete phone photos.

Transferred bytes are temporarily stored on the computer using random filenames and restricted permissions. Import acknowledgment, rejection, expiration, connection closure, and normal server shutdown clean up temporary files. Abrupt termination or power loss can leave temporary files behind. The phone browser may convert an image when selecting it; the gateway preserves the bytes the browser provides, which may differ from the original in the photo library.

If the phone cannot connect, check the selected Wi-Fi address and ensure the network allows devices to communicate. Guest or campus Wi-Fi may isolate devices. Check local network permissions or firewall restrictions yourself; the tool does not bypass them. Alternatively, transfer files using your usual system tools and import them from the computer.

## Project recovery

Original files and editing metadata are stored separately in this browser's local database. After the saved count reaches N/N, refreshing restores originals, order, corners, adjustments and states. Legacy entries or cleared caches need resupplying: SHA-256 content matching handles changed filenames and timestamps. Ambiguous legacy matches require an explicit page target. Use “从电脑补传当前页” or “手机补传当前页” to preserve the page and corners; unverifiable content requires a new confirmation. Failed cache writes show a reason and a retry action.

Clearing a project removes this tool's cached copies and editing metadata without touching source files on the computer or phone. Browser caches may be cleared or evicted and are not a substitute for keeping original-file backups. Changing browsers, clearing site data, or changing the service address can make existing metadata unavailable. Backing up the source repository does not back up browser editing projects or photos.

## Image quality and limits

- Detection analyzes an image with a longest edge of at most 640 px. It returns normalized corners rather than replacing the original.
- Correction previews use up to 1400 px; original-image comparison previews use up to 1800 px. Final export is rebuilt from the original file, not the preview or analysis image.
- Quality priority exports up to 3200 px on the longest edge at 95% JPEG quality. File-size priority uses up to 1920 px at 82%. Low-resolution originals are not enlarged.
- Images fit proportionally within the page without stretching or additional cropping. Perspective correction uses bilinear interpolation. Export may downsample and compress images; it is not a lossless copy of the source.
- Four corners determine a perspective mapping but not the exact physical aspect ratio of the photographed screen. The tool estimates the output ratio from edge lengths; severe viewing angles may still need adjustment.
- Processing limits large images to a 5000 px longest edge and rejects images above 80 megapixels. Sequential processing releases temporary bitmaps, but document packaging still retains encoded page data. The 1 GB input limit is not a guarantee that every device can export a project of that size.

Detection uses edges and straight lines rather than understanding presentation content. Windows, whiteboards, or charts may look like slides. Low contrast, glare, occlusion, severe viewing angles, or corners outside the photo can lead to failure or incorrect selection. Missing or blurred content cannot be recovered.

HEIC support has been checked with a macOS-encoded sample, but not all iPhone generations, HDR modes, multi-frame files, or color spaces. Real phone transfer, high-resolution batches, and compatibility with everyday browsers and PowerPoint still need independent acceptance testing.

Phone transfer is now the primary import action; desktop selection remains available as “从电脑选择”. A busy receive queue automatically waits and retries; other import failures report their actual reason. The magnifier moves to the opposite side of the pointer. Photo changes preserve the previous canvas frame while the next image loads, and later phone arrivals do not reload the current original. Low-contrast and smaller projection boundaries have improved local detection; occluded and cropped boundaries still require manual review.

## Naming, upload recovery, and local correction memory

Suggested report names use meaningful shared filename prefixes, capture date (or today's date), and included page count. They do not infer the topic from image text. Manual names remain unchanged unless “重新建议报告名称” is selected.

The phone page keeps failed filenames, available previews, and actual failure reasons. Once the other photos finish, an in-page reminder filters failures; retry one/all without reselecting, or replace a damaged/oversize file. Appending a selection preserves the existing list. Files remain in page memory only. Imported images with uncertain PPT boundaries are separate from failed uploads and have a desktop review shortcut. Phone boundary notices reflect import-time status.

Confirmed manual corner edits can teach a local scene memory (up to 30 examples in this browser). It stores coarse layout features and normalized corners, not original images. Very similar compositions can receive a fallback proposal when normal detection fails. Such proposals require manual confirmation and pause batch automation. This is case matching, not general model training or a claim of improving accuracy across arbitrary scenes. Disable or clear it under “更多调整”; clearing a photo project does not clear the separate memory. Nothing is uploaded or synced across browsers.
