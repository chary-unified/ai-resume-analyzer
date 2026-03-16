import {type ClassValue, clsx} from "clsx";
import {twMerge} from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  // Determine the appropriate unit by calculating the log
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  // Format with 2 decimal places and round
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export const generateUUID = () => crypto.randomUUID();

const clampScore = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

const normalizeTipType = (value: unknown): 'good' | 'improve' => {
  return value === 'good' ? 'good' : 'improve';
}

const normalizeAtsTips = (value: unknown): Feedback['ATS']['tips'] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => ({
      type: normalizeTipType((item as { type?: unknown })?.type),
      tip: typeof (item as { tip?: unknown })?.tip === 'string' ? (item as { tip: string }).tip : '',
    }))
    .filter((item) => item.tip.trim().length > 0);
}

const normalizeDetailedTips = (
  value: unknown
): Feedback['toneAndStyle']['tips'] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => ({
      type: normalizeTipType((item as { type?: unknown })?.type),
      tip: typeof (item as { tip?: unknown })?.tip === 'string' ? (item as { tip: string }).tip : '',
      explanation:
        typeof (item as { explanation?: unknown })?.explanation === 'string'
          ? (item as { explanation: string }).explanation
          : '',
    }))
    .filter((item) => item.tip.trim().length > 0);
}

export const coerceFeedback = (value: unknown): Feedback | null => {
  if (!value || typeof value !== 'object') return null;

  const input = value as Partial<Feedback>;

  return {
    overallScore: clampScore(input.overallScore),
    ATS: {
      score: clampScore(input.ATS?.score),
      tips: normalizeAtsTips(input.ATS?.tips),
    },
    toneAndStyle: {
      score: clampScore(input.toneAndStyle?.score),
      tips: normalizeDetailedTips(input.toneAndStyle?.tips),
    },
    content: {
      score: clampScore(input.content?.score),
      tips: normalizeDetailedTips(input.content?.tips),
    },
    structure: {
      score: clampScore(input.structure?.score),
      tips: normalizeDetailedTips(input.structure?.tips),
    },
    skills: {
      score: clampScore(input.skills?.score),
      tips: normalizeDetailedTips(input.skills?.tips),
    },
  };
}

const extractJsonCandidate = (text: string): string => {
  const withoutCodeFence = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const firstBrace = withoutCodeFence.indexOf('{');
  const lastBrace = withoutCodeFence.lastIndexOf('}');

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return withoutCodeFence.slice(firstBrace, lastBrace + 1);
  }

  return withoutCodeFence;
}

export const parseFeedbackResponse = (
  content: AIResponse['message']['content']
): Feedback | null => {
  const text =
    typeof content === 'string'
      ? content
      : content
          .map((item) =>
            typeof item?.text === 'string' ? item.text : ''
          )
          .join('\n')
          .trim();

  if (!text) return null;

  const candidate = extractJsonCandidate(text);

  try {
    return coerceFeedback(JSON.parse(candidate));
  } catch {
    return null;
  }
}

const buildDetailedTips = (
  focus: string,
  jobTitle?: string,
  jobDescription?: string
): Feedback['toneAndStyle']['tips'] => {
  const titleSuffix = jobTitle ? ` for ${jobTitle}` : '';
  const hasJobDescription = Boolean(jobDescription && jobDescription.trim().length > 0);

  return [
    {
      type: 'good',
      tip: `Clear section labels${titleSuffix}`,
      explanation:
        'Your resume appears to be structured in recognizable sections, which helps both ATS parsers and recruiters scan quickly.',
    },
    {
      type: 'improve',
      tip: `Add measurable impact in ${focus}`,
      explanation:
        'Convert responsibilities into outcomes using metrics like percentages, time saved, revenue impact, or scale handled.',
    },
    {
      type: hasJobDescription ? 'good' : 'improve',
      tip: hasJobDescription ? 'Role alignment context provided' : 'Add role-specific keywords',
      explanation: hasJobDescription
        ? 'You provided job context, which allows tailored suggestions. Keep matching your wording to role expectations.'
        : 'Include role-relevant terms from the target job description to increase ATS matching and recruiter relevance.',
    },
  ];
}

export const createFallbackFeedback = ({
  jobTitle,
  jobDescription,
}: {
  jobTitle?: string;
  jobDescription?: string;
} = {}): Feedback => {
  const atsTips: Feedback['ATS']['tips'] = [
    {
      type: 'good',
      tip: 'Resume was successfully uploaded and processed',
    },
    {
      type: 'improve',
      tip: 'Use a stronger keyword match to the target role',
    },
    {
      type: 'improve',
      tip: 'Keep section names standard (Summary, Experience, Skills)',
    },
  ];

  const toneTips = buildDetailedTips('tone and style', jobTitle, jobDescription);
  const contentTips = buildDetailedTips('content quality', jobTitle, jobDescription);
  const structureTips = buildDetailedTips('resume structure', jobTitle, jobDescription);
  const skillsTips = buildDetailedTips('skills presentation', jobTitle, jobDescription);

  return {
    overallScore: 62,
    ATS: {
      score: 60,
      tips: atsTips,
    },
    toneAndStyle: {
      score: 64,
      tips: toneTips,
    },
    content: {
      score: 61,
      tips: contentTips,
    },
    structure: {
      score: 66,
      tips: structureTips,
    },
    skills: {
      score: 59,
      tips: skillsTips,
    },
  };
}

