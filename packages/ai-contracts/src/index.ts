// Names only. Versioned prompts, schemas and inference arrive in their assigned phases.
export const AI_TASKS = ['job-analysis', 'rubric-draft', 'resume-extraction',
  'resume-evaluation', 'interview-planning', 'live-interviewer',
  'context-summary', 'interview-evaluation', 'final-report'] as const;
export type AiTask = typeof AI_TASKS[number];
