/** What the operator map needs about one operator. Shared by the server reader and the map. */
export interface MapOperator {
  slug: string;
  name: string;
  /** The operator's uploaded logo in our own storage, or null to show their name instead. */
  logo: string | null;
  /** Their share of all the activity on the map, 0 to 1. Drives the tile's area. */
  share: number;
}
