import { UserCollectionItem, ListType, ConditionGrade, CollectionRequestPayload } from "@/types/collection";

let collectionStore: UserCollectionItem[] = [
  {
    id: 1,
    userId: "usr_collector_1",
    stampId: "PE-1857-01",
    listType: "collection",
    condition: "MNH",
    notes: "Perfecto estado, centrado de catálogo",
    createdAt: "2026-07-01T10:00:00Z",
    updatedAt: "2026-07-01T10:00:00Z",
    stampTitle: "Perú 1857 1d Azul UN DINERO",
    stampCatalogNumber: "Scott #1"
  },
  {
    id: 2,
    userId: "usr_collector_1",
    stampId: "PE-1858-02",
    listType: "trade",
    condition: "MH",
    notes: "Para intercambio por sello de 1860",
    createdAt: "2026-07-05T12:00:00Z",
    updatedAt: "2026-07-05T12:00:00Z",
    stampTitle: "Perú 1858 1d Rojo Frambuesa",
    stampCatalogNumber: "Scott #3"
  },
  {
    id: 3,
    userId: "usr_collector_1",
    stampId: "PE-1860-03",
    listType: "wishlist",
    condition: "MNH",
    notes: "Buscando sello en excelente estado",
    createdAt: "2026-07-10T15:00:00Z",
    updatedAt: "2026-07-10T15:00:00Z",
    stampTitle: "Perú 1860 1d Azul Escudo",
    stampCatalogNumber: "Scott #7"
  },
  {
    id: 4,
    userId: "usr_collector_2",
    stampId: "PE-1860-03",
    listType: "trade",
    condition: "Used",
    notes: "Disponible para canje",
    createdAt: "2026-07-12T09:00:00Z",
    updatedAt: "2026-07-12T09:00:00Z",
    stampTitle: "Perú 1860 1d Azul Escudo",
    stampCatalogNumber: "Scott #7"
  },
  {
    id: 5,
    userId: "usr_collector_2",
    stampId: "PE-1858-02",
    listType: "wishlist",
    condition: "MH",
    notes: "Deseo completar serie 1858",
    createdAt: "2026-07-14T11:00:00Z",
    updatedAt: "2026-07-14T11:00:00Z",
    stampTitle: "Perú 1858 1d Rojo Frambuesa",
    stampCatalogNumber: "Scott #3"
  }
];

let nextId = 10;

export function resetCollectionStore() {
  collectionStore = [];
  nextId = 1;
}

export async function getUserCollection(userId: string, listType?: ListType): Promise<UserCollectionItem[]> {
  let items = collectionStore.filter(item => item.userId === userId);
  if (listType) {
    items = items.filter(item => item.listType === listType);
  }
  return items;
}

export async function getAllUserCollections(): Promise<UserCollectionItem[]> {
  // TODO: replace with paginated D1 query when D1 is wired
  return collectionStore.slice(0, 5000);
}

export async function addCollectionItem(userId: string, payload: CollectionRequestPayload): Promise<UserCollectionItem> {
  const validListTypes: ListType[] = ['collection', 'wishlist', 'trade'];
  const validConditions: ConditionGrade[] = ['MNH', 'MH', 'Used', 'FDC'];

  if (!payload.stampId || !payload.listType) {
    throw new Error("Missing required fields: stampId and listType");
  }

  if (!validListTypes.includes(payload.listType)) {
    throw new Error(`Invalid list_type '${payload.listType}'. Must be collection, wishlist, or trade.`);
  }

  const condition: ConditionGrade = payload.condition || 'MNH';
  if (!validConditions.includes(condition)) {
    throw new Error(`Invalid condition '${condition}'. Must be MNH, MH, Used, or FDC.`);
  }

  // Check unique constraint (user_id, stamp_id, list_type)
  const existing = collectionStore.find(
    item => item.userId === userId && item.stampId === payload.stampId && item.listType === payload.listType
  );

  const now = new Date().toISOString();

  if (existing) {
    existing.condition = condition;
    if (payload.notes !== undefined) existing.notes = payload.notes;
    existing.updatedAt = now;
    return existing;
  }

  const newItem: UserCollectionItem = {
    id: nextId++,
    userId,
    stampId: payload.stampId,
    listType: payload.listType,
    condition,
    notes: payload.notes || "",
    createdAt: now,
    updatedAt: now,
    stampTitle: `Sello ${payload.stampId}`,
  };

  collectionStore.push(newItem);
  return newItem;
}

export async function updateCollectionItem(
  userId: string,
  id: number,
  updates: { condition?: ConditionGrade; notes?: string }
): Promise<UserCollectionItem> {
  const item = collectionStore.find(i => i.id === id && i.userId === userId);
  if (!item) {
    throw new Error("Collection item not found");
  }

  if (updates.condition) {
    const validConditions: ConditionGrade[] = ['MNH', 'MH', 'Used', 'FDC'];
    if (!validConditions.includes(updates.condition)) {
      throw new Error(`Invalid condition '${updates.condition}'`);
    }
    item.condition = updates.condition;
  }

  if (updates.notes !== undefined) {
    item.notes = updates.notes;
  }

  item.updatedAt = new Date().toISOString();
  return item;
}

export async function deleteCollectionItem(userId: string, id: number): Promise<boolean> {
  const initialLength = collectionStore.length;
  collectionStore = collectionStore.filter(i => !(i.id === id && i.userId === userId));
  return collectionStore.length < initialLength;
}
