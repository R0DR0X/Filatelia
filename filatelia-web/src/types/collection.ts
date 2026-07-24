export type ListType = 'collection' | 'wishlist' | 'trade';
export type ConditionGrade = 'MNH' | 'MH' | 'Used' | 'FDC';

export interface UserCollectionItem {
  id: number;
  userId: string;
  stampId: string;
  listType: ListType;
  condition: ConditionGrade;
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
