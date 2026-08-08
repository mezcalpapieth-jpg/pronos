const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export const MAX_SUPPORT_ATTACHMENTS = 3;
export const MAX_SUPPORT_ATTACHMENT_BYTES = 1_500_000;
export const MAX_SUPPORT_ATTACHMENT_TOTAL_BYTES = 3_000_000;

const DATA_URL_RE = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i;

function extensionForType(type) {
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/heic') return 'heic';
  if (type === 'image/heif') return 'heif';
  return 'img';
}

function cleanName(value, index, type) {
  const raw = String(value || '').trim();
  const cleaned = raw
    .replace(/[\\/]/g, '-')
    .replace(/[^\w .()@+-]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 120)
    .trim();
  return cleaned || `captura-${index + 1}.${extensionForType(type)}`;
}

function supportAttachmentError(code, detail = null) {
  const error = new Error(code);
  error.code = code;
  error.detail = detail;
  return error;
}

export function normalizeSupportAttachments(input) {
  if (input == null || input === '') return [];
  if (!Array.isArray(input)) throw supportAttachmentError('invalid_attachments');
  if (input.length > MAX_SUPPORT_ATTACHMENTS) throw supportAttachmentError('too_many_attachments');

  const normalized = [];
  let totalBytes = 0;

  input.forEach((item, index) => {
    if (!item || typeof item !== 'object') throw supportAttachmentError('invalid_attachment');
    const match = String(item.dataUrl || '').match(DATA_URL_RE);
    if (!match) throw supportAttachmentError('invalid_attachment_data');

    const type = String(match[1] || item.type || '').toLowerCase();
    if (!ALLOWED_TYPES.has(type)) throw supportAttachmentError('unsupported_attachment_type', type);

    const base64 = String(match[2] || '').replace(/\s+/g, '');
    if (!base64) throw supportAttachmentError('invalid_attachment_data');

    let size = 0;
    try {
      size = Buffer.byteLength(base64, 'base64');
    } catch {
      throw supportAttachmentError('invalid_attachment_data');
    }
    if (!Number.isFinite(size) || size <= 0) throw supportAttachmentError('invalid_attachment_data');
    if (size > MAX_SUPPORT_ATTACHMENT_BYTES) throw supportAttachmentError('attachment_too_large');

    totalBytes += size;
    if (totalBytes > MAX_SUPPORT_ATTACHMENT_TOTAL_BYTES) throw supportAttachmentError('attachments_too_large');

    normalized.push({
      name: cleanName(item.name, index, type),
      type,
      size,
      dataUrl: `data:${type};base64,${base64}`,
    });
  });

  return normalized;
}

export function serializeSupportAttachments(value) {
  const raw = typeof value === 'string'
    ? (() => {
        try { return JSON.parse(value); } catch { return []; }
      })()
    : value;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const match = String(item.dataUrl || '').match(DATA_URL_RE);
      const type = String(item.type || match?.[1] || '').toLowerCase();
      if (!match || !ALLOWED_TYPES.has(type)) return null;
      const size = Number(item.size);
      return {
        name: cleanName(item.name, index, type),
        type,
        size: Number.isFinite(size) && size > 0 ? Math.round(size) : null,
        dataUrl: String(item.dataUrl),
      };
    })
    .filter(Boolean)
    .slice(0, MAX_SUPPORT_ATTACHMENTS);
}
