import Model, { attr } from '@warp-drive/legacy/model';

// How confident an estimated/disclosed demographic signal needs to be
// before the admin UI shows it as anything other than "Unknown" -- a
// low-confidence guess about someone in a confidential support
// conversation shouldn't be presented to the listener as if it were fact.
const CONFIDENCE_THRESHOLD = 0.5;

const SCORE_LABELS = ['Low', 'Low-mid', 'Mid', 'Mid-high', 'High'];

const GENDER_LABELS = {
  male: 'Male',
  female: 'Female',
  nonbinary_or_other: 'Nonbinary / other',
};

const AGE_BRACKET_LABELS = {
  under_18: 'Under 18',
  '18_24': '18–24',
  '25_34': '25–34',
  '35_44': '35–44',
  '45_54': '45–54',
  '55_64': '55–64',
  '65_plus': '65+',
};

const EDUCATION_LABELS = {
  less_than_high_school: 'Less than high school',
  high_school: 'High school',
  some_college: 'Some college',
  bachelors: "Bachelor's degree",
  graduate: 'Graduate degree',
};

const POLITICAL_ALIGNMENT_LABELS = {
  extreme_left: 'Far left',
  left: 'Left-leaning',
  centrist: 'Centrist',
  right: 'Right-leaning',
  extreme_right: 'Far right',
};

// Mirrors the `caller_profiles` table -- one row per user, keyed by that
// user's own id (see `user.js`'s `callerProfile` relationship, which links
// the two by sharing an id rather than a separate foreign key). AI-inferred
// traits meant to help the human listener approach the follow-up call
// informed -- see `analyzeCallerProfile` in the chat edge function for how
// these are computed, and the `add_caller_profiles` migration for what each
// raw field means. Only ever populated by `admin.js`.
export default class CallerProfileModel extends Model {
  // Continuous traits, 0 (low end) to 1 (high end) -- see the edge
  // function's `buildCallerProfileQuestions` for what each end represents.
  // Read via the `*Label` getters below rather than the raw number in the
  // UI.
  @attr('number') mood;
  @attr('number') neuroticism;
  @attr('number') entitlement;
  @attr('number') selfReflection;
  @attr('number') willingnessToChange;
  @attr('number') descriptiveness;
  @attr('number') defensiveness;
  @attr('number') satisfaction;

  // Estimated/disclosed demographic signals, each paired with a 0-1
  // confidence that may be null -- read via the `*Display` getters below,
  // which fall back to "Unknown" under `CONFIDENCE_THRESHOLD` rather than
  // showing a low-confidence guess as if it were established fact.
  @attr('string') estimatedGender;
  @attr('number') estimatedGenderConfidence;
  @attr('string') estimatedAgeBracket;
  @attr('number') estimatedAgeConfidence;
  @attr('string') educationLevel;
  @attr('number') educationLevelConfidence;
  @attr('string') politicalAlignment;
  @attr('number') politicalAlignmentConfidence;

  @attr('number') messagesAnalyzed;
  @attr('string') lastAnalyzedAt;

  get moodLabel() {
    return scoreLabel(this.mood);
  }
  get neuroticismLabel() {
    return scoreLabel(this.neuroticism);
  }
  get entitlementLabel() {
    return scoreLabel(this.entitlement);
  }
  get selfReflectionLabel() {
    return scoreLabel(this.selfReflection);
  }
  get willingnessToChangeLabel() {
    return scoreLabel(this.willingnessToChange);
  }
  get descriptivenessLabel() {
    return scoreLabel(this.descriptiveness);
  }
  get defensivenessLabel() {
    return scoreLabel(this.defensiveness);
  }
  get satisfactionLabel() {
    return scoreLabel(this.satisfaction);
  }

  get messagesAnalyzedLabel() {
    const count = this.messagesAnalyzed ?? 0;
    return `${count} message${count === 1 ? '' : 's'}`;
  }

  // The eight continuous traits as one array, each with a `barWidthClass`
  // (a literal Tailwind width class for a low-to-high bar's fill -- a
  // computed inline `style="width: ..."` is against this app's template
  // lint rules, and a runtime-built arbitrary-value class like `w-[37%]`
  // wouldn't be in the compiled CSS either, since Tailwind only generates
  // classes it finds written out literally somewhere -- see
  // `barWidthClass` below for the literal set) alongside its existing
  // `*Label` -- used by the `/users/:user_id` profile page to render a
  // little bar graph per trait without repeating the same shape eight
  // times in the template. `chat.gjs`'s plain `<dt>/<dd>` listing reads the
  // individual `*Label` getters directly instead, since it has no graph to
  // draw.
  get scoreBars() {
    return [
      { label: 'Mood', value: this.mood, valueLabel: this.moodLabel },
      {
        label: 'Neuroticism',
        value: this.neuroticism,
        valueLabel: this.neuroticismLabel,
      },
      {
        label: 'Entitlement',
        value: this.entitlement,
        valueLabel: this.entitlementLabel,
      },
      {
        label: 'Self-reflection',
        value: this.selfReflection,
        valueLabel: this.selfReflectionLabel,
      },
      {
        label: 'Willingness to change',
        value: this.willingnessToChange,
        valueLabel: this.willingnessToChangeLabel,
      },
      {
        label: 'Descriptiveness',
        value: this.descriptiveness,
        valueLabel: this.descriptivenessLabel,
      },
      {
        label: 'Defensiveness',
        value: this.defensiveness,
        valueLabel: this.defensivenessLabel,
      },
      {
        label: 'Satisfaction',
        value: this.satisfaction,
        valueLabel: this.satisfactionLabel,
      },
    ].map((trait) => ({
      ...trait,
      barWidthClass: barWidthClass(trait.value),
    }));
  }

  // The four estimated/disclosed demographic fields as one array, each
  // already resolved through its `*Display` getter (so "Unknown" below
  // `CONFIDENCE_THRESHOLD` is already applied) -- same reasoning as
  // `scoreBars` above, just for the fields that don't get a graph.
  get estimatedFields() {
    return [
      { label: 'Estimated gender', value: this.estimatedGenderDisplay },
      { label: 'Estimated age', value: this.estimatedAgeBracketDisplay },
      { label: 'Education level', value: this.educationLevelDisplay },
      {
        label: 'Political alignment',
        value: this.politicalAlignmentDisplay,
      },
    ];
  }

  get estimatedGenderDisplay() {
    return displayChoice(
      this.estimatedGender,
      this.estimatedGenderConfidence,
      GENDER_LABELS,
    );
  }
  get estimatedAgeBracketDisplay() {
    return displayChoice(
      this.estimatedAgeBracket,
      this.estimatedAgeConfidence,
      AGE_BRACKET_LABELS,
    );
  }
  get educationLevelDisplay() {
    return displayChoice(
      this.educationLevel,
      this.educationLevelConfidence,
      EDUCATION_LABELS,
    );
  }
  get politicalAlignmentDisplay() {
    return displayChoice(
      this.politicalAlignment,
      this.politicalAlignmentConfidence,
      POLITICAL_ALIGNMENT_LABELS,
    );
  }
}

function scoreLabel(value) {
  if (typeof value !== 'number') {
    return 'Unknown';
  }
  const index = Math.min(
    SCORE_LABELS.length - 1,
    Math.max(0, Math.round(value * (SCORE_LABELS.length - 1))),
  );
  return SCORE_LABELS[index];
}

// Every literal class name Tailwind needs to actually generate the CSS for
// -- listed out here so its content scanner finds them (see the comment on
// `scoreBars`). Bucketed the same way as `SCORE_LABELS`, so a bar's fill
// width always lines up with its own text label.
const BAR_WIDTH_CLASSES = ['w-0', 'w-1/4', 'w-1/2', 'w-3/4', 'w-full'];

// A missing value (no analysis yet) renders as an empty bar rather than a
// misleading "0% full = very low" reading; the accompanying `valueLabel`
// ("Unknown") is what actually communicates that distinction.
function barWidthClass(value) {
  if (typeof value !== 'number') {
    return BAR_WIDTH_CLASSES[0];
  }
  const index = Math.min(
    BAR_WIDTH_CLASSES.length - 1,
    Math.max(0, Math.round(value * (BAR_WIDTH_CLASSES.length - 1))),
  );
  return BAR_WIDTH_CLASSES[index];
}

function displayChoice(value, confidence, labels) {
  if (!value || value === 'unknown') {
    return 'Unknown';
  }
  if (typeof confidence === 'number' && confidence < CONFIDENCE_THRESHOLD) {
    return 'Unknown';
  }
  return labels[value] ?? value;
}
