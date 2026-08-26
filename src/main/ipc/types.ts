export type {
  BundleInfo,
  DoctorResult,
  ImportBundleResult,
  MeetingSummary,
  Project,
  Settings,
  SpeakerProfile,
  TranscriptSegment
} from '../../shared/types'

export interface PdfOptionsShape {
  includeTranscript: boolean
  includeTimestamps: boolean
}
