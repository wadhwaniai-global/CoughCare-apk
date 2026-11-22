/**
 * Who may take part. The study enrols adults only: a participant must be
 * MIN_AGE or older at screening. One definition, read by the age field (the
 * warning), the screen (which locks the rest of the form, recording included)
 * and the form validation.
 */
export const MIN_AGE = 18;

export const UNDERAGE_MESSAGE =
    `This participant is under ${MIN_AGE} and is not eligible for the study. Do not continue with the recording.`;

/** The age in whole years, from the age field ('' while empty) or a stored record; null when there is no usable number. */
export const ageInYears = (age: string | number | null | undefined): number | null => {
    if (age === null || age === undefined) return null;
    const text = String(age).trim();
    if (!/^\d+$/.test(text)) return null;
    const years = parseInt(text, 10);
    // 0 is how an unanswered age is stored on a draft, never a real answer: the field refuses it.
    return years > 0 ? years : null;
};

/** True only for a real age below the minimum. An empty or unreadable age is "not answered", not "underage". */
export const isUnderage = (age: string | number | null | undefined): boolean => {
    const years = ageInYears(age);
    return years !== null && years < MIN_AGE;
};
