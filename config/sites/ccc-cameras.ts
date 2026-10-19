import type { CameraHint } from "../../lib/core/site.ts";

/**
 * Best guesses for where CCC's Blue Iris cameras are, from their names. Used by
 * Edit map → "Place suggested cameras": each camera not on the map yet goes into
 * the first of its rooms that exists — a room id from CCC's map, or a room name
 * (so naming a room on the map, e.g. "Sanctuary", lets its cameras be placed).
 *
 * sure = the name says the room; otherwise it's an educated guess.
 * Cameras not listed (unknown locations, e.g. AZ/DZ, security rooms) stay in the
 * "not on the map yet" list for placing by hand.
 */
const sure = (...rooms: string[]): CameraHint => ({ rooms, sure: true });
const guess = (...rooms: string[]): CameraHint => ({ rooms, sure: false });

export const cccCameraHints: Record<string, CameraHint> = {
  // ---- Education Building, level 1 ----
  CCAOffice: sure("ebl1-cca-office", "CCA Office"),
  EB1_Acct_Halls: sure("ebl1-accounting-hallway", "Accounting Hallway"),
  EB1_FacilitiesOf: sure("ebl1-facilities", "Facilities"),
  EB1FacilOffice: sure("ebl1-facilities", "Facilities"),
  EB1_Count_Closet: guess("Count Room", "ebl1-accounting", "Accounting"),
  EB1_Count_Table: guess("Count Room", "ebl1-accounting", "Accounting"),
  EB1_Count_End: guess("Count Room", "ebl1-accounting", "Accounting"),
  EB1_Count_Wall: guess("Count Room", "ebl1-accounting", "Accounting"),
  EB1_Academy_Door: guess("ebl1-hallway", "Hallway"),
  EB1PlayDoors: guess("Playground", "o-playground", "ebl1-hallway"),
  EB1Playground_62: sure("Playground", "o-playground"),
  Playscape: guess("Playscape", "Playground", "o-playground"),
  WCCCAOfficeDrive: guess("o-drive"),

  // ---- Education Building, level 2 ----
  E203: sure("e2-203", "E203"),
  EB2_HSHall: guess("e2-south-hall", "e2-bridge"),
  EB2_Kitchen_Hall: guess("e2-west-hall", "e2-kitchen"),
  EB2_Upper_SW: guess("e2-west-hall"),
  EB2_Restrooms: sure("e2-restrooms"),

  // ---- Y Building ----
  "YC-Gym": sure("y-gym"),
  YC_Gym: sure("y-gym"),
  YCGymC: sure("y-gym"),
  YC_Gym_East: sure("y-gym"),
  YC_Gym_West: sure("y-gym"),
  YCGymNWCorner: sure("y-gym"),
  YC_Gym_Backstage: guess("y-gym"),
  YCGymSoundBooth: guess("y-gym"),
  YC_Gym_Lobby: guess("y-lobby"),
  YC_Lobby: sure("y-lobby"),
  YCLTV: sure("y-lobby"),
  YC_Entry: guess("y-lobby"),
  YC_Entryway: guess("y-lobby"),
  YC_Break_Room: guess("y-offices"),
  YCCubicles2: guess("y-offices"),
  YC_Reception: guess("y-offices"),
  YCOutsideEast: guess("o-north-parking"),
  YC_NLOutside: guess("o-north-parking"),

  // ---- Worship Center, level 1 ----
  WCNorthLobby: sure("wcl1-north-lobby", "North Lobby"),
  WC_North_East: sure("wcl1-north-lobby", "North Lobby"),
  WC_North_Merch: sure("wcl1-north-lobby", "North Lobby"),
  WC1_NL_Center: sure("wcl1-north-lobby", "North Lobby"),
  WC1_NL_NE: sure("wcl1-north-lobby", "North Lobby"),
  WC1_NL_NW: sure("wcl1-north-lobby", "North Lobby"),
  WC1_Merch_Hall: sure("wcl1-north-lobby", "North Lobby"),
  WC1_NL_Lockbox: guess("wcl1-north-lobby", "North Lobby"),
  WC1_NL_NewMemHal: guess("wcl1-northwest-hallway", "wcl1-north-lobby"),
  "WC-Cafe": sure("wcl1-cafe", "Cafe"),
  WC1_Cafe: sure("wcl1-cafe", "Cafe"),
  WCCafe_Registers: sure("wcl1-cafe", "Cafe"),
  WC1_Cafe_Safe: guess("wcl1-cafe", "Cafe"),
  "WC-Cafe-Kitchen": sure("wcl1-cafe-kitchen", "Cafe Kitchen"),
  "WC-Cafe-Back-Kit": sure("wcl1-cafe-kitchen", "Cafe Kitchen"),
  WCCafe_Freezers: guess("wcl1-cafe-kitchen", "Cafe Kitchen"),
  WCCafe_Rack: guess("wcl1-cafe-kitchen", "Cafe Kitchen"),
  "WC-Cafe-Overflow": sure("wcl1-cafe-overflow", "Cafe Overflow"),
  WC1_CafeOverflow: sure("wcl1-cafe-overflow", "Cafe Overflow"),
  CafeHall151: guess("Cafe Hallway", "wcl1-cafe"),
  "WC-Cafe-Hallway": guess("Cafe Hallway", "wcl1-cafe"),
  WCCafEHall2: guess("Cafe Hallway", "wcl1-cafe"),
  WCCafeHallway: guess("Cafe Hallway", "wcl1-cafe"),
  WC1_Cafe_Hall: guess("Cafe Hallway", "wcl1-cafe"),
  CafeEntHall176: guess("Cafe Hallway", "wcl1-cafe"),
  WC1_West_Lobby: sure("wcl1-west-lobby", "West Lobby"),
  WC1_WestLobby: sure("wcl1-west-lobby", "West Lobby"),
  WCWestLToCafe: sure("wcl1-west-lobby", "West Lobby"),
  WC1WestClean: guess("wcl1-west-lobby", "West Lobby"),
  WC1_WestLobby_NW_Out: guess("o-drive"),
  WC1WestLobbyOut: guess("o-drive"),
  WC1_East_Lobby: sure("wcl1-east-lobby", "East Lobby"),
  WC1_SL_CENTER: sure("wcl1-south-lobby", "South Lobby"),
  WC1_SL_Ceiling: sure("wcl1-south-lobby", "South Lobby"),
  SLTVs: sure("wcl1-south-lobby", "South Lobby"),
  WC1_South_Entry: guess("o-south-entrance", "wcl1-south-lobby"),
  PreEntry: guess("o-south-entrance", "wcl1-south-lobby"),
  WC1SouthDrive: guess("o-south-entrance"),
  WC_Chapel: sure("wcl1-chapel", "Chapel"),
  WC1_Chapel: sure("wcl1-chapel", "Chapel"),
  WCChapelEntrance: guess("wcl1-chapel", "Chapel"),
  WC1_Chapel_Hall: guess("Chapel Hallway", "wcl1-chapel", "Chapel"),
  WC1_Tunnel: sure("wcl1-tunnel", "Tunnel"),
  "S155-156_Hub": guess("S155", "wcl1-volunteer-hub", "Volunteer Hub"),
  S155Hub: guess("S155", "wcl1-volunteer-hub", "Volunteer Hub"),
  S156_Hub: guess("S156", "wcl1-volunteer-hub", "Volunteer Hub"),
  S157_Hub: guess("S157", "wcl1-volunteer-hub", "Volunteer Hub"),
  S158_Hub: guess("S158", "wcl1-volunteer-hub", "Volunteer Hub"),
  // The sanctuary and stage aren't named on the map yet: name those rooms "Sanctuary" and "Stage".
  Sanctuary: sure("Sanctuary", "Sanctuary (Main Floor)", "s-sanctuary"),
  WC_Sanct_PTZ_163: sure("Sanctuary", "Sanctuary (Main Floor)", "s-sanctuary"),
  WC_Sanct_PTZ_167: sure("Sanctuary", "Sanctuary (Main Floor)", "s-sanctuary"),
  WC2_SanctCeiling: sure("Sanctuary", "Sanctuary (Main Floor)", "s-sanctuary"),
  Rear_Stage_L1: sure("Stage", "Stage / Platform", "s-stage"),
  Rear_Stage_L2: sure("Stage", "Stage / Platform", "s-stage"),
  Rear_Stage_L3: sure("Stage", "Stage / Platform", "s-stage"),
  GR111: guess("Green Room", "Stage", "s-stage"),
  GR166: guess("Green Room", "Stage", "s-stage"),
  WCGreenRoom: guess("Green Room", "Stage", "s-stage"),
  ProdRm: guess("Production Room"),
  SecurityRoom146: guess("Security Room"),
  SecurityRoom147: guess("Security Room"),
  // S-numbered classrooms: the camera is named after its room.
  ...Object.fromEntries(
    ["S129", "S132", "S135", "S137", "S139", "S141", "S143", "S145", "S147", "S173", "S175", "S177", "S179", "S181", "S183"].map((s) => [s, sure(`wcl1-${s.toLowerCase()}`, s)]),
  ),

  // ---- Sanctuary / Worship Center, level 2 ----
  WC2_S238_Hall_34: guess("S238 Hall", "sl2-s238-s239", "S238/S239"),
  WC2_S232: sure("S232"),
  WC2_S232_Hall_37: guess("S232 Hall", "S232"),
  WC2_Up_East_Lob: sure("Upper East Lobby"),
  SC2_UP_Ea_Lb: sure("Upper East Lobby"),
  WC2UpperSLobby: sure("Upper South Lobby"),
  WC2_Upper_West_H: sure("Upper West Hall", "Upper West Lobby"),
  WC2_Upper_West_L: sure("Upper West Lobby"),
  WC2_UprWestLobby: sure("Upper West Lobby"),
  WC2_West_LobbyE: guess("Upper West Lobby"),
  WC2_Mezzanine_13: guess("Mezzanine", "Balcony"),
  WC2_Filming_Room: sure("Filming Room"),
  WC2SecurityRoom: sure("Security Room"),
  WC1_Upper_Count: sure("Upper Count Room", "Count Room"),
};
