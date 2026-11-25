# Example feature section

A made-up feature, to show the shape and the tone. It is not a real Drive247 feature and it is
never copied into `PRD.md`.

## feat-000 · Birthday discount for renters

**Status:** Planned · **Built by:** (example) · **Folder:** `feat-000-birthday-discount`

### In one line

A renter who books a car for the week of their birthday gets 10% off the rental.

### Why we have it

Operators asked for a simple way to bring past renters back. A birthday is a date we already know, and a small discount around it gives the operator a reason to get in touch once a year.

### Who it is for

- **A renter**: someone who has rented from the operator before and has a date of birth on their profile.
- **An operator**: the rental company, who decides whether to offer it.
- **Our team**: who want to see whether operators use it.

### What happens

1. **An operator turns it on.** In their settings they switch on "Birthday discount". It is off until they do.
2. **A renter's birthday is a week away.** They get one email from the operator: "It's nearly your birthday. Take 10% off a rental that week."
3. **The renter books a car for that week.** At the price step they see the normal price crossed out and the birthday price beside it. They do not type a code.
4. **The renter books for a different week.** They see the normal price. Nothing mentions the birthday.
5. **The renter has no date of birth on their profile.** They get no email and no discount. Nothing tells them they missed out.
6. **The renter already has another discount on the booking.** They get whichever is larger, never both.
7. **The operator turns it off.** Emails stop from that moment. Bookings already made keep their price.

### The rules

- The discount is 10% off the rental price. Extras, insurance and the deposit are not discounted.
- "Birthday week" is the 3 days before the birthday, the day itself, and the 3 days after.
- The rental must start inside the birthday week.
- One birthday booking per renter per year.
- The renter must have completed at least one rental with that operator before.
- One discount per booking. The larger one wins.

### What it does not do

- It does not apply to a renter's first ever booking.
- It does not change a booking that was made before the email went out.
- It does not let the operator pick a different percentage.
- It does not send a text message, only an email.

### How we know it is working

- The operator sees how many birthday emails went out and how many turned into bookings, on their dashboard.
- Our team can see how many operators have it switched on.
