export type Promotion = {
  id: string;
  badge: string;
  title: string;
  discount: string;
  caption: string;
  validUntil: string;
  image: string;
  imageAlt: string;
  accent: "amber" | "forest" | "stone" | "deep";
};

export const PROMOTIONS: Promotion[] = [
  {
    id: "early-bird",
    badge: "Early Bird",
    title: "Save",
    discount: "15%",
    caption: "Book 30 days in advance and save 15%.",
    validUntil: "Valid till 3rd March 2026",
    image: "/booking_landingpage/promo-early-bird.jpg",
    imageAlt: "White Range Rover at sunrise",
    accent: "amber",
  },
  {
    id: "ev-explorer",
    badge: "EV Explorer",
    title: "Deal",
    discount: "20% OFF",
    caption: "Drive electric on weekday rentals and save 20%.",
    validUntil: "Valid till 3rd March 2026",
    image: "/booking_landingpage/promo-ev-explorer.jpg",
    imageAlt: "BMW electric SUV at a charging point",
    accent: "forest",
  },
  {
    id: "weekend-escape",
    badge: "Weekend Escape",
    title: "Friday → Monday",
    discount: "10% OFF",
    caption: "Pick up Friday, return Monday — three days, one fixed rate.",
    validUntil: "Valid till 3rd March 2026",
    image: "/booking_landingpage/promo-weekend-escape.jpg",
    imageAlt: "Black Toyota Land Cruiser with roof rack",
    accent: "stone",
  },
  {
    id: "business-class",
    badge: "Business Class",
    title: "Loyalty",
    discount: "25% OFF",
    caption: "Five rentals or more this quarter unlocks a premium tier rate.",
    validUntil: "Valid till 3rd March 2026",
    image: "/booking_landingpage/promo-business-class.jpg",
    imageAlt: "Black Porsche Panamera at dusk",
    accent: "deep",
  },
];
