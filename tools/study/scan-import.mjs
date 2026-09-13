/* Bringing a scan into the measurement study.
 *
 * The operator downloads the company assessment JSON from the scan page, as in
 * SECOND-REFERENCE-SCAN-CHECKLIST.md. That file goes through the same validator the product uses
 * (js/body-sdk-reference-import.mjs), which refuses anything carrying photos, landmarks, masks,
 * contours or geometry. The study keeps only scalar outputs, the height the scan was given, and
 * provenance: exactly what the product already stores, and nothing the protocol promised not to keep.
 */

import { importAdultReferenceRecord } from '../../js/body-sdk-reference-import.mjs';
import { SCAN_TO_REFERENCE } from './reference.mjs';

const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'StudyScanError', code }); };

export function scanFromCompanyRecord(record, { code, device, visit, captureIndex, devices }) {
  if (!Array.isArray(devices) || !devices.includes(device)) fail('UNKNOWN_DEVICE', 'Device ' + device + ' is not in the study configuration.');
  if (visit !== 1 && visit !== 2) fail('BAD_VISIT', 'Visit must be 1 or 2.');
  if (!Number.isInteger(captureIndex) || captureIndex < 1) fail('BAD_CAPTURE_INDEX', 'Capture index must be a positive whole number.');
  const imported = importAdultReferenceRecord(record);
  const outputs = {};
  for (const item of imported.result.measurements) {
    if (!Object.hasOwn(SCAN_TO_REFERENCE, item.key)) fail('UNKNOWN_SCAN_OUTPUT', 'The scan returned an output this study does not recognise: ' + item.key);
    if (item.unit !== 'in') fail('BAD_UNIT', 'Scan outputs must be in inches; got ' + item.unit + ' for ' + item.key);
    outputs[item.key] = item.value;
  }
  return Object.freeze({
    code, device, visit, captureIndex,
    capturedAt: new Date(record.capturedAt).toISOString(),
    sdkVersion: imported.result.sdkVersion,
    engine: Object.freeze({ ...imported.result.engine }),
    heightIn: imported.result.heightIn,
    outputs: Object.freeze(outputs),
    missingOutputs: Object.freeze(Object.keys(SCAN_TO_REFERENCE).filter(key => !Object.hasOwn(outputs, key))),
  });
}
