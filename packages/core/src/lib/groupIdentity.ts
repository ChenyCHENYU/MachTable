/** Canonical grouping identity prefix, independent from its presentation label. */
export const GROUP_ID_PREFIX = "group:";
/** Persistence boundary only: live models may contain longer group identities, as with ordinary row/column IDs. */
export const MAX_PERSISTED_GROUP_ID_LENGTH = 64 * 1024;
