/**
 * Wording for records on this phone that belong to another login.
 *
 * Records are scoped to the login that saved them, so a phone logged in as
 * someone else shows none of them. Rather than letting them look lost, the
 * Dashboard names them and the Login screen asks before a login that would
 * hide them. One place for the words, so both screens say the same thing.
 */

export type HiddenRecords = { username: string; count: number }[];

const total = (hidden: HiddenRecords): number => hidden.reduce((n, h) => n + h.count, 0);

const records = (n: number): string => (n === 1 ? '1 unsynced record' : `${n} unsynced records`);

const byLogins = (hidden: HiddenRecords): string => hidden.map((h) => `${h.username} (${h.count})`).join(', ');

/** Dashboard notice: "3 unsynced records on this phone were saved by victoria.mensah. Log in as victoria.mensah to see and sync them." */
export const hiddenRecordsNotice = (hidden: HiddenRecords): string => {
    const n = total(hidden);
    if (hidden.length === 1) {
        const who = hidden[0].username;
        return `${records(n)} on this phone ${n === 1 ? 'was' : 'were'} saved by ${who}. Log in as ${who} to see and sync ${n === 1 ? 'it' : 'them'}.`;
    }
    return `${records(n)} on this phone were saved by other logins: ${byLogins(hidden)}. Log in as each of them to sync.`;
};

/** Login question: what logging in as `loginAs` would hide, ending in the question itself. */
export const hiddenRecordsQuestion = (hidden: HiddenRecords, loginAs: string): string => {
    const n = total(hidden);
    const held = hidden.length === 1
        ? `This phone holds ${records(n)} saved by ${hidden[0].username} and none saved by ${loginAs}. ${n === 1 ? 'It stays' : 'They stay'} hidden until ${hidden[0].username} logs in.`
        : `This phone holds ${records(n)} saved by other logins: ${byLogins(hidden)}, and none saved by ${loginAs}. They stay hidden until those logins are used.`;
    return `${held}\n\nLog in as ${loginAs} anyway?`;
};
