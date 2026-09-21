# Notifications v2 and Pricing cleanup: team lead's walkthrough, in English

Source: the team lead's recorded walkthrough, "Pricing cleanup and the new Notifications page" (21:06), recorded in Hindi/Urdu.
Branch: `haseeb/notifications-v2`. Scope: v2 only. Northwind gets it; every other tenant keeps today's screens.

Timestamps like `[01:40]` point into the video. The transcript has gaps (for example 01:52–02:24 and 15:25–15:52), and he points at the screen a lot ("this one", "here"). Check the video wherever this document marks something **Unclear**.

---

## Part 1: Pricing (00:01 – 04:02)

### 1.1 What goes inside Pricing
- `[00:01]` Pricing will contain **rules**. The fees, tax and deposit settings become one rule inside Pricing.
- `[00:10]` Next to that rule sits the page we currently call **"Custom pricing"**.

### 1.2 Rename "Custom pricing"
- `[00:10–00:27]` "Custom pricing" sounds like we are customising a single price. It is really about **weekend and holiday pricing**, so give it a clearer name (something like "Weekend & holiday pricing").

### 1.3 Move the monthly rate to General
- `[00:33–00:46]` The **"Monthly rate starts at"** setting moves to **General**.
- `[00:54–01:24]` General is organised under headings: **Regional**, then **Driver requirements**, and the monthly setting goes somewhere under those. He says the monthly setting is "general in the true sense".
- **Unclear `[00:54–01:05]`:** he says that last time he asked for tabs here, then says "yahan par tab na bana do". That can mean "just make a tab here" or "don't make tabs here". What follows describes **headings/sections** on the General page, which suggests sections, not tabs. Confirm with him.

### 1.4 Tidy the weekend/holiday pricing UI
- `[01:24–01:40]` Weekend pricing is not in testing yet, but everything on the page must still make sense.
- `[01:40–01:52]` He does not understand what one area of the page is for. The UI looks bad, and one block "has taken up a whole table's worth of space".
- `[01:52]` The feature was built 7–8 months ago, so we will not show it off (it isn't featured).
- `[02:24]` "We'll move it to the **end**. You only need to fix its **UI**." The weekend/holiday block goes at the end of the page, and the work is UI-only.
- `[02:57–03:07]` "Please fix this table. I don't know what this mess is or where it comes from." The tables themselves were built correctly, but **this problem shows up on all of them**. That points to a shared table-styling bug across the v2 settings tables, not something specific to this one table.
- `[03:11–03:31]` Test it: delete one or two holidays and check the **delete state**; add a holiday and check the **add state**.

### 1.5 Trax suggestions placement
- `[03:39–03:48]` The animation is wrong. It is the same mistake discussed before. Trax slides in from its own side, but here the Trax suggestions came in **in the middle of the section**. Fix where they appear.

### 1.6 Wrap-up of Pricing
- `[03:56–04:02]` The renamed "custom pricing" becomes one section of Pricing, and the other section (the fees, tax and deposit rule) sits beside it.

---

## Part 2: A new "Templates" section (04:11)

- `[04:11]` Create a new section called **Templates**. (He moves straight on to notifications. The notification templates below are what it holds.)

---

## Part 3: The Notifications page (04:19 – 21:06)

### 3.1 Why this matters
- `[04:25–04:35]` Notifications are one of our most important features. Clients often complain that they didn't know something would happen, or when.

### 3.2 The channels
- `[04:35–04:52]` **Push notifications** arrive on the phone like a WhatsApp message. Push is built and switched on only for **Northwind**, which we use as our test tenant. (He says he just hasn't enabled it from the backend for others.)
- `[04:59]` **Email notifications.**
- `[17:52–18:14]` He forgot to mention a third channel earlier: **in-app notifications**. These are the bell icon in the portal, and **customers can receive in-app notifications too**, not only operators.
- `[18:46–19:02]` So every notification has **three options: Email, Push and In-app**. Each has its own **edit** view and its own **preview**. The operator chooses what goes out on which channel. "I guess this would be a killer feature."

### 3.3 One page for everything
- `[05:14–05:23]` For every notification we need to sort out three things: its **template**, **when it's sent**, and its **preview**.
- `[05:39]` It is **one single page** where the operator maintains all of it, organised in sections.

### 3.4 Make every entry deliberately; don't let AI guess
- `[05:59–06:07]` "We must **not** just prompt Claude and accept whatever makes sense to it. **We will make sense of every single place ourselves.**"
- Every notification in the catalogue must come from a real event the system actually sends, and be checked by a person.

### 3.5 Directions
- `[06:13–06:35]` Worked example: a customer makes a booking on the **booking site** while the operator is in the **portal**.
- `[06:35–06:52]` When he says "notification" he means push and email (and later in-app).
- `[06:52–07:14]` Group notifications by **direction**:
  - **Customer → Admin.** The customer does something (for example books or pays) and the rental admin gets notified. ("Admin" means the rental operator.)
  - **Admin → Customer.** The operator does something and the customer gets notified.
- `[07:30–08:30]` There is a second, **system** set, handled **after** the main set:
  - **Super admin → Admin**: we (Drive247) do something and the operator is notified.
  - **Admin → Super admin**: the operator does something and we are notified.
  - **Super admin → Everyone**: all operators and all of their customers together.
- `[16:39–16:48]` For the system set, build **the same thing in the super admin dashboard** for our own use. It is part of this work, but it comes after the main set.

### 3.6 Categories, then granular items
- `[08:59–09:15]` Create **categories first**. Example category: **Booking**. Its first item: **Booking confirmation**.
- `[09:27–09:55]` Imagine you are the rental admin. You open Settings → Notifications because you want to be told whenever someone pays on the booking site. You naturally look for the **Booking** heading, open it, and find **"Booking confirmation"**.
- `[09:58]` There will be many sub-items and they will be granular, but **every item must make sense on its own**, and **every item gets a tooltip**.
- `[14:24–14:36]` Booking alone will have roughly **8–10 cases**.

### 3.7 Channel toggles and push display style
- `[10:09]` Inside an item such as Booking confirmation, the operator can switch **Email** on.
- `[10:30–10:48]` He compares it to Android, which asks how a notification should appear: as a **banner**, **once**, or on the **lock screen**. Then he says "it's not exactly that thing".
  - **Unclear:** is this a request for push display-style options, or only an analogy for choosing channels? The ticket reads it as display options. Check the video.
- `[10:48]` Each item offers the channels **Email** and **Push** (plus **In-app**, added later at 17:52). `[12:51]` Several channels can be on at once.

### 3.8 Email: editor, preview and send test
- `[10:58–11:23]` Switching Email on opens a large box with the template. The template already holds a **default we wrote**, and the operator can edit it properly.
- `[11:23–11:36]` Replace the **ugly WYSIWYG** editor we use today with a **Notion-like editor**.
- `[13:50–14:11]` The editor must be good quality, but **not heavy**. "While building a good editor we tend to make it too heavy. That should not be the case." The old ugly **inline** editor must go.
- `[11:40–11:51]` The **preview** must show the email **exactly as it will look in Gmail**, as the customer will see it.
- `[12:02–12:12]` A **Send test** button opens a box **underneath**. The operator's email is **filled in by default** and they can change it. We then send the test email to that address.

### 3.9 Push: preview and test
- `[12:24–12:53]` Selecting Push opens the same big box with its own view and preview.
- `[13:04]` A push has two parts: a **title** and a **description**.
- `[13:14–13:35]` **How many characters show** matters, and marketers care a lot about it. His example: in "My name is Ghulam Muhyuddin, my name is Ghulam", the text gets cut at "Muhyu…". The preview must show **exactly where the "…" appears**.
- `[13:35–13:42]` The operator can **send a test push to themselves**. When they press Test, it arrives on their own device or window.
- `[16:48–17:12]` Push already works (via add-to-home-screen, and a test push arrives). Add the **"Open in app"** action to push notifications.

### 3.10 Drafts and saving
- `[14:15–14:24]` Operators can **draft** a template and save it with **the same save flow we already use** (the v2 settings sticky save bar).

### 3.11 Defaults and variables
- `[14:36–14:46]` Every case comes with a **meaningful default template**.
- `[14:46–15:17]` Templates need **variables** (customer name, amount and so on), because notifications are not static.
  - Show example values in the preview (for example "700 USD").
  - Give the operator a way to **insert and manage variables**.

### 3.12 Plain-English description on each notification
- `[15:25–16:05]` Each email or notification states clearly, in plain English:
  - **When** it's sent, for example "When a booking is confirmed".
  - **Where** it's triggered: the **booking site** or the **portal**.
  - Its **direction**: "Admin → Customer", or "Customer → Admin".

### 3.13 Global channel settings
- `[19:35–19:59]` Email has an **overall setting**:
  - **Which email address we send from.** This is the only thing to change.
  - **CC:** if people are already CC'd, leave CC as it is. He has a CC issue of his own to sort out.
- `[20:11–20:18]` Once email or push is enabled, the operator can **change these settings later**.

### 3.14 Push setup flow (built, currently hidden)
- `[19:09–19:16]` Push must be **enabled first**. The whole flow is already built and only hidden. **Reuse it.**
- `[20:18–20:46]` Push needs:
  1. **Installing the app on the phone's home screen** (PWA install).
  2. **Granting notification permission.**
  3. A final check on the phone.

  **All the instructions and permission steps appear on this page.** Once installed, notifications start arriving. It's a "comprehensive check" flow.

### 3.15 Working agreement
- `[20:55]` Ask him whenever part of the push flow is unclear.
- `[21:01]` **Get his approval step by step as the work goes.**

---

## Open questions for the team lead
1. **General page, tabs or headings?** (`00:54–01:05`) Is "tab na bana do" "make a tab" or "don't make tabs"? The rest of the passage describes headings.
2. **Push display style** (`10:30–10:48`): does he want per-notification display options? Browsers can't force banner vs lock-screen; the phone's OS and the user decide. Web push can offer **"stay on screen until dismissed"**, **silent**, and **replace the previous one**.
3. **"Templates" section** (`04:11`): a new Settings index group holding Notifications, Customer messages and Agreement? Or a rename of "Customer messages"?
4. **The table problem "on all of them"** (`03:07`): which visual glitch did he mean? It is visible only in the video.
5. **Super admin set**: confirm it comes after the operator set has been approved.
