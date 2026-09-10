# On-device HEIC import

The SDK, parent capture flow and local reconstruction lab can now accept HEIC originals. Conversion runs in a worker on the device and produces a PNG without cropping, resizing or adding missing image content. JPEG/PNG/WebP files bypass the HEIC decoder. Input framing and pose-quality thresholds remain unchanged.

## Components and integration

- `js/heic-decode.js`: shared single-image decoder adapter, bounded format detection, dimensions and resource cleanup.
- `js/photo-import-worker.js` and `js/photo-import.mjs`: cancelable capture/preview conversion, with a 90-second deadline.
- `js/body-sdk-worker.js`: normalizes HEIC within its existing request worker before review or measurement. SDK version is 0.2.0; measurement-provider math remains 1.2.1.
- `js/body-scan.js`: refreshes the active athlete's consent before converting HEIC, aborts on sheet dismissal/account change, then follows the existing downscale/review flow. The camera's normal JPEG route remains available.
- `tools/sdk-demo.mjs`: HEIC previews after permission; reviewing or scanning original HEIC files also works through the SDK.
- `tools/reconstruction/silhouette-lab.js`: imports HEIC before bitmap/segmentation; Clear aborts conversion.

The three new local import assets are included in service-worker cache version `pp-v61`. Local server allowlists include them. The optional external decoder is not part of the offline precache; first HEIC import needs a connection unless the decoder is already cached by the browser. No production deployment occurred.

## Decoder provenance

The pinned module is [heic-to 1.5.2's libheif build without unsafe evaluation](https://cdn.jsdelivr.net/npm/heic-to@1.5.2/src/lib/libheif-without-unsafe-eval.js), downloaded lazily from jsDelivr. Its inspected header identifies libheif 1.22.2 and libde265 1.0.16. The module is approximately 3.16 MB before transfer compression. Our worker calls its decoder directly, avoiding a nested blob worker and keeping cancellation under our control.

Primary sources: [heic-to repository and build instructions](https://github.com/hoppergee/heic-to), [license](https://github.com/hoppergee/heic-to/blob/main/LICENSE), [libheif source](https://github.com/strukturag/libheif). The published package declares LGPL-3.0. This is a separately distributed open-source dependency, not technology owned by Parent Playbook. Preserve applicable notices and source availability when redistributing or self-hosting it; the adapter does not transfer ownership of the codec. This local build references the pinned external module rather than copying its compiled source into the repository.

The adapter runs under the existing restrictive script policy: same-origin workers and scripts plus jsDelivr. It does not need JavaScript `'unsafe-eval'` or blob workers. Pose inference separately uses WebAssembly and its existing Google model downloads. Original images are never sent to either host by this code; these hosts receive normal code/model download requests.

## Limits and provenance

Input limit: 25 MB per file. HEIC output raster limit: 16 megapixels, checked before allocating the RGBA output. Multi-image containers are rejected rather than silently selecting a frame. Browser memory can still be exceeded during native decoding before dimensions are available. Unsupported, malformed or timed-out imports fail rather than bypassing review. The canvas PNG contains pixels, without copying source EXIF/location metadata.

Conversion records identify `heic-png-v1`, decoder version, dimensions and output type. This is local client metadata, not authenticated capture provenance. It does not claim that color, HDR handling, orientation or every HEIC variant has been validated. Users must inspect the preview. Parent/reconstruction capture normalizes the photo before its existing record flow; it does not yet persist the SDK's per-view conversion metadata in measurement rows.

Native image handles, decoder context, temporary source bytes and canvas backing are released after completion/failure; termination cancels outstanding work. This describes resource lifecycle, not forensic memory erasure. Original File objects remain owned by the selecting page until cleared.

## Actual-file evidence

Four operator-provided HEIC originals converted locally in the browser at 2316 × 3088 pixels. Conversion times in one desktop run were approximately 1.1–1.7 seconds per file; these are observations, not a device-performance guarantee. Pose review on converted outputs accepted both sides and the back, and rejected the front for touching the frame edge, matching the earlier FFmpeg-converted test. The cropped front photo was not repaired or admitted.

Automated checks cover MIME/name/brand detection, bypassing the decoder for JPEG, dimensions, multi-image rejection, native cleanup, timeout/cancellation, SDK input acceptance and parent consent/account/dismissal guards. The SDK preview flow and original-file review were checked in the browser. Actual iPhone execution, the production origin and a complete accepted four-photo measurement remain outstanding. Overall FITMATCH parity remains approximately 20%.
