/**
 * Shared date helpers.
 *
 * The app stores and displays dates as DD/MM/YYYY everywhere. Earlier builds
 * defaulted the screening date with `new Date().toLocaleDateString()`, which is
 * device-locale dependent and produced M/D/YYYY on US-locale phones. Records
 * saved by those builds are still in the database, so parseDateInput has to
 * cope with both forms.
 */

/** Format a Date as DD/MM/YYYY, independent of device locale. */
export const formatDateDDMMYYYY = (date: Date): string => {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
};

/** Today as DD/MM/YYYY. */
export const todayDDMMYYYY = (): string => formatDateDDMMYYYY(new Date());

/**
 * Normalise a date string to DD/MM/YYYY, or null if it isn't a valid date.
 *
 * Accepts DD/MM/YYYY (what the app writes) and M/D/YYYY (what older builds
 * wrote on US-locale devices). Disambiguation:
 *   - first > 12  -> can only be a day, so DD/MM
 *   - second > 12 -> can only be a day, so M/D (swap)
 *   - both <= 12  -> genuinely ambiguous. Every in-app producer zero-pads, so
 *     unpadded input ("8/11/2026") is treated as the locale M/D form. This is
 *     a heuristic; a hand-typed unpadded DD/MM date would be read as M/D.
 */
export const parseDateInput = (dateString: string): string | null => {
    if (!dateString || dateString.trim() === '') return null;

    try {
        const parts = dateString.trim().split('/');
        if (parts.length !== 3) return null;

        const first = parseInt(parts[0], 10);
        const second = parseInt(parts[1], 10);
        const year = parseInt(parts[2], 10);

        if (isNaN(first) || isNaN(second) || isNaN(year)) return null;

        let day: number;
        let month: number;

        if (first > 12 && second <= 12) {
            day = first;
            month = second;
        } else if (second > 12 && first <= 12) {
            day = second;
            month = first;
        } else {
            // Ambiguous: both <= 12 (or both invalid). Unpadded means it came
            // from toLocaleDateString() on a US-locale device, so it is M/D.
            const isUnpadded = parts[0].length === 1 || parts[1].length === 1;
            day = isUnpadded ? second : first;
            month = isUnpadded ? first : second;
        }

        if (day < 1 || day > 31) return null;
        if (month < 1 || month > 12) return null;
        if (year < 1900 || year > 2100) return null;

        const daysInMonth = new Date(year, month, 0).getDate();
        if (day > daysInMonth) return null;

        return `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${year}`;
    } catch {
        return null;
    }
};
