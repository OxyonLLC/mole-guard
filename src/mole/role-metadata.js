export const ApplicationRoleConnectionMetadataType = {
  INTEGER_LESS_THAN_OR_EQUAL: 1,
  INTEGER_GREATER_THAN_OR_EQUAL: 2,
  INTEGER_EQUAL: 3,
  INTEGER_NOT_EQUAL: 4,
  DATETIME_LESS_THAN_OR_EQUAL: 5,
  DATETIME_GREATER_THAN_OR_EQUAL: 6,
  BOOLEAN_EQUAL: 7,
  BOOLEAN_NOT_EQUAL: 8,
};

const COMMON_ROLE_METADATA = [
  {
    key: 'verified_wallet',
    name: 'Verified Wallet',
    description: 'User completed the WinLEW wallet verification flow.',
    type: ApplicationRoleConnectionMetadataType.BOOLEAN_EQUAL,
  },
  {
    key: 'token_holder',
    name: 'WinLEW Holder',
    description: 'User holds a positive WinLEW balance.',
    type: ApplicationRoleConnectionMetadataType.BOOLEAN_EQUAL,
  },
  {
    key: 'lewcrew_1m',
    name: 'LewCrew 1M',
    description: 'User holds at least 1,000,000 WinLEW.',
    type: ApplicationRoleConnectionMetadataType.BOOLEAN_EQUAL,
  },
  {
    key: 'lewcrew_10m',
    name: 'LewCrew 10M',
    description: 'User holds at least 10,000,000 WinLEW.',
    type: ApplicationRoleConnectionMetadataType.BOOLEAN_EQUAL,
  },
  {
    key: 'winlew_balance',
    name: 'WinLEW Balance',
    description: 'Whole-number WinLEW balance for integer threshold roles.',
    type: ApplicationRoleConnectionMetadataType.INTEGER_GREATER_THAN_OR_EQUAL,
  },
];

export function getRoleMetadataRecords(_appKey = 'mole') {
  return COMMON_ROLE_METADATA.map((x) => ({ ...x }));
}
