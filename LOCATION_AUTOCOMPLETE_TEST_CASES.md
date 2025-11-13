# Location Autocomplete Test Cases

## Test Case 1: Basic Autocomplete Functionality
**Objective**: Verify that location suggestions appear when typing

**Steps**:
1. Navigate to the booking page
2. Click on "Pickup Location" field
3. Type "London" (at least 3 characters)
4. Wait for suggestions to load

**Expected Result**:
- Loading spinner appears while fetching
- A dropdown with 5 or fewer location suggestions appears
- Each suggestion shows:
  - A map pin icon
  - Main location name (e.g., "London")
  - Secondary address details (e.g., "Greater London, England, United Kingdom")

**Test Data**: "London"

---

## Test Case 2: Distance Calculation - Short Distance
**Objective**: Verify accurate distance calculation for nearby locations

**Steps**:
1. In "Pickup Location", type "Piccadilly Circus"
2. Select "Piccadilly Circus, Westminster, Greater London, England, United Kingdom" from suggestions
3. In "Drop-off Location", type "Buckingham Palace"
4. Select "Buckingham Palace, City of Westminster, Greater London, England, SW1A 1AA, United Kingdom" from suggestions
5. Click "Calculate Distance" button

**Expected Result**:
- Success toast shows: "Estimated distance: X.X miles (as the crow flies)"
- Distance should be approximately **1.0-1.2 miles**
- The "Estimated Miles" field is auto-filled with the calculated value

**Test Coordinates**:
- Piccadilly Circus: 51.5099° N, 0.1342° W
- Buckingham Palace: 51.5014° N, 0.1419° W

---

## Test Case 3: Distance Calculation - Medium Distance
**Objective**: Verify distance calculation for medium-range journeys

**Steps**:
1. In "Pickup Location", type "Heathrow Airport"
2. Select "London Heathrow Airport, Longford, Greater London, England, United Kingdom" from suggestions
3. In "Drop-off Location", type "Oxford"
4. Select "Oxford, Oxfordshire, England, United Kingdom" from suggestions
5. Click "Calculate Distance" button

**Expected Result**:
- Success toast appears
- Distance should be approximately **40-45 miles**
- Estimated Miles field updates automatically

**Test Coordinates**:
- Heathrow Airport: 51.4700° N, 0.4543° W
- Oxford: 51.7520° N, 1.2577° W

---

## Test Case 4: Distance Calculation - Long Distance
**Objective**: Verify distance calculation for long-distance journeys

**Steps**:
1. In "Pickup Location", type "London"
2. Select "London, Greater London, England, United Kingdom"
3. In "Drop-off Location", type "Edinburgh"
4. Select "Edinburgh, City of Edinburgh, Scotland, United Kingdom"
5. Click "Calculate Distance" button

**Expected Result**:
- Distance should be approximately **330-340 miles**
- "Long drive (4+ hours)" checkbox should be manually checked by user
- Success toast displays the calculated distance

**Test Coordinates**:
- London: 51.5074° N, 0.1278° W
- Edinburgh: 55.9533° N, 3.1883° W

---

## Test Case 5: Error Handling - No Location Selected
**Objective**: Verify error handling when calculating without selecting from suggestions

**Steps**:
1. In "Pickup Location", type "London" but DO NOT select from dropdown (just type and click away)
2. In "Drop-off Location", type "Manchester" but DO NOT select from dropdown
3. Click "Calculate Distance" button

**Expected Result**:
- Error toast appears: "Please select both pickup and dropoff locations from the suggestions"
- No distance is calculated
- Estimated Miles field remains empty

---

## Test Case 6: Debounce Functionality
**Objective**: Verify that API calls are debounced (not made on every keystroke)

**Steps**:
1. Open browser DevTools Network tab
2. Click on "Pickup Location" field
3. Type "Manchester" quickly (one character at a time)
4. Observe network requests

**Expected Result**:
- API calls to `nominatim.openstreetmap.org` should NOT happen after each keystroke
- Only ONE API call should be made after typing stops (300ms delay)
- Loading spinner appears during the delay

---

## Test Case 7: Click Outside to Close
**Objective**: Verify that dropdown closes when clicking outside

**Steps**:
1. In "Pickup Location", type "Birmingham"
2. Wait for suggestions to appear
3. Click anywhere outside the dropdown (e.g., on the "Pickup Date" field)

**Expected Result**:
- Dropdown suggestions disappear
- Typed text remains in the input field
- No location coordinates are stored (since no selection was made)

---

## Test Case 8: Selecting Same Location for Pickup and Dropoff
**Objective**: Verify system behavior with identical locations

**Steps**:
1. In "Pickup Location", type and select "Manchester, Greater Manchester, England, United Kingdom"
2. In "Drop-off Location", type and select the same "Manchester, Greater Manchester, England, United Kingdom"
3. Click "Calculate Distance"

**Expected Result**:
- Distance calculated should be **0.0 miles** or very close to 0
- Success toast appears
- No errors occur

---

## Test Case 9: International Locations (Outside UK)
**Objective**: Verify that only UK locations appear (country restriction)

**Steps**:
1. In "Pickup Location", type "Paris"
2. Observe suggestions

**Expected Result**:
- NO suggestions for "Paris, France" should appear
- Only UK locations with "Paris" in the name (if any) should appear
- If no UK matches exist, dropdown shows no results

**Note**: Current configuration restricts to `countrycodes=gb`. To test other countries, change line 65 in LocationAutocomplete.tsx

---

## Test Case 10: Special Characters and Postcodes
**Objective**: Verify search works with UK postcodes

**Steps**:
1. In "Pickup Location", type "SW1A 1AA"
2. Wait for suggestions

**Expected Result**:
- Suggestions appear with locations matching postcode
- "Buckingham Palace" area should appear in results
- Selecting a result populates the full address

**Test Data**: "SW1A 1AA" (Buckingham Palace postcode)

---

## Test Case 11: Minimum Character Validation
**Objective**: Verify that suggestions don't appear with less than 3 characters

**Steps**:
1. In "Pickup Location", type "Lo" (only 2 characters)
2. Observe behavior

**Expected Result**:
- NO dropdown appears
- No API call is made
- No loading spinner appears

**Steps (continued)**:
3. Type one more character: "Lon"
4. Observe behavior

**Expected Result**:
- Loading spinner appears
- API call is made after 300ms
- Dropdown with suggestions appears

---

## Additional Test Data for UK Locations

### Popular UK Test Locations:
1. **Airports**:
   - Heathrow Airport
   - Gatwick Airport
   - Manchester Airport
   - Birmingham Airport

2. **Major Cities**:
   - London
   - Manchester
   - Birmingham
   - Liverpool
   - Leeds
   - Glasgow
   - Edinburgh

3. **Specific Addresses**:
   - 10 Downing Street, London
   - Buckingham Palace
   - Tower Bridge, London
   - Trafalgar Square

4. **Postcodes**:
   - SW1A 1AA (Buckingham Palace)
   - W1D 3QU (Piccadilly Circus area)
   - M1 1AD (Manchester city centre)

---

## Known Limitations

1. **Distance Type**: The calculated distance is "as the crow flies" (straight-line Haversine formula), not actual driving distance. Real driving distance will be longer due to roads.

2. **Country Restriction**: Currently restricted to UK locations only (`countrycodes=gb` in API call).

3. **API Rate Limits**: Nominatim has usage limits. Excessive testing may result in temporary blocks. Use responsibly.

4. **No Road Routing**: For actual driving distance, you would need to integrate a routing service (e.g., OSRM, Mapbox, Google Directions).

---

## Success Criteria

All test cases should pass with:
- ✅ Autocomplete working for all UK locations
- ✅ Distance calculations accurate within ±5% of expected values
- ✅ No console errors
- ✅ Smooth UX with loading states
- ✅ Proper error handling for edge cases
