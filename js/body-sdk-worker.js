// One request per worker. Termination releases the model and local image resources.
let sdkProvider;
function registerBodyProvider(provider) { sdkProvider = provider; }
importScripts('body-outputs.js', 'photo-identity.js', 'photo-quality.js', 'pose-measure.js','heic-decode.js');
let started = false;
async function checkSDKPhoto(frame) {
  if (!(frame instanceof Blob) || !['image/jpeg', 'image/png', 'image/webp'].includes(frame.type) || !frame.size || frame.size > 25 * 1024 * 1024) throw Error('invalid_photo');
  const bitmap = await createImageBitmap(frame);
  try { if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 16000000) throw Error('photo_dimensions'); }
  finally { bitmap.close(); }
}
function sdkScanResult(raw, elapsedMs) {
  const measurements = Object.entries(BODY_OUTPUTS).filter(([key]) => Number.isFinite(raw.metrics?.[key]) && raw.metrics[key] > 0)
    .map(([key, definition]) => ({key, value: raw.metrics[key], unit: definition.unit, label: definition.label, definition: definition.definition}));
  if (!measurements.length) throw Error('incomplete');
  return {
    schema: 'PP_BODY_SDK_RESULT_V1', sdkVersion: '0.13.0', createdAt: new Date().toISOString(),
    engine: {id: sdkProvider.id, version: sdkProvider.version, model: sdkProvider.model},
    outputDictionary: BODY_OUTPUT_VERSION, status: 'provisional', heightIn: raw.heightIn,
    processingMs: Math.round(elapsedMs), measurements,
    missingOutputs: Object.keys(BODY_OUTPUTS).filter(key => !measurements.some(m => m.key === key)),
    captureChecks: (raw.detail?.captureChecks || []).map(check => ({view: check.view, protocol: check.protocol, accepted: check.accepted === true,
      reasons: (check.reasons || []).filter(s => typeof s === 'string'), warnings: (check.warnings || []).filter(s => typeof s === 'string')})),
    limitations: ['Photo length estimates scaled to recorded height; accuracy has not been validated.',
      'No reconstructed body mesh, anatomical girths, body composition or growth-spurt timing.',
      'Photo checks are heuristics and do not authenticate identity or facing direction.'],
  };
}
self.onmessage = async ({data}) => {
  if (started) return;
  started = true;
  const start = performance.now();
  try {
    let result;
    if (data?.operation === 'review') {
      if (!['front', 'right', 'back', 'left'].includes(data.view)) throw Error('invalid_view');
      const imported=await HeicImport.normalize(data.frame,message=>self.postMessage({type:'progress',message}));
      await checkSDKPhoto(imported.blob);
      self.postMessage({type: 'progress', message: 'Reviewing the photo on this device…'});
      const check = await sdkProvider.reviewFrame({frame: imported.blob, view: data.view});
      result = {schema: 'PP_BODY_SDK_REVIEW_V1', sdkVersion: '0.13.0', ...check,...(imported.conversion?{conversion:imported.conversion}:{})};
    } else if (data?.operation === 'scan') {
      if (!Number.isFinite(data.heightIn) || data.heightIn < 30 || data.heightIn > 90) throw Error('invalid_height');
      await requireDistinctPhotos(data.frames);
      const frames={},imports=[];
      for (const view of ['front', 'right', 'back', 'left']) {
        const imported=await HeicImport.normalize(data.frames[view],message=>self.postMessage({type:'progress',message:view+': '+message}));
        frames[view]=imported.blob;if(imported.conversion)imports.push({view,...imported.conversion});await checkSDKPhoto(frames[view]);
      }
      const raw = await sdkProvider.measure({frames, heightIn: data.heightIn,
        onProgress: message => self.postMessage({type: 'progress', message})});
      result = sdkScanResult(raw, performance.now() - start);
      if(imports.length)result.imports=imports;
    } else throw Error('invalid_operation');
    self.postMessage({type: 'result', result});
  } catch (error) {
    const messages = {
      duplicate_photos: 'Use four different photos, one per view.', needs_four_views: 'All four views are required.',
      photo_dimensions: 'Each photo must be at most 16 megapixels.', invalid_photo: 'Use JPEG, PNG or WebP photos up to 25 MB.',
      invalid_height: 'Recorded height must be 30–90 inches.', capture_quality: 'Photo checks failed. Review each view and retake it.',
      incomplete: 'Insufficient landmarks for a measurement.', implausible: 'Estimates failed the plausibility checks.',
      heic_multiple_images: 'Choose a single-photo HEIC file; image sequences are not supported.',
      heic_decode_failed: 'HEIC decoding failed. Try a fresh export from the original photo.',
    };
    const key = Object.keys(messages).find(code => error.message === code || error.message?.startsWith(code + ':'));
    const captureChecks=Array.isArray(error.captureChecks)?error.captureChecks.slice(0,4).filter(c=>['front','right','back','left'].includes(c?.view)).map(c=>({view:c.view,accepted:c.accepted===true,
      reasons:Array.isArray(c.reasons)?c.reasons.filter(s=>typeof s==='string'&&/^[a-z_]{1,64}$/.test(s)).slice(0,12):[]})):undefined;
    self.postMessage({type: 'error', code: key ? key.toUpperCase() : 'PROCESSING_FAILED', message: key ? messages[key] : 'Local photo processing failed. Check the image, model connection and device support.',...(captureChecks?{captureChecks}:{})});
  }
};

