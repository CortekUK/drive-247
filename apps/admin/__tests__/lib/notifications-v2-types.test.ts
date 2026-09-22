import { describe, it, expect } from "vitest";
import {
  EMAIL_SENDER_DOMAIN,
  NOTIFICATION_CHANNELS,
  SYSTEM_DIRECTION_AUDIENCE,
  SYSTEM_NOTIFICATION_DIRECTIONS,
  type SystemAudience,
  type SystemNotificationDirection,
} from "@/lib/notifications-v2/types";

/**
 * The contract the whole system set is built on. These assert the exported
 * VALUES — the directions the lead named (transcript §3.5, 07:30–08:30) and the
 * audience each one reaches — not the wording of the file.
 */

describe("channels", () => {
  it("are the three the lead asked for, in display order", () => {
    expect(NOTIFICATION_CHANNELS).toEqual(["email", "push", "in_app"]);
  });
});

describe("the three system directions", () => {
  it("cover super admin → admin, admin → super admin and super admin → everyone", () => {
    expect(SYSTEM_NOTIFICATION_DIRECTIONS).toEqual([
      "platform_to_operator",
      "operator_to_platform",
      "platform_to_everyone",
    ]);
  });

  it("are distinct, and none of them is one of the portal's two", () => {
    const set = new Set<string>(SYSTEM_NOTIFICATION_DIRECTIONS);
    expect(set.size).toBe(SYSTEM_NOTIFICATION_DIRECTIONS.length);
    for (const portalDirection of ["customer_to_team", "team_to_customer"]) {
      expect(set.has(portalDirection)).toBe(false);
    }
  });

  it("each reach exactly one audience", () => {
    const audiences: SystemAudience[] = SYSTEM_NOTIFICATION_DIRECTIONS.map((d) => SYSTEM_DIRECTION_AUDIENCE[d]);
    expect(audiences).toEqual(["operators", "platform", "everyone"]);
  });

  it("have an audience for every direction and no extras", () => {
    const mapped = Object.keys(SYSTEM_DIRECTION_AUDIENCE) as SystemNotificationDirection[];
    expect(mapped.slice().sort()).toEqual(SYSTEM_NOTIFICATION_DIRECTIONS.slice().sort());
  });

  it("sends the broadcast to operators AND customers, which neither one-way direction does", () => {
    expect(SYSTEM_DIRECTION_AUDIENCE.platform_to_everyone).toBe("everyone");
    expect(SYSTEM_DIRECTION_AUDIENCE.platform_to_operator).not.toBe("everyone");
    expect(SYSTEM_DIRECTION_AUDIENCE.operator_to_platform).not.toBe("everyone");
  });
});

describe("the sending domain", () => {
  it("is the one the platform owns", () => {
    expect(EMAIL_SENDER_DOMAIN).toBe("drive-247.com");
  });
});
