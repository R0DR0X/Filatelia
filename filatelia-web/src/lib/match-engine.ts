import { UserCollectionItem, MatchProposal } from "@/types/collection";

export interface UserProfileInfo {
  userId: string;
  name: string;
  email: string;
}

/**
 * Calculates 2-way reciprocal trade matches between current user and other collectors.
 * Reciprocal Condition: |M_AB| > 0 AND |M_BA| > 0
 * Score: (|M_AB| + |M_BA|) / (|A_wish| + |B_wish|) * 100%
 */
export function calculateReciprocalMatches(
  currentUserId: string,
  allItems: UserCollectionItem[],
  userProfiles: Record<string, { name: string; email: string }> = {}
): MatchProposal[] {
  // Extract User A's lists
  const userATrade = new Set(
    allItems.filter((i) => i.userId === currentUserId && i.listType === "trade").map((i) => i.stampId)
  );
  const userAWish = new Set(
    allItems.filter((i) => i.userId === currentUserId && i.listType === "wishlist").map((i) => i.stampId)
  );

  if (userATrade.size === 0 || userAWish.size === 0) {
    return [];
  }

  // Group other users' items
  const otherUserIds = Array.from(new Set(allItems.map((i) => i.userId).filter((id) => id !== currentUserId)));
  const proposals: MatchProposal[] = [];

  for (const partnerId of otherUserIds) {
    const partnerTrade = new Set(
      allItems.filter((i) => i.userId === partnerId && i.listType === "trade").map((i) => i.stampId)
    );
    const partnerWish = new Set(
      allItems.filter((i) => i.userId === partnerId && i.listType === "wishlist").map((i) => i.stampId)
    );

    // Set intersections
    const itemsYouGive = Array.from(userATrade).filter((stampId) => partnerWish.has(stampId)); // M_AB
    const itemsYouGet = Array.from(partnerTrade).filter((stampId) => userAWish.has(stampId));   // M_BA

    // Enforce 2-way Reciprocal Match Condition: |M_AB| > 0 AND |M_BA| > 0
    if (itemsYouGive.length > 0 && itemsYouGet.length > 0) {
      const totalWishlistSize = userAWish.size + partnerWish.size;
      const matchScore = totalWishlistSize > 0
        ? Math.round(((itemsYouGive.length + itemsYouGet.length) / totalWishlistSize) * 1000) / 10
        : 0;

      const profile = userProfiles[partnerId] || {
        name: `Coleccionista ${partnerId.replace("usr_", "")}`,
        email: `${partnerId}@filatelia.com`,
      };

      proposals.push({
        partnerUserId: partnerId,
        partnerName: profile.name,
        partnerEmail: profile.email,
        matchScore,
        itemsYouGet,
        itemsYouGive,
      });
    }
  }

  return proposals.sort((a, b) => b.matchScore - a.matchScore);
}
