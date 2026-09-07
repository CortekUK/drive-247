"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * Identity — name, contact, address, and who to call if something happens.
 *
 * Pure input: nothing on this section is produced from anything else, so
 * nothing here can be out of date. Everything here is READ by Verification,
 * which is why an edit made on this section is what puts that verdict in amber.
 *
 * Every field writes through `set`, which paints on the keystroke and persists
 * after a pause. There is no Save button because there is nothing to save — the
 * record already exists.
 * ────────────────────────────────────────────────────────────────────────── */

import { Building2, User } from "lucide-react";
import { Field, OptionCard, Panel, Section, Thumb, inputCls } from "./kit";
import type { SectionProps } from "./sections";
import { readSomething } from "./derive";

/** The zones an operator actually picks from. `timezone` is free text in the
 *  database, so an unrecognised value is kept and shown rather than replaced. */
const US_TIMEZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"];

export function SectionIdentity({ c, set, onJump, canEdit }: SectionProps) {
  const isCompany = c.identity.customerType === "Company";
  const zones = c.identity.timezone && !US_TIMEZONES.includes(c.identity.timezone)
    ? [c.identity.timezone, ...US_TIMEZONES]
    : US_TIMEZONES;

  return (
    <Panel
      title="Identity"
      description="Who this person is. Typing here changes the record — there is nothing to save."
    >
      <Section title="Contact">
        {c.identity.profilePhotoUrl && (
          <div className="mb-6 flex items-center gap-4">
            <Thumb className="size-16 shrink-0 rounded-4xl" src={c.identity.profilePhotoUrl} />
            <div className="min-w-0">
              <p className="font-heading text-sm font-semibold">Profile photo</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Shown to staff on the handover screen so the right person gets the keys.
              </p>
            </div>
          </div>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Full name">
              <input
                className={inputCls}
                disabled={!canEdit}
                value={c.identity.name}
                placeholder="e.g. Marcus Adeyemi"
                onChange={(e) => set({ name: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Email" hint="Optional — plenty of live customers have none, so nothing may depend on it.">
            <input
              className={inputCls}
              disabled={!canEdit}
              value={c.identity.email}
              placeholder="name@example.com"
              onChange={(e) => set({ email: e.target.value })}
            />
          </Field>
          <Field label="Phone">
            <input
              className={inputCls}
              disabled={!canEdit}
              value={c.identity.phone}
              placeholder="+1 (000) 000-0000"
              onChange={(e) => set({ phone: e.target.value })}
            />
          </Field>
          <Field label="Date of birth" hint="Used for the minimum-age check at handover.">
            <input
              type="date"
              className={inputCls}
              disabled={!canEdit}
              value={c.identity.dob}
              onChange={(e) => set({ date_of_birth: e.target.value })}
            />
          </Field>
          <Field label="Timezone" hint="When their reminders and lockbox codes are sent.">
            <select
              className={inputCls}
              disabled={!canEdit}
              value={c.identity.timezone}
              onChange={(e) => set({ timezone: e.target.value })}
            >
              <option value="">Not set</option>
              {zones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace("America/", "").replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      <Section title="Address" description="The verification provider reads this back off the licence.">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Street">
              <input
                className={inputCls}
                disabled={!canEdit}
                value={c.identity.street}
                placeholder="418 Riverside Ave, Apt 6B"
                onChange={(e) => set({ address_street: e.target.value })}
              />
            </Field>
          </div>
          <Field label="City">
            <input
              className={inputCls}
              disabled={!canEdit}
              value={c.identity.city}
              placeholder="Jacksonville"
              onChange={(e) => set({ address_city: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="State">
              <input
                className={inputCls}
                disabled={!canEdit}
                value={c.identity.state}
                placeholder="FL"
                maxLength={2}
                onChange={(e) => set({ address_state: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label="ZIP">
              <input
                className={inputCls}
                disabled={!canEdit}
                value={c.identity.zip}
                placeholder="32204"
                onChange={(e) => set({ address_zip: e.target.value })}
              />
            </Field>
          </div>
        </div>
      </Section>

      <Section
        title="Account holder"
        description="A company account bills and signs under the business, not the driver."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <OptionCard
            selected={!isCompany}
            disabled={!canEdit}
            onClick={() => set({ customer_type: "Individual" })}
            title="Individual"
            subtitle="Renting in their own name"
            right={<User className="size-4 shrink-0 text-muted-foreground" />}
          />
          <OptionCard
            selected={isCompany}
            disabled={!canEdit}
            onClick={() => set({ customer_type: "Company" })}
            title="Company"
            subtitle="Renting on behalf of a business"
            right={<Building2 className="size-4 shrink-0 text-muted-foreground" />}
          />
        </div>

        {isCompany && (
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <Field label="Company name">
              <input
                className={inputCls}
                disabled={!canEdit}
                value={c.identity.companyName}
                placeholder="e.g. Riverside Logistics LLC"
                onChange={(e) => set({ company_name: e.target.value })}
              />
            </Field>
            <Field label="Registration number">
              <input
                className={inputCls}
                disabled={!canEdit}
                value={c.identity.companyRegistration}
                placeholder="e.g. L26000148821"
                onChange={(e) => set({ company_registration: e.target.value })}
              />
            </Field>
          </div>
        )}
      </Section>

      <Section
        title="Next of kin"
        description="Who we call if something happens to the driver while the car is out."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Full name">
            <input
              className={inputCls}
              disabled={!canEdit}
              value={c.identity.nok.name}
              onChange={(e) => set({ nok_full_name: e.target.value })}
            />
          </Field>
          <Field label="Relationship">
            <input
              className={inputCls}
              disabled={!canEdit}
              value={c.identity.nok.relationship}
              placeholder="e.g. Sister"
              onChange={(e) => set({ nok_relationship: e.target.value })}
            />
          </Field>
          <Field label="Phone">
            <input
              className={inputCls}
              disabled={!canEdit}
              value={c.identity.nok.phone}
              onChange={(e) => set({ nok_phone: e.target.value })}
            />
          </Field>
          <Field label="Email">
            <input
              className={inputCls}
              disabled={!canEdit}
              value={c.identity.nok.email}
              onChange={(e) => set({ nok_email: e.target.value })}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Address">
              <input
                className={inputCls}
                disabled={!canEdit}
                value={c.identity.nok.address}
                placeholder="Street, city, state, ZIP"
                onChange={(e) => set({ nok_address: e.target.value })}
              />
            </Field>
          </div>
        </div>
      </Section>

      {readSomething(c) && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          The name, date of birth and address on this panel are among the values the identity verdict
          was issued against — so editing any of them will put{" "}
          <button
            type="button"
            onClick={() => onJump("verification")}
            className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
          >
            Verification
          </button>{" "}
          out of date. That is not a warning; it is the screen doing its job.
        </p>
      )}
    </Panel>
  );
}
