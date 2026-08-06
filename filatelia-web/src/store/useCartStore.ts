import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface CartItem {
  id: string
  title: string
  price: number
  quantity: number
  image?: string
  scott?: string
  // ISO currency code ('USD' | 'PEN') the `price` above is denominated in,
  // or null/undefined when the source catalog row hasn't declared one yet
  // (most `Product` rows today — see db/migrations/0011_add_product_currency.sql).
  // Never guessed or defaulted; the checkout UI must show "unknown" rather
  // than a number that implies a currency.
  currency?: string | null
}

interface CartStore {
  items: CartItem[]
  isOpen: boolean
  addItem: (item: CartItem) => void
  removeItem: (id: string) => void
  updateQuantity: (id: string, quantity: number) => void
  clearCart: () => void
  getTotal: () => number
  getItemCount: () => number
  openCart: () => void
  closeCart: () => void
  toggleCart: () => void
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      isOpen: false,
      
      addItem: (newItem) => {
        const currentItems = get().items
        const existingItem = currentItems.find((item) => item.id === newItem.id)

        if (existingItem) {
          set({
            items: currentItems.map((item) =>
              item.id === newItem.id
                ? { ...item, quantity: item.quantity + 1 }
                : item
            ),
            isOpen: true // Abrir carrito al añadir
          })
        } else {
          set({ 
            items: [...currentItems, { ...newItem, quantity: 1 }],
            isOpen: true // Abrir carrito al añadir
          })
        }
      },

      removeItem: (id) => {
        set({ items: get().items.filter((item) => item.id !== id) })
      },

      updateQuantity: (id, quantity) => {
        if (quantity <= 0) {
          get().removeItem(id)
          return
        }
        set({
          items: get().items.map((item) =>
            item.id === id ? { ...item, quantity } : item
          ),
        })
      },

      clearCart: () => set({ items: [] }),

      // CURRENCY-UNAWARE by design: this sums raw numbers regardless of
      // each item's `currency`, which is meaningless for a mixed-currency
      // cart. Kept only as a raw arithmetic helper; anything that RENDERS
      // a total to the buyer must go through
      // `summarizeCartCurrency()` (src/lib/orderCurrency.ts) instead, which
      // refuses to produce a total for an unknown or mixed-currency cart.
      getTotal: () => {
        return get().items.reduce((total, item) => total + item.price * item.quantity, 0)
      },

      getItemCount: () => {
        return get().items.reduce((count, item) => count + item.quantity, 0)
      },

      openCart: () => set({ isOpen: true }),
      closeCart: () => set({ isOpen: false }),
      toggleCart: () => set({ isOpen: !get().isOpen }),
    }),
    {
      name: 'filatelia-cart',
    }
  )
)
