// Single source of truth for the UserCollection enums (migration
// db/migrations/0009_add_quantity_and_ignore_list_type.sql). Both the DB
// layer (src/lib/db/collection.ts) and the API route
// (src/app/api/collection/route.ts) import VALID_LIST_TYPES /
// VALID_CONDITIONS from here instead of keeping their own copies — three
// independently-edited copies of the same enum is how drift happens.
export const VALID_LIST_TYPES = ['collection', 'wishlist', 'trade', 'ignore'] as const;
export const VALID_CONDITIONS = ['MNH', 'MH', 'Used', 'FDC'] as const;

export type ListType = (typeof VALID_LIST_TYPES)[number];
export type ConditionGrade = (typeof VALID_CONDITIONS)[number];

export function isValidListType(value: unknown): value is ListType {
  return typeof value === 'string' && (VALID_LIST_TYPES as readonly string[]).includes(value);
}

export function isValidCondition(value: unknown): value is ConditionGrade {
  return typeof value === 'string' && (VALID_CONDITIONS as readonly string[]).includes(value);
}

export interface UserCollectionItem {
  id: number;
  userId: string;
  stampId: string;
  listType: ListType;
  condition: ConditionGrade;
  quantity: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  stampTitle?: string;
  stampImage?: string;
  stampCatalogNumber?: string;
}

export interface CollectionRequestPayload {
  stampId: string;
  listType: ListType;
  condition?: ConditionGrade;
  quantity?: number;
  notes?: string;
}

export interface MatchProposal {
  partnerUserId: string;
  partnerName: string;
  partnerEmail: string;
  matchScore: number;
  itemsYouGet: string[];
  itemsYouGive: string[];
}
