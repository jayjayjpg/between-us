import { checkAiUsage, AI_DAILY_LIMIT } from './abuse-prevention.ts';

// Computes the "caller profile" surfaced to admins on the chat-log detail
// and user-profile pages: a set of traits meant to help the human listener
// approach the follow-up call well-informed -- see `caller_profiles` in
// `add_caller_profiles.sql` for the full field list and the privacy
// reasoning behind how it's written. Shared between `chat` (runs this
// after every message, for the caller's own profile) and
// `recompute-caller-profiles` (an admin-triggered bulk recompute against
// existing chat history, for when the scoring methodology below changes
// and existing profiles need to catch up with it -- see
// `add_admin_caller_profile_recompute.sql`), so the two can't compute
// different things from the same question set.
//
// Uses OpenRouter's Decisions API (`typesafe/jev-*`) rather than chat
// completions: each trait is a typed question (a 0-1 "score" on an ordinal
// scale, or a "choice" among fixed options) answered with a probability/
// confidence rather than generated prose, which is a better fit for
// structured trait extraction than asking a chat model to emit JSON. See
// OpenRouter's `/api/alpha/decisions` docs for the request/response shape.

const JEV_DECISIONS_API_URL = 'https://openrouter.ai/api/alpha/decisions';
// Note the leading `~` -- this is OpenRouter's alias syntax for "latest",
// distinct from the primary `typesafe/jev-1.13` id (both work; this just
// tracks new releases automatically). Omitting it 400s with "Model ...
// does not exist" rather than falling back to the primary id.
const DEFAULT_JEV_MODEL = '~typesafe/jev-latest';

export interface HistoryEntry {
  role: string;
  content: string;
}

// A `score` question's `criteria` is an ordinal scale (index 0 = the low
// end, last index = the high end); a `choice` question's `criteria` maps
// each allowed option key to a description of when to pick it. Every
// choice question below includes an explicit 'unknown' option and is
// instructed to prefer it over a low-confidence guess -- see
// `choiceQuestion` -- since a wrong demographic guess shown to the
// listener as if it were fact is worse than admitting there's no clear
// signal.
interface ScoreQuestion {
  type: 'score';
  instructions: string;
  criteria: string[];
}
interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}

const CALLER_PROFILE_INSTRUCTION_PREFIX =
  "Base this only on the caller's own messages (not the assistant's) in the onboarding conversation given as `state`.";

function scoreQuestion(
  instructions: string,
  criteria: string[],
): ScoreQuestion {
  return {
    type: 'score',
    instructions: `${CALLER_PROFILE_INSTRUCTION_PREFIX} ${instructions}`,
    criteria,
  };
}

function choiceQuestion(
  instructions: string,
  criteria: Record<string, string>,
): ChoiceQuestion {
  return {
    type: 'choice',
    instructions: `${CALLER_PROFILE_INSTRUCTION_PREFIX} ${instructions} Choose "unknown" unless there is clear, unambiguous signal for one of the other options -- never guess.`,
    criteria,
  };
}

// Neuroticism isn't asked as a single question -- it's the average of
// three narrower sub-questions (stress management, negative-emotion
// frequency, self-consciousness), each scored the same 0-4 way as every
// other trait below. Splitting it out like this asks the model to reason
// about three concrete, checkable things instead of one broad
// "neuroticism" judgment call, and keeps each sub-question's own
// low/high ends unambiguous. See `computeNeuroticism` for how the three
// get averaged back into the single `neuroticism` value the rest of the
// app (and the `caller_profiles` schema) still expects.
const NEUROTICISM_SUB_QUESTION_KEYS = [
  'stress_management',
  'negative_emotion_frequency',
  'self_consciousness',
] as const;

function buildNeuroticismSubQuestions(): Record<string, ScoreQuestion> {
  return {
    stress_management: scoreQuestion(
      "Estimate the caller's ability to manage stress -- the more their messages indicate they have issues managing stress, the higher this should be.",
      [
        'Manages stress very well',
        'Generally manages stress reasonably',
        'Some difficulty managing stress',
        'Frequently struggles to manage stress',
        'Severe difficulty managing stress, feels overwhelmed',
      ],
    ),
    negative_emotion_frequency: scoreQuestion(
      'Estimate how frequently the caller experiences negative emotion (anger, sadness, fear, worry) and how much it negatively impacts their behavior and life -- the more frequent and impactful, the higher this should be.',
      [
        'Rarely expresses negative emotion',
        'Occasional negative emotion, limited impact',
        'Moderate negative emotion, some impact on life',
        'Frequent negative emotion with noticeable impact',
        'Pervasive negative emotion, strongly impacting behavior and life',
      ],
    ),
    self_consciousness: scoreQuestion(
      "Estimate the caller's self-consciousness -- the more their messages hint at feeling inferior to others or worrying about how they're perceived by the people around them, the higher this should be.",
      [
        "Little to no self-consciousness about others' perception",
        "Occasional concern about others' perception",
        'Moderate self-consciousness or feelings of inferiority',
        'Frequent worry about being judged or seen as inferior',
        'Pervasive self-consciousness and feelings of inferiority',
      ],
    ),
  };
}

function buildCallerProfileQuestions(): Record<
  string,
  ScoreQuestion | ChoiceQuestion
> {
  return {
    mood: scoreQuestion(
      "Estimate the caller's overall mood across their messages.",
      [
        'Very negative or distressed',
        'Somewhat negative or down',
        'Mixed or neutral',
        'Somewhat positive or hopeful',
        'Very positive or upbeat',
      ],
    ),
    ...buildNeuroticismSubQuestions(),
    entitlement: scoreQuestion(
      "Estimate the caller's sense of entitlement -- how much they expect special treatment or exceptions versus accepting normal constraints.",
      [
        'Not entitled at all, very accommodating',
        'Mostly accommodating',
        'Balanced expectations',
        'Somewhat expects special treatment',
        'Strong sense of deserving special treatment',
      ],
    ),
    self_reflection: scoreQuestion(
      "Estimate the caller's ability to self-reflect -- insight into their own role and patterns, versus externalizing blame.",
      [
        'Little to no self-reflection, mostly external blame',
        'Limited self-reflection',
        'Some self-awareness',
        'Good self-awareness and insight',
        'Highly self-reflective and insightful',
      ],
    ),
    willingness_to_change: scoreQuestion(
      'Estimate the willingness to change their own behavior or circumstances, as opposed to wanting others or the situation to change instead.',
      [
        'Resistant to change',
        'Reluctant, some openness',
        'Ambivalent',
        'Open to change',
        'Highly motivated to change',
      ],
    ),
    descriptiveness: scoreQuestion(
      "Estimate how descriptive and detailed the caller's messages are.",
      [
        'Extremely terse, minimal detail',
        'Brief, limited detail',
        'Moderate detail',
        'Descriptive, good detail',
        'Highly descriptive and detailed',
      ],
    ),
    defensiveness: scoreQuestion(
      "Estimate how defensive the caller is -- do they answer the assistant's questions eagerly and directly, or evade/deflect many of them?",
      [
        'Very open, answers eagerly and directly',
        'Mostly open',
        'Mixed openness',
        'Often evasive or deflecting',
        'Very defensive, frequently evades questions',
      ],
    ),
    satisfaction: scoreQuestion(
      "Estimate the caller's satisfaction with their current life situation overall, independent of the specific problem they came to talk about.",
      [
        'Very dissatisfied',
        'Somewhat dissatisfied',
        'Mixed or neutral',
        'Somewhat satisfied',
        'Very satisfied',
      ],
    ),
    estimated_gender: choiceQuestion(
      "Estimate the caller's gender, from what they explicitly disclose or from clear or indirect contextual signals in how they write.",
      {
        male: 'Caller discloses or clearly signals they are male.',
        female: 'Caller discloses or clearly signals they are female.',
        nonbinary_or_other: 'Caller discloses a gender outside male/female.',
        unknown: 'Not enough information to make any reasonable estimate.',
      },
    ),
    estimated_age_bracket: choiceQuestion(
      "Estimate the caller's age bracket, from what they explicitly disclose or from clear (life stage, references, etc.) or indirect (tone, vocabulary, expressiveness, etc.) contextual signal in their messages.",
      {
        under_18: 'Clear signal the caller is under 18.',
        '18_24': 'Clear signal the caller is 18 to 24.',
        '25_34': 'Clear signal the caller is 25 to 34.',
        '35_44': 'Clear signal the caller is 35 to 44.',
        '45_54': 'Clear signal the caller is 45 to 54.',
        '55_64': 'Clear signal the caller is 55 to 64.',
        '65_plus': 'Clear signal the caller is 65 or older.',
        unknown: 'Not enough information to make any reasonable estimate.',
      },
    ),
    education_level: choiceQuestion(
      "Estimate the caller's level of education, from what they explicitly disclose or from the vocabulary and complexity of their language.",
      {
        less_than_high_school:
          'Clear signal of less than a high-school-level education.',
        high_school: 'Clear signal of a high-school-level education.',
        some_college: 'Clear signal of some college but no degree.',
        bachelors: "Clear signal of a bachelor's-level education.",
        graduate: 'Clear signal of a graduate-level education.',
        unknown: 'Not enough information to make any reasonable estimate.',
      },
    ),
    political_alignment: choiceQuestion(
      "Estimate the caller's political alignment, only from clear, explicit signal in what they say -- never from unrelated demographic assumptions.",
      {
        extreme_left: 'Clear signal of a far-left political alignment.',
        left: 'Clear signal of a left-leaning political alignment.',
        centrist: 'Clear signal of a centrist political alignment.',
        right: 'Clear signal of a right-leaning political alignment.',
        extreme_right: 'Clear signal of a far-right political alignment.',
        unknown:
          'Not enough information to make any reasonable estimate -- this should be the default for almost every caller, since political alignment rarely comes up in this kind of conversation.',
      },
    ),
  };
}

async function submitCallerProfileDecisions(
  history: HistoryEntry[],
  questions: Record<string, ScoreQuestion | ChoiceQuestion>,
  apiKey: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  const model = Deno.env.get('JEV_MODEL') || DEFAULT_JEV_MODEL;

  const state = {
    conversation: history
      .filter((entry) => entry.role === 'user' || entry.role === 'assistant')
      .map((entry) => ({ role: entry.role, content: entry.content })),
  };

  const response = await fetch(JEV_DECISIONS_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      'x-title': 'Coach Bot',
    },
    body: JSON.stringify({
      model,
      state,
      questions,
      // Same confidentiality constraint as callOpenRouter in chat/index.ts
      // -- this content is a confidential onboarding conversation either
      // way.
      provider: { data_collection: 'deny', zdr: true },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `OpenRouter Decisions API error (${response.status}): ${errorBody}`,
    );
  }

  const payload = await response.json();
  const answers = payload?.answers;
  if (!answers) {
    throw new Error('OpenRouter Decisions API returned no answers');
  }
  return answers;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// A `score` answer's `score` field is a fractional index into that
// question's `criteria` array (e.g. 1.99 out of a 5-item, 0-4 scale), not
// already normalized -- this maps it to 0-1 using that same question's own
// scale length, so a stored value means the same thing regardless of how
// many levels a given question's criteria array happens to have.
function normalizedScore(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  answers: Record<string, any>,
  key: string,
  levels: number,
): number | null {
  const answer = answers?.[key];
  if (!answer || typeof answer.score !== 'number' || levels <= 1) {
    return null;
  }
  return clamp(answer.score / (levels - 1), 0, 1);
}

// The three sub-scores, averaged -- skipping any that came back missing
// rather than treating a missing sub-score as 0, and returning null (same
// as any other trait with no signal) only if *none* of the three answered.
function computeNeuroticism(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  answers: Record<string, any>,
  questions: Record<string, ScoreQuestion | ChoiceQuestion>,
): number | null {
  const subScores = NEUROTICISM_SUB_QUESTION_KEYS.map((key) =>
    normalizedScore(
      answers,
      key,
      (questions[key] as ScoreQuestion).criteria.length,
    ),
  ).filter((value): value is number => typeof value === 'number');

  if (subScores.length === 0) {
    return null;
  }
  return subScores.reduce((sum, value) => sum + value, 0) / subScores.length;
}

function choiceValue(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  answers: Record<string, any>,
  key: string,
): { value: string; confidence: number | null } {
  const answer = answers?.[key];
  if (!answer || typeof answer.choice !== 'string') {
    return { value: 'unknown', confidence: null };
  }
  return {
    value: answer.choice,
    confidence:
      typeof answer.confidence === 'number' ? answer.confidence : null,
  };
}

// Computes and writes one user's caller profile from their conversation
// history. Two call shapes:
//   - Self (the normal `chat` path): `targetUserId` omitted, `supabase` is
//     the caller's own JWT-scoped client, `replyText` is the reply just
//     generated (appended to `history`, which was fetched before it
//     existed). Writes via `upsert_caller_profile` with no explicit
//     target, so it resolves to the caller's own `auth.uid()`.
//   - Admin recompute (`recompute-caller-profiles`): `targetUserId` set,
//     `supabase` is the *admin's* JWT-scoped client, `history` is already
//     that target user's full history (no `replyText` to append -- this
//     isn't riding along with a new message). Writes via the same RPC but
//     with an explicit `p_user_id`, which that RPC only allows for an
//     admin caller -- see `add_admin_caller_profile_recompute.sql`.
// Returns whether the write actually succeeded -- `chat` ignores this
// (its own use is fire-and-forget, same as before this returned anything),
// but `recompute-caller-profiles` uses it to report which users in a batch
// succeeded vs failed, since this function -- deliberately, for the
// self/chat path -- never throws; every failure is caught and logged
// internally rather than surfaced to the caller.
export async function analyzeCallerProfile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  history: HistoryEntry[],
  openRouterApiKey: string,
  options: { replyText?: string; targetUserId?: string } = {},
): Promise<boolean> {
  const { replyText, targetUserId } = options;

  const callerMessageCount = history.filter(
    (entry) => entry.role === 'user',
  ).length;
  if (callerMessageCount === 0) {
    // Nothing from the caller yet to analyze.
    return false;
  }

  // Best-effort and independently AI-quota-checked, same reasoning as the
  // summary regeneration in chat/index.ts: this rides along with (or, for
  // a recompute, stands in for) other AI usage, and skipping it for a
  // quota-exhausted caller shouldn't fail anything that already succeeded.
  const aiUsage = await checkAiUsage(supabase, AI_DAILY_LIMIT);
  if (!aiUsage.allowed) {
    console.warn('Skipping caller-profile analysis: daily AI quota exhausted.');
    return false;
  }

  try {
    const fullHistory = replyText
      ? [...history, { role: 'assistant', content: replyText }]
      : history;
    const questions = buildCallerProfileQuestions();
    const answers = await submitCallerProfileDecisions(
      fullHistory,
      questions,
      openRouterApiKey,
    );

    const gender = choiceValue(answers, 'estimated_gender');
    const age = choiceValue(answers, 'estimated_age_bracket');
    const education = choiceValue(answers, 'education_level');
    const political = choiceValue(answers, 'political_alignment');

    const { error } = await supabase.rpc('upsert_caller_profile', {
      p_mood: normalizedScore(
        answers,
        'mood',
        (questions.mood as ScoreQuestion).criteria.length,
      ),
      p_neuroticism: computeNeuroticism(answers, questions),
      p_entitlement: normalizedScore(
        answers,
        'entitlement',
        (questions.entitlement as ScoreQuestion).criteria.length,
      ),
      p_self_reflection: normalizedScore(
        answers,
        'self_reflection',
        (questions.self_reflection as ScoreQuestion).criteria.length,
      ),
      p_willingness_to_change: normalizedScore(
        answers,
        'willingness_to_change',
        (questions.willingness_to_change as ScoreQuestion).criteria.length,
      ),
      p_descriptiveness: normalizedScore(
        answers,
        'descriptiveness',
        (questions.descriptiveness as ScoreQuestion).criteria.length,
      ),
      p_defensiveness: normalizedScore(
        answers,
        'defensiveness',
        (questions.defensiveness as ScoreQuestion).criteria.length,
      ),
      p_satisfaction: normalizedScore(
        answers,
        'satisfaction',
        (questions.satisfaction as ScoreQuestion).criteria.length,
      ),
      p_estimated_gender: gender.value,
      p_estimated_gender_confidence: gender.confidence,
      p_estimated_age_bracket: age.value,
      p_estimated_age_confidence: age.confidence,
      p_education_level: education.value,
      p_education_level_confidence: education.confidence,
      p_political_alignment: political.value,
      p_political_alignment_confidence: political.confidence,
      p_messages_analyzed: callerMessageCount,
      ...(targetUserId ? { p_user_id: targetUserId } : {}),
    });

    if (error) {
      throw new Error(error.message);
    }
    return true;
  } catch (error) {
    console.error('Failed to (re)generate caller profile', error);
    return false;
  }
}
