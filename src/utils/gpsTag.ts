/**
 * The GPS fix captured in Section A is stored on the phone inside the address
 * column, as a trailing "[GPS:<lat>,<lng>]" tag (GPS capture was added without
 * a schema migration). The address text itself never leaves the phone; the
 * position does (since seq 120), so the sync payload needs it pulled back out
 * as numbers.
 */
const GPS_TAG = /\[GPS:([-\d.]+),([-\d.]+)\]/;

export interface GpsPosition {
    /** Decimal degrees, WGS 84, as captured (6 decimal places). */
    latitude: number;
    longitude: number;
}

/** The position packed into an address column, or null when there is none or
 *  it does not read as a real coordinate pair. */
export const parseGpsTag = (address: string | null | undefined): GpsPosition | null => {
    const m = (address || '').match(GPS_TAG);
    if (!m) return null;
    const latitude = Number(m[1]);
    const longitude = Number(m[2]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
    return { latitude, longitude };
};
