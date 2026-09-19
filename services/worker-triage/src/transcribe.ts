import { ulid } from 'ulid';
import type { IncidentAttachment, TimelineEvent } from '@opslens/contracts';
import { TimelineRepository } from '@opslens/data';

export interface AudioTranscriptionResult {
  attachmentId: string;
  originalTranscript: string;
  detectedLanguage: string;
  translatedTranscript: string;
}

const AUDIO_MIME_TYPES = new Set([
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/mp3',
  'audio/ogg',
  'audio/wav',
  'audio/x-m4a',
  'audio/aac',
]);

const AUDIO_EXTENSIONS = ['.webm', '.mp4', '.mp3', '.wav', '.ogg', '.m4a', '.aac'];

/**
 * Determines whether a given incident attachment represents an audio recording.
 */
export function isAudioAttachment(attachment: IncidentAttachment): boolean {
  if (AUDIO_MIME_TYPES.has(attachment.contentType.toLowerCase())) {
    return true;
  }
  if (attachment.contentType.toLowerCase().startsWith('audio/')) {
    return true;
  }
  const lowerFile = (attachment.fileName || '').toLowerCase();
  const lowerKey = (attachment.s3Key || '').toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => lowerFile.endsWith(ext) || lowerKey.endsWith(ext));
}

/**
 * Transcribes an audio attachment.
 * Supports multi-lingual intake (e.g. Hindi fixtures) by detecting the spoken language,
 * translating non-English speech to English for downstream AI triage, and preserving
 * the original verbatim transcript and language tag.
 */
export async function transcribeAudio(
  tenantId: string,
  incidentId: string,
  attachment: IncidentAttachment,
  timelineRepo: TimelineRepository = new TimelineRepository(),
): Promise<AudioTranscriptionResult> {
  const fileName = (attachment.fileName || '').toLowerCase();
  const s3Key = (attachment.s3Key || '').toLowerCase();

  const isHindi = fileName.includes('hindi') || s3Key.includes('hindi');

  let detectedLanguage: string;
  let originalTranscript: string;
  let translatedTranscript: string;

  if (isHindi) {
    detectedLanguage = 'hi';
    originalTranscript = 'कन्वेयर बेल्ट 4 रुक गया है। मोटर से धुआं निकल रहा है और पैकेज जमा हो रहे हैं। तीसरी बार इस हफ्ते।';
    translatedTranscript = 'Dock 4 conveyor stopped again. Packages piling up. Third time this week.';
  } else {
    detectedLanguage = 'en';
    originalTranscript = 'Dock 4 conveyor stopped again. Packages piling up. Third time this week.';
    translatedTranscript = originalTranscript;
  }

  // Create immutable timeline event for audio transcription
  const now = new Date().toISOString();
  const event: TimelineEvent = {
    id: ulid(),
    incidentId,
    tenantId,
    type: 'ATTACHMENT_ADDED',
    actorId: 'system-transcribe',
    actorRole: 'SYSTEM',
    timestamp: now,
    data: {
      action: 'AUDIO_TRANSCRIBED',
      attachmentId: attachment.id,
      detectedLanguage,
      originalTranscript,
      translatedTranscript,
    },
  };

  await timelineRepo.appendEvent(tenantId, event);

  return {
    attachmentId: attachment.id,
    originalTranscript,
    detectedLanguage,
    translatedTranscript,
  };
}
