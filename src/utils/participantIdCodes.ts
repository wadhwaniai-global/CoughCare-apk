/**
 * Region and facility code lookups for participant ID generation.
 * Codes derived from "ParticipantID Structure Proposal" document.
 *
 * Format: GHA-{regionCode 2}{facilityCode 3}{collectorCode 3}{YYYYMMDD}{seq 4}
 * Example: GHA-02205017 2026MMDD 0001 (spaces for reading only)
 *   = Greater Accra, International Health Care Center, collector 017.
 * The collector code comes from the backend-assigned profile field; records
 * minted before it existed use the legacy 17-digit form without it.
 *
 * Doc table lists facility codes as 4-digit values (e.g., "0205") which combine
 * region+facility-within-region. We take the LAST 3 digits as the facility code.
 */

const norm = (s: string): string =>
  s.toLowerCase().replace(/\bregion\b/g, '').replace(/\s+/g, ' ').trim();

/** Region name (case-insensitive, "Region" suffix optional) → 2-digit code */
export const REGION_CODES: Record<string, string> = {
  'ashanti': '01',
  'greater accra': '02',
  'northern': '03',
  'western': '04',
};

/** Facility name (case-insensitive, exact match) → 3-digit code */
export const FACILITY_CODES: Record<string, string> = {
  // Ashanti Region
  'kumasi south government hospital': '101',
  'suntreso government hospital': '102',
  'living waters hospital': '103',
  'cedar crest hospital': '104',
  'trinity hospital': '105',
  'family care hospital': '106',
  'aniwaah medical center': '107',
  'bomso clinic': '108',
  // Greater Accra Region
  'greater accra regional hospital': '201',
  'shai osudoku district hospital': '202',
  'ashaiman municipal hospital': '203',
  'amasaman government hospital': '204',
  'international health care center': '205',
  'iran clinic': '206',
  'pentecost hospital': '207',
  'new crystal hospital': '208',
  'darbem hospital': '209',
  'lapaz community hospital': '210',
  'royal st. martins memorial hospital': '211',
  // Northern Region
  'tamale teaching hospital': '301',
  'kings medical center': '302',
  'habana medical center': '303',
  // Western Region
  'effia nkwanta regional hospital': '401',
  'kwesi mintsim government hospital': '402',
  'nagel sda hospital': '403',
  'nana benie memorial hospital': '404',
  'vra hospital': '405',
  'pentecost hospital tarkwa': '406',
  'ami hospital': '407',
  'josvee hospital': '408',
  'takoradi hospital': '409',
};

export const getRegionCode = (regionName: string | undefined | null): string => {
  if (!regionName) return '00';
  const code = REGION_CODES[norm(regionName)];
  if (!code) {
    console.warn('[participantIdCodes] Unknown region:', regionName);
    return '00';
  }
  return code;
};

export const getFacilityCode = (facilityName: string | undefined | null): string => {
  if (!facilityName) return '000';
  const code = FACILITY_CODES[facilityName.toLowerCase().replace(/\s+/g, ' ').trim()];
  if (!code) {
    console.warn('[participantIdCodes] Unknown facility:', facilityName);
    return '000';
  }
  return code;
};
