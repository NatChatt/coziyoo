export type MealCard = {
  id: string;
  title: string;
  sellerId: string;
  seller: string;
  sellerUsername?: string | null;
  sellerImage?: string | null;
  sellerTagline?: string | null;
  sellerHomeCardImage?: string | null;
  allergens: string[];
  ingredients: string[];
  menuItems: string[];
  addons: Array<{
    name: string;
    kind: 'sauce' | 'extra' | 'appetizer';
    pricing: 'free' | 'paid';
    price?: number;
  }>;
  description: string;
  cuisine: string;
  lotId?: string | null;
  stock: number;
  rating: string;
  time: string;
  distance: string;
  price: string;
  deliveryFee: number;
  deliveryOptions: {
    pickup: boolean;
    delivery: boolean;
  };
  backgroundColor: string;
  category: string;
  imageUrl?: string;
  imageUrls?: string[];
  locationBasisLabel?: string;
};
