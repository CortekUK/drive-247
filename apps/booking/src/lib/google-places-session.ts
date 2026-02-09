/**
 * Manages Google Places session tokens to batch autocomplete + fetchFields
 * into a single billing session (~$2.83/1000 sessions vs per-request pricing).
 *
 * Usage: call getToken() for autocomplete requests, then refreshToken()
 * after a place is selected (fetchFields consumes the session).
 */
export class PlacesSessionManager {
  private token: google.maps.places.AutocompleteSessionToken | null = null;

  getToken(): google.maps.places.AutocompleteSessionToken {
    if (!this.token) {
      this.token = new google.maps.places.AutocompleteSessionToken();
    }
    return this.token;
  }

  refreshToken(): void {
    this.token = new google.maps.places.AutocompleteSessionToken();
  }
}
