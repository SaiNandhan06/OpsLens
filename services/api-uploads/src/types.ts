export type UploadKind = 'photo' | 'audio';

export interface PresignUploadInput {
  kind: UploadKind;
  contentType: string;
  sizeBytes: number;
}

export interface PresignUploadResult {
  uploadUrl: string;
  s3Key: string;
  key: string;
  expiresAt: string;
}
