import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_SUPPORT_ATTACHMENT_BYTES,
  normalizeSupportAttachments,
  serializeSupportAttachments,
} from './support-attachments.js';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('normalizeSupportAttachments accepts safe image data urls', () => {
  const attachments = normalizeSupportAttachments([
    { name: '../support shot.png', type: 'image/png', dataUrl: PNG_DATA_URL },
  ]);

  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].name, '..-support shot.png');
  assert.equal(attachments[0].type, 'image/png');
  assert.equal(attachments[0].dataUrl, PNG_DATA_URL);
  assert.ok(attachments[0].size > 0);
});

test('normalizeSupportAttachments rejects unsupported image types', () => {
  assert.throws(
    () => normalizeSupportAttachments([
      { name: 'vector.svg', dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' },
    ]),
    /unsupported_attachment_type/,
  );
});

test('normalizeSupportAttachments rejects excessive count and size', () => {
  assert.throws(
    () => normalizeSupportAttachments([
      { dataUrl: PNG_DATA_URL },
      { dataUrl: PNG_DATA_URL },
      { dataUrl: PNG_DATA_URL },
      { dataUrl: PNG_DATA_URL },
    ]),
    /too_many_attachments/,
  );

  const large = Buffer.alloc(MAX_SUPPORT_ATTACHMENT_BYTES + 1, 1).toString('base64');
  assert.throws(
    () => normalizeSupportAttachments([
      { name: 'large.png', dataUrl: `data:image/png;base64,${large}` },
    ]),
    /attachment_too_large/,
  );
});

test('serializeSupportAttachments filters unsafe stored values', () => {
  const serialized = serializeSupportAttachments([
    { name: 'ok.png', type: 'image/png', size: 10, dataUrl: PNG_DATA_URL },
    { name: 'bad.svg', type: 'image/svg+xml', dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' },
    null,
  ]);

  assert.deepEqual(serialized.map(a => a.name), ['ok.png']);
});
