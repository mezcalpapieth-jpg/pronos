import { MANANERA_TRANSCRIPT_SOURCE, buildMananeraDirectTranscriptUrl } from './mananera.js';

// A missing transcript is not a No. After the evening publication window,
// expose the official recording to admins while automatic retries continue.
export function buildMananeraFallbackReview(cfg, transcript, { now = new Date() } = {}) {
  if (cfg?.source !== MANANERA_TRANSCRIPT_SOURCE || transcript?.ready) return null;
  const dates = (Array.isArray(cfg.dateYmds) ? cfg.dateYmds : [cfg.dateYmd])
    .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date || '')).sort();
  if (!dates.length) return null;
  // Weekly counts must wait until the final conference's publication window.
  const reviewAfter = new Date(`${dates.at(-1)}T18:00:00-06:00`);
  if (!Number.isFinite(reviewAfter.getTime()) || new Date(now) < reviewAfter) return null;
  const dateYmd = transcript.pendingDateYmd || cfg.dateYmd || dates.at(-1);
  const videoUrls = [transcript.youtubeVideoUrl,
    ...(transcript.youtubeCaptionAttempts || []).map(item => item.videoUrl)]
    .filter(url => typeof url === 'string' && /^https:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]{11}(&|$)/.test(url));
  const sourceUrls = [...new Set([
    ...videoUrls, buildMananeraDirectTranscriptUrl(dateYmd),
    transcript.youtubeSearchUrl,
  ].filter(Boolean))];
  const reason = transcript.reason || 'official_transcript_not_ready';
  const fallbackReason = transcript.fallbackReason || null;
  return {
    suggestedOutcomeIndex: null,
    outcomeIndex: null,
    confidenceBps: 0,
    evidenceUrl: videoUrls[0] || sourceUrls[0],
    sourceUrls,
    reviewAfter: reviewAfter.toISOString(),
    dateYmd,
    dateYmds: dates,
    pendingDateYmd: transcript.pendingDateYmd || null,
    reason,
    fallbackReason,
    officialFetchAttempts: transcript.officialFetchAttempts || [],
    youtubeSearchUrl: transcript.youtubeSearchUrl || null,
    youtubeVideoUrl: videoUrls[0] || null,
    youtubeTranscriptTitle: transcript.youtubeTranscriptTitle || null,
    youtubeCaptionAttempts: transcript.youtubeCaptionAttempts || [],
    rationale: `No se pudo verificar la transcripción completa del ${dateYmd}: ${reason}${fallbackReason ? `; respaldo: ${fallbackReason}` : ''}. Revisar el video completo y contar únicamente las intervenciones de la presidenta. No inferir «No» de un texto parcial ni contar a otras personas. El lector automático seguirá reintentando.`,
  };
}
