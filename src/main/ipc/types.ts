export type {
  DoctorResult,
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
