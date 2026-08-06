"use client";

/**
 * Loads the caller's collection ONCE for a page that renders many stamps, and
 * shares it with every card on that page.
 *
 * The catalogue draws up to 16 stamps per emission group across many groups.
 * `/api/collection` has no per-stamp filter, so a card that fetched for itself
 * would issue dozens of identical full-list requests per screen. This fetches
 * once and hands each card its own row out of the result.
 *
 * A page with no provider is a supported case, not a crash: `useCollectionIndex`
 * returns a permanently `anonymous` context so a card rendered outside one
 * degrades to the logged-out prompt instead of throwing.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getMe } from "@/lib/auth";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { Identity, identityFromMeResult } from "@/lib/identityState";
import { UserCollectionItem } from "@/types/collection";
import {
  CollectionIndex,
  buildCollectionIndex,
  itemForStamp,
  withItem,
  withoutStamp,
} from "@/lib/collectionIndex";

interface CollectionIndexValue {
  identity: Identity;
  /** True while either the identity probe or the collection read is in flight. */
  loading: boolean;
  /** The read failed; cards must not claim "not in any list" on this. */
  failed: boolean;
  itemFor: (stampId: string) => UserCollectionItem | null;
  /** Record a membership locally after the server confirmed it. */
  recordItem: (item: UserCollectionItem) => void;
  /** Drop a stamp's membership locally after the server confirmed the removal. */
  recordRemoval: (stampId: string) => void;
}

const FALLBACK: CollectionIndexValue = {
  identity: { status: "anonymous" },
  loading: false,
  failed: false,
  itemFor: () => null,
  recordItem: () => {},
  recordRemoval: () => {},
};

const Ctx = createContext<CollectionIndexValue | null>(null);

export function useCollectionIndex(): CollectionIndexValue {
  return useContext(Ctx) ?? FALLBACK;
}

export function CollectionIndexProvider({ children }: { children: React.ReactNode }) {
  const [identity, setIdentity] = useState<Identity>({ status: "unknown" });
  const [index, setIndex] = useState<CollectionIndex>({});
  const [loadingItems, setLoadingItems] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    getMe().then((result) => {
      if (active) setIdentity(identityFromMeResult(result));
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (identity.status !== "authenticated") return;
    let active = true;
    setLoadingItems(true);
    setFailed(false);
    // Bounded, like every other call this widget family makes: an unanswered
    // read would otherwise leave every card on the page disabled forever.
    fetchWithTimeout("/api/collection", { credentials: "same-origin" })
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        if (data.success && Array.isArray(data.items)) {
          setIndex(buildCollectionIndex(data.items));
        } else {
          setFailed(true);
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoadingItems(false);
      });
    return () => {
      active = false;
    };
  }, [identity.status]);

  const itemFor = useCallback(
    (stampId: string) => itemForStamp(index, stampId),
    [index]
  );
  const recordItem = useCallback((item: UserCollectionItem) => {
    setIndex((prev) => withItem(prev, item));
  }, []);
  const recordRemoval = useCallback((stampId: string) => {
    setIndex((prev) => withoutStamp(prev, stampId));
  }, []);

  const value = useMemo<CollectionIndexValue>(
    () => ({
      identity,
      loading: identity.status === "unknown" || loadingItems,
      failed,
      itemFor,
      recordItem,
      recordRemoval,
    }),
    [identity, loadingItems, failed, itemFor, recordItem, recordRemoval]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
