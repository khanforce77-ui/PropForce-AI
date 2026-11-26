export const CALL_OUTCOMES = [
  'interested',
  'not_interested',
  'callback_requested',
  'viewing_requested',
  'wrong_number',
  'do_not_call',
  'no_answer',
  'voicemail',
  'other',
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];
